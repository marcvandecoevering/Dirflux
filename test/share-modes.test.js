import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.js';

test('share modes persist, preserve legacy links and keep active content inert', async t => {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'share-modes-'));
  const options={files:path.join(temp,'files'),config:path.join(temp,'config'),publicMode:true,watch:false,pollingInterval:0};
  let instance,server,base,headers;
  async function start(){
    instance=await createApp(options);server=instance.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
    const r=await fetch(base+'/api/session'),session=await r.json();
    headers={Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':session.csrf,'Content-Type':'application/json'};
  }
  async function stop(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));instance.close();}
  t.after(async()=>{await stop();await fs.rm(temp,{recursive:true,force:true});});
  const create=async(body,status=201)=>{const r=await fetch(base+'/api/shares',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,status);return r.json();};
  await start();
  await fs.writeFile(path.join(instance.root,'test.txt'),'shared text');
  await fs.writeFile(path.join(instance.root,'test.html'),'<script>alert(1)</script>');
  await fs.mkdir(path.join(instance.root,'folder'));
  const legacy=await create({path:'test.txt'});
  await stop();
  // A real pre-upgrade schema has no mode column.
  const db=new DatabaseSync(path.join(options.config,'state.sqlite'));
  db.exec('ALTER TABLE shares DROP COLUMN download');db.close();
  await start();
  let response=await fetch(base+legacy.url);
  assert.match(response.headers.get('content-disposition'),/^attachment/);await response.text();
  const inline=await create({path:'test.txt',download:false});
  const download=await create({path:'test.txt',download:true});
  const html=await create({path:'test.html',download:false});
  const folder=await create({path:'folder',download:false});assert.equal(folder.download,true);
  await create({path:'test.txt',download:'false'},400);
  await stop();await start();
  response=await fetch(base+inline.url);assert.match(response.headers.get('content-type'),/^text\/plain/);
  assert.doesNotMatch(response.headers.get('content-disposition')||'',/^attachment/);assert.equal(await response.text(),'shared text');
  response=await fetch(base+download.url);assert.match(response.headers.get('content-disposition'),/^attachment/);await response.text();
  response=await fetch(base+html.url);assert.match(response.headers.get('content-type'),/^text\/plain/);assert.equal(await response.text(),'<script>alert(1)</script>');
  response=await fetch(base+inline.url+'?download=1');assert.match(response.headers.get('content-disposition'),/^attachment/);await response.text();
  response=await fetch(base+legacy.url+'?download=0');assert.match(response.headers.get('content-type'),/^text\/plain/);await response.text();
  const listing=await (await fetch(base+'/api/shares',{headers})).json();
  assert.equal(listing.items.find(i=>i.id===inline.id).download,false);
  assert.equal(listing.items.find(i=>i.id===legacy.id).download,true);
  assert.equal((await fetch(base+'/api/shares/'+inline.id,{method:'DELETE',headers})).status,200);
  assert.equal((await fetch(base+inline.url)).status,404);
});
