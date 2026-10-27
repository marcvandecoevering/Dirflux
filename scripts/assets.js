import fs from 'node:fs/promises';
import path from 'node:path';
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
for(const name of packages){
  const directory=path.join(root,'node_modules',name);
  for(const filename of await fs.readdir(directory))if(/^licen[sc]e(?:\.|$|-)/i.test(filename)){
    if((await fs.stat(path.join(directory,filename))).isFile())await fs.copyFile(path.join(directory,filename),path.join(root,'public/vendor/licenses',name.replaceAll('/','-')+'-'+filename+'.txt'));
  }
}
console.log('Editor and PDF assets built locally.');
