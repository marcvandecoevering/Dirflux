export function createLogger({level=2,timestamps=true,write=(line,severity)=>{
  (severity==='error'?process.stderr:process.stdout).write(line+'\n');
},now=()=>new Date().toISOString()}={}) {
  if(![0,1,2,3].includes(level))throw new Error('LOG_LEVEL must be 0, 1, 2 or 3.');
  if(typeof timestamps!=='boolean')throw new Error('LOG_TIMESTAMPS must be true or false.');
  const emit=(severity,required,event,fields)=>{
    if(level<required)return;
    const record={...(timestamps?{time:now()}:{}),level:severity,event,...fields};
    write(JSON.stringify(record),severity);
  };
  return {
    error:(event,fields={})=>emit('error',1,event,fields),
    info:(event,fields={})=>emit('info',2,event,fields),
    debug:(event,fields={})=>emit('debug',3,event,fields),
  };
}
