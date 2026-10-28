import test from 'node:test';
import assert from 'node:assert/strict';
import { fileShortcut } from '../public/file-shortcuts.js';

const ready={selected:true,clipboard:true,writable:true};
test('file shortcuts work with Ctrl or Command and Caps Lock',()=>{
  for(const modifier of ['ctrlKey','metaKey'])for(const [key,operation] of [['c','copy'],['x','move'],['v','paste']]){
    for(const letter of [key,key.toUpperCase()])assert.equal(fileShortcut({key:letter,[modifier]:true},ready),operation);
  }
});
test('file shortcuts leave selected text and modified browser commands alone',()=>{
  for(const key of ['c','x','v']){
    assert.equal(fileShortcut({key,ctrlKey:true},{...ready,textSelected:true}),key==='v'?'paste':null);
    for(const flag of ['altKey','shiftKey','isComposing','defaultPrevented'])assert.equal(fileShortcut({key,ctrlKey:true,[flag]:true},ready),null);
    assert.equal(fileShortcut({key},ready),null);
  }
});
test('file shortcuts require an applicable selection, clipboard and write permission',()=>{
  assert.equal(fileShortcut({key:'c',ctrlKey:true},{...ready,selected:false}),null);
  assert.equal(fileShortcut({key:'x',ctrlKey:true},{...ready,selected:false}),null);
  assert.equal(fileShortcut({key:'v',ctrlKey:true},{...ready,clipboard:false}),null);
  assert.equal(fileShortcut({key:'c',ctrlKey:true},{...ready,writable:false}),'copy');
  for(const key of ['x','v'])assert.equal(fileShortcut({key,ctrlKey:true},{...ready,writable:false}),null);
});
