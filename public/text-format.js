// Match droppy's dominant CRLF/LF choice; ties and files without LF use LF.
export function dominantLineEnding(text) {
  let crlf=0,lf=0;
  for(let i=0;i<text.length;i++)if(text[i]==='\n') {
    if(i>0&&text[i-1]==='\r')crlf++;else lf++;
  }
  return crlf>lf?'\r\n':'\n';
}

export const editorText=(document,lineEnding)=>document.sliceString(0,document.length,lineEnding);
