import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';

for(const phase of ['prepared','renamed']) test(`interrupted move at ${phase} recovers its public links on restart`,async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'file-app-move-'));
  const options={files:path.join(temp,'files'),config:path.join(temp,'config')};
  let instance,server,base,cookie,csrf;
  async function start(extra={}) {
    instance=await createApp({...options,...extra});server=instance.app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));instance.close();server=null;}}
  t.after(async()=>{await stop();assert.equal(path.dirname(temp),os.tmpdir());await fs.rm(temp,{recursive:true,force:true});});
  await start({moveCheckpoint:at=>{if(at===phase)throw Object.assign(new Error('Simulated process interruption'),{status:503});}});
  const token=(await fs.readFile(path.join(instance.config,'setup-token'),'utf8')).trim();
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'test',password:'test-move-password',setupToken:token})});
  assert.equal(setup.status,201);cookie=setup.headers.get('set-cookie').split(';')[0];csrf=(await setup.json()).csrf;
  async function request(route,body) {return fetch(base+'/api'+route,{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});}
  await fs.mkdir(path.join(instance.root,'before'));
  await fs.writeFile(path.join(instance.root,'before','child.txt'),'original content');
  const links=[];
  for(const target of ['before','before/child.txt']) {
    const response=await request('/shares',{path:target});assert.equal(response.status,201);links.push(await response.json());
  }
  const move=await request('/transfer',{source:'before',target:'after',operation:'move'});assert.equal(move.status,503);
  for(const link of links)assert.equal((await fetch(base+link.url)).status,503,'Pending links must be unavailable');
  assert.equal((await request('/create',{path:'another.txt'})).status,503,'Mutations cannot race unresolved recovery');
  if(phase==='renamed') {
    await fs.mkdir(path.join(instance.root,'before'));
    await fs.writeFile(path.join(instance.root,'before','child.txt'),'unrelated replacement');
  }
  await stop();await start();
  const expected=phase==='renamed'?'after':'before';
  const content=await fetch(base+links[1].url);assert.equal(content.status,200);assert.equal(await content.text(),'original content');
  const directory=await fetch(base+links[0].url);assert.equal(directory.status,200);await directory.arrayBuffer();
  const database=new DatabaseSync(path.join(instance.config,'state.sqlite'));
  assert.deepEqual(database.prepare('SELECT path FROM shares ORDER BY length(path)').all().map(i=>i.path),[expected,expected+'/child.txt']);
  assert.equal(database.prepare('SELECT count(*) AS n FROM file_moves').get().n,0);database.close();
  await stop();await start();assert.equal(await fetch(base+links[1].url).then(r=>r.text()),'original content');
});

test('ambiguous interrupted move fails closed without choosing an unrelated file',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'file-app-move-ambiguous-'));
  const options={files:path.join(temp,'files'),config:path.join(temp,'config')};
  const instance=await createApp(options);instance.close();
  const db=new DatabaseSync(path.join(options.config,'state.sqlite'));
  db.prepare('INSERT INTO file_moves VALUES (?,?,?,?,?)').run('interrupted','old','new','not-the-current-object','[]');db.close();
  await fs.writeFile(path.join(options.files,'old'),'unrelated old');await fs.writeFile(path.join(options.files,'new'),'unrelated new');
  t.after(async()=>{assert.equal(path.dirname(temp),os.tmpdir());await fs.rm(temp,{recursive:true,force:true});});
  await assert.rejects(createApp(options),/Move recovery is ambiguous/);
  assert.equal(await fs.readFile(path.join(options.files,'old'),'utf8'),'unrelated old');
  assert.equal(await fs.readFile(path.join(options.files,'new'),'utf8'),'unrelated new');
});
