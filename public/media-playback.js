export const isAudio = item => !item.directory && /\.(mp3|wav|ogg|m4a|flac)$/i.test(item.name);
export const isVideo = item => !item.directory && /\.(mp4|webm|ogv)$/i.test(item.name);

export function nextTrack(index, length, delta = 1, shuffle = false, random = Math.random) {
  if (length <= 1) return 0;
  // Select uniformly from every other track, without a retry loop.
  if (shuffle) {
    const candidate = Math.floor(random() * (length - 1));
    return candidate >= index ? candidate + 1 : candidate;
  }
  return (index + delta + length) % length;
}

export function audioFailureRecovery(length) {
  const failed=new Set();
  return {
    reset() {failed.clear();},
    fail(index) {
      failed.add(index);
      for(let step=1;step<length;step++) {
        const candidate=(index+step)%length;
        if(!failed.has(candidate))return candidate;
      }
      return null;
    },
  };
}

export function bindVideoPlayback(player, { preferences, next, error, playRejected }) {
  let disposed = false;
  const play = () => { player.play().catch(() => {
    if (!disposed) (player.error ? error : playRejected)();
  }); };
  const ended = () => {
    if (preferences().loop) { player.currentTime = 0; play(); }
    else if (preferences().autonext) next();
  };
  player.addEventListener('ended', ended);
  player.addEventListener('error', error);
  return {
    play,
    destroy() {
      disposed = true;
      player.removeEventListener('ended', ended);
      player.removeEventListener('error', error);
      player.pause();
      player.removeAttribute('src');
      player.load();
    },
  };
}
