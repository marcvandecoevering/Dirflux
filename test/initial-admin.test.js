import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';

test('initial credentials create a protected account and never reset an existing account',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dirflux-admin-'));
  const options={files:path.join(directory,'files'),config:path.join(directory,'config'),watch:false,pollingInterval:0,logLevel:0};
  let instance,server;
  async function start(password){
    instance=await createApp({...options,initialAdminPassword:password});
    server=instance.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    return 'http://127.0.0.1:'+server.address().port;
  }
  async function stop(){server.closeAllConnections();await new Promise(r=>server.close(r));instance.close();server=undefined;instance=undefined;}
  const login=(base,password)=>fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'admin',password})});
  try {
    await assert.rejects(createApp({...options,initialAdminPassword:'short'}),/12–1024/);
    let base=await start('first-valid-password');
    assert.equal((await fetch(base+'/api/session').then(r=>r.json())).setup,false);
    assert.equal((await fetch(base+'/api/files')).status,401);
    assert.equal((await login(base,'first-valid-password')).status,200);
    await assert.rejects(fs.stat(path.join(options.config,'setup-token')),{code:'ENOENT'});
    await stop();base=await start('different-password');
    assert.equal((await login(base,'first-valid-password')).status,200);
    assert.equal((await login(base,'different-password')).status,401);
    assert.equal((await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,409);
  } finally {if(server)await stop();await fs.rm(directory,{recursive:true,force:true});}
});
