import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorSave} from '../public/editor-save.js';

function fixture(){
  let text='first draft',active=true,writable=true;
  const requests=[],busy=[],saved=[];
  const save=createEditorSave({version:'v1',getText:()=>text,isActive:()=>active,canSave:()=>writable,
    write:(text,version)=>new Promise((resolve,reject)=>requests.push({text,version,resolve,reject})),
    onBusy:value=>busy.push(value),onSaved:result=>saved.push(result)});
  return {save,requests,busy,saved,setText:value=>text=value,close:()=>active=false,readOnly:()=>writable=false};
}

test('repeated save cannot duplicate a request; later edits retain dirty state and use the returned version',async()=>{
  const f=fixture(),first=f.save();
  f.setText('newer draft');await f.save();assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].text,'first draft');assert.equal(f.requests[0].version,'v1');
  f.requests[0].resolve({version:'v2'});await first;
  assert.deepEqual(f.saved,[{dirty:true}]);assert.deepEqual(f.busy,[true,false]);
  const second=f.save();assert.equal(f.requests[1].text,'newer draft');assert.equal(f.requests[1].version,'v2');
  f.requests[1].resolve({version:'v3'});await second;assert.deepEqual(f.saved,[{dirty:true},{dirty:false}]);
});

test('a closed editor cannot update another editor after either success or failure',async()=>{
  for(const failure of [false,true]){
    const f=fixture(),pending=f.save();f.close();
    if(failure)f.requests[0].reject(new Error('late failure'));else f.requests[0].resolve({version:'v2'});
    await pending;assert.deepEqual(f.saved,[]);assert.deepEqual(f.busy,[true]);
    await f.save();assert.equal(f.requests.length,1);
  }
});

test('active failures preserve the version for retry and current read-only permissions prevent saving',async()=>{
  const f=fixture(),pending=f.save();f.requests[0].reject(new Error('conflict'));
  await assert.rejects(pending,/conflict/);assert.deepEqual(f.busy,[true,false]);assert.deepEqual(f.saved,[]);
  const retry=f.save();assert.equal(f.requests[1].version,'v1');f.requests[1].resolve({version:'v2'});await retry;
  f.readOnly();await f.save();assert.equal(f.requests.length,2);
});
