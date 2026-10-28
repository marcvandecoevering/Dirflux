import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';

test('external framing opt-in changes only ancestor restrictions, not session or mutation protections',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'framing-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  let defaultPolicy;
  for(const allowFrame of [false,true]) {
    const app=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),allowFrame,publicMode:true,watch:false,pollingInterval:0,logLevel:0});
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    try {
      for(const route of ['/','/?viewer=1&path=example.txt','/api/health','/api/missing']) {
        const response=await fetch(base+route);
        const policy=response.headers.get('content-security-policy');
        if(!allowFrame){assert.equal(response.headers.get('x-frame-options'),'SAMEORIGIN');assert.match(policy,/frame-ancestors 'self';/);defaultPolicy=policy;}
        else {assert.equal(response.headers.get('x-frame-options'),null);assert.equal(policy,defaultPolicy.replace("frame-ancestors 'self'; ",''));}
        await response.arrayBuffer();
      }
      const response=await fetch(base+'/api/session');const session=await response.json();
      assert.match(response.headers.get('set-cookie'),/SameSite=Strict/);
      assert.match(response.headers.get('set-cookie'),/HttpOnly/);
      const headers={Cookie:response.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json','X-CSRF-Token':session.csrf};
      const body=JSON.stringify({path:'should-not-exist.txt',type:'file'});
      assert.equal((await fetch(base+'/api/create',{method:'POST',headers:{...headers,Origin:'https://unrelated.example'},body})).status,403);
      delete headers['X-CSRF-Token'];
      assert.equal((await fetch(base+'/api/create',{method:'POST',headers,body})).status,403);
      await assert.rejects(fs.stat(path.join(temp,'files/should-not-exist.txt')),{code:'ENOENT'});
    } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));app.close();}
  }
});

test('invalid embedding setting fails before storage opens',async()=>{
  await assert.rejects(createApp({allowFrame:'yes'}),/ALLOW_FRAME must be true or false/);
});
