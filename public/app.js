import { bindImageViewer } from './image-viewer.js';
import { fileShortcut } from './file-shortcuts.js';
import { canEditSession } from './session-permissions.js';
import { galleryShortcut } from './gallery-shortcuts.js';
import { isImage } from './file-types.js';
import { downloadText } from './text-download.js';
import { createEditorSave } from './editor-save.js';
import { dropOperation, readInternalDrop, dropTransfer } from './internal-drop.js';
import { isAudio, isVideo, nextTrack, audioFailureRecovery, bindVideoPlayback } from './media-playback.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const viewParameters = new URLSearchParams(location.search);
const viewerMode = viewParameters.get('viewer') === '1';
let historyPosition=Number.isSafeInteger(history.state?.fileAppPosition)?history.state.fileAppPosition:0;
let currentHistoryUrl=location.href,historyRequest=0;
if(!viewerMode)history.replaceState({fileAppPosition:historyPosition},'',location.href);
if (viewerMode) document.body.classList.add('viewer-mode');
const state = { user: null, csrf: '', readOnly: false, setup: false, panes: [{ path: '', items: [], selected: new Set(), sort: 'name', descending: false }], active: 0, uploading: false, search: '', dirty: false };
const icons = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const join = (...parts) => parts.filter(Boolean).join('/');
const parent = value => value.split('/').slice(0, -1).join('/');
const basename = value => value.split('/').at(-1);
const active = () => state.panes[state.active];
const canWrite = () => canEditSession(state);
const size = n => n < 1024 ? n + ' B' : n < 1024 ** 2 ? (n / 1024).toFixed(1) + ' KB' : n < 1024 ** 3 ? (n / 1024 ** 2).toFixed(1) + ' MB' : (n / 1024 ** 3).toFixed(1) + ' GB';
const date = n => new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' }).format(n);
const kind = item => item.directory ? 'folder' : isImage(item) ? 'image' : isAudio(item)||isVideo(item) ? 'media' : 'file';
let toastTimer, closeHook = null, refreshBusy = false;
const uploadJobs = new Set();
let uploadConflictQueue = Promise.resolve();
let nativeFullscreenPane = null;
let videoPlayback = null, imageViewer = null, imageFitMode = 'fit';
let editorInstance = null, currentMedia = null, clipboard = null, audioItems = [], audioIndex = 0, eventSource = null, textReadController = null;
let suspendedWorkspaceOwner=null;
let stopAudio = () => {};
const defaultPrefs = { theme:'droppy',editorFontSize:16,indentWithTabs:false,indentUnit:4,lineWrapping:false,loop:true,autonext:false,sharelinkDownload:true };
let prefs;
function readPreferences() {
  let settings;try{settings={...defaultPrefs,...JSON.parse(localStorage.getItem('droppy-next-prefs')||'{}')};}catch{settings={...defaultPrefs};}
  if(![1,2,4,8].includes(Number(settings.indentUnit)))settings.indentUnit=defaultPrefs.indentUnit;
  if(!Number.isFinite(Number(settings.editorFontSize))||Number(settings.editorFontSize)<10||Number(settings.editorFontSize)>30)settings.editorFontSize=defaultPrefs.editorFontSize;
  for(const name of ['indentWithTabs','lineWrapping','loop','autonext','sharelinkDownload'])if(typeof settings[name]!=='boolean')settings[name]=defaultPrefs[name];
  if(typeof settings.theme!=='string')settings.theme=defaultPrefs.theme;
  return settings;
}
prefs=readPreferences();
window.addEventListener('storage',event=>{if(event.key==='droppy-next-prefs'){prefs=readPreferences();editorInstance?.setPreferences(prefs);syncVideoControls();}});
const originalIcon = name => `<svg class="original-icon" aria-hidden="true"><use href="/original/icons.svg#o-${name}"/></svg>`;
const tool = (action,icon,label,extra='') => `<button class="classic-button ${extra}" data-tool="${action}" aria-label="${label}" title="${label}">${originalIcon(icon)}</button>`;
function paneNav() {
  return `<div class="classic-nav"><div class="classic-nav-group">${tool('upload','add-file','Upload files from disk','write')}${tool('upload-folder','add-folder','Upload folder from disk','write')}${tool('create','create-file','Create file','write')}${tool('mkdir','create-folder','Create folder','write')}</div><div class="classic-nav-group"><form class="classic-search">${tool('search','find','Search')}<input type="search" placeholder="Term" aria-label="Search term"></form>${tool('refresh','reload','Reload View')}${tool('split','window','Create new View')}${tool('preferences','cog','Preferences')}${tool('about','info','About','nav-about')}${tool('logout','signout',state.user?.guest?'Sign in':'Sign out','nav-logout')}</div></div>`;
}
async function showPrefs() {
  const {themeNames}=await import('/vendor/extras.js');
  showDialog('Preferences', `<form class="dialog-form" id="prefs-form"><label>Editor theme<select name="theme"><option value="droppy">Dirflux</option><option value="dark">one dark</option><option value="light">light</option></select></label><label>Editor font size<select name="editorFontSize">${Array.from({length:11},(_,i)=>`<option>${10+i*2}</option>`).join('')}</select></label><label>Editor indent type<select name="indentWithTabs"><option value="false">Spaces</option><option value="true">Tabs</option></select></label><label>Editor indent width<select name="indentUnit">${[1,2,4,8].map(n=>`<option>${n}</option>`).join('')}</select></label><label>Editor word wrap<select name="lineWrapping"><option value="false">No wrap</option><option value="true">Wrap</option></select></label><label>Sharelink download<select name="sharelinkDownload"><option value="true">Default on</option><option value="false">Default off</option></select></label><div class="prefs-buttons"><button type="button" class="secondary" data-prefs="shares">Shared links</button><button type="button" class="secondary" data-prefs="trash">Trash</button>${state.user.guest?'<a class="secondary" href="/?login=1">Sign in</a>':'<button type="button" class="secondary" data-prefs="account">Account</button>'}${state.user.role==='admin'?'<button type="button" class="secondary" data-prefs="users">Users</button>':''}</div><div class="dialog-actions"><button class="primary" type="submit">Save</button></div></form>`);
  $('#prefs-form [name=theme]').innerHTML=themeNames.map(name=>`<option>${escape(name)}</option>`).join('');
  for(const [key,value] of Object.entries(prefs)) { const input=$(`#prefs-form [name="${key}"]`); if(input)input.value=String(value); }
  on($('#prefs-form'),'submit',e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget)); for(const [key,value] of Object.entries(data)) prefs[key]=['true','false'].includes(value)?value==='true':/^\d+$/.test(value)?Number(value):value;localStorage.setItem('droppy-next-prefs',JSON.stringify(prefs));closeDialog();toast('Preferences saved.');});
  $$('[data-prefs]').forEach(b=>on(b,'click',()=>{const action=b.dataset.prefs;if(action==='shares')return showShares();if(action==='trash')return showTrash();if(action==='users')return showUsers();$('#account-settings').click();}));
}

