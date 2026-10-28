// Short functional check, disposable volumes, no production data.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const image=process.argv[2];if(!image||image.startsWith('-'))throw new Error('Image required');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:120000}).trim();
const name='dirflux-security-'+crypto.randomBytes(6).toString('hex'),password=crypto.randomBytes(24).toString('hex');
const volumes=[name+'-files',name+'-config'];let running=false;
try {
  for(const volume of volumes)docker('volume','create',volume);
  docker('run','-d','--name',name,'--read-only','--cap-drop=ALL',...['CHOWN','FOWNER','DAC_OVERRIDE','SETUID','SETGID'].map(c=>'--cap-add='+c),
    '--security-opt=no-new-privileges','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','-p','127.0.0.1::8080',
    ...volumes.flatMap((v,i)=>['--mount',`type=volume,src=${v},dst=${i?'/config':'/files'},volume-nocopy`]),
    '-e','INITIAL_ADMIN_PASSWORD='+password,image);running=true;
  let base='http://127.0.0.1:'+docker('port',name,'8080/tcp').split(':').at(-1);
  let healthy=false;
  for(let i=0;i<60;i++){try{healthy=(await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok;if(healthy)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  assert.ok(healthy,'Container must start');
  assert.equal((await fetch(base+'/api/files')).status,401);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'admin',password})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrf;
  const headers={Cookie:cookie,'X-CSRF-Token':csrf};
  assert.equal((await fetch(base+'/api/upload?path=check.txt',{method:'PUT',headers,body:'security smoke'})).status,201);
  assert.equal(await (await fetch(base+'/api/file?path=check.txt&download=1',{headers})).text(),'security smoke');
  for(const download of [false,true]) {
    const response=await fetch(base+'/api/shares',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({path:'check.txt',download})});
    assert.equal(response.status,201);const share=await response.json();
    const opened=await fetch(base+share.url);assert.equal(opened.status,200);assert.equal(await opened.text(),'security smoke');
    if(download)assert.match(opened.headers.get('content-disposition'),/^attachment/);
    else assert.doesNotMatch(opened.headers.get('content-disposition')||'',/^attachment/);
  }
  docker('restart',name);
  base='http://127.0.0.1:'+docker('port',name,'8080/tcp').split(':').at(-1);
  let restored=false;
  for(let i=0;i<60;i++){try{const r=await fetch(base+'/api/file?path=check.txt&download=1',{headers,signal:AbortSignal.timeout(1000)});if(r.ok&&await r.text()==='security smoke'){restored=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
  assert.ok(restored,'Uploaded file and session survive restart');
  console.log('PASS: startup, authentication, upload, download, both share modes and restart persistence.');
} finally {
  if(running)docker('rm','-f',name);
  for(const volume of volumes)docker('volume','rm',volume);
}
