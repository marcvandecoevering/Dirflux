// Run on a disposable CI runner: docker load restores the archive's local tag.
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifyContainerCandidate,verifyLoadedContainer} from './verify-container-candidate.js';

const directory=process.argv[2];
if(!directory)throw new Error('Pass a downloaded container candidate directory.');
const metadata=await verifyContainerCandidate(directory,{
  revision:process.env.RELEASE_REVISION,repository:process.env.GITHUB_REPOSITORY,
  run:process.env.GITHUB_RUN_ID,platform:process.env.IMAGE_PLATFORM,image:'local/file-app-ci'
});
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:300000}).trim();
docker('image','load','--platform',metadata.platform,'--input',path.join(directory,metadata.archive));
const loaded=JSON.parse(docker('image','inspect','local/file-app-ci'))[0];
verifyLoadedContainer(loaded,metadata);
console.log(`Verified and loaded ${metadata.platform} at source ${metadata.revision}.`);
