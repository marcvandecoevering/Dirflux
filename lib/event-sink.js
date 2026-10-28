const changeMessage='event: change\ndata: {}\n\n';

// Changes invalidate the same listing, so one pending notification is sufficient.
export function createEventSink(response,allowed=()=>true) {
  let blocked=false,pendingChange=false,closed=false;
  const writable=()=>!closed&&!response.destroyed&&!response.writableEnded&&allowed();
  function write(message){
    if(!writable())return;
    blocked=!response.write(message);
  }
  const drain=()=>{
    blocked=false;
    if(pendingChange){pendingChange=false;write(changeMessage);}
  };
  response.on('drain',drain);
  write('event: ready\ndata: {}\n\n');
  return {
    change(){if(!writable())return;if(blocked){pendingChange=true;return;}write(changeMessage);},
    heartbeat(){if(!blocked)write(': heartbeat\n\n');},
    close(){closed=true;pendingChange=false;response.off('drain',drain);},
  };
}
