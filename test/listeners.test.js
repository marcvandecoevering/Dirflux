import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createApp} from '../server.js';
import {listenerSettings,startListeners,closeListeners} from '../lib/listeners.js';
import {checkHealth} from '../lib/health-check.js';

test('listener configuration validates endpoints before startup',()=>{
  assert.deepEqual(listenerSettings({}),[{host:'127.0.0.1',port:8080}]);
  assert.deepEqual(listenerSettings({HOST:'::1',PORT:'8095'}),[{host:'::1',port:8095}]);
  assert.deepEqual(listenerSettings({LISTENERS:'[{"host":"::","port":0,"ipv6Only":true}]'}),[{host:'::',port:0,ipv6Only:true}]);
  for(const value of ['bad','null','[]','[null]','[{"host":"","port":123}]','[{"host":"localhost","port":"123"}]','[{"host":"localhost","port":65536}]','[{"host":"localhost","port":12,"protocol":"ftp"}]','[{"path":"relative.sock"}]','[{"path":"/tmp/test.sock","port":123}]'])assert.throws(()=>listenerSettings({LISTENERS:value}));
  assert.throws(()=>listenerSettings({PORT:'invalid'}));
});

test('multiple listeners share application sessions and all close',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'listeners-'));
  const instance=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),publicMode:true,watch:false,pollingInterval:0,logLevel:0});
  let servers=[];
  t.after(async()=>{await closeListeners(servers,true);instance.close();await fs.rm(temp,{recursive:true,force:true});});
  servers=await startListeners(instance,[{host:'127.0.0.1',port:0},{host:'127.0.0.1',port:0}]);
  const bases=servers.map(server=>`http://127.0.0.1:${server.address().port}`);
  const session=await fetch(bases[0]+'/api/session');
  const first=await session.json();
  const second=await (await fetch(bases[1]+'/api/session',{headers:{Cookie:session.headers.get('set-cookie').split(';')[0]}})).json();
  assert.equal(first.csrf,second.csrf);assert.deepEqual(first.user,second.user);
  for(const server of servers)await checkHealth({endpoint:{host:'127.0.0.1',port:server.address().port},certFile:''});
  await closeListeners(servers,true);
  for(const base of bases)await assert.rejects(fetch(base+'/api/health'));
});

test('a failed later bind closes earlier listeners without stopping the occupied server',async t=>{
  const occupied=http.createServer((_req,res)=>res.end('existing'));
  occupied.listen(0,'127.0.0.1');await new Promise(resolve=>occupied.once('listening',resolve));
  const created=[];
  t.after(async()=>{await closeListeners(created,true);await closeListeners([occupied],true);});
  const instance={listen(endpoint){const server=http.createServer((_req,res)=>res.end('new'));created.push(server);return server.listen(endpoint);}};
  await assert.rejects(startListeners(instance,[{host:'127.0.0.1',port:0},{host:'127.0.0.1',port:occupied.address().port}]),{code:'EADDRINUSE'});
  assert.ok(created.every(server=>!server.listening));
  assert.equal(await (await fetch(`http://127.0.0.1:${occupied.address().port}`)).text(),'existing');
});

test('Unix socket listeners serve health and preserve unrelated existing paths',{skip:process.platform==='win32'},async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'socket-'));
  const socketPath=path.join(temp,'app.sock');
  const existing=path.join(temp,'existing');await fs.writeFile(existing,'keep');
  const instance=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),watch:false,pollingInterval:0,logLevel:0});
  let servers=[];
  t.after(async()=>{await closeListeners(servers,true);instance.close();await fs.rm(temp,{recursive:true,force:true});});
  servers=await startListeners(instance,listenerSettings({LISTENERS:JSON.stringify([{path:socketPath}])}));
  await checkHealth({endpoint:{path:socketPath},certFile:''});
  await assert.rejects(startListeners(instance,[{path:existing}]),{code:'EADDRINUSE'});
  assert.equal(await fs.readFile(existing,'utf8'),'keep');
  await closeListeners(servers,true);
  await assert.rejects(fs.stat(socketPath),{code:'ENOENT'});
});
