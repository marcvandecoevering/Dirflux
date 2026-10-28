import test from 'node:test';
import assert from 'node:assert/strict';
import {galleryShortcut} from '../public/gallery-shortcuts.js';

test('gallery supports the original next, previous and fullscreen shortcuts',()=>{
  for(const key of ['Enter',' ','ArrowRight','ArrowDown'])assert.equal(galleryShortcut({key}),'next');
  for(const key of ['Backspace','ArrowLeft','ArrowUp'])assert.equal(galleryShortcut({key}),'previous');
  assert.equal(galleryShortcut({key:' ',shiftKey:true}),'previous');
  for(const key of ['f','F'])assert.equal(galleryShortcut({key}),'fullscreen');
  assert.equal(galleryShortcut({key:'Enter',altKey:true}),'fullscreen');
});
test('gallery preserves native media controls, button activation and image panning',()=>{
  for(const key of ['Enter',' ','ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Backspace','f'])assert.equal(galleryShortcut({key},{nativeControl:true}),null);
  for(const key of ['Enter',' '])assert.equal(galleryShortcut({key},{activationControl:true}),null);
  assert.equal(galleryShortcut({key:' ',shiftKey:true},{activationControl:true}),null);
  for(const key of [' ','ArrowRight','ArrowDown','ArrowLeft','ArrowUp'])assert.equal(galleryShortcut({key},{overflowingImage:true}),null);
  assert.equal(galleryShortcut({key:'f'},{overflowingImage:true}),'fullscreen');
});
test('gallery ignores composing, consumed and unrelated modified shortcuts',()=>{
  for(const flag of ['ctrlKey','metaKey','isComposing','defaultPrevented'])for(const key of ['f','Enter',' ','ArrowRight'])assert.equal(galleryShortcut({key,[flag]:true}),null);
  for(const key of ['f',' ','ArrowRight','Backspace'])assert.equal(galleryShortcut({key,altKey:true}),null);
  for(const key of ['f','Enter','ArrowLeft'])assert.equal(galleryShortcut({key,shiftKey:true}),null);
});
