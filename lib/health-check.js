import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import {X509Certificate} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {listenerSettings} from './listeners.js';

export async function checkHealth({port,endpoint,certFile=process.env.TLS_CERT_FILE}={}) {
  endpoint??=port===undefined?listenerSettings()[0]:{host:'127.0.0.1',port};
  certFile=endpoint.protocol==='http'?'':endpoint.certFile??certFile;
  if(endpoint.protocol==='https'&&!certFile)throw new Error('HTTPS healthcheck requires its configured certificate.');
  const target=endpoint.path?{socketPath:endpoint.path}:{hostname:endpoint.host==='0.0.0.0'?'127.0.0.1':endpoint.host==='::'?'::1':endpoint.host,port:endpoint.port};
  const fingerprint=certFile?new X509Certificate(await fs.readFile(certFile)).fingerprint256:null;
  return new Promise((resolve,reject)=>{
    // A local probe connects through loopback, which need not match the public
    // certificate hostname. Authenticate the server by the configured exact
    // certificate fingerprint instead of disabling verification without a pin.
    const req=(fingerprint?https:http).get({...target,path:'/api/health',...(fingerprint?{rejectUnauthorized:false}:{})},res=>{
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
