import path from 'node:path';
import {command,json,scanner,write} from './security-maintenance.js';
import {findings,validateImprovement,auditFindings} from './security-policy.js';

const [image,arch]=process.argv.slice(2),directory=path.resolve(process.env.SECURITY_DIR);
if(image!=='local/file-app-ci'||!['amd64','arm64'].includes(arch))throw new Error('Invalid candidate');
const plan=json(path.join(directory,'plan.json'));
command('docker','image','save',image,'--output',path.join(directory,'image.tar'));
command('docker','run','--rm','--user',`${process.getuid()}:${process.getgid()}`,'--cap-drop=ALL','--security-opt=no-new-privileges',
  '--mount',`type=bind,src=${directory},dst=/reports`,scanner,'image','--cache-dir','/reports/cache','--scanners','vuln','--list-all-pkgs',
  '--input','/reports/image.tar','--format','json','--output','/reports/after.json');
const after=findings(json(path.join(directory,'after.json')));
const fixed=validateImprovement(plan.baseline[arch],after);
const npmFixed=validateImprovement(plan.beforeNpm,auditFindings(json(path.join(directory,'candidate-audit.json'))));
write(path.join(directory,'verification.json'),{arch,revision:plan.revision,fixed,npmFixed,passed:true});
console.log(`Security gate passed: ${fixed} container findings and ${npmFixed} npm findings removed.`);
