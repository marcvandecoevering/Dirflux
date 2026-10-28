import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {verifyContainerCandidate,verifyLoadedContainer} from '../scripts/verify-container-candidate.js';

async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'container-candidate-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const expected={revision:'a'.repeat(40),repository:'example/project',run:'123',platform:'linux/arm64',image:'local/file-app-ci'};
  const archive='image-arm64.tar.gz',bytes=Buffer.from('synthetic archive'),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const metadata={...expected,schema:1,status:'candidate',verificationRun:expected.run,archive,sha256,configuration:{Labels:{'org.opencontainers.image.revision':expected.revision},User:'node'},layers:['sha256:'+'b'.repeat(64)]};
  await fs.writeFile(path.join(directory,archive),bytes);
  await fs.writeFile(path.join(directory,'SHA256SUMS'),`${sha256}  ${archive}\n`);
  const write=async value=>fs.writeFile(path.join(directory,'container.json'),JSON.stringify(value));await write(metadata);
  return {directory,expected,metadata,write};
}
test('container artifacts require the expected source, platform, image and originating run',async t=>{
  const f=await fixture(t);assert.deepEqual(await verifyContainerCandidate(f.directory,f.expected),f.metadata);
  for(const [key,value] of Object.entries({revision:'c'.repeat(40),platform:'linux/amd64',repository:'other/project',verificationRun:'999',image:'local/other',archive:'../escape',schema:2,status:'published'})){
    await f.write({...f.metadata,[key]:value});await assert.rejects(verifyContainerCandidate(f.directory,f.expected),/context mismatch/);
  }
});
test('container artifacts reject altered payload, checksums and extra files',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.directory,'extra'),'extra');await assert.rejects(verifyContainerCandidate(f.directory,f.expected),/file set/);await fs.unlink(path.join(f.directory,'extra'));
  await fs.writeFile(path.join(f.directory,'SHA256SUMS'),'bad');await assert.rejects(verifyContainerCandidate(f.directory,f.expected),/checksum file mismatch/);
  await fs.writeFile(path.join(f.directory,f.metadata.archive),'changed');await assert.rejects(verifyContainerCandidate(f.directory,f.expected),/archive digest mismatch/);
});
test('container artifact context must be complete, with a valid configuration and layers',async t=>{
  const f=await fixture(t);
  await assert.rejects(verifyContainerCandidate(f.directory,{...f.expected,run:undefined}),/expected container context/);
  await assert.rejects(verifyContainerCandidate(f.directory,{...f.expected,image:'--help'}),/expected container context/);
  await f.write({...f.metadata,layers:['bad']});await assert.rejects(verifyContainerCandidate(f.directory,f.expected),/configuration or layer/);
  await f.write({...f.metadata,configuration:{Labels:{}}});await assert.rejects(verifyContainerCandidate(f.directory,f.expected),/configuration or layer/);
});
test('loaded image identity includes the complete configuration and each layer',async t=>{
  const {metadata}=await fixture(t),info={Os:'linux',Architecture:'arm64',Config:metadata.configuration,RootFS:{Layers:metadata.layers}};
  verifyLoadedContainer(info,metadata);
  assert.throws(()=>verifyLoadedContainer({...info,Architecture:'amd64'},metadata),/platform/);
  assert.throws(()=>verifyLoadedContainer({...info,Config:{...info.Config,User:'root'}},metadata),/configuration/);
  assert.throws(()=>verifyLoadedContainer({...info,RootFS:{Layers:['sha256:'+'c'.repeat(64)]}},metadata),/layers/);
});
