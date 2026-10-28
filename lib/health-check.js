import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import {X509Certificate} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export async function checkHealth({port=process.env.PORT||8094,certFile=process.env.TLS_CERT_FILE}={}) {
  const fingerprint=certFile?new X509Certificate(await fs.readFile(certFile)).fingerprint256:null;
  return new Promise((resolve,reject)=>{
    // A local probe connects through loopback, which need not match the public
    // certificate hostname. Authenticate the server by the configured exact
    // certificate fingerprint instead of disabling verification without a pin.
    const req=(fingerprint?https:http).get({hostname:'127.0.0.1',port,path:'/api/health',...(fingerprint?{rejectUnauthorized:false}:{})},res=>{
      if(fingerprint&&res.socket.getPeerCertificate().fingerprint256!==fingerprint){res.destroy();reject(new Error('Healthcheck certificate mismatch.'));return;}
      res.resume();res.once('end',()=>res.statusCode===200?resolve():reject(new Error('Healthcheck failed: '+res.statusCode)));
      res.once('error',reject);
    });
    req.setTimeout(2000,()=>req.destroy(new Error('Healthcheck timed out.')));req.once('error',reject);
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {await checkHealth();} catch(error) {console.error(error.message);process.exitCode=1;}
}
