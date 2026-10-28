import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {responseHeaders} from '../lib/response-headers.js';
import {createApp} from '../server.js';

test('deployment header validation rejects injection, ambiguity and application-owned fields',()=>{
  for(const input of ['bad','null','[]',{'bad name':'x'},{'X-Test':'x\r\nSet-Cookie: injected=1'},{'X-Test':7},{'X-Test':[]},{'X-Test':'a','x-test':'b'},{'X-Test':'a'.repeat(4097)},{'X-Test':Array(5).fill('a'.repeat(4096))},Object.fromEntries(Array.from({length:33},(_,i)=>['X-'+i,'a']))])assert.throws(()=>responseHeaders(input),/RESPONSE_HEADERS/);
  for(const name of ['Content-Length','Transfer-Encoding','Connection','Set-Cookie','Content-Type','Content-Security-Policy','X-Frame-Options','Cache-Control','Access-Control-Allow-Origin'])assert.throws(()=>responseHeaders({[name]:'ignored'}),/application-owned/);
  const original=['one','two'];const parsed=responseHeaders({'X-Test':original});original.push('three');assert.deepEqual(parsed['x-test'],['one','two']);
});

test('configured headers reach files, pages and API responses without changing security or bytes',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'response-headers-'));
  const app=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),publicMode:true,watch:false,pollingInterval:0,logLevel:0,responseHeaders:JSON.stringify({'X-Deployment':'integration','X-Labels':['one','two'],'Permissions-Policy':'camera=(), microphone=()'})});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));app.close();await fs.rm(temp,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  await fs.writeFile(path.join(app.root,'example.txt'),'exact content');
  const session=await fetch(base+'/api/session');await session.json();
  const cookie=session.headers.get('set-cookie').split(';')[0];
  for(const route of ['/','/api/health','/api/missing','/api/file?path=example.txt&download=1']) {
    const response=await fetch(base+route,{headers:{Cookie:cookie}});
    assert.equal(response.headers.get('x-deployment'),'integration');
    assert.equal(response.headers.get('x-labels'),'one, two');
    assert.equal(response.headers.get('permissions-policy'),'camera=(), microphone=()');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.equal(response.headers.get('x-frame-options'),'SAMEORIGIN');
    if(route.includes('download')){assert.equal(response.status,200);assert.equal(await response.text(),'exact content');}
    else await response.arrayBuffer();
    if(route.startsWith('/api/'))assert.equal(response.headers.get('cache-control'),'no-store');
  }
});

test('invalid response header configuration fails before creating storage',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'header-invalid-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  await assert.rejects(createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),responseHeaders:{'X-Test':'bad\nvalue'}}),/invalid header value/);
  await assert.rejects(fs.stat(path.join(temp,'config')),{code:'ENOENT'});
});
