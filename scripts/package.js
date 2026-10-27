import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export async function packRelease() {
  const root=path.resolve(import.meta.dirname,'..');
  if(!process.env.npm_execpath)throw new Error('Run this script through npm.');
  const manifest=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  const staging=await fs.mkdtemp(path.join(os.tmpdir(),'file-app-package-'));
  try {
    for(const entry of ['package.json',...manifest.files]) {
      const source=path.resolve(root,entry),target=path.resolve(staging,entry);
      if(!source.startsWith(root+path.sep)||!target.startsWith(staging+path.sep))throw new Error('Invalid package path');
      await fs.mkdir(path.dirname(target),{recursive:true});
      await fs.cp(source,target,{recursive:true});
    }
    // npm excludes package-lock.json from published archives. A shrinkwrap carries
    // the identical audited dependency tree and is included by npm pack.
    await fs.copyFile(path.join(root,'package-lock.json'),path.join(staging,'npm-shrinkwrap.json'));
    await fs.writeFile(path.join(staging,'package.json'),JSON.stringify({...manifest,files:[...manifest.files,'npm-shrinkwrap.json']},null,2)+'\n');
    const output=execFileSync(process.execPath,[process.env.npm_execpath,'pack','--ignore-scripts','--json','--pack-destination',root],{cwd:staging,encoding:'utf8',timeout:120000});
    return path.join(root,JSON.parse(output)[0].filename);
  } finally {
    if(path.dirname(path.resolve(staging))!==path.resolve(os.tmpdir())||!path.basename(staging).startsWith('file-app-package-'))throw new Error('Unsafe package cleanup path');
    await fs.rm(staging,{recursive:true,force:true});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await packRelease());
