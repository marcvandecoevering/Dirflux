import {validateHeaderName,validateHeaderValue} from 'node:http';

// These fields are owned by the application's authentication, security and
// representation/transport handling. Extra deployment metadata must not replace them.
const reserved=new Set(('connection keep-alive proxy-authenticate proxy-authorization te trailer transfer-encoding upgrade content-length content-type content-encoding content-range content-disposition accept-ranges etag last-modified vary cache-control expires pragma set-cookie authorization www-authenticate location content-security-policy content-security-policy-report-only x-frame-options x-content-type-options referrer-policy').split(' '));

export function responseHeaders(value={}) {
  if(typeof value==='string') {
    try {value=JSON.parse(value);}catch{throw new Error('RESPONSE_HEADERS must be a JSON object.');}
  }
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>32)throw new Error('RESPONSE_HEADERS must be an object with at most 32 headers.');
  const result=Object.create(null);
  let bytes=0;
  for(const [name,raw] of Object.entries(value)) {
    const key=name.toLowerCase();
    try {validateHeaderName(name);}catch{throw new Error('RESPONSE_HEADERS contains an invalid header name.');}
    if(reserved.has(key)||key.startsWith('access-control-'))throw new Error(`RESPONSE_HEADERS cannot override application-owned header: ${name}.`);
    if(Object.hasOwn(result,key))throw new Error('RESPONSE_HEADERS contains duplicate case-insensitive names.');
    const values=Array.isArray(raw)?raw:[raw];
    if(!values.length||values.length>16)throw new Error('RESPONSE_HEADERS values must contain 1..16 strings.');
    for(const item of values) {
      if(typeof item!=='string'||Buffer.byteLength(item)>4096)throw new Error('RESPONSE_HEADERS values must be strings of at most 4096 bytes.');
      try{validateHeaderValue(name,item);}catch{throw new Error('RESPONSE_HEADERS contains an invalid header value.');}
      bytes+=Buffer.byteLength(name)+Buffer.byteLength(item)+4;
    }
    if(bytes>16384)throw new Error('RESPONSE_HEADERS must not exceed 16384 bytes.');
    result[key]=Array.isArray(raw)?[...values]:raw;
  }
  return result;
}
