import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { DatabaseSync } from 'node:sqlite';
import { samplePdf } from '../scripts/fixtures.js';
import { inflateRawSync } from 'node:zlib';
import crypto from 'node:crypto';

// Inspect the complete small test archive using its central directory. This
// validates actual paths and decompressed bytes, not just the ZIP signature.
function archiveContents(bytes) {
  const end=bytes.length-22;
  assert.equal(bytes.readUInt32LE(end),0x06054b50);
  const count=bytes.readUInt16LE(end+10),items=new Map();
  let at=bytes.readUInt32LE(end+16);
  for(let n=0;n<count;n++) {
    assert.equal(bytes.readUInt32LE(at),0x02014b50);
    const method=bytes.readUInt16LE(at+10),size=bytes.readUInt32LE(at+20);
    const nameLength=bytes.readUInt16LE(at+28),extraLength=bytes.readUInt16LE(at+30),commentLength=bytes.readUInt16LE(at+32);
    const local=bytes.readUInt32LE(at+42),name=bytes.subarray(at+46,at+46+nameLength).toString('utf8');
    assert.equal(bytes.readUInt32LE(local),0x04034b50);
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    assert.ok(method===0||method===8,'Expected stored or deflate entry');
    const packed=bytes.subarray(start,start+size);
    items.set(name,method===8?inflateRawSync(packed):packed);
    at+=46+nameLength+extraLength+commentLength;
  }
  return items;
}

