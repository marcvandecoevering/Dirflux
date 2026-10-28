export function galleryShortcut(event, {nativeControl=false,activationControl=false,overflowingImage=false}={}) {
  if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||nativeControl)return null;
  const key=event.key;
  if((key.toLowerCase()==='f'&&!event.altKey&&!event.shiftKey)||(key==='Enter'&&event.altKey&&!event.shiftKey))return 'fullscreen';
  if(event.altKey)return null;
  if(activationControl&&[' ','Enter'].includes(key))return null;
  if(overflowingImage&&['ArrowRight','ArrowLeft','ArrowUp','ArrowDown',' '].includes(key))return null;
  if(key===' '&&event.shiftKey)return 'previous';
  if(event.shiftKey)return null;
  if(['ArrowRight','ArrowDown',' ','Enter'].includes(key))return 'next';
  if(['ArrowLeft','ArrowUp','Backspace'].includes(key))return 'previous';
  return null;
}
