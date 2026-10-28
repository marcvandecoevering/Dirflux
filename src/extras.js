import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import * as themes from '@uiw/codemirror-themes-all';
import * as pdfjs from 'pdfjs-dist';

export const modes = languages.map(l=>l.name);
export const themeNames = ['droppy','light','dark',...Object.keys(themes).filter(name=>Array.isArray(themes[name])&&!name.endsWith('Style'))];
export async function editor(parent, text, filename, prefs, readOnly, onChange, onSave) {
  const language = new Compartment(), wrapping = new Compartment(), appearance = new Compartment(), indentation = new Compartment();
  const description = languages.find(l=>l.extensions.includes(filename.split('.').at(-1).toLowerCase()));
  const appearanceExtensions = settings => [
    ...(themes[settings.theme] ? [themes[settings.theme]] : settings.theme !== 'light' ? [oneDark] : []),
    EditorView.theme({'&':{height:'100%',fontSize:`${settings.editorFontSize}px`,backgroundColor:settings.theme==='droppy'?'#161616':undefined},'.cm-scroller':{overflow:'auto',fontFamily:'Consolas, monospace'},'.cm-content':{minHeight:'100%'},'.cm-gutters':{backgroundColor:settings.theme==='droppy'?'#282828':undefined}})
  ];
  const indentationExtensions = settings => [EditorState.tabSize.of(Number(settings.indentUnit)),indentUnit.of(settings.indentWithTabs ? '\t' : ' '.repeat(Number(settings.indentUnit)))];
  const view = new EditorView({parent,state:EditorState.create({doc:text,extensions:[basicSetup,
    keymap.of([{key:'Mod-s',run:()=>{onSave();return true;}},indentWithTab]),
    EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly),
    indentation.of(indentationExtensions(prefs)),
    language.of(description ? await description.load() : []),wrapping.of(prefs.lineWrapping ? EditorView.lineWrapping : []),
    appearance.of(appearanceExtensions(prefs)),
    EditorView.updateListener.of(update=>{if(update.docChanged)onChange();})
  ]})});
  return { getText:()=>view.state.doc.toString(), destroy:()=>view.destroy(), focus:()=>view.focus(), find:()=>openSearchPanel(view),
    setPreferences:settings=>view.dispatch({effects:[appearance.reconfigure(appearanceExtensions(settings)),indentation.reconfigure(indentationExtensions(settings)),wrapping.reconfigure(settings.lineWrapping?EditorView.lineWrapping:[])]}),
    wrap:value=>view.dispatch({effects:wrapping.reconfigure(value?EditorView.lineWrapping:[])}),
    mode:async name=>{const l=languages.find(i=>i.name===name);view.dispatch({effects:language.reconfigure(l?await l.load():[])});},
    modeName:description?.name || 'Plain text'
  };
}
export async function pdf(url, canvas, onInfo) {
  pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.min.mjs';
  const loading=pdfjs.getDocument({url,isEvalSupported:false,useWasm:false,wasmUrl:'/vendor/wasm/',iccUrl:'/vendor/iccs/',cMapUrl:'/vendor/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/standard_fonts/'});
  const document=await loading.promise;
  let page=1,scale=1.3,renderTask=null;
  async function render() {
    if(renderTask){renderTask.cancel();try{await renderTask.promise;}catch{}}
    const current=await document.getPage(page), viewport=current.getViewport({scale});
    canvas.width=viewport.width;canvas.height=viewport.height;
    renderTask=current.render({canvasContext:canvas.getContext('2d'),viewport});
    try{await renderTask.promise;}catch(e){if(e.name!=='RenderingCancelledException')throw e;}
    onInfo({page,total:document.numPages,scale});
  }
  await render();
  return {previous:async()=>{page=Math.max(1,page-1);await render();},next:async()=>{page=Math.min(document.numPages,page+1);await render();},zoom:async factor=>{scale=Math.max(.4,Math.min(3,scale*factor));await render();},destroy:()=>loading.destroy()};
}
