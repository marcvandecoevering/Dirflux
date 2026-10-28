// Disposable nginx HTTPS integration. Only synthetic test certificates/data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createApp} from '../server.js';

const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:120000}).trim();
docker('info','--format','{{.ServerVersion}}');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'proxy-smoke-'));
const name='file-app-proxy-'+crypto.randomBytes(6).toString('hex');
const root=path.resolve(import.meta.dirname,'..');
let app,server,running=false,base,agent;
function request(route,{method='GET',body,headers={}}={}) {
  return new Promise((resolve,reject)=>{
    const req=https.request(base+route,{method,headers,agent,timeout:5000},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });
    req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Proxy request timed out')));req.end(body);
  });
}
try {
  app=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),secureCookie:true,publicMode:false,watch:true,pollingInterval:0,updateInterval:150,keepAlive:100,linkExtensions:true});
  server=app.listen(0,'0.0.0.0');await new Promise(resolve=>server.once('listening',resolve));
  const template=await fs.readFile(path.join(root,'deploy/nginx.conf'),'utf8');
  await fs.writeFile(path.join(temp,'default.conf'),template.replace('http://127.0.0.1:8094',`http://host.docker.internal:${server.address().port}`));
  const certificates=path.join(root,'test/fixtures/tls');
  agent=new https.Agent({ca:await fs.readFile(path.join(certificates,'cert.pem'))});
  docker('run','--detach','--name',name,'--add-host','host.docker.internal:host-gateway','--publish','127.0.0.1::443',
    '--mount',`type=bind,src=${path.join(temp,'default.conf')},dst=/etc/nginx/conf.d/default.conf,readonly`,
    '--mount',`type=bind,src=${certificates},dst=/etc/nginx/certs,readonly`,'nginx:stable-alpine');
  running=true;
  base='https://127.0.0.1:'+docker('port',name,'443/tcp').split(':').at(-1);
  let ready=false;
  for(let n=0;n<30;n++){try {if((await request('/api/health')).status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
  assert.ok(ready,'nginx did not reach the application');
  const setupToken=(await fs.readFile(path.join(app.config,'setup-token'),'utf8')).trim();
  const setup=await request('/api/setup',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({name:'proxy-test',password:'synthetic-proxy-password',setupToken})});
  assert.equal(setup.status,201,setup.body);
  assert.match(setup.headers['set-cookie'][0],/Secure/);
  const headers={Cookie:setup.headers['set-cookie'][0].split(';')[0],'X-CSRF-Token':JSON.parse(setup.body).csrf,Origin:base};
  assert.equal((await request('/api/upload?path=proxy.txt',{method:'PUT',headers,body:'0123456789'})).status,201);
  const range=await request('/api/file?path=proxy.txt',{headers:{...headers,Range:'bytes=2-5'}});
  assert.equal(range.status,206);assert.equal(range.body,'2345');
  const created=await request('/api/shares',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({path:'proxy.txt'})});
  assert.equal(created.status,201);const share=JSON.parse(created.body);
  assert.equal(share.url,`/s/${share.id}.txt`);
  const shared=await request(share.url,{headers:{Range:'bytes=2-5'}});
  assert.equal(shared.status,206);assert.equal(shared.body,'2345');
  assert.equal((await request('/api/shares/'+share.id,{method:'DELETE',headers})).status,200);
  assert.equal((await request(share.url)).status,404);
  assert.equal((await request('/api/create',{method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:'https://wrong.invalid'},body:JSON.stringify({path:'denied.txt'})})).status,403);
  assert.equal((await request('/api/create',{method:'POST',headers:{...headers,'Content-Type':'application/json','X-CSRF-Token':'wrong'},body:JSON.stringify({path:'denied.txt'})})).status,403);
  await new Promise((resolve,reject)=>{
    let text='',wrote=false;
    const req=https.get(base+'/api/events',{headers,agent},res=>{
      res.on('error',reject);
      res.on('data',chunk=>{
        text+=chunk;
        if(text.includes('event: ready')&&!wrote){wrote=true;fs.writeFile(path.join(app.root,'external.txt'),'external change').catch(reject);}
        if(text.includes('event: change')&&text.includes(': heartbeat')){clearTimeout(timer);res.destroy();req.destroy();resolve();}
      });
    });
    const timer=setTimeout(()=>{req.destroy();reject(new Error('SSE events were not delivered through nginx'));},5000);
    req.on('error',error=>{clearTimeout(timer);reject(error);});
  });
  console.log('HTTPS nginx proxy passed: trusted TLS, setup, Secure cookie, Origin/CSRF, streaming upload, range download, extension share/revocation, unbuffered live updates and configured heartbeat.');
} finally {
  agent?.destroy();
  if(running)docker('rm','--force',name);
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  app?.close();
  if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('proxy-smoke-'))throw new Error('Unsafe cleanup path');
  await fs.rm(temp,{recursive:true,force:true});
}
