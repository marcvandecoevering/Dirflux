// Dedicated, bounded-memory ZIP64 check. Run on a filesystem supporting sparse
// files; the source is logically >4 GiB but contains only two allocated bytes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createInflateRaw,crc32} from 'node:zlib';
import {createApp} from '../server.js';

if(process.platform!=='linux')throw new Error('Run this sparse-file check in the Linux test container.');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'zip64-smoke-'));
let app,server;
try {
  app=await createApp({files:path.join(temporary,'files'),config:path.join(temporary,'config'),publicMode:true,watch:false,pollingInterval:0});
  const size=2**32+123;
  const file=await fs.open(path.join(app.root,'large.bin'),'w');
  try {await file.truncate(size);await file.write(Buffer.from('A'),0,1,0);await file.write(Buffer.from('Z'),0,1,size-1);}
  finally {await file.close();}
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const session=await fetch(base+'/api/session');
  const cookie=session.headers.get('set-cookie').split(';')[0];
  const response=await fetch(base+'/api/zip',{headers:{Cookie:cookie},signal:AbortSignal.timeout(240000)});
  assert.equal(response.status,200);
  const target=path.join(temporary,'download.zip');
  await pipeline(Readable.fromWeb(response.body),createWriteStream(target));
  const archiveStat=await fs.stat(target);
  assert.ok(archiveStat.size<64*1024**2,'Synthetic zero-filled archive should remain small');
  const bytes=await fs.readFile(target);
  const end=bytes.length-22;
  assert.equal(bytes.readUInt32LE(end),0x06054b50);
  assert.equal(bytes.readUInt16LE(end+10),1);
  const central=bytes.readUInt32LE(end+16);
  assert.equal(bytes.readUInt32LE(central),0x02014b50);
  assert.equal(bytes.readUInt16LE(central+10),8,'Expected deflate');
  assert.equal(bytes.readUInt32LE(central+24),0xffffffff,'Large entry must use ZIP64 size');
  let compressed=bytes.readUInt32LE(central+20),local=bytes.readUInt32LE(central+42);
  const nameLength=bytes.readUInt16LE(central+28),extraLength=bytes.readUInt16LE(central+30);
  assert.equal(bytes.subarray(central+46,central+46+nameLength).toString(),'large.bin');
  let zip64Size;
  for(let at=central+46+nameLength;at<central+46+nameLength+extraLength;) {
    const id=bytes.readUInt16LE(at),length=bytes.readUInt16LE(at+2);
    if(id===1) {
      let cursor=at+4;
      zip64Size=bytes.readBigUInt64LE(cursor);cursor+=8;
      if(compressed===0xffffffff){compressed=Number(bytes.readBigUInt64LE(cursor));cursor+=8;}
      if(local===0xffffffff)local=Number(bytes.readBigUInt64LE(cursor));
    }
    at+=4+length;
  }
  assert.equal(zip64Size,BigInt(size));
  assert.ok(Number.isSafeInteger(compressed)&&compressed<bytes.length);
  assert.ok(Number.isSafeInteger(local)&&local<central);
  assert.equal(bytes.readUInt32LE(local),0x04034b50);
  const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
  const inflater=Readable.from([bytes.subarray(start,start+compressed)]).pipe(createInflateRaw());
  let count=0,crc=0;
  for await(const chunk of inflater) {
    assert.ok(count+chunk.length<=size,'Unexpected inflated size');
    const expected=Buffer.alloc(chunk.length);
    if(count===0)expected[0]=65;
    if(count+chunk.length===size)expected[chunk.length-1]=90;
    assert.ok(chunk.equals(expected),`Incorrect unpacked bytes at offset ${count}`);
    crc=crc32(chunk,crc);count+=chunk.length;
  }
  assert.equal(count,size);
  assert.equal(crc,bytes.readUInt32LE(central+16));
  console.log(`ZIP64 passed: ${count} unpacked bytes, ${archiveStat.size} downloaded bytes, complete content and CRC verified.`);
} finally {
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  app?.close();
  if(path.dirname(path.resolve(temporary))!==path.resolve(os.tmpdir())||!path.basename(temporary).startsWith('zip64-smoke-'))throw new Error('Unsafe cleanup path');
  await fs.rm(temporary,{recursive:true,force:true});
}
