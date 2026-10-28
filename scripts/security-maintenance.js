// Daily scan first. No Docker build occurs in this script.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {findings,auditFindings,fingerprint,sameMajor} from './security-policy.js';

export const scanner='aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c';
export const command=(name,...args)=>execFileSync(name,args,{encoding:'utf8',timeout:600000,maxBuffer:32*1024*1024}).trim();
export const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
export async function api(route,method='GET',body) {
  const response=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${route}`,{
    method,headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)
  });
  if(!response.ok)throw new Error(`GitHub ${method} ${route}: ${response.status}`);
  return response.status===204?null:response.json();
}
export async function issues() {
  const result=[];
  for(let page=1;;page++){const batch=await api(`issues?state=all&per_page=100&page=${page}`);result.push(...batch.filter(x=>!x.pull_request));if(batch.length<100)return result;}
}
export async function issueOnce(marker,title,body) {
  if((await issues()).some(i=>i.body?.includes(marker)))return;
  await api('issues','POST',{title,body:`${marker}\n\n${body}\n\nRun: https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`});
}
export function scan(reference,arch,file) {
  const directory=path.resolve(process.env.SECURITY_DIR);
  command('docker','run','--rm','--user',`${process.getuid()}:${process.getgid()}`,'--cap-drop=ALL','--security-opt=no-new-privileges',
    '--mount',`type=bind,src=${directory},dst=/reports`,scanner,'image','--cache-dir','/reports/cache','--scanners','vuln',
    '--list-all-pkgs','--image-src','remote','--platform',`linux/${arch}`,'--format','json','--output',`/reports/${file}`,reference);
  return json(path.join(directory,file));
}
export function audit(cwd) {
  const r=spawnSync('npm',['audit','--json','--ignore-scripts'],{cwd,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
  if(![0,1].includes(r.status))throw new Error('npm audit failed');
  const report=JSON.parse(r.stdout);auditFindings(report);return report;
}
async function registryConfig(image,manifest) {
  const name=image.replace(/^ghcr.io\//,'');
  const auth=await fetch(`https://ghcr.io/token?scope=repository:${name}:pull&service=ghcr.io`);
  if(!auth.ok)throw new Error('Cannot obtain registry read token');
  const {token}=await auth.json();
  const response=await fetch(`https://ghcr.io/v2/${name}/blobs/${manifest.config.digest}`,{headers:{Authorization:`Bearer ${token}`}});
  if(!response.ok)throw new Error('Cannot read published image configuration');
  return response.json();
}
export function inspect(ref) {return JSON.parse(command('docker','buildx','imagetools','inspect',ref,'--format','{{json .Manifest}}'));}
async function prepare() {
  const directory=path.resolve(process.env.SECURITY_DIR);fs.mkdirSync(directory,{recursive:true});
  const image='ghcr.io/'+process.env.GITHUB_REPOSITORY.toLowerCase(),channel='beta';
  const digest=inspect(`${image}:${channel}`).digest;
  if(!/^sha256:[a-f0-9]{64}$/.test(digest))throw new Error('Invalid channel digest');
  const index=JSON.parse(command('docker','buildx','imagetools','inspect',`${image}@${digest}`,'--raw'));
  const baseline={},revisions=[];
  for(const arch of ['amd64','arm64']) {
    const platform=index.manifests?.filter(m=>m.platform?.os==='linux'&&m.platform?.architecture===arch);
    if(platform?.length!==1)throw new Error(`Missing or ambiguous ${arch} image`);
    const ref=`${image}@${platform[0].digest}`;
    baseline[arch]=findings(scan(ref,arch,`before-${arch}.json`));
    const manifest=JSON.parse(command('docker','buildx','imagetools','inspect',ref,'--raw'));
    const config=await registryConfig(image,manifest);
    revisions.push(config.config.Labels?.['org.opencontainers.image.revision']);
  }
  const released=revisions[0];
  if(!/^[a-f0-9]{40}$/.test(released)||revisions.some(r=>r!==released))throw new Error('Published source revisions disagree');
  command('git','fetch','origin',released);
  const work=path.join(directory,'released');command('git','worktree','add','--detach',work,released);
  const beforeAudit=audit(work);write(path.join(directory,'before-audit.json'),beforeAudit);
  const beforeNpm=auditFindings(beforeAudit);
  const targets=[...Object.values(baseline).flat(),...beforeNpm].filter(v=>v.fixed);
  if(!targets.length){console.log('No fixable vulnerabilities. No build or publication.');summary('No fixable vulnerabilities: scanned both published platforms and the shipped dependency lockfile. No build.');return;}
  const start=command('git','rev-parse','HEAD');
  // Never silently ship unreleased application changes as a dependency patch.
  const changes=command('git','diff','--name-only',released,start,'--','server.js','lib','src','public');
  const releasedPackage=json(path.join(work,'package.json')),currentPackage=json('package.json');
  if(changes||releasedPackage.version!==currentPackage.version)throw new Error('Unreleased application changes need a normal release before automatic maintenance');
  const base=inspect('node:24-alpine').digest;
  if(!/^sha256:[a-f0-9]{64}$/.test(base))throw new Error('Invalid Node base digest');
  let dockerfile=fs.readFileSync('Dockerfile','utf8');
  if((dockerfile.match(/FROM node:24-alpine@sha256:[a-f0-9]{64}/g)||[]).length!==2)throw new Error('Unexpected Dockerfile base');
  dockerfile=dockerfile.replaceAll(/node:24-alpine@sha256:[a-f0-9]{64}/g,`node:24-alpine@${base}`);
  fs.writeFileSync('Dockerfile',dockerfile);
  // Update vulnerable direct dependencies only, and never cross a major version.
  for(const section of ['dependencies','devDependencies'])for(const [name,version] of Object.entries(currentPackage[section]||{})) {
    if(!beforeAudit.vulnerabilities[name])continue;
    if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error(`Unpinned direct dependency ${name}`);
    const versions=JSON.parse(command('npm','view',`${name}@${version.split('.')[0]}`,'version','--json'));
    const latest=Array.isArray(versions)?versions.at(-1):versions;
    if(!sameMajor(version,latest))throw new Error(`Major update requires review: ${name}`);
    currentPackage[section][name]=latest;
  }
  write('package.json',currentPackage);
  command('npm','install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund');
  const fixed=spawnSync('npm',['audit','fix','--package-lock-only','--ignore-scripts','--no-fund'],{encoding:'utf8',timeout:120000});
  if(![0,1].includes(fixed.status))throw new Error('Cannot prepare dependency fixes');
  const afterAudit=audit(process.cwd());write(path.join(directory,'candidate-audit.json'),afterAudit);
  // Repository indexes allow a retry when an OS fix becomes available without a new base tag.
  const indexes=[];
  for(const arch of ['amd64','arm64']) {
    const os=json(path.join(directory,`before-${arch}.json`)).Metadata.OS;
    if(os.Family!=='alpine'||!/^\d+\.\d+\.\d+$/.test(os.Name))throw new Error('Unexpected OS version');
    for(const repo of ['main','community']) {
      const url=`https://dl-cdn.alpinelinux.org/alpine/v${os.Name.split('.').slice(0,2).join('.')}/${repo}/${arch==='amd64'?'x86_64':'aarch64'}/APKINDEX.tar.gz`;
      const response=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error('Cannot read Alpine package availability');
      const archive=path.join(directory,`index-${arch}-${repo}.tar.gz`);
      fs.writeFileSync(archive,Buffer.from(await response.arrayBuffer()));
      const index=command('tar','-xOzf',archive,'APKINDEX');
      const wanted=new Set(baseline[arch].filter(v=>v.fixed&&v.key.startsWith('os-pkgs:')).map(v=>v.package));
      const available=index.split(/\n\n/).flatMap(record=>{
        const name=record.match(/^P:(.+)$/m)?.[1],version=record.match(/^V:(.+)$/m)?.[1];
        return wanted.has(name)?[[name,version]]:[];
      }).sort();
      indexes.push(available);
    }
  }
  const key=fingerprint({digest,base,lock:fs.readFileSync('package-lock.json','utf8'),targets:targets.map(v=>[v.key,v.fixed]).sort(),indexes,
    logic:fingerprint(fs.readdirSync('scripts').filter(f=>f.startsWith('security-')).sort().map(f=>fs.readFileSync('scripts/'+f,'utf8')).join('\n')+dockerfile)});
  const marker=`<!-- dirflux-security-attempt:${key} -->`;
  if((await issues()).some(i=>i.body?.includes(marker))){summary('Identical patch candidate already failed. No rebuild; see the existing security issue.');return;}
  write(path.join(directory,'plan.json'),{image,channel,digest,start,released,baseline,beforeNpm,key,marker});
  if(auditFindings(afterAudit).some(v=>v.fixed))throw new Error('npm fixes require review; no automatic major upgrades or forced overrides');
  command('git','config','user.name','github-actions[bot]');command('git','config','user.email','41898282+github-actions[bot]@users.noreply.github.com');
  command('git','add','Dockerfile','package.json','package-lock.json');
  command('git','commit','--allow-empty','-m',`Apply automated security maintenance (${key.slice(0,12)})`);
  const revision=command('git','rev-parse','HEAD');
  command('git','bundle','create',path.join(directory,'candidate.bundle'),'HEAD',`^${start}`);
  const plan=json(path.join(directory,'plan.json'));plan.revision=revision;write(path.join(directory,'plan.json'),plan);
  fs.appendFileSync(process.env.GITHUB_OUTPUT,`build=true\nrevision=${revision}\n`);
  summary(`Fixable vulnerabilities found. Prepared dependency-only candidate ${revision}; both platforms must pass before publication.`);
}
function summary(text) {console.log(text);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,text+'\n');}
if(process.argv[1]===path.resolve(import.meta.filename)) {
  try {await prepare();} catch(error) {
    const file=path.join(process.env.SECURITY_DIR,'plan.json');
    const marker=fs.existsSync(file)?json(file).marker:`<!-- dirflux-security-error:${fingerprint(error.message)} -->`;
    await issueOnce(marker,'Dirflux security maintenance needs attention',error.message);
    throw error;
  }
}
