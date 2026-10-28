import test from 'node:test';
import assert from 'node:assert/strict';
import { isAudio, isVideo, nextTrack, audioFailureRecovery, bindVideoPlayback } from '../public/media-playback.js';

test('audio failure recovery attempts each track once and stops when all fail',()=>{
  const queue=audioFailureRecovery(3);
  assert.equal(queue.fail(1),2);
  assert.equal(queue.fail(2),0);
  assert.equal(queue.fail(0),null);
  assert.equal(queue.fail(0),null);
  queue.reset();
  assert.equal(queue.fail(0),1,'Successful playback allows a later retry of previously failed files');
  assert.equal(audioFailureRecovery(1).fail(0),null);
});

test('media playlists exclude directories and other media types', () => {
  const items = [{name:'a.WAV'}, {name:'b.mp4'}, {name:'c.webm'}, {name:'folder.mp4',directory:true}, {name:'photo.png'}];
  assert.deepEqual(items.filter(isAudio), [items[0]]);
  assert.deepEqual(items.filter(isVideo), [items[1],items[2]]);
});

test('audio wraps in both directions and shuffle cannot repeat the current track', () => {
  assert.equal(nextTrack(2,3),0);
  assert.equal(nextTrack(0,3,-1),2);
  assert.equal(nextTrack(0,1,1,true),0);
  for(let current=0;current<4;current++) {
    const choices=[0,0.4,0.99999].map(random=>nextTrack(current,4,1,true,()=>random));
    assert.deepEqual(choices,[0,1,2,3].filter(index=>index!==current));
  }
});

test('video repeat takes precedence over auto-next, reads live preferences, and detaches on close', async () => {
  const player = new EventTarget();
  let played=0,next=0,errors=0,rejections=0,paused=0,loaded=0,removed;
  Object.assign(player, {currentTime:7,play:async()=>{played++;},pause:()=>paused++,load:()=>loaded++,removeAttribute:name=>removed=name});
  const prefs={loop:true,autonext:true};
  const binding=bindVideoPlayback(player,{preferences:()=>prefs,next:()=>next++,error:()=>errors++,playRejected:()=>rejections++});
  player.dispatchEvent(new Event('ended'));
  assert.equal(played,1);assert.equal(player.currentTime,0);assert.equal(next,0);
  prefs.loop=false;
  player.dispatchEvent(new Event('ended'));assert.equal(next,1);
  prefs.autonext=false;
  player.dispatchEvent(new Event('ended'));assert.equal(next,1);assert.equal(played,1);
  player.dispatchEvent(new Event('error'));assert.equal(errors,1);
  player.play=async()=>{throw new Error('autoplay denied');};
  binding.play();await Promise.resolve();assert.equal(rejections,1);
  player.error={code:4};
  binding.play();await Promise.resolve();assert.equal(errors,2);assert.equal(rejections,1);
  binding.play();
  binding.destroy();
  await Promise.resolve();assert.equal(errors,2);
  prefs.autonext=true;
  player.dispatchEvent(new Event('ended'));player.dispatchEvent(new Event('error'));
  assert.equal(next,1);assert.equal(errors,2);
  assert.equal(paused,1);assert.equal(loaded,1);assert.equal(removed,'src');
});
