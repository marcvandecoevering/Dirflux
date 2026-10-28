import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createLogger} from '../lib/logger.js';
import {createApp} from '../server.js';

test('logging levels filter output and timestamps can be disabled',()=>{
  for(const level of [0,1,2,3]){
    const records=[];
    const logger=createLogger({level,now:()=> '2026-10-28T00:00:00.000Z',write:line=>records.push(JSON.parse(line))});
    logger.error('failure');logger.info('request');logger.debug('connection');
    assert.equal(records.length,level);
    for(const record of records)assert.equal(record.time,'2026-10-28T00:00:00.000Z');
  }
  let raw;createLogger({timestamps:false,write:line=>raw=line}).info('test',{message:'first\nsecond'});
  assert.equal(raw.includes('\n'),false,'Each structured log is a single physical line');
  assert.equal(Object.hasOwn(JSON.parse(raw),'time'),false);
});

test('HTTP logs use route templates and exclude private paths, headers, bodies and share IDs',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'private-logs-')),lines=[];
  const app=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),publicMode:true,maxPublicSessions:1,watch:false,pollingInterval:0,logLevel:3,logTimestamps:false,logWriter:line=>lines.push(line)});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));app.close();await fs.rm(temp,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(base+'/api/session');const session=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  const headers={Cookie:cookie,'X-CSRF-Token':session.csrf,'Content-Type':'application/json',Authorization:'Bearer PRIVATE-AUTH'};
  const filename='PRIVATE-FILENAME.txt';await fs.writeFile(path.join(app.root,filename),'PRIVATE-CONTENT');
  assert.equal((await fetch(base+'/api/file?path='+filename,{headers})).status,200);
  const created=await fetch(base+'/api/shares',{method:'POST',headers,body:JSON.stringify({path:filename,password:'PRIVATE-PASSWORD'})});
  assert.equal(created.status,201);const share=await created.json();
  assert.equal((await fetch(base+share.url)).status,200);
  assert.equal((await fetch(base+'/api/session?secret=PRIVATE-QUERY')).status,503);
  assert.equal((await fetch(base+'/PRIVATE-UNMATCHED')).status,404);
  const raw=lines.join('\n'),records=lines.map(line=>JSON.parse(line));
  for(const secret of [filename,'PRIVATE-CONTENT','PRIVATE-AUTH','PRIVATE-PASSWORD','PRIVATE-QUERY','PRIVATE-UNMATCHED',cookie,session.csrf,share.id])assert.equal(raw.includes(secret),false,`Log disclosed ${secret}`);
  assert.ok(records.some(record=>record.event==='http.request'&&record.route==='/s/:id'&&record.status===200));
  assert.ok(records.some(record=>record.event==='http.error'&&record.status===503));
  assert.ok(records.every(record=>!Object.hasOwn(record,'time')));
});

test('invalid log settings fail startup',async()=>{
  for(const logLevel of [-1,4,0.5,'',true,'debug'])await assert.rejects(createApp({logLevel}),/LOG_LEVEL/);
  await assert.rejects(createApp({logTimestamps:'yes'}),/LOG_TIMESTAMPS/);
});
