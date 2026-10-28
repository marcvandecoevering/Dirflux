import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {verifyCandidate} from '../scripts/verify-candidate.js';

async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'candidate-verification-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const expected={name:'test-release',version:'1.2.3-beta.1',tag:'v1.2.3-beta.1',revision:'a'.repeat(40),repository:'example/project',run:'12345'};
  const archive=expected.name+'-'+expected.version+'.tgz',bytes=Buffer.from('synthetic archive bytes');
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const metadata={...expected,verificationRun:expected.run,archive,sha256,status:'candidate'};
  await fs.writeFile(path.join(directory,archive),bytes);
  await fs.writeFile(path.join(directory,'SHA256SUMS'),`${sha256}  ${archive}\n`);
  await fs.writeFile(path.join(directory,'release.json'),JSON.stringify(metadata));
  return {directory,expected,archive,metadata};
}
test('release candidate is bound to exact source, repository, version and workflow run',async t=>{
  const f=await fixture(t);
  assert.equal((await verifyCandidate(f.directory,f.expected)).archive,f.archive);
  for(const [key,value] of Object.entries({revision:'b'.repeat(40),repository:'elsewhere/project',verificationRun:'999',tag:'v9.9.9',status:'published',archive:'../escape.tgz'})){
    await fs.writeFile(path.join(f.directory,'release.json'),JSON.stringify({...f.metadata,[key]:value}));
    await assert.rejects(verifyCandidate(f.directory,f.expected),/context mismatch/);
  }
});
test('candidate rejects changed bytes and inconsistent checksums',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.directory,'SHA256SUMS'),'wrong checksum\n');
  await assert.rejects(verifyCandidate(f.directory,f.expected),/checksum file mismatch/);
  await fs.writeFile(path.join(f.directory,f.archive),'changed');
  await assert.rejects(verifyCandidate(f.directory,f.expected),/archive digest mismatch/);
});
test('candidate rejects extra files, non-regular entries and invalid trusted context',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.directory,'extra.txt'),'unexpected');
  await assert.rejects(verifyCandidate(f.directory,f.expected),/file set/);
  await fs.unlink(path.join(f.directory,'extra.txt'));
  await fs.unlink(path.join(f.directory,f.archive));await fs.mkdir(path.join(f.directory,f.archive));
  await assert.rejects(verifyCandidate(f.directory,f.expected),/regular files/);
  await assert.rejects(verifyCandidate(f.directory,{...f.expected,run:undefined}),/expected release context/);
});
