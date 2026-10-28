// Directory readers can return multiple batches. Keep directory entries as well
// as files so an empty directory is not lost during drag-and-drop upload.
export async function collectUploadEntries(entries) {
  const items=[];
  async function collect(entry,prefix='') {
    const relative=prefix+entry.name;
    if (entry.isFile) {
      const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));
      items.push({file,path:relative});
    } else if (entry.isDirectory) {
      items.push({directory:true,path:relative});
      const reader=entry.createReader();
      while(true) {
        const children=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));
        if(!children.length)break;
        for(const child of children)await collect(child,relative+'/');
      }
    }
  }
  for(const entry of entries)await collect(entry);
  return items;
}
