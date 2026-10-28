import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';

test('optional share extensions preserve authorization, MIME, rename and restart behavior',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'share-extensions-'));
  const options={files:path.join(temp,'files'),config:path.join(temp,'config'),publicMode:true,watch:false,pollingInterval:0};
  let instance,server,base;
  async function start(linkExtensions){instance=await createApp({...options,linkExtensions});server=instance.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;}
  async function stop(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));instance.close();}
  t.after(async()=>{await stop();await fs.rm(temp,{recursive:true,force:true});});
  await start(true);
  await fs.writeFile(path.join(instance.root,'sample.txt'),'extension test');
  await fs.writeFile(path.join(instance.root,'unicode.téxt'),'unicode extension');
  await fs.writeFile(path.join(instance.root,'no-extension'),'no extension');
  const session=await fetch(base+'/api/session'),user=await session.json();
  const headers={Cookie:session.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':user.csrf,'Content-Type':'application/json'};
  const request=(route,method='GET',body)=>fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const create=async filename=>{const response=await request('/api/shares','POST',{path:filename});assert.equal(response.status,201);return response.json();};
  const share=await create('sample.txt');
  assert.match(share.id,/^[\w-]{43}$/);
  assert.equal(share.url,`/s/${share.id}.txt`);
  for(const url of [share.url,`/s/${share.id}`,`/s/${share.id}.html`]){
    const response=await fetch(base+url+'?download=0');
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/^text\/plain/);
    assert.equal(await response.text(),'extension test');
  }
  const ranged=await fetch(base+share.url,{headers:{Range:'bytes=0-8'}});
  assert.equal(ranged.status,206);assert.equal(await ranged.text(),'extension');
  const unicode=await create('unicode.téxt');
  assert.ok(unicode.url.endsWith('.t%C3%A9xt'));assert.equal(await (await fetch(base+unicode.url)).text(),'unicode extension');
  const plain=await create('no-extension');assert.equal(plain.url,'/s/'+plain.id);
  let listed=await (await request('/api/shares')).json();assert.equal(listed.items.find(i=>i.id===share.id).url,share.url);
  assert.equal((await request('/api/transfer','POST',{source:'sample.txt',target:'renamed.log',operation:'move'})).status,200);
  assert.equal(await (await fetch(base+share.url)).text(),'extension test');
  listed=await (await request('/api/shares')).json();assert.equal(listed.items.find(i=>i.id===share.id).url,`/s/${share.id}.log`);
  await stop();await start(false);
  listed=await (await request('/api/shares')).json();assert.equal(listed.items.find(i=>i.id===share.id).url,'/s/'+share.id);
  assert.equal(await (await fetch(base+share.url)).text(),'extension test');
  const newer=await create('renamed.log');assert.equal(newer.url,'/s/'+newer.id);
  assert.equal((await request('/api/shares/'+share.id,'DELETE')).status,200);
  for(const url of [share.url,`/s/${share.id}`,`/s/${share.id}.log`])assert.equal((await fetch(base+url)).status,404);
});

test('share extension configuration rejects ambiguous values',async()=>{
  await assert.rejects(createApp({linkExtensions:'yes'}),/LINK_EXTENSIONS must be true or false/);
});
