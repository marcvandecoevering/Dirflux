import test from 'node:test';
import assert from 'node:assert/strict';
import {collectUploadEntries} from '../public/upload-entries.js';

const file=name=>({name,isFile:true,file:resolve=>resolve({name,size:1})});
const directory=(name,batches)=>({name,isDirectory:true,createReader:()=>{
  let index=0;
  return {readEntries:resolve=>resolve(batches[index++]||[])};
}});

test('directory upload includes empty folders and every reader batch in parent-first order',async()=>{
  const entries=[directory('Top',[[directory('Empty',[]),file('first.txt')],[directory('Nested',[[directory('Also empty',[])]]),file('last.txt')]])];
  const items=await collectUploadEntries(entries);
  assert.deepEqual(items.map(({path,directory})=>[path,!!directory]),[
    ['Top',true],['Top/Empty',true],['Top/first.txt',false],['Top/Nested',true],['Top/Nested/Also empty',true],['Top/last.txt',false]
  ]);
  assert.equal(items[2].file.name,'first.txt');
});

test('unreadable directory entries fail explicitly instead of reporting an incomplete upload',async()=>{
  const denied={name:'Denied',isDirectory:true,createReader:()=>({readEntries:(_resolve,reject)=>reject(new Error('access denied'))})};
  await assert.rejects(collectUploadEntries([denied]),/access denied/);
});
