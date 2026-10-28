import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { sendOpenedFile } from '../lib/download.js';

test('download streams the opened object after its pathname is replaced', async t => {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pinned-download-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const filename=path.join(temp,'file.txt');
  await fs.writeFile(filename,'original content');
  const handle=await fs.open(filename,'r');
  await fs.rename(filename,path.join(temp,'moved.txt'));
  await fs.writeFile(filename,'replacement must not leak');
  const app=express();
  app.get('/',async(req,res)=>{
    try {await sendOpenedFile(req,res,handle,'file.txt');}
    finally {await handle.close();}
  });
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await handle.close();});
  const response=await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-length'),'16');
  assert.equal(await response.text(),'original content');
  assert.equal(await fs.readFile(filename,'utf8'),'replacement must not leak');
});