function toast(message, error = false) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').className = 'toast' + (error ? ' error' : ''); $('#toast').hidden = false;
  toastTimer = setTimeout(() => $('#toast').hidden = true, error ? 7000 : 4000);
}
async function api(url, options = {}) {
  const headers = { ...options.headers };
  if (options.body && typeof options.body !== 'string') { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(options.body); }
  if (options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
  const response = await fetch('/api' + url, { ...options, headers });
  const body = await response.json();
  if (!response.ok) {
    if(response.status===403 && body.error?.includes('Ongeldig sessietoken') && !options.retried){
      const renewed=await fetch('/api/session').then(r=>r.json());
      if(renewed.csrf&&renewed.csrf!==state.csrf){state.csrf=renewed.csrf;return api(url,{...options,headers,retried:true});}
    }
    if (response.status === 401 && state.user) {
      const owner=state.user.id;
      if(editorInstance&&state.dirty){
        state.user=null;state.csrf=null;pauseEditorSession(owner);
        if(viewerMode)window.parent.pauseWorkspaceSession?.(owner);
      } else if(viewerMode||!pauseWorkspaceSession(owner)) {
        state.user=null;state.csrf=null;await init();
      }
    }
    throw new Error(body.error || 'Verzoek mislukt.');
  }
  return body;
}
function on(element, event, action) {
  element.addEventListener(event, async e => { try { await action(e); } catch (error) { toast(error.message, true); } });
}
async function closeDialog() {
  if (viewerMode && window.parent.viewTransitionPending?.()) return;
  if (closeHook && !await closeHook()) return;
  videoPlayback?.destroy(); videoPlayback=null; imageViewer?.destroy(); imageViewer=null;
  editorInstance?.destroy(); editorInstance=null; currentMedia=null;
  $('#dialog').close(); $('#dialog-content').replaceChildren(); state.dirty = false; closeHook = null;
  if(viewerMode)window.parent.postMessage({type:'droppy-close'},location.origin);
}
let discardPrompt = null;
function confirmDiscardChanges() {
  if (!state.dirty) return Promise.resolve(true);
  // Only the action that opened the prompt may proceed after confirmation.
  // A second navigation or close request must not reuse its approval.
  if (discardPrompt) return Promise.resolve(false);
  const dialog = document.createElement('dialog');
  dialog.className = 'discard-dialog';
  dialog.setAttribute('aria-labelledby', 'discard-title');
  dialog.innerHTML = '<h2 id="discard-title">Niet-opgeslagen wijzigingen</h2><p>Je wijzigingen zijn nog niet opgeslagen. Wil je verder bewerken of ze verwerpen?</p><form method="dialog" class="dialog-actions"><button value="cancel" class="secondary" autofocus>Verder bewerken</button><button value="discard" class="danger">Wijzigingen verwerpen</button></form>';
  discardPrompt = new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const discard = dialog.returnValue === 'discard';
      dialog.remove(); discardPrompt = null;
      resolve(discard);
    }, { once: true });
  });
  document.body.append(dialog);
  dialog.showModal();
  return discardPrompt;
}
function pauseEditorSession(owner) {
  const editor=editorInstance,status=$('#editor-status'),save=$('#save');
  document.body.classList.add('read-only');save.disabled=true;
  status.replaceChildren(document.createTextNode('Sessie verlopen. Je concept blijft hier behouden. '));
  const login=document.createElement('a');login.href='/?login=1';login.target='_blank';login.rel='noopener';login.textContent='Opnieuw aanmelden';
  const resume=document.createElement('button');resume.type='button';resume.textContent='Sessie controleren';
  status.append(login,document.createTextNode(' '),resume);
  on(resume,'click',async()=>{
    resume.disabled=true;
    try {
      const response=await fetch('/api/session?login=1',{cache:'no-store'});
      if(!response.ok)throw new Error('De sessie kon niet worden gecontroleerd.');
      const session=await response.json();
      if(editorInstance!==editor||!status.isConnected)return;
      if(!canEditSession(session,owner))throw new Error('Meld je aan met hetzelfde account met bewerkrechten. Je concept blijft behouden.');
      Object.assign(state,session);document.body.classList.remove('read-only');
      save.disabled=false;status.textContent='Unsaved changes';
      if(viewerMode)window.parent.resumeWorkspaceSession?.(session,owner,window);
      toast('Sessie hersteld. Je kunt het concept nu opslaan.');
    } finally {if(resume.isConnected)resume.disabled=false;}
  });
}
window.confirmCloseView = confirmDiscardChanges;
window.hasUnsavedChanges=()=>state.dirty;
window.pauseExpiredEditor=owner=>{
  if(editorInstance&&state.dirty&&state.user?.id===owner){state.user=null;state.csrf=null;pauseEditorSession(owner);}
};
function pauseWorkspaceSession(owner) {
  if(viewerMode||(state.user?.id!==owner&&suspendedWorkspaceOwner!==owner))return false;
  const frames=$$('.file-view').filter(frame=>frame.contentWindow.hasUnsavedChanges?.());
  if(!frames.length)return false;
  suspendedWorkspaceOwner=owner;state.user=null;state.csrf=null;
  document.body.classList.add('read-only');clipboard=null;
  for(const job of uploadJobs)job.cancel();
  eventSource?.close();eventSource=null;
  for(const frame of frames)frame.contentWindow.pauseExpiredEditor?.(owner);
  toast('Sessie verlopen. Meld je opnieuw aan via je open editor. Je concepten blijven behouden.',true);
  return true;
}
window.pauseWorkspaceSession=pauseWorkspaceSession;
window.resumeWorkspaceSession=(session,owner,source)=>{
  if(viewerMode||suspendedWorkspaceOwner!==owner||!canEditSession(session,owner)||!$$('.file-view').some(frame=>frame.contentWindow===source))return;
  Object.assign(state,session);suspendedWorkspaceOwner=null;
  document.body.classList.remove('read-only');
  renderPanes(); // Existing viewer frames are retained by renderPane.
  startLiveEvents();
};
let viewTransitionBusy = false;
let transitionFrames = [];
window.viewTransitionPending = () => viewTransitionBusy;
function freezeApprovedFrame(frame) {
  transitionFrames.push({ frame, inert: frame.inert }); frame.inert = true;
}
async function changeView(action) {
  if (viewTransitionBusy) return;
  viewTransitionBusy = true;
  try { return await action(); }
  finally {
    for (const { frame, inert } of transitionFrames) frame.inert = inert;
    transitionFrames = []; viewTransitionBusy = false;
  }
}
async function confirmCloseFrames() {
  for (const frame of $$('.file-view')) {
    if (await frame.contentWindow.confirmCloseView?.() === false) return false;
    // Hold approved panes until the entire transition finishes. Cancellation
    // restores every editor without clearing dirty or allowing later edits
    // to inherit an earlier discard approval.
    freezeApprovedFrame(frame);
  }
  return true;
}
function showDialog(title, html, className = '') {
  textReadController?.abort();textReadController=null;
  videoPlayback?.destroy(); videoPlayback=null; imageViewer?.destroy(); imageViewer=null;
  editorInstance?.destroy(); editorInstance=null; currentMedia=null;
  $('#dialog-title').textContent = title; $('#dialog-content').innerHTML = html; $('#dialog').className = className;
  state.dirty = false; closeHook = null;
  if (!$('#dialog').open) $('#dialog').showModal();
}
async function formDialog(title, fields, submitLabel, handler, description = '') {
  showDialog(title, `${description ? `<p>${escape(description)}</p>` : ''}<form id="modal-form" class="dialog-form">${fields}<div id="modal-error" class="dialog-error" role="alert"></div><div class="dialog-actions"><button type="button" class="secondary" id="modal-cancel">Annuleren</button><button type="submit" class="primary">${escape(submitLabel)}</button></div></form>`);
  $('#modal-cancel').onclick = closeDialog;
  const form=$('#modal-form'),errorBox=$('#modal-error'),closeButton=$('#dialog-close');
  const progress=document.createElement('div');progress.setAttribute('role','status');progress.hidden=true;progress.textContent='Bezig… Wacht tot de bewerking is afgerond.';form.append(progress);
  let submitting=false;
  closeHook=()=>!submitting;
  form.addEventListener('submit', async e => {
    e.preventDefault();if(submitting)return;
    const data=new FormData(form);
    const controls=[...form.querySelectorAll('input,select,textarea,button'),closeButton].map(element=>({element,disabled:element.disabled}));
    submitting=true;form.setAttribute('aria-busy','true');errorBox.textContent='';progress.hidden=false;
    for(const {element} of controls)element.disabled=true;
    try {
      await handler(data);submitting=false;
      if($('#modal-form')===form)await closeDialog();
      await refreshAll();
    } catch(error){if($('#modal-form')===form)errorBox.textContent=error.message;else toast(error.message,true);}
    finally {
      submitting=false;form.removeAttribute('aria-busy');progress.hidden=true;
      for(const {element,disabled} of controls)if(element!==closeButton||!$('#modal-form')||$('#modal-form')===form)element.disabled=disabled;
    }
  });
  $('#modal-form input')?.focus();
}
function setActive(index) {
  state.active = index;
  $$('.pane').forEach((p, i) => p.classList.toggle('active', i === index));
  updateSelection();
}
function updateSelection() {
  const n = active().selected.size;
  $('#selection-bar').hidden = !n;
  $('#selection-count').textContent = `${n} geselecteerd`;
}
async function loadPane(index, quiet = false) {
  const pane = state.panes[index]; if (!pane) return;
  if(quiet&&pane.query&&(pane.searchOffset>0||pane.loadingMore))return;
  const generation=pane.loadGeneration=(pane.loadGeneration||0)+1;
  const requestedPath = pane.path, requestedSearch = pane.query || '';
  const data = await api(requestedSearch ? `/search?path=${encodeURIComponent(requestedPath)}&q=${encodeURIComponent(requestedSearch)}` : `/files?path=${encodeURIComponent(requestedPath)}`);
  if (state.panes[index]!==pane || pane.loadGeneration!==generation || pane.path !== requestedPath || (pane.query || '') !== requestedSearch) return;
  const changed = JSON.stringify(pane.items) !== JSON.stringify(data.items) || pane.nextOffset !== (data.nextOffset??null);
  pane.items = data.items;
  pane.nextOffset=data.nextOffset??null;pane.searchOffset=0;
  pane.selected = new Set([...pane.selected].filter(p => pane.items.some(i => i.path === p)));
  if (!quiet || changed) renderPane(index);
  if (data.truncated && !quiet) toast('Er zijn meer resultaten. Gebruik Meer resultaten onderaan de lijst.');
}
async function refreshAll(quiet = false) {
  if (!state.user || refreshBusy) return;
  refreshBusy = true;
  try {
    await Promise.all(state.panes.map((_, i) => loadPane(i, quiet)));
    $('#connection').textContent = 'Wijzigingen worden automatisch bijgewerkt'; $('#connection').className = '';
  } catch (error) {
    $('#connection').textContent = error.message; $('#connection').className = 'connection-error';
    if (!quiet) throw error;
  } finally { refreshBusy = false; }
}
async function leavePaneFullscreen(element) {
  if(document.fullscreenElement===element)await document.exitFullscreen();
  element?.classList.remove('is-fullscreen');
}
async function togglePaneFullscreen(index) {
  const element=$(`[data-pane="${index}"]`);
  setActive(index);
  if(element.classList.contains('is-fullscreen'))return leavePaneFullscreen(element);
  element.classList.add('is-fullscreen');
  if(document.fullscreenEnabled&&element.requestFullscreen) {
    try {await element.requestFullscreen();nativeFullscreenPane=element;}
    catch {toast('Vergroot binnen de app; deze browser staat volledig scherm niet toe.');}
  }
}
document.addEventListener('fullscreenchange',()=>{
  if(nativeFullscreenPane&&document.fullscreenElement!==nativeFullscreenPane){nativeFullscreenPane.classList.remove('is-fullscreen');nativeFullscreenPane=null;}
});
async function navigate(index, path, openItem=null) {
  return changeView(async () => {
  const pane = state.panes[index];
  const frame=$(`[data-pane="${index}"] iframe`);
  if(frame && await frame.contentWindow.confirmCloseView?.()===false)return;
  if(frame)freezeApprovedFrame(frame);
  await leavePaneFullscreen($(`[data-pane="${index}"]`));
  if(frame)frame.remove();pane.open=openItem&&!isAudio(openItem)?{item:openItem,forceText:false}:null;
  pane.path = path; pane.query = ''; pane.selected.clear();
  setActive(index); $('#search').value = ''; await loadPane(index);recordLocation();
  if(openItem&&isAudio(openItem))playAudio(openItem,index);
  });
}
async function openDroppedItem(raw,index) {
  const source=readInternalDrop(raw);
  const item=await api('/stat?path='+encodeURIComponent(source.path));
  return navigate(index,item.directory?item.path:parent(item.path),item.directory?null:item);
}
function recordLocation(replace=false) {
  if(viewerMode)return;
  const hash='#/'+state.panes.map(p=>encodeURIComponent(p.open?.item.path||p.path)).join('|');
  if(location.hash!==hash){
    if(!replace)historyPosition++;
    history[replace?'replaceState':'pushState']({fileAppPosition:historyPosition},'',hash);
  }else if(replace)history.replaceState({fileAppPosition:historyPosition},'',hash);
  currentHistoryUrl=location.href;
}
function cancelHistoryNavigation(){
  const target=history.state?.fileAppPosition;
  if(Number.isSafeInteger(target)&&target!==historyPosition)history.go(historyPosition-target);
  else history.replaceState({fileAppPosition:historyPosition},'',currentHistoryUrl);
}
async function restoreLocation(fromHistory=false) {
  if(viewerMode||!state.user)return;
  // Returning to a cancelled entry must not reopen or discard its existing editors.
  if(fromHistory&&location.href===currentHistoryUrl&&history.state?.fileAppPosition===historyPosition){if(viewTransitionBusy)historyRequest++;return;}
  const request=++historyRequest;
  if(viewTransitionBusy){cancelHistoryNavigation();return;}
  return changeView(async () => {
  const requestedHash = location.hash;
  const requestedPosition=history.state?.fileAppPosition;
  const approved=await confirmCloseFrames();
  if(request!==historyRequest)return;
  if(!approved){cancelHistoryNavigation();return;}
  const paths=requestedHash.replace(/^#\/?/,'').split('|').slice(0,2).map(decodeURIComponent),panes=[];
  for(const locationPath of paths){
    try{const item=await api('/stat?path='+encodeURIComponent(locationPath));panes.push({path:item.directory?item.path:parent(item.path),open:item.directory?null:{item,forceText:false},items:[],selected:new Set(),sort:'name'});}
    catch(error){toast(error.message,true);panes.push({path:'',items:[],selected:new Set(),sort:'name'});}
  }
  if(request!==historyRequest)return;
  state.panes=panes;state.active=0;$('#panes').replaceChildren();
  if(Number.isSafeInteger(requestedPosition))historyPosition=requestedPosition;
  else if(fromHistory)historyPosition++;
  recordLocation(true);
  renderPanes();await refreshAll();
  });
}
function renderPanes() {
  $('#panes').classList.toggle('split', state.panes.length === 2);
  while($('#panes').children.length>state.panes.length)$('#panes').lastElementChild.remove();
  state.panes.forEach((_,i)=>{if(!$(`[data-pane="${i}"]`)){const el=document.createElement('article');el.className='pane';el.dataset.pane=i;el.setAttribute('aria-label',`Bestandsvenster ${i+1}`);$('#panes').append(el);}});
  setActive(state.active);
  state.panes.forEach((_, i) => renderPane(i));
}
function renderPane(index) {
  const pane = state.panes[index], el = $(`[data-pane="${index}"]`); if (!el) return;
  if(pane.open&&el.querySelector('iframe'))return;
  const parts = pane.path.split('/').filter(Boolean);
  let crumbs = `<button data-path="" title="Hoofdmap">${icons('home')}</button><span>/</span><button data-path="">Bestanden</button>`;
  parts.forEach((p, i) => crumbs += `<span>/</span><button data-path="${escape(parts.slice(0, i + 1).join('/'))}">${escape(p)}</button>`);
  const items = [...pane.items].sort((a, b) => Number(b.directory) - Number(a.directory) || (pane.sort === 'name' ? a.name.localeCompare(b.name, 'nl', { numeric: true }) : a[pane.sort] - b[pane.sort]) * (pane.descending ? -1 : 1));
  const sortTitle = (key, label) => `<button data-sort="${key}">${label}${pane.sort === key ? pane.descending ? ' ↓' : ' ↑' : ''}</button>`;
  el.innerHTML = `${paneNav()}<div class="pane-toolbar"><button class="icon-button" data-up aria-label="Bovenliggende map" ${!pane.path ? 'disabled' : ''}>${icons('arrow')}</button><div class="breadcrumbs">${crumbs}</div>${state.panes.length === 2 ? `<span class="pane-label">${index === 0 ? 'LINKS' : 'RECHTS'}</span>` : ''}</div><div class="table-wrap"><table><thead><tr><th><input type="checkbox" data-all aria-label="Alles selecteren" ${items.length && pane.selected.size === items.length ? 'checked' : ''}></th><th>${sortTitle('name', pane.query ? 'Search results' : 'Name')}</th><th>${sortTitle('modified', 'Modified')}</th><th>${sortTitle('size', 'Size')}</th><th></th></tr></thead><tbody>${items.map(item => `<tr data-item="${escape(item.path)}" class="${pane.selected.has(item.path) ? 'selected' : ''}"><td><input type="checkbox" data-select aria-label="Selecteer ${escape(item.name)}" ${pane.selected.has(item.path) ? 'checked' : ''}></td><td><button class="file-name" data-open title="${escape(item.name)}"><span class="file-icon ${kind(item)}">${icons(kind(item))}</span><span>${escape(item.name)}${pane.query ? `<span class="file-path">${escape(parent(item.path) || 'Bestanden')}</span>` : ''}</span></button></td><td class="file-meta" title="${escape(new Date(item.modified).toLocaleString())}">${date(item.modified)}</td><td class="file-meta">${item.size===null ? '—' : size(item.size)}</td><td><div class="row-actions">${canWrite()?`<button class="icon-button write" data-share aria-label="Share ${escape(item.name)}" title="Share">${originalIcon('link')}</button>`:''}<button class="icon-button" data-download aria-label="Download ${escape(item.name)}" title="Download">${originalIcon('download')}</button>${canWrite()?`<button class="icon-button write" data-trash aria-label="Delete ${escape(item.name)}" title="Delete">${originalIcon('trash')}</button>`:''}<button class="icon-button" data-menu aria-label="Acties voor ${escape(item.name)}" title="Actions">${originalIcon('menu')}</button></div></td></tr>`).join('')}</tbody></table>${items.length ? '' : `<div class="empty">${originalIcon(pane.query ? 'find' : 'upload-cloud')}<strong>${pane.query ? 'No results' : 'Add files'}</strong><p>${pane.query ? 'Probeer een andere zoekterm.' : 'Deze map is nog leeg.<br>Sleep bestanden hierheen of begin met een nieuwe map.'}</p>${canWrite() && !pane.query ? '<button class="secondary" data-empty-upload>Bestanden uploaden</button>' : ''}</div>`}</div><div class="pane-footer"><span>${items.length} ${items.length === 1 ? 'item' : 'items'}${pane.query ? ` · “${escape(pane.query)}” <button data-clear-search class="text-button">Wis zoekopdracht</button>` : ''}</span><span>${size(items.filter(i => !i.directory).reduce((n, i) => n + i.size, 0))}</span></div>`;
  if(pane.query&&pane.nextOffset!=null) {
    const more=document.createElement('button');more.className='secondary search-more';more.textContent='Meer resultaten';el.querySelector('.table-wrap').append(more);
    on(more,'click',async()=>{
      const requestedPath=pane.path,requestedQuery=pane.query,offset=pane.nextOffset;
      const generation=pane.loadGeneration=(pane.loadGeneration||0)+1;pane.loadingMore=true;
      more.disabled=true;
      try {
        const data=await api(`/search?path=${encodeURIComponent(requestedPath)}&q=${encodeURIComponent(requestedQuery)}&offset=${offset}`);
        if(state.panes[index]!==pane||pane.loadGeneration!==generation||pane.path!==requestedPath||pane.query!==requestedQuery||pane.nextOffset!==offset)return;
        const scroll=el.querySelector('.table-wrap').scrollTop;
        pane.items=[...new Map([...pane.items,...data.items].map(item=>[item.path,item])).values()];
        pane.searchOffset=offset;pane.nextOffset=data.nextOffset;renderPane(index);el.querySelector('.table-wrap').scrollTop=scroll;
      } finally {pane.loadingMore=false;more.disabled=false;}
    });
  }
  if (clipboard && canWrite()) { const paste=document.createElement('button');paste.className='paste-floating';paste.textContent=clipboard.busy?'Plakken…':'Paste here';paste.disabled=!!clipboard.busy;el.append(paste);on(paste,'click',()=>pasteFiles(pane.path)); }
  el.querySelectorAll('[data-tool]').forEach(button=>on(button,'click',async e=>{
    e.preventDefault();setActive(index);
    switch(button.dataset.tool){
      case 'upload':$('#file-input').click();break;
      case 'upload-folder':$('#folder-input').click();break;
      case 'create':await create(false);break;
      case 'mkdir':await create(true);break;
      case 'refresh':await loadPane(index);break;
      case 'split':$('#split').click();break;
      case 'preferences':await showPrefs();break;
      case 'logout':$('#logout').click();break;
      case 'search':el.querySelector('.classic-search').classList.toggle('expanded');el.querySelector('.classic-search input').focus();break;
      case 'about':showDialog('Dirflux', '<p>Zelfstandig herbouwde versie · Dirflux 0.1</p><p>Oorspronkelijk ontwerp en iconen: <a href="https://github.com/silverwind/droppy" target="_blank" rel="noopener">silverwind/droppy</a>.</p><p>Node.js · SQLite · CodeMirror 6</p>');break;
    }
  }));
  if(pane.query){el.querySelector('.classic-search').classList.add('expanded');el.querySelector('.classic-search input').value=pane.query;}
  on(el.querySelector('.classic-search input'),'search',async e=>{pane.query=e.target.value.trim();await loadPane(index);});
  on(el.querySelector('.classic-search input'),'keydown',async e=>{if(e.key==='Escape'){e.preventDefault();await navigate(index,pane.path);}});
  on(el.querySelector('.classic-search'),'submit',async e=>{e.preventDefault();pane.query=el.querySelector('.classic-search input').value.trim();await loadPane(index);});
  el.onpointerdown = () => setActive(index);
  el.querySelectorAll('[data-path]').forEach(b => on(b, 'click', () => navigate(index, b.dataset.path)));
  on(el.querySelector('[data-up]'), 'click', () => navigate(index, parent(pane.path)));
  el.querySelectorAll('[data-sort]').forEach(b => on(b, 'click', () => { pane.descending = pane.sort === b.dataset.sort ? !pane.descending : false; pane.sort = b.dataset.sort; renderPane(index); }));
  on(el.querySelector('[data-all]'), 'change', e => { setActive(index); pane.selected = new Set(e.target.checked ? pane.items.map(i => i.path) : []); renderPane(index); });
  el.querySelectorAll('[data-item]').forEach(row => {
    const item = pane.items.find(i => i.path === row.dataset.item);
    row.draggable=canWrite();
    row.ondragstart=e=>{e.dataTransfer.setData('application/x-droppy-path',JSON.stringify({path:item.path,directory:item.directory,operation:dropOperation(e)}));e.dataTransfer.effectAllowed='copyMove';};
    row.onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey){e.preventDefault();pane.selected.has(item.path)?pane.selected.delete(item.path):pane.selected.add(item.path);renderPane(index);}};
    const shareButton=row.querySelector('[data-share]'),trashButton=row.querySelector('[data-trash]');
    if(shareButton)on(shareButton,'click',()=>share(item));
    if(trashButton)on(trashButton,'click',()=>trashItems([item]));
    on(row.querySelector('[data-download]'),'click',()=>download(item));
    on(row.querySelector('[data-select]'), 'change', e => { setActive(index); e.target.checked ? pane.selected.add(item.path) : pane.selected.delete(item.path); row.classList.toggle('selected', e.target.checked); updateSelection(); });
    on(row.querySelector('[data-open]'), 'click', e => {if(e.ctrlKey||e.metaKey||e.shiftKey)return;return item.directory ? navigate(index, item.path) : openFile(item, index);});
    on(row.querySelector('[data-menu]'), 'click', e => { e.stopPropagation(); setActive(index); showMenu(e.currentTarget, item, index); });
    row.oncontextmenu = e => { e.preventDefault(); setActive(index); showMenu(row.querySelector('[data-menu]'), item, index); };
  });
  const emptyUpload = el.querySelector('[data-empty-upload]'); if (emptyUpload) emptyUpload.closest('.empty').onclick = () => { setActive(index); $('#file-input').click(); };
  const clearSearch = el.querySelector('[data-clear-search]'); if (clearSearch) on(clearSearch, 'click', () => navigate(index, pane.path));
  el.ondragover = e => { if (!canWrite()) return; e.preventDefault(); el.classList.add('drop-target'); };
  el.ondragleave = e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-target'); };
  on(el, 'drop', async e => {
    e.preventDefault(); el.classList.remove('drop-target'); setActive(index); if (!canWrite()) return;
    const internal=e.dataTransfer.getData('application/x-droppy-path');
    if(internal){
      if(pane.open)return openDroppedItem(internal,index);
      const item=readInternalDrop(internal),destination=pane.path,operation=dropOperation(e,item.operation);
      const perform=async operation=>{const body=dropTransfer(item,destination,operation);if(body)await api('/transfer',{method:'POST',body});};
      if(operation){await perform(operation);await refreshAll();return;}
      return formDialog('Verplaatsen, kopiëren of openen', '<label>Bewerking<select name="operation"><option value="move">Verplaatsen</option><option value="copy">Kopiëren</option><option value="open">Openen</option></select></label>', 'Toepassen',async form=>form.get('operation')==='open'?openDroppedItem(internal,index):perform(form.get('operation')),item.name+' → /'+destination);
    }
    const entries = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
    const destination=pane.path;
    const fallback=[...e.dataTransfer.files].map(file=>({file,path:file.name}));
    const {collectUploadEntries}=await import('/upload-entries.js');
    await upload(entries.length?await collectUploadEntries(entries):fallback, destination);
  });
  if(pane.open){
    const frame=document.createElement('iframe');frame.className='file-view';frame.title=pane.open.item.name;
    frame.src='/?viewer=1&path='+encodeURIComponent(pane.open.item.path)+(pane.open.forceText?'&edit=1':'');
    el.querySelector('.table-wrap').replaceChildren(frame);
    const label=document.createElement('button');label.textContent=pane.open.item.name;label.title='Close file';on(label,'click',()=>navigate(index,pane.path));el.querySelector('.breadcrumbs').append(label);
  }
  updateSelection();
}
function showMenu(anchor, item, index) {
  $('.menu')?.remove();
  const menu = document.createElement('div'); menu.className = 'menu'; menu.setAttribute('role', 'menu');
  const actions = [['open', item.directory ? 'Map openen' : 'Bekijken / bewerken'], ['download', item.directory ? 'Download als ZIP' : 'Downloaden']];
  if (!item.directory) actions.push(['edit','Edit']);
  if (canWrite()) actions.push(['share','Share'],['rename','Rename'],['clipboard-copy','Copy'],['clipboard-cut','Cut'],['copy','Kopiëren naar…'],['move','Verplaatsen naar…'],['trash','Delete']);
  menu.innerHTML = actions.map(([key, label]) => `<button role="menuitem" data-action="${key}" class="${key === 'trash' ? 'danger' : ''}">${label}</button>`).join('');
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect(); menu.style.left = Math.max(8, Math.min(rect.right - 190, innerWidth - 205)) + 'px'; menu.style.top = Math.max(8, Math.min(rect.bottom + 5, innerHeight - menu.offsetHeight - 8)) + 'px';
  menu.querySelectorAll('button').forEach(b => on(b, 'click', async () => { menu.remove(); await action(b.dataset.action, item, index); }));
  menu.querySelector('button').focus();
}
function download(item) {
  const link = document.createElement('a'); link.href = '/api/' + (item.directory ? 'zip' : 'file') + '?path=' + encodeURIComponent(item.path) + '&download=1'; link.download = ''; document.body.append(link); link.click(); link.remove();
}
async function action(actionName, item, index) {
  if (actionName==='clipboard-copy' || actionName==='clipboard-cut') { clipboard={items:[item],operation:actionName==='clipboard-copy'?'copy':'move'};renderPanes();return; }
  if (actionName === 'edit') return openFile(item,index,true);
  if (actionName === 'open') return item.directory ? navigate(index, item.path) : openFile(item, index);
  if (actionName === 'download') return download(item);
  if (actionName === 'share') return share(item);
  if (actionName === 'rename') return formDialog('Naam wijzigen', `<label>Nieuwe naam<input name="name" value="${escape(item.name)}" required maxlength="255"></label>`, 'Naam wijzigen', async form => {
    const name = form.get('name'); if (name.includes('/') || name.includes('\\')) throw new Error('Gebruik een naam zonder schuine strepen.');
    await api('/transfer', { method:'POST', body:{ source:item.path, target:join(parent(item.path), name), operation:'move' } }); toast('Naam gewijzigd.');
  });
  if (actionName === 'trash') return trashItems([item]);
  if (['copy','move'].includes(actionName)) return transfer([item], actionName);
}
async function transfer(items, operation) {
  const other = state.panes[state.active === 0 ? 1 : 0];
  let completed=0;
  return formDialog(operation === 'copy' ? 'Bestanden kopiëren' : 'Bestanden verplaatsen', `<label>Doelmap<input name="destination" value="${escape(other?.path || '')}" placeholder="Leeg = hoofdmap"></label>`, operation === 'copy' ? 'Kopiëren' : 'Verplaatsen', async form => {
    const destination=form.get('destination').replace(/^\/+|\/+$/g, '');
    const destinationField=$('#modal-form [name="destination"]');
    try {
      while(completed<items.length){
        const item=items[completed];
        await api('/transfer', { method:'POST', body:{ source:item.path, target:join(destination, item.name), operation, conflict:'rename' } });
        completed++;
        destinationField.readOnly=true;
      }
    }catch(error){throw new Error(`${completed} van ${items.length} verwerkt. Opnieuw proberen verwerkt alleen de resterende bestanden. ${error.message}`);}
    active().selected.clear(); toast(`${items.length} item(s) ${operation === 'copy' ? 'gekopieerd' : 'verplaatst'}.`);
  }, `${items.length} item(s). Voer een bestaande map in, bijvoorbeeld Documenten/Archief. Bij een naamconflict wordt een vrije naam gekozen; beide items blijven bewaard.`);
}
async function pasteFiles(destination) {
  if (!clipboard || !canWrite() || clipboard.busy) return;
  const batch=clipboard,items=[...batch.items],operation=batch.operation;
  let completed=0;
  batch.busy=true;renderPanes();
  try {
    for(const item of items) {
      await api('/transfer',{method:'POST',body:{source:item.path,target:join(destination,item.name),operation,conflict:'rename'}});
      completed++;
    }
    if(clipboard===batch&&operation==='move')clipboard=null;
    toast('Files pasted.');
  } finally {
    batch.busy=false;
    // Retrying a partial operation must not repeat already completed transfers.
    // Never clear or alter a newer clipboard selection made during this batch.
    if(clipboard===batch&&completed<items.length)batch.items=items.slice(completed);
    renderPanes();await refreshAll();
  }
}
async function openPdf(item) {
  showDialog(item.name,'<div class="pdf-scroll"><canvas id="pdf-canvas" aria-label="PDF page"></canvas></div><div class="preview-controls"><button class="secondary" id="pdf-prev">←</button><span class="pdf-info" id="pdf-info">Loading PDF…</span><button class="secondary" id="pdf-next">→</button><button class="secondary" id="pdf-out">−</button><button class="secondary" id="pdf-in">+</button><button class="secondary" id="pdf-download">Download</button></div>','preview-dialog');
  const controller=new AbortController(),canvas=$('#pdf-canvas'),info=$('#pdf-info'),previous=$('#pdf-prev'),next=$('#pdf-next'),zoomIn=$('#pdf-in'),zoomOut=$('#pdf-out'),downloadButton=$('#pdf-download');
  closeHook=()=>{controller.abort();return true;};
  const extras=await import('/vendor/extras.js');
  if(controller.signal.aborted||!canvas.isConnected)return;
  const viewer=await extras.pdf('/api/pdf?path='+encodeURIComponent(item.path),canvas,({page,total,scale})=>{if(controller.signal.aborted||!canvas.isConnected)return;info.textContent=`${page} / ${total} · ${Math.round(scale*100)}%`;previous.disabled=page===1;next.disabled=page===total;},controller.signal);
  if(!viewer||controller.signal.aborted||!canvas.isConnected){viewer?.destroy();return;}
  on(previous,'click',viewer.previous);on(next,'click',viewer.next);on(zoomIn,'click',()=>viewer.zoom(1.2));on(zoomOut,'click',()=>viewer.zoom(1/1.2));downloadButton.onclick=()=>download(item);
}
function playAudio(item,index) {
  audioItems=state.panes[index].items.filter(isAudio);audioIndex=audioItems.findIndex(i=>i.path===item.path);
  let bar=$('#audio-bar');
  if(!bar){bar=document.createElement('div');bar.id='audio-bar';bar.className='audio-bar';bar.innerHTML='<button id="audio-prev" aria-label="Previous track">◀</button><button id="audio-next" aria-label="Next track">▶</button><button id="audio-shuffle" aria-label="Shuffle" aria-pressed="false">⤨</button><span id="audio-title"></span><audio id="audio-player" controls></audio><button id="audio-stop" aria-label="Stop">×</button>';document.body.append(bar);}
  $('#shell').classList.add('has-audio');
  const player=$('#audio-player');
  const recovery=audioFailureRecovery(audioItems.length);let generation=0,stopped=false;
  function start(){const track=audioItems[audioIndex],request=++generation;$('#audio-title').textContent=track.name;player.src='/api/file?path='+encodeURIComponent(track.path);player.play().catch(error=>{if(!stopped&&request===generation&&error.name==='NotAllowedError')toast('Druk op afspelen om de audio te starten.');});}
  function next(delta){audioIndex=nextTrack(audioIndex,audioItems.length,delta,$('#audio-shuffle').classList.contains('toggle-active'));start();}
  $('#audio-prev').onclick=()=>next(-1);$('#audio-next').onclick=()=>next(1);$('#audio-shuffle').onclick=e=>{const enabled=e.currentTarget.classList.toggle('toggle-active');e.currentTarget.setAttribute('aria-pressed',String(enabled));};
  player.onended=()=>next(1);
  player.onplaying=()=>recovery.reset();
  player.onerror=()=>{
    if(stopped||!player.error)return;
    const following=recovery.fail(audioIndex);
    if(following===null){player.pause();toast('Geen van de nummers kan worden afgespeeld.',true);return;}
    toast('Dit nummer kan niet worden afgespeeld. Het volgende wordt geprobeerd.',true);
    audioIndex=following;start();
  };
  stopAudio=()=>{stopped=true;generation++;player.onended=player.onplaying=player.onerror=null;player.pause();player.removeAttribute('src');player.load();bar.remove();$('#shell').classList.remove('has-audio');audioItems=[];audioIndex=0;stopAudio=()=>{};};
  $('#audio-stop').onclick=()=>stopAudio();start();
}
async function trashItems(items) {
  return formDialog('Naar de prullenbak', '', 'Verplaatsen naar prullenbak', async () => {
    for (const item of items) await api('/trash', { method:'POST', body:{ path:item.path } });
    active().selected.clear(); toast('Verplaatst. Je kunt de bestanden herstellen via de prullenbak.');
  }, `${items.map(i => i.name).join(', ')}. Deze bestanden blijven beschikbaar in de prullenbak.`);
}
async function create(directory) {
  const destination = active().path;
  return formDialog(directory ? 'Nieuwe map' : 'Nieuw tekstbestand', `<label>Naam<input name="name" placeholder="${directory ? 'Naam van de map' : 'notities.txt'}" required maxlength="255"></label>`, 'Aanmaken', async form => {
    const name = form.get('name'); if (name.includes('/') || name.includes('\\')) throw new Error('Gebruik een naam zonder schuine strepen.');
    await api('/create', { method:'POST', body:{ path:join(destination,name), directory } }); toast(directory ? 'Map aangemaakt.' : 'Bestand aangemaakt.');
  });
}
function syncVideoControls() {
  for(const setting of ['loop','autonext']) {
    const button=$('#video-'+setting);
    if(button){button.setAttribute('aria-pressed',String(prefs[setting]));button.classList.toggle('toggle-active',prefs[setting]);}
  }
}
async function openFile(item, index, forceText=false) {
  if(!viewerMode && !isAudio(item)) {
    const pane=state.panes[index];pane.open={item,forceText};renderPane(index);recordLocation();return;
  }
  const url = '/api/file?path=' + encodeURIComponent(item.path);
  if (!forceText && isAudio(item)) return playAudio(item,index);
  if (!forceText && /\.pdf$/i.test(item.name)) return openPdf(item);
  if (!forceText && ['image','media'].includes(kind(item))) {
    const type = isImage(item) ? 'image' : 'video';
    showDialog(item.name, `${type === 'image' ? `<div class="image-viewport" tabindex="0" aria-label="Afbeelding verschuiven"><img class="preview-image" src="${url}" alt="${escape(item.name)}" draggable="false"></div>` : `<${type} class="preview-${type}" src="${url}" controls></${type}>`}<div class="preview-controls"><button class="secondary" id="preview-prev">← Vorige</button><button class="secondary" id="preview-download">Download</button><button class="secondary" id="preview-zoom">Zoom</button><button class="secondary" id="fullscreen">Vergroten</button><button class="secondary" id="preview-next">Volgende →</button></div>`, 'preview-dialog');
    const peers = state.panes[index].items.filter(i => type === 'video' ? isVideo(i) : kind(i) === 'image'); const at = peers.findIndex(i => i.path === item.path);
    $('#preview-prev').disabled = at <= 0; $('#preview-next').disabled = at >= peers.length - 1;
    on($('#preview-prev'), 'click', () => openFile(peers[at-1], index)); on($('#preview-next'), 'click', () => openFile(peers[at+1], index)); $('#preview-download').onclick = () => download(item);
    $('#fullscreen').onclick = () => (viewerMode?window.parent.postMessage({type:'droppy-fullscreen'},location.origin):$('#dialog').classList.toggle('fullscreen-dialog'));
    currentMedia={previous:()=>{if(at>0)openFile(peers[at-1],index);},next:()=>{if(at<peers.length-1)openFile(peers[at+1],index);}};
    if(type==='image') {
      $('#preview-zoom').remove();
      const controls=$('.preview-controls');
      for(const [id,label] of [['in','Inzoomen'],['out','Uitzoomen'],['fit','Passend'],['width','Breedte'],['height','Hoogte']]) {
        const button=document.createElement('button');button.className='secondary';button.id='image-'+id;button.textContent=label;
        button.onclick=()=>{if(id==='in'||id==='out')imageViewer.zoom(id==='in'?1.5:1/1.5);else imageViewer.select(id);};controls.append(button);
      }
      const status=document.createElement('output');status.id='image-scale';status.setAttribute('aria-label','Zoomniveau');controls.append(status);
      imageViewer=bindImageViewer($('.preview-image'),$('.image-viewport'),{
        initialMode:imageFitMode,
        change:({scale,mode})=>{status.textContent=Math.round(scale*100)+'%';imageFitMode=['width','height'].includes(mode)?mode:'fit';for(const key of ['fit','width','height'])$('#image-'+key).setAttribute('aria-pressed',String(mode===key));},
        error:()=>toast('Je browser kan deze afbeelding niet weergeven.',true),
      });
    } else $('#preview-zoom').hidden=true;
    if(type==='video') {
      const controls=$('.preview-controls');
      for(const [setting,label] of [['loop','Video herhalen'],['autonext','Automatisch volgende video']]) {
        const button=document.createElement('button');button.className='secondary';button.id='video-'+setting;button.textContent=label;
        button.onclick=()=>{prefs[setting]=!prefs[setting];localStorage.setItem('droppy-next-prefs',JSON.stringify(prefs));syncVideoControls();};controls.append(button);
      }
      syncVideoControls();
      videoPlayback=bindVideoPlayback($('.preview-video'),{
        preferences:()=>prefs,next:()=>currentMedia?.next(),
        error:()=>toast('Je browser kan deze video niet afspelen.',true),
        playRejected:()=>toast('Druk op afspelen om de video te starten.'),
      });
      if(!matchMedia('(pointer: coarse)').matches)videoPlayback.play();
    }
    const surface=$('.preview-image')||$('.preview-video');let touchStart;
    surface.addEventListener('touchstart',e=>touchStart=e.touches[0].clientX,{passive:true});surface.addEventListener('touchend',e=>{const delta=e.changedTouches[0].clientX-touchStart;if((!imageViewer||imageViewer.canSwipe())&&Math.abs(delta)>60)(delta<0?currentMedia.next:currentMedia.previous)();},{passive:true});
    if(viewerMode)window.parent.postMessage({type:'droppy-media-location',path:item.path},location.origin);
    return;
  }
  showDialog(item.name,'<p id="text-loading" role="status">Tekst laden…</p>','editor-dialog');
  const loading=$('#text-loading'),controller=new AbortController();
  textReadController=controller;
  closeHook=()=>{controller.abort();return true;};
  let data;
  try { data = await api('/text?path=' + encodeURIComponent(item.path),{signal:controller.signal}); }
  catch (error) {
    if(controller.signal.aborted||!loading.isConnected)return;
    if(!state.user){await closeDialog();return;}
    showDialog(item.name, `<p>${escape(error.message)}</p><p>Je kunt dit bestand downloaden en in de bijbehorende toepassing openen.</p><button class="primary" id="file-download">Downloaden</button>`);
    $('#file-download').onclick = () => download(item); return;
  } finally {
    if(textReadController===controller)textReadController=null;
  }
  if(controller.signal.aborted||!loading.isConnected)return;
  if(!state.user){await closeDialog();return;}
  showDialog(item.name, `<div class="editor-toolbar"><button id="save" class="write">Save</button><button id="editor-download">DL</button><button id="wrap">Wrap</button><select id="syntax" aria-label="Syntax"></select><button id="editor-find">Find</button><button id="fullscreen">Full</button><span id="editor-status">UTF-8</span></div><div id="editor-host" class="editor-host" aria-label="Bestandsinhoud"></div>`, 'editor-dialog');
  const host=$('#editor-host'),saveButton=$('#save'),status=$('#editor-status');
  const extras=await import('/vendor/extras.js');
  if(!host.isConnected)return;
  let save;
  const ownedEditor=await extras.editor(host,data.text,item.name,prefs,!canWrite(),()=>{state.dirty=true;if(state.user)status.textContent='Unsaved changes';},()=>save?.().catch(e=>toast(e.message,true)));
  if(!host.isConnected){ownedEditor.destroy();return;}
  editorInstance=ownedEditor;
  save=createEditorSave({version:data.version,getText:()=>ownedEditor.getText(),
    write:(text,version)=>api('/text',{method:'POST',body:{path:item.path,text,version}}),
    isActive:()=>editorInstance===ownedEditor&&host.isConnected,canSave:canWrite,
    onBusy:busy=>{saveButton.disabled=busy||!canWrite();},
    onSaved:async({dirty})=>{state.dirty=dirty;status.textContent=dirty?'Unsaved changes':'Saved · '+new Date().toLocaleTimeString('nl-NL');await refreshAll();}
  });
  $('#syntax').innerHTML=['Plain text',...extras.modes].map(mode=>`<option>${escape(mode)}</option>`).join('');$('#syntax').value=editorInstance.modeName;
  on($('#syntax'),'change',e=>editorInstance.mode(e.target.value));on($('#save'),'click',save);
  $('#editor-find').onclick=()=>editorInstance.find();$('#editor-download').onclick=()=>downloadText(editorInstance.getText(),item.name);
    $('#wrap').onclick=()=>{prefs.lineWrapping=!prefs.lineWrapping;editorInstance.wrap(prefs.lineWrapping);localStorage.setItem('droppy-next-prefs',JSON.stringify(prefs));};
  $('#fullscreen').onclick=()=>(viewerMode?window.parent.postMessage({type:'droppy-fullscreen'},location.origin):$('#dialog').classList.toggle('fullscreen-dialog'));
  closeHook=confirmDiscardChanges;
  editorInstance.focus();
}
async function share(item) {
  showDialog('Downloadlink maken', `<p>Iedereen met deze link kan <strong>${escape(item.name)}</strong> downloaden, zonder account. De link werkt zolang je server bereikbaar is.</p><form id="share-form" class="dialog-form"><label>Geldigheid<select id="share-hours"><option value="0">Geen vervaldatum</option><option value="24">24 uur</option><option value="168">7 dagen</option><option value="720">30 dagen</option></select></label><button class="primary" type="submit">Link maken</button></form><div id="share-result"></div>`);
  on($('#share-form'), 'submit', async e => {
    e.preventDefault(); e.submitter.disabled = true;
    try {
      const result = await api('/shares', { method:'POST', body:{ path:item.path, hours:Number($('#share-hours').value) } });
      $('#share-form').hidden = true;
      $('#share-result').innerHTML = `<label>Downloadlink<input class="share-url" id="share-url" readonly></label><div class="dialog-actions"><button class="primary" id="copy-link">Kopieer link</button></div>`;
      $('#share-url').value = location.origin + result.url + (prefs.sharelinkDownload ? '' : '?download=0');
      on($('#copy-link'), 'click', () => copyLink($('#share-url').value));
    } catch (error) { e.submitter.disabled = false; throw error; }
  });
}
async function copyLink(url) {
  try { await navigator.clipboard.writeText(url); toast('Link gekopieerd.'); }
  catch { const input = $('#share-url'); if (input) { input.focus(); input.select(); } toast('Selecteer de link en druk op Ctrl+C.'); }
}
async function showShares() {
  const { items } = await api('/shares');
  showDialog('Gedeelde links', `<p>Links geven downloadtoegang zonder account. Je kunt ze op elk moment intrekken.</p><div class="detail-list">${items.length ? items.map(i => `<div class="detail-item"><div><strong>${escape(i.path)}</strong><small>${!i.expires?'Geen vervaldatum':(i.expires > Date.now() ? 'Geldig tot ' : 'Verlopen op ')+date(i.expires)}</small><input class="share-url" value="${escape(location.origin + i.url)}" readonly aria-label="Downloadlink"></div><button data-revoke="${i.id}" class="danger">Intrekken</button></div>`).join('') : '<p>Je hebt nog geen downloadlinks gemaakt.</p>'}</div>`);
  $$('[data-revoke]').forEach(b => on(b, 'click', async () => { await api('/shares/' + b.dataset.revoke, { method:'DELETE' }); await showShares(); toast('Link ingetrokken.'); }));
}
async function showTrash() {
  const { items } = await api('/trash');
  showDialog('Prullenbak', `<p>Herstel bestanden of verwijder ze definitief om schijfruimte vrij te maken.</p><div class="detail-list">${items.length ? items.map(i => `<div class="detail-item">${icons('trash')}<div><strong>${escape(i.path)}</strong><small>Verwijderd op ${date(i.deleted)}</small></div><button class="secondary write" data-restore="${i.id}">Herstellen</button><button class="danger write" data-purge="${i.id}">Definitief verwijderen</button></div>`).join('') : '<p>De prullenbak is leeg.</p>'}</div>`);
  $$('[data-restore]').forEach(b => on(b, 'click', async () => { await api('/restore', { method:'POST', body:{ id:b.dataset.restore } }); await showTrash(); await refreshAll(); toast('Bestand hersteld.'); }));
  $$('[data-purge]').forEach(b => on(b,'click',() => {
    const item=items.find(i=>i.id===b.dataset.purge);
    return formDialog('Definitief verwijderen','', 'Definitief verwijderen',async()=>{
      await api('/trash/'+item.id,{method:'DELETE'});toast('Definitief verwijderd.');
    },`${item.path} wordt permanent verwijderd. Dit kan niet ongedaan worden gemaakt.`);
  }));
}
async function showUsers() {
  const { items } = await api('/users');
  const roles = { admin:'Beheerder', editor:'Bewerken', viewer:'Alleen lezen' };
  showDialog('Gebruikers', `<p>Alle gebruikers zien dezelfde bestandenmap. Lezers kunnen alleen bekijken en downloaden.</p><div class="detail-list">${items.map(i => `<div class="detail-item">${icons('user')}<div><strong>${escape(i.name)}</strong><small>${roles[i.role]}</small></div>${i.id !== state.user.id ? `<button data-edit-user="${i.id}" class="secondary">Wijzigen</button><button data-delete-user="${i.id}" class="danger">Verwijderen</button>` : '<small>Jij</small>'}</div>`).join('')}</div><div class="dialog-actions"><button id="add-user" class="primary">Gebruiker toevoegen</button></div>`);
  $$('[data-edit-user]').forEach(button => on(button,'click',() => {
    const user=items.find(i=>i.id===button.dataset.editUser);
    return formDialog('Gebruiker wijzigen', `<label>Rol<select name="role">${Object.entries(roles).map(([value,label])=>`<option value="${value}" ${user.role===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Nieuw wachtwoord (optioneel)<input name="password" type="password" minlength="12" maxlength="1024" autocomplete="new-password" placeholder="Leeg laten om te behouden"></label>`, 'Opslaan',async form=>{
      const body={role:form.get('role')};if(form.get('password'))body.password=form.get('password');
      await api('/users/'+user.id,{method:'PUT',body});toast('Gebruiker bijgewerkt.');
    },`${user.name}: een gewijzigde rol of een nieuw wachtwoord meldt deze gebruiker op alle apparaten af. Bestaande deellinks blijven geldig totdat je ze intrekt.`);
  }));
  $$('[data-delete-user]').forEach(b => on(b, 'click', async () => {
    const user = items.find(i => i.id === b.dataset.deleteUser);
    await formDialog('Gebruiker verwijderen', '', 'Gebruiker verwijderen', async () => {
      await api('/users/' + user.id, { method:'DELETE' }); toast('Gebruiker verwijderd.');
    }, `${user.name} verliest toegang. De sessies en downloadlinks van deze gebruiker worden ingetrokken. Bestanden blijven behouden.`);
  }));
  on($('#add-user'), 'click', () => formDialog('Gebruiker toevoegen', '<label>Gebruikersnaam<input name="name" required maxlength="64" autocomplete="off"></label><label>Wachtwoord<input name="password" type="password" required minlength="12" maxlength="1024" autocomplete="new-password"></label><label>Rol<select name="role"><option value="editor">Bewerken</option><option value="viewer">Alleen lezen</option><option value="admin">Beheerder</option></select></label>', 'Gebruiker toevoegen', async form => { await api('/users', { method:'POST', body:Object.fromEntries(form) }); toast('Gebruiker toegevoegd.'); }));
}
function chooseUploadConflict(name, directory, job) {
  const result=uploadConflictQueue.then(async()=>{
    const dialog=$('#dialog');
    while(dialog.open)await new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));
    if(job.cancelled)return 'skip';
    return new Promise(resolve => {
    showDialog('Deze naam bestaat al', `<p>${escape(name)}</p><p>${directory ? 'Er bestaat al een map met deze naam.' : 'Wil je het bestaande bestand vervangen of beide versies bewaren?'}</p><div class="dialog-actions"><button data-conflict="skip" class="secondary">Overslaan</button><button data-conflict="rename" class="primary">Beide bewaren</button>${directory ? '' : '<button data-conflict="replace" class="danger">Vervangen</button>'}</div>`);
    let choice='skip';
    job.closeConflict=()=>closeDialog();
    dialog.addEventListener('close', () => {job.closeConflict=null;resolve(choice);}, {once:true});
    $$('[data-conflict]').forEach(button => on(button,'click',() => {
      choice = button.dataset.conflict;
      closeDialog();
    }));
    });
  });
  uploadConflictQueue=result.catch(()=>{});
  return result;
}
async function upload(files, destination) {
  if (!files.length || !canWrite()) return;
  const job={cancelled:false,xhr:null,closeConflict:null};
  const card=document.createElement('article');card.className='upload-job';card.setAttribute('aria-label','Upload naar /'+destination);
  card.innerHTML='<div><strong></strong><button class="text-button">Annuleren</button></div><small class="upload-destination"></small><progress max="100" value="0"></progress><small class="upload-detail"></small>';
  const title=card.querySelector('strong'),detail=card.querySelector('.upload-detail'),progress=card.querySelector('progress'),cancel=card.querySelector('button');
  card.querySelector('.upload-destination').textContent='Naar /'+destination;
  job.cancel=()=>{job.cancelled=true;job.xhr?.abort();job.closeConflict?.();cancel.disabled=true;};
  cancel.onclick=job.cancel;
  uploadJobs.add(job);state.uploading=true;$('#uploads').append(card);$('#uploads').hidden=false;
  const errors = []; let completed = 0;
  try {
  for (let i = 0; i < files.length && !job.cancelled; i++) {
    const { file, path, directory } = files[i];
    title.textContent = `Upload ${i+1} van ${files.length}`; detail.textContent = path; progress.value = 0;
    try {
      const target = join(destination,path);
      const existing = await api('/upload-target?path=' + encodeURIComponent(target));
      if(job.cancelled)break;
      if(directory) {
        if(existing.exists&&!existing.directory)throw new Error('Een bestand blokkeert deze map. Hernoem het bestand of de uploadmap.');
        if(!existing.exists)await api('/create',{method:'POST',body:{path:target,directory:true}});
        completed++;continue;
      }
      const conflict = existing.exists ? await chooseUploadConflict(path,existing.directory,job) : 'reject';
      if (conflict === 'skip' || job.cancelled) continue;
      const query = new URLSearchParams({path:target,conflict});
      if (conflict === 'replace') query.set('version',existing.version);
      await new Promise((resolve, reject) => {
        const xhr = job.xhr = new XMLHttpRequest(); xhr.open('PUT', '/api/upload?' + query); xhr.setRequestHeader('X-CSRF-Token', state.csrf); xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.upload.onprogress = e => { if (e.lengthComputable) progress.value = e.loaded / e.total * 100; };
        xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else { let message = 'Upload mislukt.'; try { message = JSON.parse(xhr.responseText).error; } catch {} reject(new Error(message)); } };
        xhr.onerror = () => reject(new Error('Verbinding verbroken.')); xhr.onabort = () => reject(new Error('Geannuleerd.')); xhr.send(file);
      }); completed++;
    } catch (error) { if(!job.cancelled)errors.push(path + ': ' + error.message); }
  }
  } finally {
    uploadJobs.delete(job);state.uploading=uploadJobs.size>0;job.xhr=null;
    if(errors.length) {
      title.textContent='Upload deels mislukt';detail.textContent=errors.join('\n');cancel.disabled=false;cancel.textContent='Sluiten';
      cancel.onclick=()=>{card.remove();$('#uploads').hidden=!$('#uploads').childElementCount;};
    } else card.remove();
    $('#uploads').hidden=!$('#uploads').childElementCount;
  }
  await refreshAll();
  toast(`${completed} van ${files.length} bestand(en)/map(pen) verwerkt.${job.cancelled ? ' Upload geannuleerd.' : ''}`, errors.length > 0);
}
function startLiveEvents() {
  if(!viewerMode&&state.user&&!eventSource){eventSource=new EventSource('/api/events');eventSource.addEventListener('change',()=>{if(!$('#dialog').open&&!state.uploading)refreshAll(true);});}
}
async function init() {
  const session = await api('/session'+(viewParameters.get('login')==='1'?'?login=1':'')); Object.assign(state, session);
  $('#auth').hidden = !!state.user; $('#shell').hidden = !state.user;
  document.body.classList.toggle('read-only', !canWrite());
  if (!state.user) {
    stopAudio(); clipboard=null;
    for(const job of uploadJobs)job.cancel();
    eventSource?.close();eventSource=null;
    if(!$('.auth-bottom')) {const bottom=document.createElement('div');bottom.className='auth-bottom';bottom.innerHTML='<input type="checkbox" id="remember-me" checked aria-label="Remember Me"><span>Remember Me</span>';$('#login-form').append(bottom);}
    if(!$('#setup-code-label')) {
      const label=document.createElement('label');label.id='setup-code-label';
      label.innerHTML='Installatiecode<input id="setup-code" type="password" autocomplete="off" placeholder="Code uit CONFIG_DIR/setup-token"><small>Lees het bestand setup-token in je configuratiemap.</small>';
      $('#login-button').before(label);
    }
    $('#setup-code-label').hidden=!state.setup;$('#setup-code').required=!!state.setup;
    $('#username').placeholder='Username';$('#password').placeholder='Password';
    $('#auth-title').textContent = state.setup ? 'Maak het jouw plek' : 'Welkom terug';
    $('#auth-description').textContent = state.setup ? 'Maak je eerste beheerdersaccount aan om te beginnen.' : 'Log in om je bestanden te openen.';
    $('#login-button').innerHTML = `${state.setup ? 'Create account' : 'Sign in'} <span>→</span>`;
    $('#password').minLength = state.setup ? 12 : 1; $('#password').autocomplete = state.setup ? 'new-password' : 'current-password';
    $('#auth-footnote').textContent = state.setup ? 'Gebruik een wachtwoord van minstens 12 tekens.' : 'Alleen toegankelijk met jouw account.';
    return;
  }
  $('#account-name').textContent = state.user.name; $('#avatar').textContent = state.user.name[0].toUpperCase();
  $('#account-settings').hidden=!!state.user.guest;
  $('#account-role').textContent = { admin:'Beheerder', editor:'Bewerken', viewer:'Alleen lezen' }[state.user.role];
  $('#nav-users').hidden = state.user.role !== 'admin';
  if(!viewerMode&&location.hash)await restoreLocation();
  if(viewerMode)state.panes[0].path=parent(viewParameters.get('path')||'');
  renderPanes(); await refreshAll();
  if(viewerMode){const item=state.panes[0].items.find(i=>i.path===viewParameters.get('path'));if(item)await openFile(item,0,viewParameters.get('edit')==='1');else showDialog('Not found','<p>Dit bestand bestaat niet meer.</p>');}
  startLiveEvents();
}
on($('#login-form'), 'submit', async e => {
  e.preventDefault(); $('#login-button').disabled = true; $('#auth-error').textContent = '';
  try { await api(state.setup ? '/setup' : '/login', { method:'POST', body:{ name:$('#username').value, password:$('#password').value, setupToken:state.setup?$('#setup-code').value:undefined, remember:$('#remember-me')?.checked !== false } }); $('#password').value = ''; if($('#setup-code'))$('#setup-code').value=''; await init(); }
  catch (error) { $('#auth-error').textContent = error.message; }
  finally { $('#login-button').disabled = false; }
});
on($('#logout'), 'click', () => changeView(async () => { if(!await confirmCloseFrames())return; const wasGuest=state.user?.guest; for(const pane of $$('.pane.is-fullscreen'))await leavePaneFullscreen(pane); await api('/logout', { method:'POST' }); stopAudio(); clipboard=null; $('#panes').replaceChildren(); if(wasGuest){location.href='/?login=1';return;} state.user = null; state.panes = [{ path:'', items:[], selected:new Set(), sort:'name' }]; state.active = 0; await init(); }));
on($('#refresh'), 'click', () => refreshAll());
on($('#new-folder'), 'click', () => create(true)); on($('#new-file'), 'click', () => create(false));
$('#upload-button').onclick = () => $('#file-input').click(); $('#upload-folder').onclick = () => $('#folder-input').click();
for (const id of ['#file-input','#folder-input']) {
  on($(id),'click',e=>{e.target.dataset.destination=active().path;});
  on($(id), 'change', async e => { const files = [...e.target.files].map(file => ({ file, path:file.webkitRelativePath || file.name })); const destination=e.target.dataset.destination??active().path; e.target.value = ''; await upload(files, destination); });
}
on($('#split'), 'click', () => changeView(async () => {
  if (state.panes.length === 2) {const frame=$('[data-pane="1"] iframe');if(frame&&await frame.contentWindow.confirmCloseView?.()===false)return;state.panes = [state.panes[0]]; state.active = 0; }
  else state.panes.push({ path:active().path, items:[], selected:new Set(), sort:'name' });
  $('#split').setAttribute('aria-pressed', String(state.panes.length === 2)); renderPanes(); await refreshAll();recordLocation();
  startLiveEvents();
}));
on($('#search-form'), 'submit', async e => { e.preventDefault(); const q = $('#search').value.trim(); active().query = q; active().selected.clear(); await loadPane(state.active); });
on($('#search'), 'search', async () => { if (!$('#search').value) { active().query = ''; await loadPane(state.active); } });
$$('[data-batch]').forEach(button => on(button, 'click', async () => {
  const items = active().items.filter(i => active().selected.has(i.path));
  switch (button.dataset.batch) {
    case 'clear': active().selected.clear(); renderPane(state.active); break;
    case 'trash': await trashItems(items); break;
    case 'copy': case 'move': await transfer(items, button.dataset.batch); break;
    case 'download': for (const item of items) download(item); break;
  }
}));
on($('#nav-files'), 'click', () => navigate(state.active, ''));
on($('#nav-shares'), 'click', showShares); on($('#nav-trash'), 'click', showTrash); on($('#nav-users'), 'click', showUsers);
on($('#account-settings'), 'click', () => formDialog('Wachtwoord wijzigen', '<label>Huidig wachtwoord<input name="currentPassword" type="password" required autocomplete="current-password"></label><label>Nieuw wachtwoord<input name="password" type="password" required minlength="12" maxlength="1024" autocomplete="new-password"></label>', 'Wachtwoord wijzigen', async form => {
  const session = await api('/password', { method:'POST', body:Object.fromEntries(form) }); Object.assign(state, session); toast('Wachtwoord gewijzigd. Andere sessies zijn afgemeld.');
}, `Account: ${state.user.name}. Je andere sessies worden afgemeld na het wijzigen.`));
$('#dialog-close').onclick = closeDialog;
$('#dialog').addEventListener('cancel', e => { e.preventDefault(); closeDialog(); });
document.addEventListener('click', e => { if (!e.target.closest('.menu')) $('.menu')?.remove(); });
on(document,'keydown',async e=>{
  if(e.defaultPrevented)return;
  if(e.key==='Escape')$('.menu')?.remove();
  if(e.target.closest('input,textarea,select,[contenteditable]'))return;
  if(currentMedia){
    const action=galleryShortcut(e,{
      nativeControl:Boolean(e.target.closest('audio,video,[role="slider"]')),
      activationControl:Boolean(e.target.closest('button,a[href],summary,[role="button"]')),
      overflowingImage:Boolean(imageViewer&&!imageViewer.canSwipe()&&e.target.closest('.image-viewport'))
    });
    if(action){e.preventDefault();if(action==='next')currentMedia.next();else if(action==='previous')currentMedia.previous();else $('#fullscreen')?.click();}
    return;
  }
  if($('#dialog').open||!state.user)return;
  const shortcut=fileShortcut(e,{selected:active().selected.size>0,clipboard:Boolean(clipboard),textSelected:Boolean(window.getSelection()?.toString()),writable:canWrite()});
  if(shortcut==='copy'||shortcut==='move'){e.preventDefault();clipboard={items:active().items.filter(i=>active().selected.has(i.path)),operation:shortcut};renderPanes();}
  if(shortcut==='paste'){e.preventDefault();await pasteFiles(active().path);}
  if(e.key==='Backspace'){e.preventDefault();await navigate(state.active,parent(active().path));}
});
window.addEventListener('beforeunload', e => { if (state.dirty || state.uploading || $$('.file-view').some(frame=>frame.contentWindow.hasUnsavedChanges?.())) { e.preventDefault(); e.returnValue = ''; } });
for(const [event,operation] of [['copy','copy'],['cut','move']])on(document,event,e=>{
  if(e.defaultPrevented||!state.user||$('#dialog').open||e.target.closest('input,textarea,select,[contenteditable]')||window.getSelection()?.toString())return;
  const items=active().items.filter(item=>active().selected.has(item.path));
  if(!items.length||(operation==='move'&&!canWrite()))return;
  e.preventDefault();
  e.clipboardData?.setData('text/plain',items.map(item=>item.path).join('\n'));
  clipboard={items,operation};renderPanes();
});
on(document, 'paste', async e => {
  if (e.defaultPrevented || !state.user || !canWrite() || e.target.closest('input,textarea,select,[contenteditable]') || $('#dialog').open) return;
  if(clipboard){e.preventDefault();return pasteFiles(active().path);}
  const files = [...e.clipboardData.files];
  if (files.length) { e.preventDefault(); await upload(files.map(file => ({ file, path:`geplakt-${Date.now()}-${file.name}` })), active().path); }
  else {
    const text = e.clipboardData.getData('text/plain');
    if (text) await formDialog('Tekst opslaan als bestand', '<label>Bestandsnaam<input name="name" value="geplakte-tekst.txt" required></label>', 'Opslaan', async form => { const file = new File([text], form.get('name'), { type:'text/plain' }); await upload([{ file, path:file.name }], active().path); });
  }
});
if(viewerMode){
  document.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('application/x-droppy-path'))e.preventDefault();});
  document.addEventListener('drop',e=>{
    const raw=e.dataTransfer.getData('application/x-droppy-path');
    if(!raw)return;
    e.preventDefault();e.stopPropagation();
    window.parent.postMessage({type:'droppy-drop-open',raw},location.origin);
  });
}
window.addEventListener('message',async e=>{
  if(e.origin!==location.origin||!['droppy-close','droppy-fullscreen','droppy-drop-open','droppy-media-location'].includes(e.data?.type))return;
  const index=state.panes.findIndex((p,i)=>$(`[data-pane="${i}"] iframe`)?.contentWindow===e.source);
  if(index<0)return;
  try {
    if(e.data.type==='droppy-media-location'){
      const pane=state.panes[index];
      const item=pane.items.find(item=>item.path===e.data.path&&!item.directory&&(kind(item)==='image'||isVideo(item)));
      if(!pane.open||pane.open.forceText||!item||pane.open.item.path===item.path)return;
      pane.open.item=item;
      const element=$(`[data-pane="${index}"]`);element.querySelector('iframe').title=item.name;
      const label=element.querySelector('.breadcrumbs button[title="Close file"]');if(label)label.textContent=item.name;
      recordLocation(true);return;
    }
    if(e.data.type==='droppy-drop-open'){await openDroppedItem(e.data.raw,index);return;}
    if(e.data.type==='droppy-fullscreen'){await togglePaneFullscreen(index);return;}
    await leavePaneFullscreen($(`[data-pane="${index}"]`));
    $(`[data-pane="${index}"] iframe`)?.remove();state.panes[index].open=null;
    renderPane(index);await refreshAll(true);recordLocation();
  } catch(error){toast(error.message,true);}
});
setInterval(() => { if (!viewerMode && state.user && !document.hidden && !$('#dialog').open && !$('.menu') && !state.uploading) refreshAll(true); }, 15000);
window.addEventListener('popstate',()=>restoreLocation(true).catch(e=>toast(e.message,true)));
init().catch(error => {
  $('#auth').hidden=false;$('#shell').hidden=true;$('#auth-error').textContent=error.message;
  const link=document.createElement('a');link.href='/?login=1';link.className='secondary';link.textContent='Aanmelden of server instellen';$('#auth-error').after(link);
});
