import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import {createApp} from '../server.js';
import {checkHealth} from '../lib/health-check.js';

const certFile=path.join(import.meta.dirname,'fixtures/tls/cert.pem');
const keyFile=path.join(import.meta.dirname,'fixtures/tls/key.pem');

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
