import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import {createApp} from '../server.js';
import {checkHealth} from '../lib/health-check.js';
import {listenerSettings,startListeners,closeListeners} from '../lib/listeners.js';

const certFile=path.join(import.meta.dirname,'fixtures/tls/cert.pem');
const keyFile=path.join(import.meta.dirname,'fixtures/tls/key.pem');
const secondaryCert=path.join(import.meta.dirname,'fixtures/tls/secondary-cert.pem');

test('mixed HTTP/HTTPS listeners select independent certificates and transport-appropriate cookies',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'mixed-tls-'));
  const endpoints=listenerSettings({LISTENERS:JSON.stringify([
    {host:'127.0.0.1',port:0,protocol:'http'},
    {host:'127.0.0.1',port:0,protocol:'https'},
    {host:'127.0.0.1',port:0,protocol:'https',certFile:secondaryCert,keyFile}
  ])});
  const instance=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),listeners:endpoints,tlsCertFile:certFile,tlsKeyFile:keyFile,secureCookie:false,publicMode:true,watch:false,pollingInterval:0,logLevel:0});
  let servers=[];
  t.after(async()=>{await closeListeners(servers,true);instance.close();await fs.rm(temp,{recursive:true,force:true});});
  servers=await startListeners(instance,endpoints);
  const plain=await fetch(`http://127.0.0.1:${servers[0].address().port}/api/session`,{headers:{'X-Forwarded-Proto':'https'}});
  const cookie=plain.headers.get('set-cookie');await plain.json();assert.doesNotMatch(cookie,/; Secure/);
  for(const index of [1,2]){
    const expected=index===1?certFile:secondaryCert;
    const ca=await fs.readFile(expected);
    const response=await new Promise((resolve,reject)=>https.get({hostname:'127.0.0.1',port:servers[index].address().port,path:'/api/session',ca},res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,cookie:res.headers['set-cookie'][0],session:JSON.parse(body)}));res.on('error',reject);}).on('error',reject));
    assert.equal(response.status,200);assert.match(response.cookie,/; Secure/);assert.ok(response.session.user.guest);
    await checkHealth({endpoint:{...endpoints[index],port:servers[index].address().port},certFile});
  }
  // An explicit HTTP endpoint ignores global certificate settings for its probe.
  await checkHealth({endpoint:{...endpoints[0],port:servers[0].address().port},certFile});
  await assert.rejects(checkHealth({port:servers[2].address().port,certFile}),/certificate mismatch/);
});

test('every listener TLS pair is validated before storage opens',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'listener-tls-invalid-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const options={files:path.join(temp,'files'),config:path.join(temp,'config')};
  await assert.rejects(createApp({...options,listeners:[{host:'127.0.0.1',port:0,protocol:'https'}]}),/requires certFile/);
  await assert.rejects(createApp({...options,listeners:[{host:'127.0.0.1',port:0,protocol:'https',certFile:path.join(import.meta.dirname,'fixtures/tls/other-cert.pem'),keyFile}]}),/key values mismatch/);
  await assert.rejects(fs.stat(options.config),{code:'ENOENT'});
  for(const endpoint of [{host:'127.0.0.1',port:0,protocol:'http',certFile,keyFile},{host:'127.0.0.1',port:0,protocol:'https',certFile}])assert.throws(()=>listenerSettings({LISTENERS:JSON.stringify([endpoint])}));
  await fs.mkdir(options.files);const exposedKey=path.join(options.files,'key.pem');await fs.copyFile(keyFile,exposedKey);
  await assert.rejects(createApp({...options,listeners:[{host:'127.0.0.1',port:0,protocol:'https',certFile,keyFile:exposedKey}]}),/must not be inside/);
});

test('native HTTPS verifies a trusted certificate and always sets Secure session cookies',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'tls-app-'));
  const instance=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),tlsCertFile:certFile,tlsKeyFile:keyFile,publicMode:true,watch:false,pollingInterval:0});
  const server=instance.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));instance.close();await fs.rm(temp,{recursive:true,force:true});});
  assert.equal(instance.protocol,'https');
  await checkHealth({port:server.address().port,certFile});
  await assert.rejects(checkHealth({port:server.address().port,certFile:path.join(import.meta.dirname,'fixtures/tls/other-cert.pem')}),/certificate mismatch/);
  const ca=await fs.readFile(certFile);
  const response=await new Promise((resolve,reject)=>{
    const req=https.get({hostname:'127.0.0.1',port:server.address().port,path:'/api/session',ca},res=>{
      assert.equal(res.socket.authorized,true);let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,cookie:res.headers['set-cookie'][0],body:JSON.parse(text)}));
    });req.on('error',reject);
  });
  assert.equal(response.status,200);assert.equal(response.body.user.guest,true);assert.match(response.cookie,/; Secure/);assert.match(response.cookie,/; HttpOnly/);
  await assert.rejects(new Promise((resolve,reject)=>https.get({hostname:'127.0.0.1',port:server.address().port,path:'/api/health'},res=>{res.resume();resolve();}).on('error',reject)),/self-signed certificate/);
});

test('local healthcheck also supports plain HTTP',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'http-health-'));
  const instance=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),watch:false,pollingInterval:0});
  const server=instance.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));instance.close();await fs.rm(temp,{recursive:true,force:true});});
  await checkHealth({port:server.address().port,certFile:''});
});

test('TLS rejects partial configuration, invalid keys and keys within shared files',async t=>{
  await assert.rejects(createApp({tlsCertFile:certFile}),/must both/);
  await assert.rejects(createApp({tlsKeyFile:keyFile}),/must both/);
  await assert.rejects(createApp({tlsCertFile:path.join(import.meta.dirname,'fixtures/tls/other-cert.pem'),tlsKeyFile:keyFile}),/key values mismatch/);
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'tls-invalid-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const invalid=path.join(temp,'invalid.pem');await fs.writeFile(invalid,'not a key');
  await assert.rejects(createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),tlsCertFile:certFile,tlsKeyFile:invalid}));
  await assert.rejects(fs.stat(path.join(temp,'config')),{code:'ENOENT'});
  const files=path.join(temp,'files');await fs.mkdir(files);await fs.copyFile(keyFile,path.join(files,'key.pem'));
  await assert.rejects(createApp({files,config:path.join(temp,'config'),tlsCertFile:certFile,tlsKeyFile:path.join(files,'key.pem')}),/must not be inside/);
});
