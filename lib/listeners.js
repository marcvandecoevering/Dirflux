import path from 'node:path';

export function listenerSettings(env=process.env) {
  let entries;
  if(env.LISTENERS!==undefined) {
    try { entries=JSON.parse(env.LISTENERS); }
    catch { throw new Error('LISTENERS must be a JSON array.'); }
  } else entries=[{host:env.HOST||'127.0.0.1',port:Number(env.PORT??8094)}];
  if(!Array.isArray(entries)||!entries.length||entries.length>32)throw new Error('LISTENERS must contain 1..32 endpoints.');
  return entries.map(entry=>{
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error('Each listener must be an endpoint object.');
    if(entry.protocol!==undefined&&!['http','https'].includes(entry.protocol))throw new Error('Listener protocol must be http or https.');
    if(Boolean(entry.certFile)!==Boolean(entry.keyFile))throw new Error('Listener certFile and keyFile must both be configured.');
    if(entry.certFile!==undefined||entry.keyFile!==undefined){
      if(entry.protocol!=='https'||[entry.certFile,entry.keyFile].some(file=>typeof file!=='string'||!file.trim()||file.includes('\0')))throw new Error('Listener TLS files require protocol https and non-empty file paths.');
    }
    const tlsFields=['protocol','certFile','keyFile'];
    if(Object.hasOwn(entry,'path')) {
      if(Object.keys(entry).some(key=>!['path',...tlsFields].includes(key))||typeof entry.path!=='string'||!path.isAbsolute(entry.path)||entry.path.includes('\0'))throw new Error('Socket listeners require an absolute path and optional TLS settings.');
      if(process.platform==='win32')throw new Error('Unix socket listeners are not supported on Windows; use host and port.');
      return {...entry};
    }
    if(Object.keys(entry).some(key=>!['host','port','ipv6Only',...tlsFields].includes(key))||typeof entry.host!=='string'||!entry.host.trim()||entry.host.includes('\0')||!Number.isInteger(entry.port)||entry.port<0||entry.port>65535||(entry.ipv6Only!==undefined&&typeof entry.ipv6Only!=='boolean'))throw new Error('TCP listeners require host, integer port 0..65535 and optional ipv6Only/TLS settings.');
    return {...entry};
  });
}

export async function startListeners(instance,endpoints) {
  const servers=[];
  try {
    for(const endpoint of endpoints) {
      const server=instance.listen(endpoint);
      servers.push(server);
      await new Promise((resolve,reject)=>{
        const ready=()=>{server.off('error',failed);resolve();};
        const failed=error=>{server.off('listening',ready);reject(error);};
        server.once('listening',ready);server.once('error',failed);
      });
    }
    return servers;
  } catch(error) {
    await closeListeners(servers,true);
    throw error;
  }
}

export async function closeListeners(servers,force=false) {
  await Promise.all(servers.map(server=>new Promise(resolve=>{
    server.close(resolve);
    if(force)server.closeAllConnections();
  })));
}
