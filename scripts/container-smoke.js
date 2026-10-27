// Run against a disposable local image. Never uses production files or Docker volumes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const image = process.argv[2];
if (!image || image.startsWith('-')) throw new Error('Pass the image name to test.');
const docker = (...args) => execFileSync('docker',args,{encoding:'utf8',timeout:120000}).trim();
docker('info','--format','{{.ServerVersion}}');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'file-app-container-'));
const name = 'file-app-test-' + crypto.randomBytes(6).toString('hex');
const password = crypto.randomBytes(32).toString('hex');
const files = path.join(temporary,'files'), config = path.join(temporary,'config');
await fs.mkdir(files,{mode:0o777}); await fs.mkdir(config,{mode:0o777});
await fs.chmod(files,0o777); await fs.chmod(config,0o777);
let base, cookie, csrf, running=false;
async function waitHealthy() {
  for (let i=0;i<60;i++) {
    try { if ((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok) return; } catch {}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Container did not become healthy: '+docker('logs',name));
}
async function start(readOnly=false) {
  docker('run','--detach','--name',name,'--user','99:100','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges',
    '--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--publish','127.0.0.1::8094',
    '--mount',`type=bind,src=${files},dst=/files${readOnly?',readonly':''}`,
    '--mount',`type=bind,src=${config},dst=/config`,'--env',`READ_ONLY=${readOnly}`,image);
  running=true;
  const port = docker('port',name,'8094/tcp').split(':').at(-1);
  base='http://127.0.0.1:'+port;
  await waitHealthy();
  assert.equal(docker('exec',name,'id','-u'),'99');
  assert.equal(docker('exec',name,'id','-g'),'100');
}
async function request(route, method='GET',body) {
  return fetch(base+route,{method,headers:{Cookie:cookie||'','X-CSRF-Token':csrf||'','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
}
async function login(route='/api/login') {
  const setupToken=route==='/api/setup'?docker('exec',name,'cat','/config/setup-token'):undefined;
  const response=await request(route,'POST',{name:'container-test',password,setupToken});
  assert.equal(response.status,route==='/api/setup'?201:200,await response.clone().text());
  cookie=response.headers.get('set-cookie').split(';')[0]; csrf=(await response.json()).csrf;
}
try {
  await start();
  assert.equal((await request('/api/files')).status,401);
  await login('/api/setup');
  const uploaded=await fetch(base+'/api/upload?path=persist.txt',{method:'PUT',headers:{Cookie:cookie,'X-CSRF-Token':csrf},body:'persistent content'});
  assert.equal(uploaded.status,201,await uploaded.text());
  docker('restart',name); await waitHealthy(); await login();
  const restored=await request('/api/text?path=persist.txt');
  assert.equal((await restored.json()).text,'persistent content');
  assert.equal((await fs.stat(path.join(files,'persist.txt'))).uid,99);
  docker('rm','--force',name); running=false;
  await start(true); await login();
  assert.equal((await request('/api/create','POST',{path:'forbidden.txt'})).status,403);
  assert.equal((await request('/api/file?path=persist.txt&download=1')).status,200);
  console.log('Container smoke passed: UID/GID 99:100, restricted filesystem, upload, restart persistence and read-only mount.');
} finally {
  if(running) docker('rm','--force',name);
  // Only delete the freshly-created test directory, never a supplied path.
  if(path.dirname(path.resolve(temporary))!==path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('file-app-container-')) throw new Error('Unsafe test cleanup path');
  await fs.rm(temporary,{recursive:true,force:true});
}
