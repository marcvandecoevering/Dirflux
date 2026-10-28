import test from 'node:test';
import assert from 'node:assert/strict';
import {isAudio,isVideo,isImage,canInlineFile} from '../public/file-types.js';

test('all original audio/video extensions enter the appropriate playlist and inline delivery',()=>{
  const audio=['aac','aif','aifc','aiff','f4a','flac','m4a','m4b','m4p','m4r','mka','mp1','mp2','mp3','mpa','mpeg','mpg','oga','ogg','opus','wav','wma'];
  const video=['3g2','3gp','f4v','flv','m4v','mk3d','mkv','mov','mp4','ogv','ogx','webm'];
  for(const [formats,own,other] of [[audio,isAudio,isVideo],[video,isVideo,isAudio]])for(const ext of formats){
    const item={name:'Example.'+ext.toUpperCase()};assert.equal(own(item),true,ext);assert.equal(other(item),false,ext);
    assert.equal(own({...item,directory:true}),false);assert.equal(canInlineFile(item.name),true);
  }
});
test('image coverage preserves SVG attachment policy and excludes misleading filenames',()=>{
  for(const ext of ['png','apng','bmp','gif','ico','jpg','jpeg','svg','webp','avif']){
    assert.equal(isImage({name:'example.'+ext}),true);assert.equal(canInlineFile('example.'+ext),ext!=='svg');
  }
  for(const name of ['mp3','video.mp4.html','video.mp4/notes','file.svg.js','file.txt','file.']){
    assert.equal(isAudio({name}),false,name);assert.equal(isVideo({name}),false,name);assert.equal(isImage({name}),false,name);assert.equal(canInlineFile(name),false,name);
  }
});
