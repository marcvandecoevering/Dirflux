export function createPdfRenderer(document,canvas,onInfo) {
  let page=1,scale=1.3,task=null,generation=0,disposed=false;
  async function render() {
    const request=++generation,requestedPage=page,requestedScale=scale,previous=task;
    if(previous){previous.cancel();try{await previous.promise;}catch{}}
    if(disposed||request!==generation)return;
    const current=await document.getPage(requestedPage);
    if(disposed||request!==generation)return;
    const viewport=current.getViewport({scale:requestedScale});
    canvas.width=viewport.width;canvas.height=viewport.height;
    const active=current.render({canvasContext:canvas.getContext('2d'),viewport});
    task=active;
    try {await active.promise;}
    catch(error){if(error.name!=='RenderingCancelledException')throw error;}
    finally {if(task===active)task=null;}
    if(!disposed&&request===generation)onInfo({page:requestedPage,total:document.numPages,scale:requestedScale});
  }
  return {render,previous:()=>{page=Math.max(1,page-1);return render();},next:()=>{page=Math.min(document.numPages,page+1);return render();},zoom:factor=>{scale=Math.max(.4,Math.min(3,scale*factor));return render();},destroy:()=>{disposed=true;generation++;task?.cancel();}};
}
