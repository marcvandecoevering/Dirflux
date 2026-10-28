import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadText} from '../public/text-download.js';

test('draft download snapshots exact UTF-8 bytes and filename, then releases its blob URL',async()=>{
  let href,filename,removed=false,release;
  const link={click(){href=this.href;filename=this.download;},remove(){removed=true;}};
  const document={createElement(tag){assert.equal(tag,'a');return link;},body:{appendChild(node){assert.equal(node,link);}}};
  const draft='\uFEFFNiet opgeslagen: café €\r\nTweede regel\r\n';
  downloadText(draft,'Mijn notities.txt',document,URL,(callback,delay)=>{assert.equal(delay,60000);release=callback;});
  try {
    assert.equal(filename,'Mijn notities.txt');assert.equal(removed,true);
    const response=await fetch(href);
    assert.equal(response.headers.get('content-type'),'text/plain;charset=utf-8');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(draft));
  } finally {release();}
  await assert.rejects(fetch(href));
});

test('failed browser download releases the URL and removes its temporary link',()=>{
  let created,revoked,removed=false;
  const urls={createObjectURL(blob){assert.ok(blob instanceof Blob);return created='blob:test';},revokeObjectURL(url){revoked=url;}};
  const document={createElement(){return {click(){throw new Error('Download rejected');},remove(){removed=true;}};},body:{appendChild(){}}};
  assert.throws(()=>downloadText('draft','file.txt',document,urls,()=>assert.fail('No delayed release after failure')),/Download rejected/);
  assert.equal(revoked,created);assert.equal(removed,true);
});
