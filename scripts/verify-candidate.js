// Validate a candidate against trusted job context, never its own claims alone.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function verifyCandidate(directory, expected) {
  const {name,version,tag,revision,repository,run}=expected;
  if(!/^[a-z0-9][a-z0-9-]*$/.test(name)||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)||tag!=='v'+version||!/^[a-f0-9]{40}$/.test(revision)||!/^[-\w.]+\/[-\w.]+$/.test(repository)||!/^\d+$/.test(run))throw new Error('Invalid expected release context.');
  const archive=`${name}-${version}.tgz`;
  const files=[archive,'SHA256SUMS','release.json'];
  const actual=await fs.readdir(directory);
  if(actual.length!==files.length||files.some(file=>!actual.includes(file)))throw new Error('Unexpected candidate file set.');
  for(const file of files)if(!(await fs.lstat(path.join(directory,file))).isFile())throw new Error('Candidate entries must be regular files.');
  const metadata=JSON.parse(await fs.readFile(path.join(directory,'release.json'),'utf8'));
  for(const [key,value] of Object.entries({name,version,tag,revision,repository,verificationRun:run,archive,status:'candidate'})){
    if(metadata[key]!==value)throw new Error(`Candidate context mismatch: ${key}`);
  }
  const bytes=await fs.readFile(path.join(directory,archive));
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  if(metadata.sha256!==sha256)throw new Error('Candidate archive digest mismatch.');
  if(await fs.readFile(path.join(directory,'SHA256SUMS'),'utf8')!==`${sha256}  ${archive}\n`)throw new Error('Candidate checksum file mismatch.');
  return {archive,sha256};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const manifest=JSON.parse(await fs.readFile('package.json','utf8'));
  const result=await verifyCandidate(process.argv[2],{
    name:manifest.name,version:manifest.version,tag:process.env.RELEASE_TAG,
    revision:process.env.RELEASE_REVISION,repository:process.env.GITHUB_REPOSITORY,run:process.env.GITHUB_RUN_ID
  });
  console.log(`Verified ${result.archive}: ${result.sha256}`);
}
