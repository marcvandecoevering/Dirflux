import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';

test('original media extensions stream through authenticated and public routes with media MIME types',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'media-formats-'));
  const app=await createApp({files:path.join(temp,'files'),config:path.join(temp,'config'),publicMode:true,watch:false,pollingInterval:0,logLevel:0});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));app.close();await fs.rm(temp,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`,session=await fetch(base+'/api/session');
  const cookie=session.headers.get('set-cookie').split(';')[0],{csrf}=await session.json();
  // Arbitrary bytes test transport, MIME and ranges; they do not assert decoding.
  const bytes=Buffer.from([0,1,2,3,4,5,6,7,8,9]);
  for(const ext of 'aac aif aifc aiff f4a flac m4a m4b m4p m4r mka mp1 mp2 mp3 mpa mpeg mpg oga ogg opus wav wma 3g2 3gp f4v flv m4v mk3d mkv mov mp4 ogv ogx webm'.split(' ')){
    const file='example.'+ext;await fs.writeFile(path.join(app.root,file),bytes);
    const url=base+'/api/file?path='+file,response=await fetch(url,{headers:{Cookie:cookie}});
    assert.equal(response.status,200,ext);assert.match(response.headers.get('content-type'),/^(audio\/|video\/|application\/(mp4|ogg))/,ext);
    assert.equal(response.headers.get('content-disposition'),null,ext);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    if(['f4a','m4r'].includes(ext))assert.equal(response.headers.get('content-type'),'audio/mp4');
    if(['mp1','mpa'].includes(ext))assert.equal(response.headers.get('content-type'),'audio/mpeg');
    const range=await fetch(url,{headers:{Cookie:cookie,Range:'bytes=2-5'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(2,6));
    const download=await fetch(url+'&download=1',{method:'HEAD',headers:{Cookie:cookie}});assert.match(download.headers.get('content-disposition'),/^attachment;/);
    const share=await fetch(base+'/api/shares',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({path:file})});
    assert.equal(share.status,201);const link=await share.json(),publicResponse=await fetch(base+link.url+'?download=0');
    assert.equal(publicResponse.status,200);assert.equal(publicResponse.headers.get('content-disposition'),null);
    assert.equal(publicResponse.headers.get('content-type'),response.headers.get('content-type'));assert.deepEqual(Buffer.from(await publicResponse.arrayBuffer()),bytes);
    const publicDownload=await fetch(base+link.url,{method:'HEAD'});assert.equal(publicDownload.status,200);assert.match(publicDownload.headers.get('content-disposition'),/^attachment;/);
  }
});
