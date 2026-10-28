import test from 'node:test';
import assert from 'node:assert/strict';
import {canEditSession} from '../public/session-permissions.js';

test('editing requires an authenticated known writable role and writable deployment',()=>{
  for(const session of [undefined,{}, {user:null},{user:{id:'a'}},{user:{id:'a',role:'viewer'}},{user:{id:'a',role:'unknown'}}])assert.equal(canEditSession(session),false);
  for(const role of ['admin','editor']){
    assert.equal(canEditSession({user:{id:'a',role}}),true);
    assert.equal(canEditSession({user:{id:'a',role},readOnly:true}),false);
  }
  assert.equal(canEditSession({user:{id:'public',role:'editor',guest:true}}),true);
});
test('restoring an editor session requires the original account and current write permission',()=>{
  assert.equal(canEditSession({user:{id:'a',role:'editor'}},'a'),true);
  assert.equal(canEditSession({user:{id:'b',role:'admin'}},'a'),false);
  assert.equal(canEditSession({user:{id:'a',role:'viewer'}},'a'),false);
  assert.equal(canEditSession({user:{id:'a',role:'editor'},readOnly:true},'a'),false);
});
