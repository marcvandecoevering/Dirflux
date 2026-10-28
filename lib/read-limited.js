import fs from 'node:fs';
import fsp from 'node:fs/promises';

const tooLarge=()=>Object.assign(new Error('Het bestand is groter dan de ingestelde tekstlimiet.'),{status:413});

// Positional reads leave the handle's stream offset untouched. Enforce the
// bound while reading, since a file can grow after its initial stat call.
export async function readLimitedHandle(handle,limit) {
  const stat=await handle.stat();
  if(!stat.isFile())throw Object.assign(new Error('Dit is geen tekstbestand.'),{status:400});
  if(stat.size>limit)throw tooLarge();
  const chunks=[];
  let total=0;
  while(true) {
    const buffer=Buffer.allocUnsafe(Math.min(65536,limit-total+1));
    const {bytesRead}=await handle.read(buffer,0,buffer.length,total);
    if(!bytesRead)return Buffer.concat(chunks,total);
    total+=bytesRead;
    if(total>limit)throw tooLarge();
    chunks.push(buffer.subarray(0,bytesRead));
  }
}

export async function readLimitedFile(filename,limit) {
  const handle=await fsp.open(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try {return await readLimitedHandle(handle,limit);}
  finally {await handle.close();}
}
