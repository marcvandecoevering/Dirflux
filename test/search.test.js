import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';

test('search pages beyond 1000 results and finds files beyond the former 25000-item limit',{timeout:120000},async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'search-scale-'));
  const instance=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),publicMode:true,watch:false,pollingInterval:0,ignorePatterns:['excluded']});
  const server=instance.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));instance.close();await fs.rm(temp,{recursive:true,force:true});});
  const folder=path.join(instance.root,'scope');await fs.mkdir(folder);
  for(let first=0;first<25005;first+=64)await Promise.all(Array.from({length:Math.min(64,25005-first)},(_,n)=>fs.writeFile(path.join(folder,'entry-'+String(first+n).padStart(5,'0')+'.txt'),'')));
  await fs.writeFile(path.join(folder,'zz-needle.txt'),'found');
  await fs.mkdir(path.join(instance.root,'excluded'));await fs.writeFile(path.join(instance.root,'excluded/needle.txt'),'hidden');
  await fs.writeFile(path.join(instance.root,'needle-outside.txt'),'outside');
  const base=`http://127.0.0.1:${server.address().port}`;
  const session=await fetch(base+'/api/session');const headers={Cookie:session.headers.get('set-cookie').split(';')[0]};
  async function search(query) {const response=await fetch(base+'/api/search?'+query,{headers});assert.equal(response.status,200);return response.json();}
  const first=await search('path=scope&q=entry');assert.equal(first.items.length,1000);assert.equal(first.nextOffset,1000);assert.equal(first.truncated,true);
  const second=await search('path=scope&q=entry&offset=1000');assert.equal(second.items.length,1000);assert.equal(second.nextOffset,2000);
  assert.equal(new Set([...first.items,...second.items].map(item=>item.path)).size,2000);
  assert.equal(first.items[0].name,'entry-00000.txt');assert.equal(second.items[0].name,'entry-01000.txt');
  const last=await search('path=scope&q=entry&offset=25000');assert.equal(last.items.length,5);assert.equal(last.nextOffset,null);assert.equal(last.truncated,false);
  const target=await search('path=scope&q=needle');assert.deepEqual(target.items.map(item=>item.path),['scope/zz-needle.txt']);
  for(const offset of ['-1','0.5','nope'])assert.equal((await fetch(base+'/api/search?q=x&offset='+offset,{headers})).status,400);
});
