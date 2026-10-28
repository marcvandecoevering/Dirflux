// Image dimensions are explicit so scrollbars cover the complete zoomed image.
export function bindImageViewer(image, viewport, { initialMode = 'fit', change, error }) {
  let scale = 1, mode = initialMode, disposed = false, drag;
  const fitScale = () => Math.min(1, viewport.clientWidth / image.naturalWidth, viewport.clientHeight / image.naturalHeight);
  function render(nextScale, center = true) {
    if (!image.naturalWidth || !viewport.clientWidth || !viewport.clientHeight) return;
    const oldWidth = image.naturalWidth * scale, oldHeight = image.naturalHeight * scale;
    const x = oldWidth ? (viewport.scrollLeft + viewport.clientWidth / 2) / oldWidth : 0.5;
    const y = oldHeight ? (viewport.scrollTop + viewport.clientHeight / 2) / oldHeight : 0.5;
    scale = Math.max(0.01, Math.min(32, nextScale));
    image.style.width = `${image.naturalWidth * scale}px`;
    image.style.height = `${image.naturalHeight * scale}px`;
    viewport.scrollLeft = (center ? 0.5 : x) * image.naturalWidth * scale - viewport.clientWidth / 2;
    viewport.scrollTop = (center ? 0.5 : y) * image.naturalHeight * scale - viewport.clientHeight / 2;
    change({ scale, mode });
  }
  function resize() {
    if (disposed || !image.naturalWidth) return;
    render(mode === 'width' ? viewport.clientWidth / image.naturalWidth : mode === 'height' ? viewport.clientHeight / image.naturalHeight : mode === 'fit' ? fitScale() : scale);
  }
  function select(nextMode) { mode = mode === nextMode && nextMode !== 'fit' ? 'fit' : nextMode; resize(); }
  const down = event => {
    if(event.pointerType !== 'mouse' || event.button !== 0) return;
    viewport.focus({preventScroll:true});
    drag = {x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
    viewport.setPointerCapture(event.pointerId);event.preventDefault();
  };
  const move = event => {
    if(!drag) return;
    viewport.scrollLeft=drag.left+drag.x-event.clientX;
    viewport.scrollTop=drag.top+drag.y-event.clientY;
  };
  const up = () => {drag=null;};
  viewport.addEventListener('pointerdown',down);viewport.addEventListener('pointermove',move);
  viewport.addEventListener('pointerup',up);viewport.addEventListener('pointercancel',up);
  image.addEventListener('load',resize);image.addEventListener('error',error);
  const observer = new ResizeObserver(resize);observer.observe(viewport);
  resize();
  return {
    select,
    zoom(factor) { mode='custom';render(scale*factor,false); },
    canSwipe() { return image.scrollWidth <= viewport.clientWidth + 1 && image.scrollHeight <= viewport.clientHeight + 1; },
    destroy() {
      disposed=true;observer.disconnect();
      image.removeEventListener('load',resize);image.removeEventListener('error',error);
      viewport.removeEventListener('pointerdown',down);viewport.removeEventListener('pointermove',move);
      viewport.removeEventListener('pointerup',up);viewport.removeEventListener('pointercancel',up);
    },
  };
}
