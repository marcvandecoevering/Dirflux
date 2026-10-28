// Fixed-window counters with a hard memory bound. Never evict an active counter:
// an attacker rotating addresses must not reset another address's restriction.
export function createAttemptLimiter({ limit=15, windowMs=15*60000, maxEntries=1000, now=Date.now }={}) {
  const entries=new Map();
  return {
    clear(key) {entries.delete(key);},
    consume(key) {
      const time=now();
      let entry=entries.get(key);
      if(entry&&entry.until<=time){entries.delete(key);entry=undefined;}
      if(!entry) {
        let earliest=Infinity;
        if(entries.size>=maxEntries) {
          for(const [address,counter] of entries) {
            if(counter.until<=time)entries.delete(address);
            else earliest=Math.min(earliest,counter.until);
          }
          if(entries.size>=maxEntries)return {allowed:false,retryAfter:Math.max(1,Math.ceil((earliest-time)/1000))};
        }
        entry={count:0,until:time+windowMs};entries.set(key,entry);
      }
      if(entry.count>=limit)return {allowed:false,retryAfter:Math.max(1,Math.ceil((entry.until-time)/1000))};
      entry.count++;
      return {allowed:true};
    },
  };
}
