import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createEventSink} from '../lib/event-sink.js';

class Response extends EventEmitter {
  messages=[];accept=false;destroyed=false;writableEnded=false;
  write(message){this.messages.push(message);return this.accept;}
}
test('blocked live stream coalesces a large change burst and skips heartbeat buffering',()=>{
  const response=new Response(),sink=createEventSink(response);
  for(let n=0;n<100000;n++){sink.change();sink.heartbeat();}
  assert.deepEqual(response.messages,['event: ready\ndata: {}\n\n']);
  response.accept=true;response.emit('drain');
  assert.deepEqual(response.messages,['event: ready\ndata: {}\n\n','event: change\ndata: {}\n\n']);
  response.emit('drain');assert.equal(response.messages.length,2);
  sink.heartbeat();assert.equal(response.messages.at(-1),': heartbeat\n\n');
  sink.close();assert.equal(response.listenerCount('drain'),0);
});
test('repeated backpressure retains one pending update and closing never flushes it',()=>{
  const response=new Response(),sink=createEventSink(response);
  sink.change();response.emit('drain');assert.equal(response.messages.length,2);
  for(let n=0;n<100;n++)sink.change();assert.equal(response.messages.length,2);
  sink.close();sink.close();response.accept=true;response.emit('drain');sink.change();sink.heartbeat();
  assert.equal(response.messages.length,2);
});
test('destroyed and ended responses never receive additional events',()=>{
  for(const flag of ['destroyed','writableEnded']){
    const response=new Response();response.accept=true;
    const sink=createEventSink(response);response[flag]=true;
    sink.change();sink.heartbeat();response.emit('drain');
    assert.equal(response.messages.length,1);sink.close();
  }
});
test('revoked authorization prevents flushing a queued change after drain',()=>{
  const response=new Response();let allowed=true;
  const sink=createEventSink(response,()=>allowed);
  sink.change();allowed=false;response.accept=true;response.emit('drain');
  sink.change();sink.heartbeat();assert.equal(response.messages.length,1);sink.close();
});
