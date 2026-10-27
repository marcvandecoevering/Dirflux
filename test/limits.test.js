import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';

async function fixture(t,options) {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'droppy-limits-'));
  const instance=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),watch:false,pollingInterval:0,...options});
  const server=instance.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));instance.close();await fs.rm(temp,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const setupToken=(await fs.readFile(path.join(instance.config,'setup-token'),'utf8')).trim();
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'admin',password:'limits-test-password',setupToken})});
  assert.equal(setup.status,201);
  const headers={Cookie:setup.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await setup.json()).csrf};
  const request=(url,method='GET',body)=>fetch(base+url,{method,headers:{...headers,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {instance,base,headers,request};
}

test('zero upload limit accepts uploads; editor limit counts UTF-8 bytes',async t=>{
  const {instance,base,headers,request}=await fixture(t,{maxUpload:0,maxText:4});
  const uploaded=await fetch(base+'/api/upload?path=test.txt',{method:'PUT',headers,body:'éé'});
  assert.equal(uploaded.status,201);
  const initial=await request('/api/text?path=test.txt');assert.equal(initial.status,200);
  const {version,text}=await initial.json();assert.equal(text,'éé');
  const rejected=await request('/api/text','POST',{path:'test.txt',version,text:'ééa'});
  assert.equal(rejected.status,413);
  assert.equal(await fs.readFile(path.join(instance.root,'test.txt'),'utf8'),'éé');
  assert.equal((await request('/api/text','POST',{path:'test.txt',version,text:'abcd'})).status,200);
  await fs.writeFile(path.join(instance.root,'test.txt'),'abcde');
  assert.equal((await request('/api/text?path=test.txt')).status,413);
  assert.equal((await request('/api/text','POST',{path:'test.txt',version,text:'x'})).status,413);
});

test('JSON escaping does not lower the configured editor byte limit',async t=>{
  const text='\u0001'.repeat(600000);
  const {instance,request}=await fixture(t,{maxText:600000});
  await fs.writeFile(path.join(instance.root,'test.txt'),'initial');
  const {version}=await (await request('/api/text?path=test.txt')).json();
  assert.equal((await request('/api/text','POST',{path:'test.txt',version,text})).status,200);
  assert.equal(await fs.readFile(path.join(instance.root,'test.txt'),'utf8'),text);
});

test('invalid byte limits fail before storage is opened',async()=>{
  for(const value of [-1,0.5,'bad','',true,Infinity,Number.MAX_SAFE_INTEGER+1])
    await assert.rejects(createApp({maxUpload:value}),/MAX_UPLOAD_BYTES/);
  for(const value of [0,-1,'',true,64*1024**2+1])
    await assert.rejects(createApp({maxText:value}),/MAX_TEXT_BYTES/);
});