test('file manager integration: accounts, files, permissions, conflicts and sharing', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'droppy-next-test-'));
  const instance = await createApp({ files:path.join(temp,'files'), config:path.join(temp,'config'), maxUpload:1024 });
  const setupToken=(await fs.readFile(path.join(instance.config,'setup-token'),'utf8')).trim();
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); instance.close(); await fs.rm(temp, { recursive:true, force:true }); });
  let cookie = '', csrf = '';
  async function request(route, method = 'GET', data, extra = {}) {
    const headers = { Cookie:cookie, 'X-CSRF-Token':csrf, ...(route==='/api/setup'?{'X-Setup-Token':setupToken}:{}), ...extra };
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(base + route, { method, headers, body:data === undefined ? undefined : JSON.stringify(data) });
  }
  async function json(route, method, data, expected = 200) { const r = await request(route,method,data); const b = await r.json(); assert.equal(r.status, expected, JSON.stringify(b)); return b; }
  await t.test('requires login and protects initial setup', async () => {
    assert.equal((await request('/api/files')).status,401);
    assert.equal((await json('/api/session')).setup,true);
    const unauthenticated=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'attacker',password:'integration-test-password'})});
    assert.equal(unauthenticated.status,403);
    assert.equal((await request('/api/setup','POST',{name:'attacker',password:'integration-test-password'},{'X-Setup-Token':'wrong'})).status,403);
    await json('/api/setup','POST',{ name:'admin',password:'short' },400);
    const r = await request('/api/setup','POST',{ name:'admin',password:'integration-test-password' });
    assert.equal(r.status,201); cookie = r.headers.get('set-cookie').split(';')[0]; csrf = (await r.json()).csrf;
    await assert.rejects(fs.stat(path.join(instance.config,'setup-token')),{code:'ENOENT'});
    assert.match(r.headers.get('set-cookie'),/HttpOnly/);
    assert.match(r.headers.get('set-cookie'),/SameSite=Strict/);
    await json('/api/setup','POST',{name:'other',password:'integration-test-password'},409);
    assert.equal((await json('/api/session')).user.role,'admin');
  });
  await t.test('CSRF and cross-origin requests rejected', async () => {
    assert.equal((await request('/api/create','POST',{path:'blocked.txt'}, { 'X-CSRF-Token':'bad' })).status,403);
    assert.equal((await request('/api/create','POST',{path:'blocked.txt'}, { Origin:'https://evil.example' })).status,403);
  });
  await t.test('creates and streams uploads without overwriting', async () => {
    await json('/api/create','POST',{path:'Docs',directory:true},201);
    const r = await fetch(base+'/api/upload?path=Docs/hello.txt',{method:'PUT',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/octet-stream'},body:'hello world'});
    assert.equal(r.status,201);
    const duplicate = await fetch(base+'/api/upload?path=Docs/hello.txt',{method:'PUT',headers:{Cookie:cookie,'X-CSRF-Token':csrf},body:'overwrite'});
    assert.equal(duplicate.status,409);
    const listing = await json('/api/files?path=Docs'); assert.equal(listing.items[0].size,11);
    const folder = await fetch(base+'/api/upload?path=Photos/Trip/note.txt',{method:'PUT',headers:{Cookie:cookie,'X-CSRF-Token':csrf},body:'folder upload'});
    assert.equal(folder.status,201);
    const jsonUpload=await fetch(base+'/api/upload?path=raw.json',{method:'PUT',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:'{"raw":true}'});
    assert.equal(jsonUpload.status,201);assert.equal(await fs.readFile(path.join(instance.root,'raw.json'),'utf8'),'{"raw":true}');
    const tooLarge = await fetch(base+'/api/upload?path=oversized.txt',{method:'PUT',headers:{Cookie:cookie,'X-CSRF-Token':csrf},body:'x'.repeat(1025)});
    assert.equal(tooLarge.status,413);
    assert.equal((await json('/api/files')).items.some(i=>i.name==='oversized.txt'),false);
  });
  await t.test('upload conflicts allow explicit replacement or keeping both, with stale-version protection', async () => {
    const put = (name,content,extra='') => fetch(base+'/api/upload?path='+encodeURIComponent(name)+extra,{method:'PUT',headers:{Cookie:cookie,'X-CSRF-Token':csrf},body:content});
    assert.equal((await put('conflict.txt','original')).status,201);
    const target = await json('/api/upload-target?path=conflict.txt');
    assert.equal(target.exists,true);
    assert.equal((await put('conflict.txt','unsafe','&conflict=replace')).status,409);
    assert.equal((await put('conflict.txt','second','&conflict=rename')).status,201);
    assert.equal(await fs.readFile(path.join(instance.root,'conflict (1).txt'),'utf8'),'second');
    assert.equal(await fs.readFile(path.join(instance.root,'conflict.txt'),'utf8'),'original');
    assert.equal((await put('conflict.txt','replacement','&conflict=replace&version='+target.version)).status,201);
    assert.equal((await put('conflict.txt','stale','&conflict=replace&version='+target.version)).status,409);
    assert.equal(await fs.readFile(path.join(instance.root,'conflict.txt'),'utf8'),'replacement');
    const current = await json('/api/upload-target?path=conflict.txt');
    assert.equal((await put('conflict.txt','x'.repeat(1025),'&conflict=replace&version='+current.version)).status,413);
    assert.equal(await fs.readFile(path.join(instance.root,'conflict.txt'),'utf8'),'replacement');
    assert.equal((await put('Docs','unsafe','&conflict=replace&version='+current.version)).status,409);
    const kept = await put('Docs','safe','&conflict=rename');
    assert.equal(kept.status,201); assert.equal((await kept.json()).path,'Docs (1)');
    const concurrent = await Promise.all([put('conflict.txt','a','&conflict=rename'),put('conflict.txt','b','&conflict=rename')]);
    assert.deepEqual(concurrent.map(r=>r.status),[201,201]);
    assert.equal(await fs.readFile(path.join(instance.root,'conflict (2).txt'),'utf8'),'a');
    assert.equal(await fs.readFile(path.join(instance.root,'conflict (3).txt'),'utf8'),'b');
    await fs.writeFile(path.join(instance.root,'.app-tmp-protected'),'private staging');
    assert.equal((await request('/api/file?path=.app-tmp-protected')).status,403);
    assert.equal((await json('/api/files')).items.some(i=>i.name.startsWith('.app-tmp-')),false);
    await fs.rm(path.join(instance.root,'.app-tmp-protected'));
    assert.deepEqual(await fs.readdir(path.join(instance.config,'tmp')),[]);
    assert.equal((await fs.readdir(instance.root)).some(n=>n.startsWith('.app-tmp-')),false);
  });
  await t.test('supports optimistic text edits and rejects stale versions', async () => {
    const data = await json('/api/text?path=Docs/hello.txt'); assert.equal(data.text,'hello world');
    await json('/api/text','POST',{path:'Docs/hello.txt',text:'updated',version:data.version});
    await json('/api/text','POST',{path:'Docs/hello.txt',text:'stale',version:data.version},409);
    const current = await json('/api/text?path=Docs/hello.txt');
    const results = await Promise.all(['edit one','edit two'].map(text=>request('/api/text','POST',{path:'Docs/hello.txt',text,version:current.version})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  });
  await t.test('blocks traversal, alternate streams, device names and symlinks', async () => {
    for (const name of ['../outside','Docs/../../outside','C:/windows','Docs/hello.txt:secret','NUL','Docs/trailing.','Docs\\hello.txt']) {
      assert.equal((await request('/api/files?path='+encodeURIComponent(name))).status,400,name);
    }
    const outside = path.join(temp,'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside,'secret.txt'),'outside');
    await fs.symlink(outside,path.join(instance.root,'escape'),process.platform==='win32'?'junction':'dir');
    assert.equal((await request('/api/files?path=escape')).status,403);
    assert.equal((await request('/api/file?path=escape/secret.txt')).status,403);
    assert.equal((await json('/api/files')).items.some(i=>i.name==='escape'),false);
  });
  await t.test('download, range, archive and search', async () => {
    const result = await json('/api/search?q=hello'); assert.equal(result.items.length,1);
    const file = await request('/api/file?path=Docs/hello.txt&download=1'); assert.match(file.headers.get('content-disposition'),/attachment/);
    const zip = await request('/api/zip?path=Docs'); const bytes = Buffer.from(await zip.arrayBuffer()); assert.equal(bytes.readUInt16LE(),0x4b50);
    const entries=archiveContents(bytes);
    assert.ok(entries.has('Docs/'));
    assert.deepEqual(entries.get('Docs/hello.txt'),await fs.readFile(path.join(instance.root,'Docs/hello.txt')));
    await fs.mkdir(path.join(instance.root,'.hidden'));
    await fs.writeFile(path.join(instance.root,'.hidden','résumé 日本語.txt'),'Unicode and hidden directory content');
    const hidden=await request('/api/file?path='+encodeURIComponent('.hidden/résumé 日本語.txt')+'&download=1');
    assert.equal(hidden.status,200);assert.equal(await hidden.text(),'Unicode and hidden directory content');
    const hiddenZip=await request('/api/zip?path=.hidden');
    const hiddenEntries=archiveContents(Buffer.from(await hiddenZip.arrayBuffer()));
    assert.equal(hiddenEntries.get('.hidden/résumé 日本語.txt').toString(),'Unicode and hidden directory content');
    const hiddenShare=await json('/api/shares','POST',{path:'.hidden/résumé 日本語.txt'},201);
    const publicHidden=await fetch(base+hiddenShare.url);
    assert.equal(publicHidden.status,200);assert.equal(await publicHidden.text(),'Unicode and hidden directory content');
    const partial=await fetch(base+hiddenShare.url,{headers:{Range:'bytes=0-6'}});
    assert.equal(partial.status,206);assert.equal(await partial.text(),'Unicode');
    const suffix=await fetch(base+hiddenShare.url,{headers:{Range:'bytes=-7'}});
    assert.equal(suffix.status,206);assert.equal(await suffix.text(),'content');
    const head=await fetch(base+hiddenShare.url,{method:'HEAD'});
    assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(Number(head.headers.get('content-length')),36);
    const unsatisfied=await fetch(base+hiddenShare.url,{headers:{Range:'bytes=1000-2000'}});
    assert.equal(unsatisfied.status,416);
    await fs.writeFile(path.join(instance.root,'video.mp4'),Buffer.from('0123456789'));
    const range = await request('/api/file?path=video.mp4','GET',undefined,{Range:'bytes=2-5'});
    assert.equal(range.status,206); assert.equal(await range.text(),'2345');
    await fs.writeFile(path.join(instance.root,'untrusted.html'),'<script>alert(1)</script>');
    assert.match((await request('/api/file?path=untrusted.html')).headers.get('content-disposition'),/attachment/);
    assert.equal((await json('/api/stat?path=Docs/hello.txt')).directory,false);
    await fs.writeFile(path.join(instance.root,'document.pdf'),samplePdf());
    const pdf = await request('/api/pdf?path=document.pdf');assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.match(await pdf.text(),/^%PDF/);
    assert.equal((await request('/api/pdf?path=untrusted.html')).status,415);
    const page=await fetch(base+'/?viewer=1&path=Docs%2Fhello.txt');assert.equal(page.headers.get('x-frame-options'),'SAMEORIGIN');assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  });
  await t.test('real-time updates are emitted for external filesystem changes', async () => {
    const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),5000);
    const response=await fetch(base+'/api/events',{headers:{Cookie:cookie},signal:abort.signal});
    const reader=response.body.getReader();let text=new TextDecoder().decode((await reader.read()).value);assert.match(text,/event: ready/);
    await fs.writeFile(path.join(instance.root,'external-change.txt'),'filesystem event');
    try{while(!text.includes('event: change'))text+=new TextDecoder().decode((await reader.read()).value);assert.match(text,/event: change/);}
    finally{await reader.cancel();clearTimeout(timeout);abort.abort();}
  });
  await t.test('search accepts one character and matches folder paths without escaping its scope', async () => {
    await fs.mkdir(path.join(instance.root,'Scope','Matched','Nested'),{recursive:true});
    await fs.mkdir(path.join(instance.root,'Scope-other'),{recursive:true});
    await fs.writeFile(path.join(instance.root,'Scope','a.txt'),'one character');
    await fs.writeFile(path.join(instance.root,'Scope-other','a.txt'),'outside search scope');
    const one=await json('/api/search?path=Scope&q=A');
    assert.ok(one.items.some(i=>i.path==='Scope/a.txt'));
    assert.equal(one.items.some(i=>i.path.startsWith('Scope-other/')),false);
    const folders=await json('/api/search?path=Scope&q=matched');
    assert.deepEqual(folders.items.map(i=>i.path).sort(),['Scope/Matched','Scope/Matched/Nested']);
    await json('/api/search?q=','GET',undefined,400);
    await json('/api/search?q='+('x'.repeat(257)),'GET',undefined,400);
  });
  await t.test('cancelled ZIP downloads release streams without disrupting subsequent requests', async () => {
    const folder=path.join(instance.root,'cancel-archive');await fs.mkdir(folder);
    for(let i=0;i<4;i++)await fs.writeFile(path.join(folder,`${i}.bin`),crypto.randomBytes(256*1024));
    const link=await json('/api/shares','POST',{path:'cancel-archive'},201);
    for(let i=0;i<3;i++) {
      const response=await fetch(base+link.url);assert.equal(response.status,200);
      const reader=response.body.getReader();await reader.read();await reader.cancel();
      assert.equal((await request('/api/health')).status,200);
    }
    const completed=await fetch(base+link.url);
    const entries=archiveContents(Buffer.from(await completed.arrayBuffer()));
    assert.deepEqual(entries.get('cancel-archive/3.bin'),await fs.readFile(path.join(folder,'3.bin')));
  });
  await t.test('copy, move, duplicate protection, descendant checks', async () => {
    await json('/api/transfer','POST',{source:'Docs/hello.txt',target:'Docs/copy.txt',operation:'copy'});
    await json('/api/transfer','POST',{source:'Docs/copy.txt',target:'Docs/moved.txt',operation:'move'});
    await json('/api/transfer','POST',{source:'Docs/hello.txt',target:'Docs/moved.txt',operation:'copy'},409);
    await json('/api/transfer','POST',{source:'Docs',target:'Docs/sub',operation:'copy'},400);
    await json('/api/transfer','POST',{source:'',target:'rootcopy',operation:'copy'},400);
    const duplicate=await json('/api/transfer','POST',{source:'Docs/hello.txt',target:'Docs/hello.txt',operation:'copy',conflict:'rename'});
    assert.equal(duplicate.path,'Docs/hello (1).txt');
    assert.equal(await fs.readFile(path.join(instance.root,duplicate.path),'utf8'),await fs.readFile(path.join(instance.root,'Docs/hello.txt'),'utf8'));
    const moved=await json('/api/transfer','POST',{source:duplicate.path,target:'Docs/hello.txt',operation:'move',conflict:'rename'});
    assert.equal(moved.path,'Docs/hello (2).txt');
    await assert.rejects(fs.stat(path.join(instance.root,duplicate.path)),{code:'ENOENT'});
    await json('/api/create','POST',{path:'folder.with.dots',directory:true},201);
    const folderCopy=await json('/api/transfer','POST',{source:'folder.with.dots',target:'folder.with.dots',operation:'copy',conflict:'rename'});
    assert.equal(folderCopy.path,'folder.with.dots (1)');
    await json('/api/transfer','POST',{source:'Docs',target:'Docs/sub',operation:'copy',conflict:'rename'},400);
  });
  await t.test('public links are revocable and follow moved files without exposing reused names', async () => {
    const share = await json('/api/shares','POST',{path:'Docs/hello.txt',hours:1},201);
    assert.equal((await fetch(base+share.url)).status,200);
    await json('/api/shares/'+share.id,'DELETE');
    assert.equal((await fetch(base+share.url)).status,404);
    const another = await json('/api/shares','POST',{path:'Docs/moved.txt'},201);
    assert.equal(another.expires,0);
    await json('/api/transfer','POST',{source:'Docs/moved.txt',target:'Docs/renamed.txt',operation:'move'});
    await fs.writeFile(path.join(instance.root,'Docs/moved.txt'),'unrelated replacement');
    const followed=await fetch(base+another.url);assert.equal(followed.status,200);
    assert.equal(await followed.text(),await fs.readFile(path.join(instance.root,'Docs/renamed.txt'),'utf8'));
    assert.equal((await json('/api/shares')).items.find(i=>i.id===another.id).path,'Docs/renamed.txt');
    await json('/api/shares','POST',{path:'Docs/hello.txt',hours:-1},400);
    const folder = await json('/api/shares','POST',{path:'Docs'},201);
    const r = await fetch(base+folder.url); assert.equal(r.status,200); assert.match(r.headers.get('content-disposition'),/zip/); await r.arrayBuffer();
    const expired = await json('/api/shares','POST',{path:'Docs/hello.txt'},201);
    const inspection = new DatabaseSync(path.join(instance.config,'state.sqlite'));
    inspection.prepare('UPDATE shares SET expires=? WHERE id=?').run(Date.now()-1,expired.id); inspection.close();
    assert.equal((await fetch(base+expired.url)).status,404);
    const inline = await json('/api/shares','POST',{path:'untrusted.html'},201);
    const textOnly=await fetch(base+inline.url+'?download=0');assert.match(textOnly.headers.get('content-type'),/text\/plain/);assert.match(await textOnly.text(),/<script>/);
  });
  await t.test('trash restores exact file contents without overwriting', async () => {
    const original = await fs.readFile(path.join(instance.root,'Docs/hello.txt'),'utf8');
    const share = await json('/api/shares','POST',{path:'Docs/hello.txt'},201);
    const deleted = await json('/api/trash','POST',{path:'Docs/hello.txt'});
    assert.equal((await fetch(base+share.url)).status,404);
    await json('/api/text?path=Docs/hello.txt','GET',undefined,404);
    assert.equal((await json('/api/trash')).items.length,1);
    await json('/api/create','POST',{path:'Docs/hello.txt'},201);
    await json('/api/restore','POST',{id:deleted.id},409);
    await json('/api/trash','POST',{path:'Docs/hello.txt'});
    await json('/api/restore','POST',{id:deleted.id});
    assert.equal((await json('/api/text?path=Docs/hello.txt')).text,original);
  });
  await t.test('viewer permissions, session revocation and admin-only users', async () => {
    const user = await json('/api/users','POST',{name:'reader',password:'integration-reader-password',role:'viewer'},201);
    const adminCookie = cookie, adminCsrf = csrf;
    const login = await request('/api/login','POST',{name:'reader',password:'integration-reader-password'});
    cookie = login.headers.get('set-cookie').split(';')[0]; csrf = (await login.json()).csrf;
    await json('/api/files');
    await json('/api/create','POST',{path:'blocked'},403);
    await json('/api/shares','POST',{path:'Docs'},403);
    await json('/api/users','GET',undefined,403);
    const trashItems=(await json('/api/trash')).items;
    assert.equal(trashItems.length,0);
    await json('/api/trash/nonexistent','DELETE',undefined,403);
    const viewerCookie = cookie;
    cookie = adminCookie; csrf = adminCsrf;
    await json('/api/users/'+user.id,'DELETE');
    const removed = await fetch(base+'/api/files',{headers:{Cookie:viewerCookie}}); assert.equal(removed.status,401);
  });
  await t.test('permanent trash removal frees storage and cannot remove another user’s item', async () => {
    await json('/api/create','POST',{path:'purge-folder',directory:true},201);
    await json('/api/create','POST',{path:'purge-folder/child.txt'},201);
    const removed=await json('/api/trash','POST',{path:'purge-folder'});
    const stored=path.join(instance.config,'trash',removed.id);
    assert.equal((await fs.stat(stored)).isDirectory(),true);
    const editor=await json('/api/users','POST',{name:'editor-purge',password:'integration-editor-password',role:'editor'},201);
    const login=await request('/api/login','POST',{name:editor.name,password:'integration-editor-password'});
    const editorCookie=login.headers.get('set-cookie').split(';')[0],editorCsrf=(await login.json()).csrf;
    const denied=await fetch(base+'/api/trash/'+removed.id,{method:'DELETE',headers:{Cookie:editorCookie,'X-CSRF-Token':editorCsrf}});
    assert.equal(denied.status,404);assert.equal((await fs.stat(stored)).isDirectory(),true);
    await json('/api/trash/'+removed.id,'DELETE');
    await assert.rejects(fs.stat(stored),{code:'ENOENT'});
    await json('/api/restore','POST',{id:removed.id},404);
    await json('/api/trash/'+removed.id,'DELETE',undefined,404);
    await json('/api/trash/'+encodeURIComponent('../outside'),'DELETE',undefined,404);
    await json('/api/users/'+editor.id,'DELETE');
  });
  await t.test('administrators can change roles and reset passwords, revoking every target session', async () => {
    const user=await json('/api/users','POST',{name:'managed',password:'managed-initial-password',role:'editor'},201);
    const credentials=async password=>{
      const response=await request('/api/login','POST',{name:user.name,password});
      assert.equal(response.status,200,await response.clone().text());
      const body=await response.json();return {Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':body.csrf};
    };
    const first=await credentials('managed-initial-password'),second=await credentials('managed-initial-password');
    const forbidden=await fetch(base+'/api/users/'+user.id,{method:'PUT',headers:{...first,'Content-Type':'application/json'},body:JSON.stringify({role:'admin'})});
    assert.equal(forbidden.status,403);
    const self=(await json('/api/session')).user;
    await json('/api/users/'+self.id,'PUT',{role:'viewer'},400);
    await json('/api/users/'+user.id,'PUT',{password:'short'},400);
    await json('/api/users/'+user.id,'PUT',{role:'unknown'},400);
    await json('/api/users/'+user.id,'PUT',{role:'editor'});
    assert.equal((await fetch(base+'/api/files',{headers:first})).status,200,'No-op update keeps sessions');
    const updated=await json('/api/users/'+user.id,'PUT',{role:'viewer'});assert.equal(updated.role,'viewer');
    for(const headers of [first,second])assert.equal((await fetch(base+'/api/files',{headers})).status,401);
    const reader=await credentials('managed-initial-password');
    assert.equal((await fetch(base+'/api/create',{method:'POST',headers:{...reader,'Content-Type':'application/json'},body:JSON.stringify({path:'forbidden.txt'})})).status,403);
    await json('/api/users/'+user.id,'PUT',{role:'admin',password:'managed-replacement-password'});
    assert.equal((await fetch(base+'/api/files',{headers:reader})).status,401);
    await json('/api/login','POST',{name:user.name,password:'managed-initial-password'},401);
    const promoted=await credentials('managed-replacement-password');
    assert.equal((await fetch(base+'/api/users',{headers:promoted})).status,200);
    assert.equal((await json('/api/users')).items.find(i=>i.id===user.id).role,'admin');
    await json('/api/users/'+user.id,'DELETE');
    await json('/api/users/'+user.id,'PUT',{role:'editor'},404);
  });
  await t.test('password change rotates credentials and revokes existing sessions', async () => {
    const oldCookie = cookie;
    await json('/api/password','POST',{currentPassword:'incorrect',password:'updated-integration-password'},403);
    const changed = await request('/api/password','POST',{currentPassword:'integration-test-password',password:'updated-integration-password'});
    assert.equal(changed.status,200); cookie = changed.headers.get('set-cookie').split(';')[0]; csrf = (await changed.json()).csrf;
    assert.equal((await fetch(base+'/api/files',{headers:{Cookie:oldCookie}})).status,401);
    await json('/api/login','POST',{name:'admin',password:'integration-test-password'},401);
    await json('/api/files');
    await json('/api/logout','POST'); await json('/api/files','GET',undefined,401);
  });
});

test('persistent accounts and global read-only mode survive restart', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'droppy-next-persistence-'));
  const options = {files:path.join(temp,'files'),config:path.join(temp,'config')};
  let instance = await createApp(options), server = instance.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  const setupToken=(await fs.readFile(path.join(instance.config,'setup-token'),'utf8')).trim();
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'admin',password:'persistence-test-password',setupToken})});
  assert.equal(setup.status,201);
  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); instance.close();
  instance = await createApp({...options,readOnly:true}); server = instance.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve)); base = `http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));instance.close();await fs.rm(temp,{recursive:true,force:true});});
  const response = await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'admin',password:'persistence-test-password'})});
  assert.equal(response.status,200); const body = await response.json(); assert.equal(body.readOnly,true);
  const denied = await fetch(base+'/api/create',{method:'POST',headers:{'Content-Type':'application/json',Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':body.csrf},body:JSON.stringify({path:'blocked.txt'})});
  assert.equal(denied.status,403);
});
