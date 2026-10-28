import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttemptLimiter} from '../lib/rate-limit.js';
import {createApp} from '../server.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('attempt windows enforce a hard bound without evicting active counters',()=>{
  let time=0;
  const limiter=createAttemptLimiter({limit:2,windowMs:10000,maxEntries:2,now:()=>time});
  assert.equal(limiter.consume('a').allowed,true);
  assert.equal(limiter.consume('a').allowed,true);
  assert.deepEqual(limiter.consume('a'),{allowed:false,retryAfter:10});
  time=1500;
  assert.equal(limiter.consume('b').allowed,true);
  for(let n=0;n<2000;n++)assert.deepEqual(limiter.consume('new-'+n),{allowed:false,retryAfter:9});
  assert.equal(limiter.consume('a').allowed,false,'Rotating addresses must not evict an active restriction');
  assert.equal(limiter.consume('b').allowed,true,'Existing addresses retain their remaining attempts');
  time=10000;
  assert.equal(limiter.consume('c').allowed,true,'Expired slot is reclaimed at its exact deadline');
  assert.equal(limiter.consume('b').allowed,false);
  limiter.clear('b');
  assert.equal(limiter.consume('b').allowed,true,'Successful login explicitly resets its counter');
});

test('login rate limit returns Retry-After and ignores spoofed forwarded addresses',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'login-limit-'));
  const app=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),watch:false,pollingInterval:0});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));app.close();await fs.rm(temp,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${server.address().port}/api/login`;
  for(let n=0;n<16;n++) {
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':`192.0.2.${n}`},body:JSON.stringify({name:'missing',password:'synthetic-password'})});
    assert.equal(response.status,n<15?401:429);
    if(n===15){assert.ok(Number(response.headers.get('retry-after'))>0);assert.ok(Number(response.headers.get('retry-after'))<=900);}
  }
});
