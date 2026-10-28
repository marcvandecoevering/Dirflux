import test from 'node:test';
import assert from 'node:assert/strict';
import { dropOperation, readInternalDrop, dropTransfer } from '../public/internal-drop.js';

test('drag modifiers match original copy precedence and retain drag-start intent', () => {
  assert.equal(dropOperation({}), null);
  for (const key of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(dropOperation({ [key]:true }), 'copy');
    assert.equal(dropOperation({ [key]:true, shiftKey:true }, 'move'), 'copy');
  }
  assert.equal(dropOperation({ shiftKey:true }), 'move');
  assert.equal(dropOperation({}, 'copy'), 'copy');
  assert.equal(dropOperation({}, 'move'), 'move');
  assert.equal(dropOperation({ shiftKey:true }, 'copy'), 'copy');
});

test('same-folder move is a no-op while copy still requests collision renaming', () => {
  const item=readInternalDrop(JSON.stringify({path:'Documenten/één.txt',name:'wrong.txt',directory:false}));
  assert.equal(item.name, 'één.txt');
  assert.equal(dropTransfer(item, 'Documenten', 'move'), null);
  assert.deepEqual(dropTransfer(item, 'Documenten', 'copy'), {source:item.path,target:item.path,operation:'copy',conflict:'rename'});
  assert.deepEqual(dropTransfer(item, '', 'move'), {source:item.path,target:'één.txt',operation:'move',conflict:'rename'});
  assert.throws(()=>dropTransfer(item, '', 'delete'));
});

test('malformed internal drops fail before any transfer request', () => {
  for (const raw of ['invalid','null','[]', ...['','/etc/passwd','../secret','a/../b','a//b','a\\b','a\0b'].map(path=>JSON.stringify({path,directory:false})), JSON.stringify({path:'a',directory:'false'}), JSON.stringify({path:'a',directory:true,operation:'delete'})]) {
    assert.throws(()=>readInternalDrop(raw), /Ongeldige sleepgegevens/);
  }
  assert.equal(readInternalDrop('{"path":"Map","directory":true}').directory, true);
});
