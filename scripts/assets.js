import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname,'..');
const generated = path.resolve(root,'public/vendor');
if (path.dirname(generated) !== path.join(root,'public')) throw new Error('Unexpected generated-assets directory.');
await fs.rm(generated,{recursive:true,force:true});
await fs.mkdir(generated,{recursive:true});
const result = await build({entryPoints:[path.join(root,'src/extras.js')],bundle:true,format:'esm',minify:true,splitting:true,outdir:path.join(root,'public/vendor'),target:['es2022'],legalComments:'linked',metafile:true});
const pdfRoot = path.join(root,'node_modules/pdfjs-dist');
await fs.copyFile(path.join(pdfRoot,'build/pdf.worker.min.mjs'),path.join(root,'public/vendor/pdf.worker.min.mjs'));
for (const folder of ['cmaps','standard_fonts']) await fs.cp(path.join(pdfRoot,folder),path.join(root,'public/vendor',folder),{recursive:true});
await fs.copyFile(path.join(root,'node_modules/@fontsource/roboto/files/roboto-latin-300-normal.woff2'),path.join(root,'public/original/roboto-latin-300.woff2'));
await fs.writeFile(path.join(root,'public/original/fonts.css'),'@font-face{font-family:Roboto;font-style:normal;font-weight:300;font-display:swap;src:url("roboto-latin-300.woff2") format("woff2")}');
const packages=new Set(['pdfjs-dist','@fontsource/roboto']);
for(const input of Object.keys(result.metafile.inputs)){
  const parts=input.replaceAll('\\','/').split('node_modules/').at(-1).split('/');
  if(input.includes('node_modules/'))packages.add(parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0]);
}
await fs.mkdir(path.join(root,'public/vendor/licenses'),{recursive:true});
const licenseManifest=[];
for(const name of [...packages].sort()){
  const directory=path.join(root,'node_modules',name);
  const metadata=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));
  const files=[];
  let hasLicense=false;
  for(const filename of (await fs.readdir(directory)).sort())if(/^(?:licen[sc]e|notice|copying|authors)(?:\.|$|-)/i.test(filename)){
    if((await fs.stat(path.join(directory,filename))).isFile()){
      const content=await fs.readFile(path.join(directory,filename));
      if(!content.length)throw new Error(`Empty third-party notice: ${name}/${filename}`);
      const target=encodeURIComponent(name)+'-'+filename+'.txt';
      await fs.writeFile(path.join(generated,'licenses',target),content);
      files.push({path:target,sha256:createHash('sha256').update(content).digest('hex')});
      if(/^(?:licen[sc]e|copying)(?:\.|$|-)/i.test(filename))hasLicense=true;
    }
  }
  // These npm packages omit the monorepo license. Use the reviewed, pinned
  // upstream version only; a dependency update must revalidate this fallback.
  if(!hasLicense&&name.startsWith('@uiw/codemirror-')&&metadata.version==='4.25.12'&&metadata.license==='MIT'&&metadata.repository?.url==='https://github.com/uiwjs/react-codemirror.git'){
    const content=await fs.readFile(path.join(root,'src/third-party-licenses/uiw-react-codemirror-4.25.12-LICENSE.txt'));
    if(createHash('sha256').update(content).digest('hex')!=='fd1f049b3bb5cbaf5143516b72dbc6805cd30cca0cda94edb37160e37662fd17')throw new Error('Pinned uiw license text has changed; review upstream attribution.');
    const target=encodeURIComponent(name)+'-LICENSE.txt';
    await fs.writeFile(path.join(generated,'licenses',target),content);
    files.push({path:target,sha256:createHash('sha256').update(content).digest('hex'),source:'https://raw.githubusercontent.com/uiwjs/react-codemirror/1e2e11f865860c6bd5029d71a2a09bd894ed5bad/LICENSE'});
    hasLicense=true;
  }
  if(!hasLicense)throw new Error(`No license text found for bundled package ${name}; review its distribution notices before building.`);
  licenseManifest.push({name,version:metadata.version,license:metadata.license??null,files});
}
await fs.writeFile(path.join(generated,'licenses','packages.json'),JSON.stringify({schemaVersion:1,packages:licenseManifest},null,2)+'\n');
console.log('Editor and PDF assets built locally.');
