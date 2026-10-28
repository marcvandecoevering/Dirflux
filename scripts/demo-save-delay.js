// Manual browser harness. Only proxies the disposable scripts/demo.js instance.
// Run alongside that demo, then browse http://127.0.0.1:18098/.
import http from 'node:http';

let saves=0;
const server=http.createServer((req,res)=>{
  const save=req.method==='POST'&&req.url==='/api/text';
  const number=save?++saves:0;
  if(save)console.log(`SAVE_REQUEST ${number}`);
  const upstream=http.request({hostname:'127.0.0.1',port:18094,path:req.url,method:req.method,headers:req.headers},response=>{
    if(number!==1){res.writeHead(response.statusCode,response.headers);response.pipe(res);return;}
    const chunks=[];let size=0;
    response.on('data',chunk=>{
      size+=chunk.length;
      if(size>65536){upstream.destroy();res.destroy();return;}
      chunks.push(chunk);
    });
    response.on('end',()=>{
      console.log(`SAVE_RESPONSE_HELD ${response.statusCode}`);
      const timer=setTimeout(()=>{
        if(!res.destroyed){res.writeHead(response.statusCode,response.headers);res.end(Buffer.concat(chunks));console.log('SAVE_RESPONSE_DELIVERED');}
      },30000);
      res.once('close',()=>clearTimeout(timer));
    });
    response.on('error',()=>res.destroy());
  });
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
  res.once('close',()=>upstream.destroy());
  req.pipe(upstream);
});
server.listen(18098,'127.0.0.1',()=>console.log('Disposable demo save-delay proxy: http://127.0.0.1:18098/'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
