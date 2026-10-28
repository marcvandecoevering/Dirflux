import fs from 'node:fs/promises';

const required = ['vendor/extras.js','vendor/pdf.worker.min.mjs','vendor/wasm/openjpeg_nowasm_fallback.js','vendor/wasm/jbig2_nowasm_fallback.js','vendor/iccs/CGATS001Compat-v2-micro.icc','original/fonts.css','original/roboto-latin-300.woff2'];
let missing=false;
for(const file of required) {
  try { await fs.access(new URL('../public/'+file,import.meta.url)); }
  catch { missing=true; }
}
if(missing) await import('./assets.js');
