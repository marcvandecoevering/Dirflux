// Verify the actual npm archive in a clean directory, without development dependencies.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { packRelease } from './package.js';
const root=path.resolve(import.meta.dirname,'..');
const npm=process.env.npm_execpath;
if(!npm) throw new Error('Run using npm run test:package.');
const runNpm=(args,cwd)=>execFileSync(process.execPath,[npm,...args],{cwd,encoding:'utf8',timeout:120000});
const packed=await packRelease();
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'file-app-native-'));
let child;
try {
  execFileSync('tar',['-xzf',packed,'-C',temporary],{timeout:30000});
  const app=path.join(temporary,'package');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(app,'npm-shrinkwrap.json'),'utf8')),JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8')));
  runNpm(['ci','--omit=dev','--ignore-scripts'],app);
  execFileSync(process.execPath,['scripts/ensure-assets.js'],{cwd:app,timeout:30000});
  let output='',errors='';
  child=spawn(process.execPath,['server.js'],{cwd:app,env:{...process.env,HOST:'127.0.0.1',PORT:'0',FILES_DIR:path.join(temporary,'files'),CONFIG_DIR:path.join(temporary,'config')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
  let base;
  for(let n=0;n<80;n++){
    base=output.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[0];
    if(base)break;
    if(child.exitCode!==null)throw new Error('Server exited: '+errors);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(base,'No listening address: '+errors);
  assert.equal((await fetch(base+'/api/health')).status,200);
  assert.equal((await fetch(base+'/vendor/extras.js')).status,200);
  assert.equal((await fetch(base+'/vendor/pdf.worker.min.mjs')).status,200);
  assert.equal((await fetch(base+'/api/session').then(r=>r.json())).setup,true);
  console.log('Native package starts with production dependencies and bundled editor/PDF assets.');
} finally {
  if(child && child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
  if(path.dirname(path.resolve(temporary))!==path.resolve(os.tmpdir())||!path.basename(temporary).startsWith('file-app-native-'))throw new Error('Unsafe cleanup path');
  await fs.rm(temporary,{recursive:true,force:true});
}
