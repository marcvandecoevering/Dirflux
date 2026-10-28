import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {api,command,inspect,json,write} from './security-maintenance.js';
import {verifyContainerCandidate,verifyLoadedContainer} from './verify-container-candidate.js';

const directory=path.resolve(process.env.SECURITY_DIR),plan=json(path.join(directory,'plan.json'));
const {GITHUB_REPOSITORY:repository,GITHUB_RUN_ID:run,GITHUB_RUN_ATTEMPT:attempt,GH_TOKEN:token}=process.env;
if(!/^\d+$/.test(run)||!/^\d+$/.test(attempt)||plan.image!=='ghcr.io/'+repository.toLowerCase()||plan.channel!=='beta')throw new Error('Invalid publication context');
const git=(...args)=>command('git',...args),docker=(...args)=>command('docker',...args);
if(git('rev-parse','HEAD')!==plan.revision||git('status','--porcelain'))throw new Error('Candidate source mismatch');
async function unchanged() {
  if((await api('git/ref/heads/main')).object.sha!==plan.start)throw new Error('Main changed; refusing stale security release');
  if(inspect(`${plan.image}:${plan.channel}`).digest!==plan.digest)throw new Error('Update channel changed; refusing stale security release');
}
await unchanged();
const candidates=[];let improvements=0;
for(const arch of ['amd64','arm64']) {
  const folder=path.join(directory,arch);
  const evidence=json(path.join(directory,`verification-${arch}.json`));
  if(evidence.arch!==arch||evidence.revision!==plan.revision||evidence.passed!==true)throw new Error('Missing platform verification');
  improvements+=evidence.fixed+evidence.npmFixed;
  const metadata=await verifyContainerCandidate(folder,{revision:plan.revision,repository,run,platform:`linux/${arch}`,image:'local/file-app-ci'});
  candidates.push({arch,folder,metadata});
}
if(improvements<=0)throw new Error('No vulnerabilities were removed; no publication');
const unique=`security-${run}-${attempt}`,published=[];
execFileSync('docker',['login','ghcr.io','--username',repository.split('/')[0],'--password-stdin'],{input:token,stdio:['pipe','pipe','pipe'],timeout:30000});
try {
  for(const {arch,folder,metadata} of candidates) {
    docker('image','load','--platform',metadata.platform,'--input',path.join(folder,metadata.archive));
    verifyLoadedContainer(JSON.parse(docker('image','inspect','local/file-app-ci'))[0],metadata);
    const reference=`${plan.image}:${unique}-${arch}`;
    docker('tag','local/file-app-ci',reference);docker('push',reference);
    const digest=inspect(reference).digest;if(!/^sha256:[a-f0-9]{64}$/.test(digest))throw new Error('Missing published digest');
    docker('pull','--platform',metadata.platform,`${plan.image}@${digest}`);
    verifyLoadedContainer(JSON.parse(docker('image','inspect',`${plan.image}@${digest}`))[0],metadata);
    published.push({arch,digest});
  }
  const reference=`${plan.image}:${unique}`;
  docker('buildx','imagetools','create','--tag',reference,...published.map(p=>`${plan.image}@${p.digest}`));
  const index=JSON.parse(docker('buildx','imagetools','inspect',reference,'--raw'));
  if(index.manifests?.length!==2||published.some(p=>!index.manifests.some(m=>m.digest===p.digest&&m.platform?.os==='linux'&&m.platform?.architecture===p.arch)))throw new Error('Incorrect platform index');
  const digest=inspect(reference).digest;
  await unchanged();
  // Fast-forward only. Never overwrite source edits or mutate existing release tags.
  git('tag',unique,plan.revision);git('push','--atomic','origin','HEAD:refs/heads/main',`refs/tags/${unique}`);
  docker('buildx','imagetools','create','--tag',`${plan.image}:${plan.channel}`,`${plan.image}@${digest}`);
  if(inspect(`${plan.image}:${plan.channel}`).digest!==digest)throw new Error('Channel verification failed');
  write(path.join(directory,'published.json'),{reference,digest,revision:plan.revision,channel:plan.channel,published});
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Published verified security patch: ${reference}@${digest}. Unraid channel :${plan.channel} updated.\n`);
} finally {docker('logout','ghcr.io');}
