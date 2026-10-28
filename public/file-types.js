// Extension coverage follows droppy 12.2.0. Recognition is not a codec promise.
const audio=new Set(['aac','aif','aifc','aiff','f4a','flac','m4a','m4b','m4p','m4r','mka','mp1','mp2','mp3','mpa','mpeg','mpg','oga','ogg','opus','wav','wma']);
const video=new Set(['3g2','3gp','f4v','flv','m4v','mk3d','mkv','mov','mp4','ogv','ogx','webm']);
const images=new Set(['png','apng','bmp','gif','ico','jpg','jpeg','svg','webp','avif']);
const extension=name=>String(name).match(/\.([^.\\/]+)$/)?.[1].toLowerCase()||'';
export const isAudio=item=>!item.directory&&audio.has(extension(item.name));
export const isVideo=item=>!item.directory&&video.has(extension(item.name));
export const isImage=item=>!item.directory&&images.has(extension(item.name));
export function canInlineFile(name){
  const ext=extension(name);
  return audio.has(ext)||video.has(ext)||(images.has(ext)&&ext!=='svg');
}
// These legacy extensions are absent from the server's MIME database.
const legacyMime={f4a:'audio/mp4',m4r:'audio/mp4',mp1:'audio/mpeg',mpa:'audio/mpeg'};
export const legacyMediaType=name=>Object.hasOwn(legacyMime,extension(name))?legacyMime[extension(name)]:null;
