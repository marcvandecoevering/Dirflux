import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';

// Exercise the dependency as resolved by archiver, rather than a separate copy.
const archiveRequire=createRequire(import.meta.resolve('archiver'));
const glob=archiveRequire('readdir-glob');

test('archive glob dependency preserves nested, hidden, ignore and skip matching',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archive-glob-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const file of ['top.txt','nested/café.txt','nested/ignore.txt','.hidden.txt','skip/private.txt','other.js']) {
    await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});
    await fs.writeFile(path.join(root,file),file);
  }
  const collect=options=>new Promise((resolve,reject)=>{
    const matches=[];
    glob(root,options).on('match',m=>matches.push(m.relative.replaceAll('\\','/')))
      .on('error',reject).on('end',()=>resolve(matches.sort()));
  });
  assert.deepEqual(await collect({pattern:'**/*.txt',dot:true,ignore:'**/ignore.txt',skip:'skip'}),
    ['.hidden.txt','nested/café.txt','top.txt']);
  assert.deepEqual(await collect({pattern:'**/*.txt',ignore:'**/ignore.txt',skip:'skip'}),
    ['nested/café.txt','top.txt']);
});
