import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {readLimitedHandle,readLimitedFile} from '../lib/read-limited.js';

test('bounded reads accept exact limits and leave the handle offset unchanged',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bounded-read-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const filename=path.join(dir,'text');await fs.writeFile(filename,'abcd');
  assert.equal((await readLimitedFile(filename,4)).toString(),'abcd');
  await assert.rejects(readLimitedFile(filename,3),{status:413});
  const handle=await fs.open(filename,'r');
  try {
    assert.equal((await readLimitedHandle(handle,4)).toString(),'abcd');
    assert.equal((await handle.readFile()).toString(),'abcd');
  } finally {await handle.close();}
  await fs.writeFile(filename,'');assert.equal((await readLimitedFile(filename,4)).length,0);
});

test('a file growing after stat cannot bypass the memory read limit',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bounded-growth-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const filename=path.join(dir,'text');await fs.writeFile(filename,'a');
  const handle=await fs.open(filename,'r');
  let requested=0;
  try {
    const growing={
      stat:async()=>{const stat=await handle.stat();await fs.appendFile(filename,'x'.repeat(200000));return stat;},
      read:async(buffer,offset,length,position)=>{requested+=length;return handle.read(buffer,offset,length,position);}
    };
    await assert.rejects(readLimitedHandle(growing,100000),{status:413});
    assert.equal(requested,100001,'At most the limit plus one detection byte is read');
    assert.equal((await handle.read(Buffer.alloc(1),0,1,null)).bytesRead,1);
  } finally {await handle.close();}
});
