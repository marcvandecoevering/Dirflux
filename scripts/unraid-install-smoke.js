// Disposable Docker volumes only: fresh installation and real beta.2 data upgrade.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
const image=process.argv[2];
if(!image||image.startsWith('-'))throw new Error('Pass candidate image.');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024}).trim();
const name='dirflux-install-'+crypto.randomBytes(6).toString('hex');
const password=crypto.randomBytes(24).toString('hex');
const volumes=[name+'-files',name+'-config'];
const mounts=volumes.flatMap((v,i)=>['--mount',`type=volume,src=${v},dst=${i?'/config':'/files'},volume-nocopy`]);
const restrictions=['--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--tmpfs','/tmp:rw,noexec,nosuid,size=64m'];
const caps=['CHOWN','FOWNER','DAC_OVERRIDE','SETUID','SETGID'].map(c=>'--cap-add='+c);
let running=false,base,cookie,csrf;
async function start(reference,extra=[],port=8080){
  docker('run','-d','--name',name,...restrictions,...extra,...mounts,'-p','127.0.0.1::'+port,reference);running=true;
  base='http://127.0.0.1:'+docker('port',name,port+'/tcp').split(':').at(-1);
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}
  throw new Error(docker('logs',name));
}
function stop(){docker('stop',name);docker('rm',name);running=false;}
async function login(route='/api/login'){
  const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'admin',password,...(route==='/api/setup'?{setupToken:docker('exec',name,'cat','/config/setup-token')}:{})})});
  assert.equal(r.status,route==='/api/setup'?201:200,await r.clone().text());cookie=r.headers.get('set-cookie').split(';')[0];csrf=(await r.json()).csrf;
}
try {
  for(const volume of volumes)docker('volume','create',volume);
  // Match Unraid's pre-created nobody:users appdata while Files remains root-owned.
  docker('run','--rm',...mounts,'--entrypoint','sh',image,'-c','chown 99:100 /config && chmod 755 /config');
  // Docker creates root-owned mount directories; no host mkdir/chown preparation.
  await start(image,[...caps,'-e','INITIAL_ADMIN_PASSWORD='+password]);await login();
  assert.equal(docker('exec',name,'stat','-c','%u:%g:%a','/config'),'99:100:700');
  const r=await fetch(base+'/api/upload?path=persist.txt',{method:'PUT',headers:{Cookie:cookie,'X-CSRF-Token':csrf},body:'upgrade fixture'});assert.equal(r.status,201,await r.text());
  assert.equal(docker('exec',name,'stat','-c','%u:%g','/files/persist.txt'),'99:100');
  const status=docker('exec',name,'node','-e',String.raw`const fs=require('fs');for(const p of fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p))){try{const a=fs.readFileSync('/proc/'+p+'/cmdline','utf8').split('\0');if(a[1]==='server.js')console.log(fs.readFileSync('/proc/'+p+'/status','utf8'));}catch{}}`);
  assert.match(status,/Uid:\s+99\s+99\s+99\s+99/);assert.match(status,/CapEff:\s+0000000000000000/);
  stop();
  // Replace only our disposable config volume to create an actual previous-version DB.
  docker('volume','rm',volumes[1]);docker('volume','create',volumes[1]);
  docker('run','--rm',...mounts,'--entrypoint','sh',image,'-c','chown 99:100 /config');
  const previous='ghcr.io/marcvandecoevering/dirflux:0.1.0-beta.2';
  await start(previous,['--user','99:100'],8094);await login('/api/setup');stop();
  const ownership=docker('run','--rm',...mounts,'--entrypoint','stat',image,'-c','%u:%g:%a','/files/persist.txt','/config/state.sqlite');
  await start(image,[...caps,'-e','INITIAL_ADMIN_PASSWORD=must-not-reset-existing']);await login();
  const download=await fetch(base+'/api/file?path=persist.txt&download=1',{headers:{Cookie:cookie}});assert.equal(await download.text(),'upgrade fixture');
  assert.equal(docker('exec',name,'stat','-c','%u:%g:%a','/files/persist.txt','/config/state.sqlite'),ownership);
  stop();
  console.log('PASS: root-owned empty volumes, direct admin login, non-root server without effective capabilities, upload, beta.2 account/data upgrade, no password reset or recursive ownership changes.');
} finally {
  if(running)docker('rm','-f',name);
  for(const volume of volumes)docker('volume','rm',volume);
}
