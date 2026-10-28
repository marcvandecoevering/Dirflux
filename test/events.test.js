import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createApp} from '../server.js';

async function stream(t,options){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'event-settings-'));
  const app=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),publicMode:true,watch:false,pollingInterval:0,...options});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const session=await fetch(base+'/api/session');const user=await session.json();
  const controller=new AbortController();
  const response=await fetch(base+'/api/events',{headers:{Cookie:session.headers.get('set-cookie').split(';')[0]},signal:controller.signal});
  const reader=response.body.getReader(),chunks=[];
  const reading=(async()=>{try{while(true){const {done,value}=await reader.read();if(done)break;chunks.push({at:performance.now(),text:new TextDecoder().decode(value)});}}catch(error){if(error.name!=='AbortError')throw error;}})();
  t.after(async()=>{controller.abort();await reading;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));app.close();await fs.rm(temp,{recursive:true,force:true});});
  return {chunks,ended:reading,logout:()=>fetch(base+'/api/logout',{method:'POST',headers:{Cookie:session.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':user.csrf}})};
}

test('continuous polling coalesces notifications without indefinitely postponing updates',async t=>{
  const {chunks}=await stream(t,{pollingInterval:20,updateInterval:120,keepAlive:0});
  await delay(650);
  const changes=chunks.flatMap(chunk=>Array.from(chunk.text.matchAll(/event: change/g),()=>chunk.at));
  assert.ok(changes.length>=3&&changes.length<=6,`Expected bounded ongoing notifications, got ${changes.length}`);
  for(let n=1;n<changes.length;n++)assert.ok(changes[n]-changes[n-1]>=85,'Changes should be coalesced');
  assert.ok(chunks.some(chunk=>chunk.text.includes('event: ready')));
  assert.ok(chunks.every(chunk=>!chunk.text.includes('heartbeat')));
});

test('keepalive interval can be configured independently from filesystem notifications',async t=>{
  const {chunks}=await stream(t,{keepAlive:60,updateInterval:0});
  await delay(250);
  assert.ok(chunks.filter(chunk=>chunk.text.includes(': heartbeat')).length>=2);
  assert.ok(chunks.every(chunk=>!chunk.text.includes('event: change')));
});

test('disabled keepalive still ends a revoked idle session', {timeout:30000},async t=>{
  const {chunks,ended,logout}=await stream(t,{keepAlive:0});
  assert.equal((await logout()).status,200);
  await ended;
  assert.ok(chunks.every(chunk=>!chunk.text.includes('heartbeat')));
});

test('change notifications detect logout without waiting for the session timer', {timeout:5000},async t=>{
  const {ended,logout}=await stream(t,{keepAlive:0,pollingInterval:30,updateInterval:0});
  assert.equal((await logout()).status,200);
  await ended;
});

test('event interval configuration rejects invalid and overflowing timers',async()=>{
  for(const [option,name] of [['updateInterval','UPDATE_INTERVAL_MS'],['keepAlive','KEEP_ALIVE_MS']]){
    for(const value of [-1,0.5,2147483648,'',true,'invalid'])await assert.rejects(createApp({[option]:value}),new RegExp(name));
  }
});
