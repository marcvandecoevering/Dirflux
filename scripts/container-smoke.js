// Run against a disposable local image. Never uses production files or Docker volumes.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const image = process.argv[2];
if (!image || image.startsWith('-')) throw new Error('Pass the image name to test.');
const docker = (...args) => execFileSync('docker',args,{encoding:'utf8',timeout:120000}).trim();
docker('info','--format','{{.ServerVersion}}');
const platform=docker('image','inspect',image,'--format','{{.Os}}/{{.Architecture}}');
if(!['linux/amd64','linux/arm64'].includes(platform))throw new Error('Unsupported image platform: '+platform);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'file-app-container-'));
const name = 'file-app-test-' + crypto.randomBytes(6).toString('hex');
const password = crypto.randomBytes(32).toString('hex');
const files = path.join(temporary,'files'), config = path.join(temporary,'config');
// Windows bind mounts do not preserve Linux UID/GID ownership. Use isolated
// Linux volumes there; Linux CI still exercises actual host bind mounts.
const linuxVolumes=process.platform==='win32',createdVolumes=[];
const filesMount=linuxVolumes?`type=volume,src=${name}-files,dst=/files,volume-nocopy`:`type=bind,src=${files},dst=/files`;
const configMount=linuxVolumes?`type=volume,src=${name}-config,dst=/config,volume-nocopy`:`type=bind,src=${config},dst=/config`;
await fs.mkdir(files,{mode:0o777}); await fs.mkdir(config,{mode:0o777});
await fs.chmod(files,0o777); await fs.chmod(config,0o777);
let base, cookie, csrf, running=false, duplicateCreated=false;
const duplicateName=name+'-duplicate';
async function waitHealthy() {
  // Docker may assign another ephemeral host port when restarting a container.
  const port=docker('port',name,'8080/tcp').split(':').at(-1);
  base='http://127.0.0.1:'+port;
  for (let i=0;i<60;i++) {
    try { if ((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok) return; } catch {}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Container did not become healthy: '+docker('logs',name));
}
async function start(readOnly=false) {
  docker('run','--platform',platform,'--detach','--name',name,'--user','99:100','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges',
    '--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--publish','127.0.0.1::8080',
    '--mount',filesMount+(readOnly?',readonly':''),
    '--mount',configMount,'--env',`READ_ONLY=${readOnly}`,image);
  running=true;
  await waitHealthy();
  docker('exec',name,'node','lib/health-check.js');
  assert.equal(docker('exec',name,'node','-p','process.arch'),platform==='linux/arm64'?'arm64':'x64');
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
  if(linuxVolumes) {
    for(const suffix of ['files','config']){const volume=name+'-'+suffix;docker('volume','create',volume);createdVolumes.push(volume);}
    docker('run','--platform',platform,'--rm','--user','0:0','--mount',filesMount,'--mount',configMount,'--entrypoint','sh',image,'-c','chown 99:100 /files /config');
  }
  await start();
  assert.equal((await request('/api/files')).status,401);
  await login('/api/setup');
  // Exercise files from the built image, not the checkout's generated assets.
  for(const resource of ['wasm/openjpeg_nowasm_fallback.js','wasm/jbig2_nowasm_fallback.js','wasm/LICENSE_OPENJPEG','wasm/LICENSE_JBIG2','iccs/CGATS001Compat-v2-micro.icc','iccs/LICENSE']) {
    const response=await request('/vendor/'+resource);
    assert.equal(response.status,200,`Missing PDF resource: ${resource}`);
    if(resource.endsWith('.js'))assert.match(response.headers.get('content-type'),/(?:javascript|ecmascript)/);
    assert.ok((await response.arrayBuffer()).byteLength>0,`Empty PDF resource: ${resource}`);
  }
  const inventoryResponse=await request('/vendor/licenses/packages.json');
  assert.equal(inventoryResponse.status,200);
  const inventory=await inventoryResponse.json();
  assert.equal(inventory.schemaVersion,1);assert.ok(inventory.packages.length>0);
  for(const entry of inventory.packages) {
    assert.ok(entry.files.length>0,`Missing notices: ${entry.name}`);
    for(const file of entry.files) {
      assert.equal(path.basename(file.path),file.path);
      const response=await request('/vendor/licenses/'+encodeURIComponent(file.path));
      assert.equal(response.status,200,`Missing notice: ${file.path}`);
      assert.equal(crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),file.sha256,`Changed notice: ${file.path}`);
    }
  }
  const uploaded=await fetch(base+'/api/upload?path=persist.txt',{method:'PUT',headers:{Cookie:cookie,'X-CSRF-Token':csrf},body:'persistent content'});
  assert.equal(uploaded.status,201,await uploaded.text());
  docker('run','--platform',platform,'--detach','--name',duplicateName,'--user','99:100','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges',
    '--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--mount',filesMount,'--mount',configMount,image);
  duplicateCreated=true;
  let duplicateState;
  for(let attempt=0;attempt<40;attempt++) {
    duplicateState=JSON.parse(docker('inspect',duplicateName,'--format','{{json .State}}'));
    if(!duplicateState.Running)break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.equal(duplicateState.Running,false,'A second container must reject the shared config volume');
  assert.notEqual(duplicateState.ExitCode,0);
  const duplicateLogs=spawnSync('docker',['logs',duplicateName],{encoding:'utf8',timeout:10000});
  assert.equal(duplicateLogs.status,0);assert.match(duplicateLogs.stdout+duplicateLogs.stderr,/APP_ALREADY_RUNNING/);
  assert.equal((await request('/api/health')).status,200,'Original container must remain healthy');
  docker('rm',duplicateName);duplicateCreated=false;
  docker('restart',name); await waitHealthy(); await login();
  const restored=await request('/api/text?path=persist.txt');
  assert.equal((await restored.json()).text,'persistent content');
  assert.equal(docker('exec',name,'stat','-c','%u:%g','/files/persist.txt'),'99:100');
  if(!linuxVolumes)assert.equal((await fs.stat(path.join(files,'persist.txt'))).uid,99);
  docker('rm','--force',name); running=false;
  await start(true); await login();
  assert.equal((await request('/api/create','POST',{path:'forbidden.txt'})).status,403);
  assert.equal((await request('/api/file?path=persist.txt&download=1')).status,200);
  console.log(`Container smoke passed (${platform}): UID/GID 99:100, PDF resources, ${inventory.packages.length} bundled package notices, restricted filesystem, upload, duplicate-container rejection, restart persistence and read-only mount.`);
} finally {
  if(duplicateCreated)docker('rm','--force',duplicateName);
  if(running) docker('rm','--force',name);
  for(const volume of createdVolumes)docker('volume','rm',volume);
  // Only delete the freshly-created test directory, never a supplied path.
  if(path.dirname(path.resolve(temporary))!==path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('file-app-container-')) throw new Error('Unsafe test cleanup path');
  await fs.rm(temporary,{recursive:true,force:true});
}
