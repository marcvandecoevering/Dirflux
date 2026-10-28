import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.js';

async function fixture(t){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'account-atomicity-'));
  const app=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),watch:false,pollingInterval:0,logLevel:0});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const db=new DatabaseSync(path.join(app.config,'state.sqlite'));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();app.close();await fs.rm(temp,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(route,method='GET',body,headers={})=>fetch(base+route,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const password='initial-test-password';
  const setupToken=(await fs.readFile(path.join(app.config,'setup-token'),'utf8')).trim();
  const response=await request('/api/setup','POST',{name:'admin',password,setupToken});assert.equal(response.status,201);
  const session=await response.json(),headers={Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':session.csrf};
  return {app,db,request,password,headers,id:session.user.id};
}

test('failed session revocation rolls back a self-service password change',async t=>{
  const f=await fixture(t),before=f.db.prepare('SELECT salt,digest FROM users WHERE id=?').get(f.id);
  f.db.exec("CREATE TRIGGER fail_session_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  const change={currentPassword:f.password,password:'replacement-test-password'};
  const failed=await f.request('/api/password','POST',change,f.headers);assert.equal(failed.status,500);
  assert.deepEqual(f.db.prepare('SELECT salt,digest FROM users WHERE id=?').get(f.id),before);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(f.id).n,1);
  assert.equal((await f.request('/api/files','GET',undefined,f.headers)).status,200);
  f.db.exec('DROP TRIGGER fail_session_delete');
  const success=await f.request('/api/password','POST',change,f.headers);assert.equal(success.status,200);
  assert.notDeepEqual(f.db.prepare('SELECT salt,digest FROM users WHERE id=?').get(f.id),before);
  assert.equal((await f.request('/api/files','GET',undefined,f.headers)).status,401);
  assert.equal((await f.request('/api/login','POST',{name:'admin',password:f.password})).status,401);
  assert.equal((await f.request('/api/login','POST',{name:'admin',password:change.password})).status,200);
});

test('failed account deletion restores its sessions and shares as well as the account',async t=>{
  const f=await fixture(t);
  const created=await f.request('/api/users','POST',{name:'editor',password:f.password,role:'editor'},f.headers);assert.equal(created.status,201);
  const user=await created.json();
  const login=await f.request('/api/login','POST',{name:'editor',password:f.password});assert.equal(login.status,200);
  const session=await login.json(),headers={Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':session.csrf};
  await fs.writeFile(path.join(f.app.root,'shared.txt'),'shared synthetic content');
  const shared=await f.request('/api/shares','POST',{path:'shared.txt'},headers);assert.equal(shared.status,201);const link=await shared.json();
  f.db.exec("CREATE TRIGGER fail_user_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  assert.equal((await f.request('/api/users/'+user.id,'DELETE',undefined,f.headers)).status,500);
  assert.ok(f.db.prepare('SELECT id FROM users WHERE id=?').get(user.id));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(user.id).n,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM shares WHERE owner=?').get(user.id).n,1);
  assert.equal((await f.request('/api/files','GET',undefined,headers)).status,200);
  assert.equal(await (await f.request(link.url)).text(),'shared synthetic content');
  f.db.exec('DROP TRIGGER fail_user_delete');
  assert.equal((await f.request('/api/users/'+user.id,'DELETE',undefined,f.headers)).status,200);
  assert.equal(f.db.prepare('SELECT id FROM users WHERE id=?').get(user.id),undefined);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(user.id).n,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM shares WHERE owner=?').get(user.id).n,0);
  assert.equal((await f.request('/api/files','GET',undefined,headers)).status,401);
  assert.equal((await f.request(link.url)).status,404);
});
