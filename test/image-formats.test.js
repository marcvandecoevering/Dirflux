import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';

test('original APNG, ICO and SVG formats retain exact bytes and safe delivery headers',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'image-formats-'));
  const app=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),publicMode:true,watch:false,pollingInterval:0,logLevel:0});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));app.close();await fs.rm(temp,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`,session=await fetch(base+'/api/session');
  const cookie=session.headers.get('set-cookie').split(';')[0];const {csrf}=await session.json();
  for(const [file,mime] of [['animated.apng',/^image\/apng/],['icon.ico',/^image\/(vnd.microsoft.icon|x-icon)/],['vector.svg',/^image\/svg\+xml/]]){
    const bytes=await fs.readFile(path.join(import.meta.dirname,'fixtures/images',file));await fs.writeFile(path.join(app.root,file),bytes);
    const url=base+'/api/file?path='+encodeURIComponent(file);
    const response=await fetch(url,{headers:{Cookie:cookie}});
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),mime);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    if(file.endsWith('.svg'))assert.match(response.headers.get('content-disposition'),/^attachment;/);
    else assert.equal(response.headers.get('content-disposition'),null);
    const download=await fetch(url+'&download=1',{method:'HEAD',headers:{Cookie:cookie}});
    assert.match(download.headers.get('content-disposition'),/^attachment;/);
    assert.equal(download.headers.get('x-content-type-options'),'nosniff');
    const range=await fetch(url,{headers:{Cookie:cookie,Range:'bytes=0-7'}});
    assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(0,8));
    if(!file.endsWith('.svg')){
      const shared=await fetch(base+'/api/shares',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({path:file})});
      assert.equal(shared.status,201);const link=await shared.json();
      const publicResponse=await fetch(base+link.url);assert.match(publicResponse.headers.get('content-type'),mime);
      assert.deepEqual(Buffer.from(await publicResponse.arrayBuffer()),bytes);
    }
  }
});
