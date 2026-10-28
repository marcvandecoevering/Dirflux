import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJson,parseApiResponse} from '../public/api-response.js';

test('API reads bypass a previously cached HTML login and retain request credentials and headers',async t=>{
  const requests=[];
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    requests.push({url,options});
    return options.cache==='no-store'
      ? Response.json({user:{name:'admin'}})
      : new Response('<!DOCTYPE html>old login',{headers:{'Content-Type':'text/html'}});
  });
  const {body}=await requestJson('/api/session',{cache:'force-cache'});
  assert.equal(body.user.name,'admin');
  await requestJson('/api/create',{method:'POST',headers:{'X-CSRF-Token':'test-token','Content-Type':'application/json'},body:'{"path":"test"}'});
  assert.equal(requests.length,2);
  const {options}=requests[1];
  assert.equal(options.method,'POST');assert.equal(options.body,'{"path":"test"}');
  assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
  assert.equal(options.headers.get('X-CSRF-Token'),'test-token');
  assert.equal(options.headers.get('Accept'),'application/json');
});

test('HTML access gates and redirects are reported safely, never retried or treated as upload success',async t=>{
  for(const status of [200,401,403,502]) {
    assert.throws(()=>parseApiResponse('<html>secret proxy content</html>','text/html',status),error=>
      error.message.includes(`HTTP ${status}`)&&error.message.includes('access proxy')&&!error.message.includes('secret'));
  }
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}});});
  await assert.rejects(requestJson('/api/create',{method:'POST',body:'{}'}),/access proxy/);
  assert.equal(calls,1,'a failed write must not be replayed');
});

test('JSON errors are preserved and malformed JSON has a readable error',()=>{
  assert.deepEqual(parseApiResponse('{"error":"Invalid session token"}','application/json; charset=utf-8',403),{error:'Invalid session token'});
  assert.deepEqual(parseApiResponse('{"error":"Unavailable"}','application/problem+json',503),{error:'Unavailable'});
  assert.throws(()=>parseApiResponse('<!DOCTYPE html>','application/json',200),/invalid API data/);
});
