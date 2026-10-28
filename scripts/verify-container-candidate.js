import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

export async function verifyContainerCandidate(directory, expected) {
  const {revision,repository,run,platform,image}=expected;
  const local=repository===null&&run===null;
  if(!/^[a-f0-9]{40}$/.test(revision)||!['linux/amd64','linux/arm64'].includes(platform)||
    typeof image!=='string'||!/^local\/[a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9.-]*)?$/.test(image)||
    (!local&&(!/^[-\w.]+\/[-\w.]+$/.test(repository)||!/^\d+$/.test(run))))throw new Error('Invalid expected container context.');
  const archive=`image-${platform.split('/')[1]}.tar.gz`;
  const files=[archive,'SHA256SUMS','container.json'];
  const entries=await fs.readdir(directory);
  if(entries.length!==files.length||files.some(file=>!entries.includes(file)))throw new Error('Unexpected container candidate file set.');
  for(const file of files){
    const stat=await fs.lstat(path.join(directory,file));
    if(!stat.isFile())throw new Error('Container candidate entries must be regular files.');
    if(file!==archive&&stat.size>1024*1024)throw new Error('Container metadata exceeds its size limit.');
  }
  const metadata=JSON.parse(await fs.readFile(path.join(directory,'container.json'),'utf8'));
  for(const [key,value] of Object.entries({schema:1,status:'candidate',revision,repository,verificationRun:run,platform,image,archive})){
    if(metadata[key]!==value)throw new Error(`Container context mismatch: ${key}`);
  }
  if(metadata.configuration?.Labels?.['org.opencontainers.image.revision']!==revision||
    !Array.isArray(metadata.layers)||!metadata.layers.length||metadata.layers.some(layer=>!/^sha256:[a-f0-9]{64}$/.test(layer)))throw new Error('Invalid container configuration or layer identities.');
  const hash=crypto.createHash('sha256');
  for await(const chunk of createReadStream(path.join(directory,archive)))hash.update(chunk);
  const sha256=hash.digest('hex');
  if(metadata.sha256!==sha256)throw new Error('Container archive digest mismatch.');
  if(await fs.readFile(path.join(directory,'SHA256SUMS'),'utf8')!==`${sha256}  ${archive}\n`)throw new Error('Container checksum file mismatch.');
  return metadata;
}

export function verifyLoadedContainer(info, metadata) {
  assert.equal(`${info.Os}/${info.Architecture}`,metadata.platform,'Loaded platform differs from candidate.');
  assert.deepEqual(info.Config,metadata.configuration,'Loaded configuration differs from candidate.');
  assert.deepEqual(info.RootFS?.Layers,metadata.layers,'Loaded layers differ from candidate.');
}
