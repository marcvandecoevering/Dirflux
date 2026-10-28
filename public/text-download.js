// Download a snapshot of the draft without saving it to the server.
export function downloadText(text,filename,document=globalThis.document,urls=URL,schedule=setTimeout) {
  const url=urls.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download=filename;link.hidden=true;
  try {document.body.appendChild(link);link.click();}
  catch(error) {urls.revokeObjectURL(url);throw error;}
  finally {link.remove();}
  // Keep the URL alive while the browser begins the download, then release it.
  schedule(()=>urls.revokeObjectURL(url),60000);
}
