import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';
import http from 'node:http';

async function fixture(t,options) {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'droppy-limits-'));
  const instance=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),watch:false,pollingInterval:0,...options});
  const server=instance.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));instance.close();await fs.rm(temp,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const setupToken=(await fs.readFile(path.join(instance.config,'setup-token'),'utf8')).trim();
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'admin',password:'limits-test-password',setupToken})});
  assert.equal(setup.status,201);
  const headers={Cookie:setup.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await setup.json()).csrf};
  const request=(url,method='GET',body)=>fetch(base+url,{method,headers:{...headers,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {instance,base,headers,request,server};
}

async function until(check) {
  const end=Date.now()+3000;
  while(!await check()) {assert.ok(Date.now()<end,'Timed out waiting for upload state');await new Promise(resolve=>setTimeout(resolve,10));}
}
function partialUpload(base,headers,query) {
  const req=http.request(base+'/api/upload?'+query,{method:'PUT',headers});
  const result=new Promise(resolve=>{
    req.on('error',error=>resolve({error}));
    req.on('response',res=>{res.resume();res.once('end',()=>resolve({status:res.statusCode}));});
  });
  req.write('partial');
  return {req,result};
}

test('upload deadline closes stalled transfers, preserves targets and removes temporary files',async t=>{
  const {instance,base,headers,request,server}=await fixture(t,{uploadTimeout:150});
  assert.equal(server.headersTimeout,60000);assert.equal(server.requestTimeout,300000);
  await fs.writeFile(path.join(instance.root,'file.txt'),'original');
  const {version}=await (await request('/api/upload-target?path=file.txt')).json();
  const upload=partialUpload(base,headers,'path=file.txt&conflict=replace&version='+version);
  t.after(()=>upload.req.destroy());
  await until(async()=>(await fs.readdir(path.join(instance.config,'tmp'))).length===1);
  const outcome=await upload.result;
  assert.equal(outcome.error?.code,'ECONNRESET');
  await until(async()=>(await fs.readdir(path.join(instance.config,'tmp'))).length===0);
  assert.equal(await fs.readFile(path.join(instance.root,'file.txt'),'utf8'),'original');
  assert.equal((await request('/api/create','POST',{path:'after.txt'})).status,201);
  assert.ok(!(await fs.readdir(instance.root)).some(name=>name.startsWith('.app-tmp-')));
});

test('receiving uploads does not block mutations and rechecks conflicts before publishing',async t=>{
  const {instance,base,headers,request}=await fixture(t,{uploadTimeout:3000});
  const upload=partialUpload(base,headers,'path=collision.txt');t.after(()=>upload.req.destroy());
  await until(async()=>(await fs.readdir(path.join(instance.config,'tmp'))).length===1);
  assert.equal((await request('/api/create','POST',{path:'collision.txt'})).status,201);
  assert.equal(upload.req.destroyed,false,'Upload is still receiving while another mutation completes');
  upload.req.end('finished');
  assert.equal((await upload.result).status,409);
  await until(async()=>(await fs.readdir(path.join(instance.config,'tmp'))).length===0);
  assert.equal(await fs.readFile(path.join(instance.root,'collision.txt'),'utf8'),'');
});

test('a session revoked during an upload cannot publish its file',async t=>{
  const {instance,base,headers,request}=await fixture(t,{uploadTimeout:3000});
  const upload=partialUpload(base,headers,'path=revoked.txt');t.after(()=>upload.req.destroy());
  await until(async()=>(await fs.readdir(path.join(instance.config,'tmp'))).length===1);
  assert.equal((await request('/api/logout','POST')).status,200);
  upload.req.end('finished');
  assert.equal((await upload.result).status,401);
  await until(async()=>(await fs.readdir(path.join(instance.config,'tmp'))).length===0);
  await assert.rejects(fs.stat(path.join(instance.root,'revoked.txt')),{code:'ENOENT'});
});

test('parallel keep-both uploads publish distinct complete files; client cancellation cleans up',async t=>{
  const {instance,base,headers}=await fixture(t,{uploadTimeout:3000});
  const first=partialUpload(base,headers,'path=same.txt&conflict=rename');
  const second=partialUpload(base,headers,'path=same.txt&conflict=rename');
  t.after(()=>{first.req.destroy();second.req.destroy();});
  await until(async()=>(await fs.readdir(path.join(instance.config,'tmp'))).length===2);
  first.req.end('one');second.req.end('two');
  assert.equal((await first.result).status,201);assert.equal((await second.result).status,201);
  const contents=await Promise.all(['same.txt','same (1).txt'].map(name=>fs.readFile(path.join(instance.root,name),'utf8')));
  assert.deepEqual(contents.sort(),['partialone','partialtwo']);
  const cancelled=partialUpload(base,headers,'path=cancelled.txt');
  t.after(()=>cancelled.req.destroy());
  await until(async()=>(await fs.readdir(path.join(instance.config,'tmp'))).length===1);
  cancelled.req.destroy();await cancelled.result;
  await until(async()=>(await fs.readdir(path.join(instance.config,'tmp'))).length===0);
  await assert.rejects(fs.stat(path.join(instance.root,'cancelled.txt')),{code:'ENOENT'});
});

test('upload timeouts are validated and long uploads are not capped by the old one-hour server limit',async t=>{
  for(const uploadTimeout of [0,-1,'',true,2147483648]) await assert.rejects(createApp({uploadTimeout}),/UPLOAD_TIMEOUT_MS/);
  const {server}=await fixture(t,{});
  assert.equal(server.requestTimeout,604800000);
});

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
