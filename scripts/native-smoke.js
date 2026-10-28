// Verify the actual npm archive in a clean directory, without development dependencies.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import { packRelease } from './package.js';
const root=path.resolve(import.meta.dirname,'..');
const npm=process.env.npm_execpath;
if(!npm) throw new Error('Run using npm run test:package.');
const runNpm=(args,cwd)=>execFileSync(process.execPath,[npm,...args],{cwd,encoding:'utf8',timeout:120000});
const packed=await packRelease();
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'file-app-native-'));
let child;
let listeningBases=[];
async function stop() {
  if(child && child.exitCode===null && child.signalCode===null){
    const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
    child.kill('SIGTERM');
    let timer;
    const result=await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),10000);})]);
    clearTimeout(timer);
    if(!result){child.kill('SIGKILL');await exited;throw new Error('Native server did not stop within 10 seconds.');}
    // Windows terminate is not POSIX signal delivery; do not call it graceful shutdown.
    if(process.platform!=='win32')assert.equal(result.code,0,'SIGTERM must shut down successfully');
  }
  for(const base of listeningBases)await assert.rejects(fetch(base+'/api/health',{signal:AbortSignal.timeout(2000)}));
  listeningBases=[];
  child=undefined;
}
async function start(app,storage=temporary) {
  let output='',errors='';
  child=spawn(process.execPath,['server.js'],{cwd:app,env:{...process.env,HOST:'127.0.0.1',PORT:'0',LISTENERS:JSON.stringify([{host:'127.0.0.1',port:0},{host:'127.0.0.1',port:0}]),LOG_LEVEL:'2',FILES_DIR:path.join(storage,'files'),CONFIG_DIR:path.join(storage,'config'),IGNORE_PATTERNS:'[]',READ_ONLY:'false',PUBLIC_MODE:'false',COOKIE_SECURE:'false',TLS_CERT_FILE:'',TLS_KEY_FILE:'',WATCH:'false',POLLING_INTERVAL_MS:'0'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
  for(let n=0;n<80;n++){
    const entries=output.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
    listeningBases=entries.filter(entry=>entry.event==='server.listening'&&entry.protocol==='http'&&entry.host==='127.0.0.1'&&Number.isInteger(entry.port)).map(entry=>`http://${entry.host}:${entry.port}`);
    if(listeningBases.length===2){
      assert.notEqual(listeningBases[0],listeningBases[1]);
      for(const base of listeningBases)assert.equal((await fetch(base+'/api/health')).status,200);
      return listeningBases[0];
    }
    if(child.exitCode!==null||child.signalCode!==null)throw new Error('Server exited: '+errors);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('No listening address: '+errors);
}
async function credentials(base) {
  const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'release-test',password:'native-package-test-password'})});
  assert.equal(response.status,200);
  return {Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await response.json()).csrf};
}
try {
  execFileSync('tar',['-xzf',packed,'-C',temporary],{timeout:30000});
  const app=path.join(temporary,'package');
  await assert.rejects(fs.stat(path.join(app,'test')),{code:'ENOENT'},'Test fixtures, including public TLS test keys, must not ship');
  await assert.rejects(fs.stat(path.join(app,'.env')),{code:'ENOENT'},'Local deployment settings must not ship');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(app,'npm-shrinkwrap.json'),'utf8')),JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8')));
  const licenses=JSON.parse(await fs.readFile(path.join(app,'public/vendor/licenses/packages.json'),'utf8'));
  assert.equal(licenses.schemaVersion,1);assert.ok(licenses.packages.length>0);
  const lock=JSON.parse(await fs.readFile(path.join(app,'npm-shrinkwrap.json'),'utf8'));
  for(const entry of licenses.packages){
    assert.equal(entry.version,lock.packages['node_modules/'+entry.name].version,`Bundled version differs from lockfile: ${entry.name}`);
    assert.ok(entry.files.length>0,`Missing license files: ${entry.name}`);
    for(const file of entry.files){
      assert.equal(path.basename(file.path),file.path,'License manifest paths must be local filenames');
      const bytes=await fs.readFile(path.join(app,'public/vendor/licenses',file.path));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,`License contents differ: ${file.path}`);
    }
  }
  runNpm(['ci','--omit=dev','--ignore-scripts'],app);
  execFileSync(process.execPath,['scripts/ensure-assets.js'],{cwd:app,timeout:30000});
  let base=await start(app);
  assert.equal((await fetch(base+'/api/health')).status,200);
  const html=await fetch(base+'/').then(response=>response.text());
  assert.match(html,/<script\b[^>]*src="\/app\.js"[^>]*type="module"/);
  for(const module of ['app.js','editor-save.js','text-download.js','file-types.js','gallery-shortcuts.js','file-shortcuts.js','session-permissions.js','media-playback.js','image-viewer.js','upload-entries.js','vendor/extras.js','vendor/pdf.worker.min.mjs','vendor/wasm/openjpeg_nowasm_fallback.js','vendor/wasm/jbig2_nowasm_fallback.js']) {
    const response=await fetch(base+'/'+module);
    assert.equal(response.status,200,`Missing browser module: ${module}`);
    assert.match(response.headers.get('content-type'),/(?:javascript|ecmascript)/,`Incorrect module MIME: ${module}`);
    assert.equal(await response.text(),await fs.readFile(path.join(app,'public',module),'utf8'),`Served module differs from package: ${module}`);
  }
  assert.equal((await fetch(base+'/api/session').then(r=>r.json())).setup,true);
  const setupToken=(await fs.readFile(path.join(temporary,'config/setup-token'),'utf8')).trim();
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'release-test',password:'native-package-test-password',setupToken})});
  assert.equal(setup.status,201);
  let headers=await credentials(base);
  assert.equal((await fetch(base+'/api/upload?path=retained.txt',{method:'PUT',headers,body:'before update'})).status,201);
  const share=await fetch(base+'/api/shares',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({path:'retained.txt'})});
  assert.equal(share.status,201);const {id}=await share.json();
  await stop();
  // A consistent rollback snapshot includes both data trees while the app is stopped.
  const backup=path.join(temporary,'backup');
  for(const name of ['files','config'])await fs.cp(path.join(temporary,name),path.join(backup,name),{recursive:true});
  const candidateRoot=path.join(temporary,'candidate');await fs.mkdir(candidateRoot);
  execFileSync('tar',['-xzf',packed,'-C',candidateRoot],{timeout:30000});
  const candidate=path.join(candidateRoot,'package');runNpm(['ci','--omit=dev','--ignore-scripts'],candidate);
  base=await start(candidate);headers=await credentials(base);
  assert.equal((await fetch(base+'/api/session').then(r=>r.json())).setup,false);
  assert.equal(await fetch(base+'/s/'+id).then(r=>r.text()),'before update');
  const {version}=await fetch(base+'/api/upload-target?path=retained.txt',{headers}).then(r=>r.json());
  assert.equal((await fetch(base+'/api/upload?path=retained.txt&conflict=replace&version='+version,{method:'PUT',headers,body:'after update'})).status,201);
  assert.equal(await fetch(base+'/s/'+id).then(r=>r.text()),'after update');
  await stop();
  const restored=path.join(temporary,'restored');
  for(const name of ['files','config'])await fs.cp(path.join(backup,name),path.join(restored,name),{recursive:true});
  base=await start(app,restored);await credentials(base);
  assert.equal(await fetch(base+'/s/'+id).then(r=>r.text()),'before update');
  assert.equal(await fs.readFile(path.join(temporary,'files/retained.txt'),'utf8'),'after update','Restore must not overwrite the failed candidate data');
  console.log('Native package: production-only install, two CLI listeners, release-directory switch, persistent account/link/file and isolated backup restore pass. Both installations use the current archive; cross-version schema downgrade is not covered.');
} finally {
  await stop();
  if(path.dirname(path.resolve(temporary))!==path.resolve(os.tmpdir())||!path.basename(temporary).startsWith('file-app-native-'))throw new Error('Unsafe cleanup path');
  await fs.rm(temporary,{recursive:true,force:true});
}
