// Export the already-tested image. This command never builds or pushes images.
import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import crypto from 'node:crypto';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const [image,output]=process.argv.slice(2);
if(!image||image.startsWith('-')||!output)throw new Error('Usage: node scripts/container-candidate.js IMAGE NEW_OUTPUT_DIRECTORY');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:300000}).trim();
if(git('status','--porcelain','--untracked-files=all'))throw new Error('Container candidate requires a clean source checkout.');
const revision=git('rev-parse','HEAD');
const inspect=()=>JSON.parse(docker('image','inspect',image))[0];
const info=inspect(),platform=`${info.Os}/${info.Architecture}`;
if(!['linux/amd64','linux/arm64'].includes(platform))throw new Error('Unsupported candidate platform.');
if(info.Config.Labels?.['org.opencontainers.image.revision']!==revision)throw new Error('Image revision label does not match the clean checkout.');
const directory=path.resolve(output);await fs.mkdir(directory);
const temporary=path.join(directory,'image.tar'),archive=`image-${info.Architecture}.tar.gz`;
docker('image','save','--platform',platform,'--output',temporary,image);
if(inspect().Id!==info.Id)throw new Error('Image tag changed during export.');
await pipeline(createReadStream(temporary),createGzip(),createWriteStream(path.join(directory,archive),{flags:'wx'}));
await fs.unlink(temporary);
const hash=crypto.createHash('sha256');
for await(const chunk of createReadStream(path.join(directory,archive)))hash.update(chunk);
const sha256=hash.digest('hex');
await fs.writeFile(path.join(directory,'SHA256SUMS'),`${sha256}  ${archive}\n`,{flag:'wx'});
await fs.writeFile(path.join(directory,'container.json'),JSON.stringify({
  schema:1,status:'candidate',revision,repository:process.env.GITHUB_REPOSITORY||null,
  verificationRun:process.env.GITHUB_RUN_ID||null,platform,image,sourceImageId:info.Id,
  // Config and uncompressed layer identities survive Docker save/load formats.
  configuration:info.Config,layers:info.RootFS.Layers,archive,sha256,
  note:'Exported without rebuilding. CI invokes this only after its image checks pass. Local export alone is not proof of test success or a registry digest.'
},null,2)+'\n',{flag:'wx'});
console.log(`Exported ${platform} ${info.Id} to ${directory}; archive SHA-256 ${sha256}.`);
