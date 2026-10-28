import path from 'node:path';
import { pipeline } from 'node:stream/promises';

// The caller opens and validates the handle before headers are sent. Never
// reopen a pathname after checking which object the request refers to.
export async function sendOpenedFile(req,res,handle,filename,inline=false) {
  const stat=await handle.stat();
  if(!stat.isFile())throw Object.assign(new Error('Dit is geen bestand.'),{status:400});
  if(inline)res.type(path.extname(filename));else res.attachment(filename);
  res.set('Accept-Ranges','bytes');
  let start=0,end=stat.size-1;
  // No representation validator is emitted: an If-Range condition cannot be
  // proven to match, so return the whole representation rather than splice bytes.
  const range=req.headers.range && !req.headers['if-range'] ? req.range(stat.size,{combine:true}) : undefined;
  if(range===-1){res.set('Content-Range',`bytes */${stat.size}`);res.status(416).end();return;}
  if(Array.isArray(range)&&range.type==='bytes'&&range.length===1) {
    ({start,end}=range[0]);res.status(206).set('Content-Range',`bytes ${start}-${end}/${stat.size}`);
  }
  res.set('Content-Length',String(Math.max(0,end-start+1)));
  if(req.method==='HEAD'||stat.size===0){res.end();return;}
  await pipeline(handle.createReadStream({start,end,autoClose:true}),res);
}
