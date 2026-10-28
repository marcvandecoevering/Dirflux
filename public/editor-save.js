// One request per editor at a time. A response belongs only to its originating editor.
export function createEditorSave({version,getText,write,isActive,canSave,onBusy,onSaved}) {
  let pending=false;
  return async()=>{
    if(pending||!isActive()||!canSave())return;
    pending=true;onBusy(true);
    try {
      const text=getText();
      const result=await write(text,version);
      version=result.version;
      if(isActive())await onSaved({dirty:getText()!==text});
    } catch(error) {
      if(isActive())throw error;
    } finally {
      pending=false;
      if(isActive())onBusy(false);
    }
  };
}
