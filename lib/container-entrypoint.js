// Initialize only empty mount roots, then permanently drop root before starting Node.
import fs from 'node:fs';
import {spawn} from 'node:child_process';

function id(value, fallback) {
  const text=value ?? fallback;
  if(!/^[1-9][0-9]{0,9}$/.test(text)||Number(text)>2147483647)throw new Error('PUID and PGID must be positive numeric IDs.');
  return Number(text);
}
try {
  if(process.getuid()===0) {
    const uid=id(process.env.PUID,'99'),gid=id(process.env.PGID,'100');
    for(const directory of ['/files','/config']) {
      const stat=fs.lstatSync(directory);
      if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(directory)!==directory)throw new Error('Storage mount roots must be real directories.');
      // Never recurse into, change ownership of, or chmod existing user data.
      if(fs.readdirSync(directory).length===0) {
        if(stat.uid!==uid||stat.gid!==gid) {
          fs.chownSync(directory,uid,gid);
          fs.chmodSync(directory,directory==='/config'?0o700:0o770);
        } else if(directory==='/config') {
          // Unraid may create empty appdata as nobody:users with mode 0755.
          fs.chmodSync(directory,0o700);
        }
      }
    }
    process.setgroups([]);
    process.setgid(gid);
    process.setuid(uid);
  }
  const [command,...args]=process.argv.slice(2);
  if(!command)throw new Error('Missing container command.');
  const child=spawn(command,args,{stdio:'inherit'});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
  child.on('error',()=>{console.error('Container command could not start.');process.exit(1);});
  child.on('exit',(code,signal)=>process.exit(code??(signal==='SIGTERM'?143:1)));
} catch(error) {
  console.error('Dirflux storage initialization failed:',error.code||error.message);
  process.exit(1);
}
