// Publish only the container artifacts verified by this release workflow run.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifyContainerCandidate,verifyLoadedContainer} from './verify-container-candidate.js';

const {GITHUB_REPOSITORY:repository,GITHUB_RUN_ID:run,RELEASE_TAG:tag,RELEASE_REVISION:revision,GH_TOKEN:token}=process.env;
if(!/^[-\w.]+\/[-\w.]+$/.test(repository||'')||!/^\d+$/.test(run||'')||!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag||'')||!/^[a-f0-9]{40}$/.test(revision||'')||!token)throw new Error('Missing trusted release context.');
const command=(name,...args)=>execFileSync(name,args,{encoding:'utf8',timeout:600000,maxBuffer:8*1024*1024}).trim();
const gh=(...args)=>command('gh',...args);
const docker=(...args)=>command('docker',...args);
const manifest=JSON.parse(await fs.readFile('package.json','utf8'));
if(tag!=='v'+manifest.version||command('git','rev-parse','HEAD')!==revision)throw new Error('Release source/version mismatch.');
let remote=JSON.parse(gh('api',`repos/${repository}/git/ref/tags/${tag}`)).object;
for(let depth=0;remote.type==='tag'&&depth<16;depth++)remote=JSON.parse(gh('api',`repos/${repository}/git/tags/${remote.sha}`)).object;
if(remote.type!=='commit'||remote.sha!==revision)throw new Error('Remote release tag moved.');
const image='ghcr.io/'+repository.toLowerCase(),version=manifest.version;
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dirflux-publish-'));
const candidates=[];
// Validate both artifacts before writing anything to the registry.
for(const arch of ['amd64','arm64']) {
  const folder=path.join(directory,arch);await fs.mkdir(folder);
  const artifact='container-candidate-'+(arch==='amd64'?'ubuntu-24.04':'ubuntu-24.04-arm');
  gh('run','download',run,'--repo',repository,'--name',artifact,'--dir',folder);
  const metadata=await verifyContainerCandidate(folder,{revision,repository,run,platform:'linux/'+arch,image:'local/file-app-ci'});
  candidates.push({arch,folder,metadata});
}
execFileSync('docker',['login','ghcr.io','--username',repository.split('/')[0],'--password-stdin'],{input:token,stdio:['pipe','pipe','pipe'],timeout:30000});
const published=[];
try {
  for(const {arch,folder,metadata} of candidates) {
    docker('image','load','--platform',metadata.platform,'--input',path.join(folder,metadata.archive));
    verifyLoadedContainer(JSON.parse(docker('image','inspect','local/file-app-ci'))[0],metadata);
    const reference=`${image}:${version}-${arch}`;
    docker('tag','local/file-app-ci',reference);
    docker('push',reference);
    const info=JSON.parse(docker('buildx','imagetools','inspect',reference,'--format','{{json .Manifest}}'));
    if(!/^sha256:[a-f0-9]{64}$/.test(info.digest))throw new Error('Registry did not return an image digest.');
    const pinned=image+'@'+info.digest;
    docker('pull','--platform',metadata.platform,pinned);
    verifyLoadedContainer(JSON.parse(docker('image','inspect',pinned))[0],metadata);
    published.push({platform:metadata.platform,reference,digest:info.digest});
  }
  const reference=`${image}:${version}`;
  docker('buildx','imagetools','create','--tag',reference,...published.map(item=>image+'@'+item.digest));
  const info=JSON.parse(docker('buildx','imagetools','inspect',reference,'--format','{{json .Manifest}}'));
  const index=JSON.parse(docker('buildx','imagetools','inspect',reference,'--raw'));
  if(index.manifests?.length!==2||published.some(item=>!index.manifests.some(entry=>entry.digest===item.digest&&`${entry.platform?.os}/${entry.platform?.architecture}`===item.platform)))throw new Error('Published platform index does not match verified images.');
  await fs.writeFile('published-images.json',JSON.stringify({repository,revision,verificationRun:run,tag,reference,digest:info.digest,platforms:published},null,2)+'\n');
  console.log(`Published ${reference}@${info.digest}; both platforms match tested configuration and layers.`);
} finally { docker('logout','ghcr.io'); }
