import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../server.js';

test('public mode grants file editing without account administration; disabling it revokes guest access',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'public-app-'));
  const options={files:path.join(temp,'files'),config:path.join(temp,'config'),watch:false,pollingInterval:0};
  let instance,server,base;
  async function start(extra){instance=await createApp({...options,...extra});server=instance.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;}
  async function stop(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));instance.close();}
  await start({publicMode:true});t.after(async()=>{await stop();await fs.rm(temp,{recursive:true,force:true});});
  const response=await fetch(base+'/api/session');const guest=await response.json();
  assert.equal(guest.user.guest,true);assert.equal(guest.user.role,'editor');assert.equal(guest.setup,false);
  const headers={Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':guest.csrf,'Content-Type':'application/json'};
  const request=(route,method='GET',body,extra={})=>fetch(base+route,{method,headers:{...headers,...extra},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal((await request('/api/files')).status,200);
  assert.equal((await request('/api/create','POST',{path:'guest.txt'})).status,201);
  assert.equal((await request('/api/create','POST',{path:'denied.txt'},{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await request('/api/create','POST',{path:'denied.txt'},{Origin:'https://elsewhere.invalid'})).status,403);
  assert.equal((await request('/api/users')).status,403);
  assert.equal((await request('/api/users','POST',{name:'takeover',password:'guest-test-password',role:'admin'})).status,403);
  assert.equal((await request('/api/password','POST',{currentPassword:'guest-test-password',password:'replacement-password'})).status,403);
  assert.equal((await request('/api/setup','POST',{name:'takeover',password:'guest-test-password'})).status,403);
  const share=await request('/api/shares','POST',{path:'guest.txt'});assert.equal(share.status,201);
  const shareId=(await share.json()).id;
  const login=await (await request('/api/session?login=1')).json();assert.equal(login.user,null);assert.equal(login.setupTokenRequired,true);
  const setupToken=(await fs.readFile(path.join(instance.config,'setup-token'),'utf8')).trim();
  const setup=await request('/api/setup','POST',{name:'owner',password:'public-mode-owner-password',setupToken});assert.equal(setup.status,201);
  assert.equal((await setup.json()).user.role,'admin');
  assert.equal((await request('/api/users')).status,403,'Existing guest session never becomes an administrator');
  await stop();await start({publicMode:false});
  assert.equal((await request('/api/files')).status,401);
  assert.equal((await request('/api/create','POST',{path:'denied.txt'})).status,401);
  assert.equal((await fetch(base+'/api/session').then(r=>r.json())).user,null);
  assert.equal((await fetch(base+'/s/'+shareId)).status,200,'Explicit public share links retain their existing semantics');
  await stop();await start({publicMode:true,readOnly:true});
  const readonly=await fetch(base+'/api/session');const readSession=await readonly.json();
  const readHeaders={Cookie:readonly.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':readSession.csrf,'Content-Type':'application/json'};
  assert.equal(readSession.readOnly,true);
  assert.equal((await fetch(base+'/api/files',{headers:readHeaders})).status,200);
  assert.equal((await fetch(base+'/api/create',{method:'POST',headers:readHeaders,body:JSON.stringify({path:'denied.txt'})})).status,403);
});

test('invalid public mode settings fail closed',async()=>{
  for(const publicMode of ['yes','',0,1])await assert.rejects(createApp({publicMode}),/PUBLIC/);
  for(const readOnly of ['tru','',0,1])await assert.rejects(createApp({publicMode:true,readOnly}),/READ_ONLY/);
});
