import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';
import {inflateRawSync} from 'node:zlib';

// Emulated CPUs may need more wall time for the same fixture and assertions.
const scaleTimeout=Number(process.env.SCALE_TEST_TIMEOUT_MS??120000);
if(!Number.isSafeInteger(scaleTimeout)||scaleTimeout<120000||scaleTimeout>600000)throw new Error('SCALE_TEST_TIMEOUT_MS must be 120000..600000.');
test('large trees support paged search, accurate sizes and moves beyond 25000 items',{timeout:scaleTimeout},async t=>{
  const started=performance.now();
  const progress=stage=>console.info(`Large-tree check: ${stage} (${Math.round(performance.now()-started)} ms)`);
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'search-scale-'));
  const instance=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),publicMode:true,watch:false,pollingInterval:0,ignorePatterns:['excluded']});
  const server=instance.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));instance.close();await fs.rm(temp,{recursive:true,force:true});});
  const folder=path.join(instance.root,'scope');await fs.mkdir(folder);
  for(let first=0;first<25005;first+=64)await Promise.all(Array.from({length:Math.min(64,25005-first)},(_,n)=>fs.writeFile(path.join(folder,'entry-'+String(first+n).padStart(5,'0')+'.txt'),'')));
  await fs.writeFile(path.join(folder,'zz-needle.txt'),'found');
  await fs.mkdir(path.join(instance.root,'excluded'));await fs.writeFile(path.join(instance.root,'excluded/needle.txt'),'hidden');
  await fs.writeFile(path.join(instance.root,'needle-outside.txt'),'outside');
  progress('25006-file fixture created');
  const base=`http://127.0.0.1:${server.address().port}`;
  const session=await fetch(base+'/api/session');const headers={Cookie:session.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await session.json()).csrf};
  async function search(query) {const response=await fetch(base+'/api/search?'+query,{headers});assert.equal(response.status,200);return response.json();}
  const first=await search('path=scope&q=entry');assert.equal(first.items.length,1000);assert.equal(first.nextOffset,1000);assert.equal(first.truncated,true);
  const second=await search('path=scope&q=entry&offset=1000');assert.equal(second.items.length,1000);assert.equal(second.nextOffset,2000);
  assert.equal(new Set([...first.items,...second.items].map(item=>item.path)).size,2000);
  assert.equal(first.items[0].name,'entry-00000.txt');assert.equal(second.items[0].name,'entry-01000.txt');
  const last=await search('path=scope&q=entry&offset=25000');assert.equal(last.items.length,5);assert.equal(last.nextOffset,null);assert.equal(last.truncated,false);
  const target=await search('path=scope&q=needle');assert.deepEqual(target.items.map(item=>item.path),['scope/zz-needle.txt']);
  progress('pagination and full-tree search verified');
  const listing=await fetch(base+'/api/files',{headers});assert.equal(listing.status,200);
  assert.equal((await listing.json()).items.find(item=>item.path==='scope').size,5);
  const move=await fetch(base+'/api/transfer',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({source:'scope',target:'renamed',operation:'move'})});
  assert.equal(move.status,200);
  assert.equal(await fs.readFile(path.join(instance.root,'renamed/zz-needle.txt'),'utf8'),'found');
  assert.equal((await fs.readdir(path.join(instance.root,'renamed'))).length,25006);
  await assert.rejects(fs.stat(folder),{code:'ENOENT'});
  progress('size and complete directory move verified');
  const download=await fetch(base+'/api/zip?path=renamed',{headers});assert.equal(download.status,200);
  const archive=Buffer.from(await download.arrayBuffer()),end=archive.length-22;
  assert.equal(archive.readUInt32LE(end),0x06054b50);
  assert.equal(archive.readUInt16LE(end+10),25007,'All files and the containing directory must be in the ZIP');
  let at=archive.readUInt32LE(end+16),found=false;
  for(let n=0;n<25007;n++) {
    assert.equal(archive.readUInt32LE(at),0x02014b50);
    const nameLength=archive.readUInt16LE(at+28),extraLength=archive.readUInt16LE(at+30),commentLength=archive.readUInt16LE(at+32);
    const name=archive.subarray(at+46,at+46+nameLength).toString();
    if(name==='renamed/zz-needle.txt') {
      const local=archive.readUInt32LE(at+42),start=local+30+archive.readUInt16LE(local+26)+archive.readUInt16LE(local+28);
      const compressed=archive.subarray(start,start+archive.readUInt32LE(at+20));
      assert.equal(inflateRawSync(compressed).toString(),'found');found=true;
    }
    at+=46+nameLength+extraLength+commentLength;
  }
  assert.equal(found,true);
  progress('complete ZIP and final file contents verified');
  for(const offset of ['-1','0.5','nope'])assert.equal((await fetch(base+'/api/search?q=x&offset='+offset,{headers})).status,400);
});
