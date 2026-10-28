import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdfRenderer} from '../public/pdf-renderer.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const canvas=()=>({width:0,height:0,getContext:()=>({})});

test('a late PDF page lookup cannot overwrite a newer zoom result',async()=>{
  const requests=[],painted=[],updates=[];
  const document={numPages:2,getPage(page){const result=deferred();requests.push({page,...result});return result.promise;}};
  const page={getViewport:({scale})=>({width:100*scale,height:80*scale}),render:({viewport})=>{painted.push(viewport);return {promise:Promise.resolve(),cancel(){}};}};
  const target=canvas(),viewer=createPdfRenderer(document,target,info=>updates.push(info));
  const first=viewer.render(),latest=viewer.zoom(1.2);
  requests[1].resolve(page);await latest;
  requests[0].resolve(page);await first;
  assert.equal(painted.length,1);assert.equal(target.width,156);
  assert.deepEqual(updates,[{page:1,total:2,scale:1.56}]);
});

test('rapid PDF controls cancel active rendering before reusing its canvas',async()=>{
  let active=0,cancelled=0,renders=0;
  const updates=[];
  const document={numPages:3,async getPage(){return {getViewport:({scale})=>({width:100*scale,height:80*scale}),render(){assert.equal(active,0,'Canvas must have only one active render');active++;renders++;const result=deferred();let ended=false;if(renders>1){ended=true;active--;result.resolve();}return {promise:result.promise,cancel(){if(ended)return;ended=true;cancelled++;active--;result.reject(Object.assign(new Error('cancelled'),{name:'RenderingCancelledException'}));}};}};}};
  const viewer=createPdfRenderer(document,canvas(),info=>updates.push(info));
  const first=viewer.render();await Promise.resolve();
  const second=viewer.next(),last=viewer.zoom(1.2);
  await Promise.all([first,second,last]);
  assert.equal(renders,2);assert.equal(active,0);
  assert.ok(cancelled>=1);assert.deepEqual(updates,[{page:2,total:3,scale:1.56}]);
});

test('closing a PDF during page lookup prevents later drawing and callbacks',async()=>{
  const lookup=deferred(),target=canvas();let painted=false,updated=false;
  const viewer=createPdfRenderer({numPages:1,getPage:()=>lookup.promise},target,()=>{updated=true;});
  const pending=viewer.render();viewer.destroy();
  lookup.resolve({getViewport:()=>({width:100,height:100}),render(){painted=true;return {promise:Promise.resolve()};}});
  await pending;await viewer.next();
  assert.equal(painted,false);assert.equal(updated,false);assert.equal(target.width,0);
});
