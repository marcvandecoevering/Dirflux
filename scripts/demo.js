// Isolated, disposable browser-test server. Never connects to existing files.
import { createApp } from '../server.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { samplePdf, sampleWav } from './fixtures.js';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'droppy-next-demo-'));
const instance = await createApp({ files:path.join(temporary,'files'), config:path.join(temporary,'config') });
for (const folder of ['Documenten', 'Foto’s', 'Projecten', 'Gedeeld']) await fs.mkdir(path.join(instance.root,folder));
await fs.writeFile(path.join(instance.root,'Welkom.txt'), 'Welkom bij Droppy Next.\n\nDit zijn tijdelijke demonstratiebestanden.\nJe eigen bestanden blijven ongemoeid.\n');
await fs.writeFile(path.join(instance.root,'Documenten','Notities.txt'), 'Mijn notities\n\nEen nieuwe plek voor bestanden.\n');
await fs.writeFile(path.join(instance.root,'Projecten','instellingen.json'), JSON.stringify({ project:'Droppy Next', status:'demo' },null,2));
await fs.writeFile(path.join(instance.root,'Documenten','Voorbeeld.pdf'),samplePdf());
await fs.copyFile(path.resolve(import.meta.dirname,'../test/fixtures/pdf/jpeg2000.pdf'),path.join(instance.root,'Documenten','JPEG2000.pdf'));
await fs.writeFile(path.join(instance.root,'Geluidstest.wav'),sampleWav());
await fs.writeFile(path.join(instance.root,'Geluidstest-2.wav'),sampleWav());
await fs.writeFile(path.join(instance.root,'Seektest.wav'),sampleWav(30));
for(const [source,name] of [['blue.mp4','Video-1.mp4'],['green.mp4','Video-2.mp4']]) {
  await fs.copyFile(path.resolve(import.meta.dirname,'../test/fixtures/media',source),path.join(instance.root,name));
}
await fs.copyFile(path.resolve(import.meta.dirname,'../public/original/logo192.png'),path.join(instance.root,'Foto’s','Droppy.png'));
const server = instance.listen(18094,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const setupToken=(await fs.readFile(path.join(instance.config,'setup-token'),'utf8')).trim();
const response = await fetch('http://127.0.0.1:18094/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'demo',password:'demo-uitsluitend-lokaal',setupToken})});
if (!response.ok) throw new Error('Demo setup failed');
console.log('Isolated demo: http://127.0.0.1:18094 (demo account; see scripts/demo.js)');
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{instance.stopEvents();server.close(async()=>{instance.close();await fs.rm(temporary,{recursive:true,force:true});process.exit(0);});});
