import {createAttemptLimiter} from './lib/rate-limit.js';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';
import { createMoveJournal } from './lib/moves.js';
import { createTrashJournal } from './lib/trash.js';
import { sendOpenedFile } from './lib/download.js';
import picomatch from 'picomatch';
import {createServer} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {createSecureContext} from 'node:tls';
import {readLimitedHandle,readLimitedFile} from './lib/read-limited.js';

const scrypt = promisify(crypto.scrypt);
const here = path.dirname(fileURLToPath(import.meta.url));
const token = () => crypto.randomBytes(32).toString('base64url');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const day = 86400000;

export async function createApp(options = {}) {
  function booleanSetting(value,name) {
    if(![true,false,'true','false'].includes(value))throw new Error(`${name} must be true or false.`);
    return value===true||value==='true';
  }
  const publicMode=booleanSetting(options.publicMode ?? process.env.PUBLIC_MODE ?? false,'PUBLIC_MODE');
  const readOnly=booleanSetting(options.readOnly ?? process.env.READ_ONLY ?? false,'READ_ONLY');
  const secureCookie=booleanSetting(options.secureCookie ?? process.env.COOKIE_SECURE ?? false,'COOKIE_SECURE');
  const certFile=options.tlsCertFile ?? process.env.TLS_CERT_FILE;
  const keyFile=options.tlsKeyFile ?? process.env.TLS_KEY_FILE;
  if(Boolean(certFile)!==Boolean(keyFile))throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must both be configured.');
  let tlsOptions;
  if(certFile) {
    tlsOptions={cert:await fsp.readFile(certFile),key:await fsp.readFile(keyFile),minVersion:'TLSv1.2'};
    createSecureContext(tlsOptions); // Fail on invalid/mismatched credentials before opening storage.
  }
  const secure=Boolean(tlsOptions)||secureCookie;
  const guestUser={id:'public',name:'Bezoeker',role:'editor',guest:true};
  function byteLimit(value, name, minimum, maximum = Number.MAX_SAFE_INTEGER) {
    if (!['number','string'].includes(typeof value) || String(value).trim() === '') throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
    const result=Number(value);
    if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
    return result;
  }
  const maxPublicSessions = byteLimit(options.maxPublicSessions ?? process.env.MAX_PUBLIC_SESSIONS ?? 1000,'MAX_PUBLIC_SESSIONS',1,1000000);
  const maxUpload = byteLimit(options.maxUpload ?? process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 ** 3,'MAX_UPLOAD_BYTES',0);
  const maxText = byteLimit(options.maxText ?? process.env.MAX_TEXT_BYTES ?? 2 * 1024 ** 2,'MAX_TEXT_BYTES',1,64 * 1024 ** 2);
  const uploadTimeout = byteLimit(options.uploadTimeout ?? process.env.UPLOAD_TIMEOUT_MS ?? 604800000,'UPLOAD_TIMEOUT_MS',1,2147483647);
  let ignorePatterns = options.ignorePatterns;
  if (ignorePatterns === undefined) {
    try { ignorePatterns = JSON.parse(process.env.IGNORE_PATTERNS || '[]'); }
    catch { throw new Error('IGNORE_PATTERNS must be a JSON array of glob patterns.'); }
  }
  if (!Array.isArray(ignorePatterns) || ignorePatterns.length > 100 || ignorePatterns.some(p => typeof p !== 'string' || !p || p.length > 1024)) throw new Error('IGNORE_PATTERNS must contain at most 100 non-empty patterns of at most 1024 characters.');
  const ignoreMatchers = ignorePatterns.map(p => picomatch(p, {dot:true, windows:false, nocase:process.platform === 'win32', strictBrackets:true}));
  function ignored(relative) {
    const parts=relative.split('/').filter(Boolean);
    return parts.some((_,i)=>ignoreMatchers.some(matches=>matches(parts.slice(0,i+1).join('/'))));
  }
  const watchEnabled = options.watch ?? process.env.WATCH ?? true;
  if (![true, false, 'true', 'false'].includes(watchEnabled)) throw new Error('WATCH must be true or false.');
  const pollingInterval = Number(options.pollingInterval ?? process.env.POLLING_INTERVAL_MS ?? 15000);
  if (!Number.isSafeInteger(pollingInterval) || pollingInterval < 0 || pollingInterval > 2147483647) throw new Error('POLLING_INTERVAL_MS must be an integer between 0 and 2147483647.');
  const root = path.resolve(options.files || process.env.FILES_DIR || path.join(here, 'data/files'));
  const config = path.resolve(options.config || process.env.CONFIG_DIR || path.join(here, 'data/config'));
  if (config === root || config.startsWith(root + path.sep) || root.startsWith(config + path.sep)) throw new Error('FILES_DIR en CONFIG_DIR mogen niet in elkaar liggen.');
  await fsp.mkdir(root, { recursive: true });
  await fsp.mkdir(config, { recursive: true, mode: 0o700 });
  const realRoot = await fsp.realpath(root);
  const realConfig = await fsp.realpath(config);
  const comparable = p => process.platform === 'win32' ? p.toLowerCase() : p;
  if(keyFile) {
    const realKey=comparable(await fsp.realpath(keyFile));
    if(realKey===comparable(realRoot)||realKey.startsWith(comparable(realRoot)+path.sep))throw new Error('TLS_KEY_FILE must not be inside FILES_DIR.');
  }
  if (comparable(realRoot) === comparable(realConfig) || comparable(realConfig).startsWith(comparable(realRoot) + path.sep) || comparable(realRoot).startsWith(comparable(realConfig) + path.sep)) throw new Error('Bestanden en configuratie moeten gescheiden blijven, ook na het volgen van links.');
  const tmp = path.join(config, 'tmp');
  const trashDir = path.join(config, 'trash');
  await fsp.mkdir(tmp, { recursive: true });
  await fsp.mkdir(trashDir, { recursive: true });
  const db = new DatabaseSync(path.join(config, 'state.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, digest TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user_expiry ON sessions(user_id,expires);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
    CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, path TEXT NOT NULL, expires INTEGER NOT NULL, owner TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS trash (id TEXT PRIMARY KEY, path TEXT NOT NULL, deleted INTEGER NOT NULL, owner TEXT NOT NULL);`);
  const moves=createMoveJournal(db,resolve,options.moveCheckpoint);
  const trashOperations=createTrashJournal(db,resolve,trashDir,options.trashCheckpoint);
  try { await moves.recover(); await trashOperations.recover(); } catch(error) {db.close();throw error;}
  const app = express();
  let closed=false;
  const eventClients = new Set();
  const sizeCache = new Map();
  let watchTimer;
  const emitChange = () => { for (const client of eventClients) client.write('event: change\ndata: {}\n\n'); };
  const notifyChange = () => {
    sizeCache.clear();
    clearTimeout(watchTimer);
    watchTimer = setTimeout(emitChange, 150);
  };
  let watcher;
  if (watchEnabled === true || watchEnabled === 'true') {
    try {
      watcher = fs.watch(realRoot, { recursive:true }, notifyChange);
      watcher.on('error', error => { console.error('Filesystem watcher:', error.message);watcher.close();notifyChange(); });
    } catch(error) { console.error('Filesystem watcher unavailable:', error.message); }
  }
  // Periodic invalidation also covers network mounts that do not deliver fs.watch events.
  const pollTimer = pollingInterval ? setInterval(() => {sizeCache.clear();emitChange();}, pollingInterval) : undefined;
  pollTimer?.unref();
  app.disable('x-powered-by');
  const attempts = createAttemptLimiter();
  const publicUser = u => ({ id: u.id, name: u.name, role: u.role, ...(u.guest?{guest:true}:{}) });
  const countUsers = () => db.prepare('SELECT count(*) AS n FROM users').get().n;
  const setupTokenPath = path.join(config,'setup-token');
  let setupToken;
  if (!countUsers()) {
    try { await fsp.writeFile(setupTokenPath,token()+'\n',{flag:'wx',mode:0o600}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if ((await fsp.lstat(setupTokenPath)).isSymbolicLink()) throw new Error('Setup-token mag geen symbolische link zijn.');
    setupToken = (await fsp.readFile(setupTokenPath,'utf8')).trim();
    if (setupToken.length < 32 || setupToken.length > 128) throw new Error('Ongeldig setup-tokenbestand.');
  }

  // Refuse traversal, NTFS streams/device names and symbolic links on every path component.
  function normalize(input = '') {
    if (typeof input !== 'string' || input.length > 4096 || input.includes('\\') || /[\x00-\x1f:]/.test(input)) throw fail(400, 'Ongeldig pad.');
    const parts = input.split('/').filter(Boolean);
    if (parts.some(p => p.startsWith('.app-tmp-'))) throw fail(403, 'Deze naam is gereserveerd voor tijdelijke bestanden.');
    if (parts.some(p => p === '.' || p === '..' || /[. ]$/.test(p) || /[<>"|?*]/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(p))) throw fail(400, 'Ongeldige bestandsnaam.');
    return parts.join('/');
  }
  async function resolve(input = '', mustExist = true) {
    const relative = normalize(input);
    if (ignored(relative)) throw fail(403, 'Dit pad is uitgesloten door de serverinstellingen.');
    let current = realRoot;
    for (const piece of relative.split('/').filter(Boolean)) {
      current = path.join(current, piece);
      try {
        const st = await fsp.lstat(current);
        if (st.isSymbolicLink()) throw fail(403, 'Symbolische links worden niet gevolgd.');
      } catch (e) { if (e.code !== 'ENOENT' || mustExist) throw e; }
    }
    return { relative, absolute: current };
  }
  async function absent(absolute) {
    try { await fsp.lstat(absolute); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    throw fail(409, 'Er bestaat al een bestand of map met deze naam.');
  }
  async function availablePath(input, directory=false) {
    let target=await resolve(input,false);
    const initial=target.relative, ext=directory?'':path.posix.extname(initial);
    const stem=initial.slice(0,initial.length-ext.length);
    for(let n=1;;n++) {
      try { await absent(target.absolute);return target; }
      catch(error) {if(error.status!==409)throw error;}
      if(n>10000)throw fail(409,'Geen vrije bestandsnaam gevonden.');
      target=await resolve(`${stem} (${n})${ext}`,false);
    }
  }
  async function* walkEntries(rel,rejectIgnored=false,check=()=>{}) {
      check();
      if (ignored(rel)) {
        if (rejectIgnored) throw fail(403, 'Deze map bevat uitgesloten bestanden en kan niet als geheel worden gewijzigd.');
        return;
      }
      const { absolute } = await resolve(rel);
      const st = await fsp.lstat(absolute);
      if(!st.isFile()&&!st.isDirectory())return;
      yield { path: rel, absolute, directory: st.isDirectory(), size: st.size, modified: st.mtimeMs };
      if (st.isDirectory()) for (const item of (await fsp.readdir(absolute, { withFileTypes: true })).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)) {
        if (!item.isSymbolicLink() && !item.name.startsWith('.app-tmp-')) yield* walkEntries([rel, item.name].filter(Boolean).join('/'),rejectIgnored,check);
      }
  }
  async function directorySize(relative) {
    let bytes=0;
    for await(const item of walkEntries(relative))if(!item.directory)bytes+=item.size;
    return bytes;
  }
  async function addUser(name, password, role) {
    if (typeof name !== 'string' || !/^[\p{L}\p{N}_.@ -]{1,64}$/u.test(name.trim())) throw fail(400, 'Kies een gebruikersnaam van 1–64 tekens.');
    if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw fail(400, 'Gebruik een wachtwoord van 12–1024 tekens.');
    if (!['admin', 'editor', 'viewer'].includes(role)) throw fail(400, 'Onbekende rol.');
    const salt = token();
    const digest = (await scrypt(password, salt, 64)).toString('hex');
    const user = { id: crypto.randomUUID(), name: name.trim(), role, salt, digest };
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(user.id, user.name, salt, digest, role);
    return user;
  }
  function session(res, user, remember = true) {
    const id = token(), csrf = token();
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    if(user.guest&&db.prepare("SELECT count(*) AS n FROM sessions WHERE user_id='public'").get().n>=maxPublicSessions) {
      res.set('Retry-After','60');
      throw fail(503,'Er zijn momenteel te veel openbare sessies. Probeer het later opnieuw of meld je aan met een account.');
    }
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(id), user.id, csrf, Date.now() + 7 * day);
    res.cookie('droppy_session', id, { httpOnly: true, sameSite: 'strict', secure, ...(remember ? {maxAge:7*day} : {}), path: '/' });
    return { user: publicUser(user), csrf, readOnly };
  }
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' blob: data:; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"
    });
    if (req.path.startsWith('/api/') || req.path.startsWith('/s/')) res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      let origin; try { origin = new URL(req.headers.origin); } catch { return next(fail(403, 'Ongeldige herkomst.')); }
      if (origin.host !== req.headers.host) return next(fail(403, 'Verzoek vanaf een andere website geweigerd.'));
    }
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('droppy_session='))?.slice(15);
    if (cookie) {
      const row = db.prepare('SELECT sessions.id AS session_id, sessions.csrf, users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.id=? AND sessions.expires>?').get(hash(cookie), Date.now());
      if (row) req.auth = row;
      else if(publicMode) {
        const guest=db.prepare("SELECT id AS session_id,csrf FROM sessions WHERE id=? AND user_id='public' AND expires>?").get(hash(cookie),Date.now());
        if(guest)req.auth={...guestUser,...guest};
      }
    }
    next();
  });
  const jsonBody = express.json({ limit: '3mb' });
  // JSON escaping can expand one text byte to six bytes (for example \u0001).
  const textBody = express.json({limit:6 * maxText + 65536});
  app.use((req,res,next) => {
    if (req.method === 'PUT' && req.path === '/api/upload') return next();
    if (req.method === 'POST' && req.path === '/api/text') {
      if (!req.auth) return next(fail(401,'Log in om verder te gaan.'));
      if (readOnly || req.auth.role === 'viewer' || req.get('x-csrf-token') !== req.auth.csrf) return next(fail(403,'Geen toestemming om tekst op te slaan.'));
      return textBody(req,res,next);
    }
    return jsonBody(req,res,next);
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'droppy-next', version: '0.1.0' }));
  app.get('/api/session', (req, res) => {
    if(publicMode&&!req.auth&&req.query.login!=='1')return res.json({...session(res,guestUser),setup:false,setupTokenRequired:false,publicMode});
    const auth=req.query.login==='1'&&req.auth?.guest?null:req.auth;
    res.json({ setup: !auth&&countUsers() === 0, setupTokenRequired: !auth&&countUsers() === 0, user: auth ? publicUser(auth) : null, csrf:auth?.csrf, readOnly,publicMode });
  });
  const throttle = (req, res, next) => {
    const result=attempts.consume(req.socket.remoteAddress);
    if(!result.allowed) {
      res.set('Retry-After',String(result.retryAfter));
      return next(fail(429,'Te veel pogingen. Probeer het later opnieuw.'));
    }
    next();
  };
  app.post('/api/setup', throttle, async (req, res) => {
    if (countUsers()) throw fail(409, 'Er bestaat al een beheerder.');
    const supplied = req.get('x-setup-token') || req.body?.setupToken;
    if (typeof supplied !== 'string' || !crypto.timingSafeEqual(Buffer.from(hash(supplied)),Buffer.from(hash(setupToken)))) throw fail(403, 'Gebruik de installatiecode uit het bestand setup-token in je configuratiemap.');
    const { name, password } = req.body || {};
    // Recheck after async password hashing so two initial requests cannot create two admins.
    const salt = token();
    if (typeof name !== 'string' || !/^[\p{L}\p{N}_.@ -]{1,64}$/u.test(name.trim())) throw fail(400, 'Ongeldige gebruikersnaam.');
    if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw fail(400, 'Gebruik een wachtwoord van 12–1024 tekens.');
    const digest = (await scrypt(password, salt, 64)).toString('hex');
    if (countUsers()) throw fail(409, 'Er bestaat al een beheerder.');
    const user = { id: crypto.randomUUID(), name: name.trim(), role: 'admin' };
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(user.id, user.name, salt, digest, user.role);
    await fsp.rm(setupTokenPath,{force:true});
    res.status(201).json(session(res, user, req.body.remember !== false));
  });
  app.post('/api/login', throttle, async (req, res) => {
    const { name, password } = req.body || {};
    if (typeof name !== 'string' || typeof password !== 'string' || password.length > 1024) throw fail(400, 'Ongeldige inloggegevens.');
    const user = db.prepare('SELECT * FROM users WHERE name=?').get(name);
    const digest = await scrypt(password, user?.salt || 'unknown-user', 64);
    const currentUser = user && db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if (!user || !crypto.timingSafeEqual(digest, Buffer.from(user.digest, 'hex')) || currentUser?.digest !== user.digest) throw fail(401, 'Gebruikersnaam of wachtwoord klopt niet.');
    attempts.clear(req.socket.remoteAddress);
    res.json(session(res, currentUser, req.body.remember !== false));
  });
  app.get('/s/:id', async (req, res) => {
    const share = db.prepare('SELECT * FROM shares WHERE id=? AND (expires=0 OR expires>?)').get(req.params.id, Date.now());
    if (!share) throw fail(404, 'Deze downloadlink is verlopen of ingetrokken.');
    const assertCurrent = () => {
      if(closed)throw fail(503,'De server wordt afgesloten.');
      const current=db.prepare('SELECT path,expires FROM shares WHERE id=?').get(share.id);
      if(!current||(current.expires!==0&&current.expires<=Date.now()))throw fail(404,'Deze downloadlink is verlopen of ingetrokken.');
      if(current.path!==share.path||moves.blocks(share.path)||trashOperations.blocks(share.path))throw fail(503,'Dit bestand wordt verplaatst. Probeer het later opnieuw.');
    };
    assertCurrent();
    const { absolute } = await resolve(share.path);
    if ((await fsp.stat(absolute)).isDirectory()) return zip(share.path, res, assertCurrent);
    const handle=await fsp.open(absolute,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    try {
      let inline=false;
      if(req.query.download==='0') {
        const ext=path.extname(absolute).toLowerCase();
        inline=['.png','.jpg','.jpeg','.gif','.webp','.avif','.bmp','.mp4','.webm','.ogv','.mp3','.wav','.ogg','.m4a','.flac','.pdf'].includes(ext);
        if(!inline&&(await handle.stat()).size<2*1024**2) {
          let bytes;
          try {bytes=await readLimitedHandle(handle,2*1024**2);} catch(error) {if(error.status!==413)throw error;}
          assertCurrent();
          if(bytes&&!bytes.includes(0))return res.type('text/plain').send(bytes);
        }
      }
      assertCurrent();
      await sendOpenedFile(req,res,handle,path.basename(absolute),inline);
    } finally {await handle.close();}
  });
  app.use('/api', (req, _res, next) => {
    if (!req.auth) return next(fail(401, 'Log in om verder te gaan.'));
    if (!['GET', 'HEAD'].includes(req.method) && req.get('x-csrf-token') !== req.auth.csrf) return next(fail(403, 'Ongeldig sessietoken. Herlaad de pagina.'));
    next();
  });
  const writable = (req, _res, next) => next(readOnly || req.auth.role === 'viewer' ? fail(403, 'Deze gebruiker heeft alleen leestoegang.') : undefined);
  app.get('/api/events', (req, res) => {
    res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.flushHeaders();res.write('event: ready\ndata: {}\n\n');eventClients.add(res);
    const heartbeat = setInterval(() => {
      if (!db.prepare('SELECT id FROM sessions WHERE id=? AND expires>?').get(req.auth.session_id,Date.now())) {res.end();return;}
      res.write(': heartbeat\n\n');
    },20000);
    res.on('close',()=>{clearInterval(heartbeat);eventClients.delete(res);});
  });
  const admin = (req, _res, next) => next(req.auth.role !== 'admin' ? fail(403, 'Alleen voor beheerders.') : undefined);
  // Serialize filesystem commits. Receiving an upload must not lock out other users.
  let mutationQueue = Promise.resolve();
  const mutate = async (req, res, handler) => {
    const previous = mutationQueue;
    let release;
    mutationQueue = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      if (req.aborted || res.destroyed) return;
      if (moves.hasPending() || trashOperations.hasPending()) throw fail(503, 'Een onderbroken verplaatsing moet eerst worden hersteld. Herstart de server.');
      if (!db.prepare('SELECT id FROM sessions WHERE id=? AND expires>?').get(req.auth.session_id, Date.now())) throw fail(401, 'Je sessie is verlopen.');
      await handler();
    }
    finally { release(); }
  };
  const serialize = handler => async (req,res,next) => {
    try {await mutate(req,res,()=>handler(req,res,next));} catch(error) {next(error);}
  };
  const write = Object.fromEntries(['post','put','delete'].map(method => [method, (route,...handlers) => app[method](route,...handlers.slice(0,-1),serialize(handlers.at(-1)))]));
  write.post('/api/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE id=?').run(req.auth.session_id);
    res.clearCookie('droppy_session', { path: '/' }); res.json({ ok: true });
  });
  write.post('/api/password', throttle, async (req, res) => {
    if(req.auth.guest)throw fail(403,'Een openbare bezoeker heeft geen accountwachtwoord.');
    const { currentPassword, password } = req.body || {};
    if (typeof currentPassword !== 'string' || currentPassword.length > 1024 || typeof password !== 'string' || password.length < 12 || password.length > 1024) throw fail(400, 'Gebruik een nieuw wachtwoord van 12–1024 tekens.');
    const current = await scrypt(currentPassword, req.auth.salt, 64);
    if (!crypto.timingSafeEqual(current, Buffer.from(req.auth.digest, 'hex'))) throw fail(403, 'Je huidige wachtwoord klopt niet.');
    const salt = token(), digest = (await scrypt(password, salt, 64)).toString('hex');
    db.prepare('UPDATE users SET salt=?,digest=? WHERE id=?').run(salt, digest, req.auth.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.auth.id);
    res.json(session(res, req.auth));
  });
  app.get('/api/files', async (req, res) => {
    const { relative, absolute } = await resolve(req.query.path || '');
    const items = [];
    for (const entry of await fsp.readdir(absolute, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.app-tmp-')) continue;
      if (ignored([relative,entry.name].filter(Boolean).join('/'))) continue;
      try {
        const st = await fsp.stat(path.join(absolute, entry.name));
        if (!st.isDirectory() && !st.isFile()) continue;
        const itemPath = [relative, entry.name].filter(Boolean).join('/');
        let itemSize = st.size;
        if (st.isDirectory()) {
          if(!sizeCache.has(itemPath))sizeCache.set(itemPath,directorySize(itemPath).catch(()=>null));
          itemSize=await sizeCache.get(itemPath);
        }
        items.push({ name: entry.name, path: itemPath, directory: st.isDirectory(), size: itemSize, modified: st.mtimeMs });
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    res.json({ path: relative, items });
  });
  app.get('/api/stat', async (req, res) => {
    const {relative,absolute}=await resolve(req.query.path||'');const st=await fsp.stat(absolute);
    res.json({path:relative,name:path.posix.basename(relative),directory:st.isDirectory(),size:st.size,modified:st.mtimeMs});
  });
  app.get('/api/search', async (req, res) => {
    if (typeof req.query.q !== 'string' || !req.query.q.trim() || req.query.q.length > 256) throw fail(400, 'Gebruik een zoekterm van 1–256 tekens.');
    const q = req.query.q.toLowerCase();
    const { relative } = await resolve(req.query.path || '');
    const offset=Number(req.query.offset??0);
    if(!Number.isSafeInteger(offset)||offset<0)throw fail(400,'Ongeldige zoekpagina.');
    const items=[];let matched=0;
    const deadline=Date.now()+30000;
    for await(const item of walkEntries(relative,false,()=>{
      if(res.destroyed)throw fail(499,'Zoekopdracht geannuleerd.');
      if(Date.now()>deadline)throw fail(503,'Zoeken duurt te lang; kies een kleinere map.');
    })) {
      if(item.path===relative||!(item.directory?item.path:path.posix.basename(item.path)).toLowerCase().includes(q))continue;
      if(matched++<offset)continue;
      const {absolute,...entry}=item;items.push({...entry,name:path.posix.basename(item.path)});
      if(items.length>1000)break;
    }
    const truncated=items.length>1000;
    res.json({items:items.slice(0,1000),truncated,nextOffset:truncated?offset+1000:null});
  });
  async function authenticatedFile(req,res,pdfOnly=false) {
    const { absolute } = await resolve(req.query.path);
    const ext = path.extname(absolute).toLowerCase();
    if(pdfOnly&&ext!=='.pdf')throw fail(415,'Dit is geen PDF-bestand.');
    // Pin the opened file for the entire response, including HEAD/range handling.
    // Never render user-controlled HTML/SVG/scripts under the application origin.
    const inline=!pdfOnly&&req.query.download!=='1'&&['.png','.jpg','.jpeg','.gif','.webp','.avif','.bmp','.mp4','.webm','.ogv','.mp3','.wav','.ogg','.m4a','.flac'].includes(ext);
    const handle=await fsp.open(absolute,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    try {await sendOpenedFile(req,res,handle,path.basename(absolute),inline);}
    finally {await handle.close();}
  }
  app.get('/api/file', (req,res)=>authenticatedFile(req,res));
  app.get('/api/pdf', (req,res)=>authenticatedFile(req,res,true));
  async function zip(relative, res, guard = () => {}) {
    await resolve(relative);
    if(res.destroyed)return;
    guard();
    const archive = new ZipArchive({ zlib: { level: 5 } });
    const streams=new Set();
    res.attachment((path.posix.basename(relative) || 'bestanden') + '.zip');
    archive.on('error', error => res.destroy(error));
    archive.on('warning', error => res.destroy(error));
    res.on('close', () => { if (!res.writableEnded) {archive.abort();for(const stream of streams)stream.destroy();} });
    archive.pipe(res);
    const appendEntry=(source,metadata)=>new Promise((resolve,reject)=>{
      const cleanup=()=>{archive.off('entry',done);archive.off('error',failed);archive.off('warning',failed);res.off('close',cancelled);};
      const done=()=>{cleanup();resolve();};
      const failed=error=>{cleanup();reject(error);};
      const cancelled=()=>failed(fail(499,'Download geannuleerd.'));
      if(res.destroyed)return cancelled();
      archive.once('entry',done);archive.once('error',failed);archive.once('warning',failed);res.once('close',cancelled);
      try {archive.append(source,metadata);} catch(error) {failed(error);}
    });
    const base = relative ? path.posix.dirname(relative) : '';
    try {
    for await(const item of walkEntries(relative,false,()=>{if(res.destroyed)throw fail(499,'Download geannuleerd.');guard();})) {
      const name = base && base !== '.' ? item.path.slice(base.length + 1) : item.path;
      if (!name) continue;
      if (item.directory) await appendEntry('', { name: name + '/' });
      else {
        const stream=Readable.from((async function* () {
        const checked=await resolve(item.path);
        const handle=await fsp.open(checked.absolute,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
        try {
          guard();
          yield* handle.createReadStream({autoClose:true});
        } finally {await handle.close();}
        })());
        streams.add(stream);
        stream.once('close',()=>streams.delete(stream));
        stream.on('error',error=>{archive.abort();res.destroy(error);for(const other of streams)other.destroy();});
        await appendEntry(stream,{name,date:new Date(item.modified)});
      }
    }
    await archive.finalize();
    } catch(error) {archive.abort();for(const stream of streams)stream.destroy();res.destroy(error);}
  }
  app.get('/api/zip', async (req, res) => { const { relative } = await resolve(req.query.path || ''); await zip(relative, res); });
  app.get('/api/text', async (req, res) => {
    const { absolute } = await resolve(req.query.path);
    const bytes = await readLimitedFile(absolute,maxText);
    if (bytes.includes(0)) throw fail(415, 'Dit is een binair bestand. Download het om te openen.');
    let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw fail(415, 'Alleen UTF-8-tekst kan worden bewerkt.'); }
    res.json({ text, version: hash(bytes) });
  });
  write.post('/api/text', writable, async (req, res) => {
    const { absolute } = await resolve(req.body.path);
    if (typeof req.body.text !== 'string' || Buffer.byteLength(req.body.text) > maxText) throw fail(413, `Maximaal ${maxText} bytes tekst.`);
    if (hash(await readLimitedFile(absolute,maxText)) !== req.body.version) throw fail(409, 'Het bestand is ondertussen gewijzigd. Open het opnieuw voordat je opslaat.');
    const temp = path.join(path.dirname(absolute), '.app-tmp-' + crypto.randomUUID());
    try {
      await fsp.writeFile(temp, req.body.text, { flag: 'wx', mode: (await fsp.stat(absolute)).mode });
      await fsp.rename(temp, absolute);
    } finally { await fsp.rm(temp, { force: true }); }
    res.json({ version: hash(req.body.text) });
  });
  write.post('/api/create', writable, async (req, res) => {
    const { absolute, relative } = await resolve(req.body.path, false);
    if (!relative) throw fail(400, 'Geef een naam op.');
    await absent(absolute);
    if (req.body.directory) await fsp.mkdir(absolute);
    else await fsp.writeFile(absolute, '', { flag: 'wx' });
    res.status(201).json({ ok: true });
  });
  const fileVersion = st => hash([st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs].join(':'));
  app.get('/api/upload-target', writable, async (req, res) => {
    const { absolute, relative } = await resolve(req.query.path, false);
    if (!relative) throw fail(400, 'Geef een bestandsnaam op.');
    try {
      const st = await fsp.stat(absolute);
      res.json({ exists:true, directory:st.isDirectory(), version:fileVersion(st) });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      res.json({ exists:false });
    }
  });
  const uploadDeadline = (req,res,next) => {
    const timer=setTimeout(()=>req.destroy(),uploadTimeout);
    timer.unref();
    const clear=()=>clearTimeout(timer);
    req.once('end',clear);req.once('close',clear);res.once('close',clear);
    next();
  };
  app.put('/api/upload', writable, uploadDeadline, async (req, res) => {
    if (maxUpload && Number(req.headers['content-length']) > maxUpload) throw fail(413, 'Bestand is groter dan de uploadlimiet.');
    let { absolute, relative } = await resolve(req.query.path, false);
    if (!relative) throw fail(400, 'Geef een bestandsnaam op.');
    const conflict = req.query.conflict || 'reject';
    if (!['reject','replace','rename'].includes(conflict)) throw fail(400, 'Onbekende keuze bij uploadconflict.');
    let previous;
    if (conflict === 'replace') {
      previous = await fsp.stat(absolute);
      if (!previous.isFile()) throw fail(409, 'Een map kan niet door een bestand worden vervangen.');
      if (fileVersion(previous) !== req.query.version) throw fail(409, 'Het bestand is ondertussen gewijzigd. Bevestig opnieuw voordat je overschrijft.');
    } else if (conflict === 'reject') await absent(absolute);
    const temporary = path.join(tmp, crypto.randomUUID());
    let staged;
    let bytes = 0;
    const limit = new Transform({ transform(chunk, _encoding, cb) { bytes += chunk.length; cb(maxUpload && bytes > maxUpload ? fail(413, 'Bestand is groter dan de uploadlimiet.') : null, chunk); } });
    try {
      await pipeline(req, limit, fs.createWriteStream(temporary, { flags: 'wx' }));
      await mutate(req,res,async()=>{
      await resolve(relative, false);
      if (conflict === 'rename') {
        ({absolute,relative}=await availablePath(relative));
      }
      await fsp.mkdir(path.dirname(absolute), { recursive: true });
      staged = path.join(path.dirname(absolute), '.app-tmp-' + crypto.randomUUID());
      await fsp.copyFile(temporary, staged, fs.constants.COPYFILE_EXCL);
      if (previous) {
        await resolve(relative);
        if (fileVersion(await fsp.stat(absolute)) !== req.query.version) throw fail(409, 'Het bestand is tijdens de upload gewijzigd. Het is niet overschreven.');
        await fsp.chmod(staged, previous.mode);
        await fsp.rename(staged, absolute);
      } else {
        // Publish only the completed file, without replacing an existing destination.
        await fsp.link(staged, absolute);
      }
      await fsp.rm(staged, { force: true });
      staged = undefined;
      sizeCache.clear();
      res.status(201).json({ ok: true, bytes, path:relative });
      });
    } finally {
      if (staged) await fsp.rm(staged, { force: true });
      await fsp.rm(temporary, { force: true });
    }
  });
  write.post('/api/transfer', writable, async (req, res) => {
    const source = await resolve(req.body.source);
    let target = await resolve(req.body.target, false);
    if (!source.relative || !target.relative) throw fail(400, 'De hoofdmap kan niet worden verplaatst.');
    if (target.absolute.toLowerCase().startsWith(source.absolute.toLowerCase() + path.sep)) throw fail(400, 'Een map kan niet naar zichzelf worden gekopieerd.');
    if (!['move', 'copy'].includes(req.body.operation)) throw fail(400, 'Onbekende bewerking.');
    if (!['reject','rename'].includes(req.body.conflict || 'reject')) throw fail(400, 'Onbekende keuze bij naamconflict.');
    if (req.body.conflict === 'rename') target=await availablePath(target.relative,(await fsp.stat(source.absolute)).isDirectory());
    await absent(target.absolute);
    for await(const item of walkEntries(source.relative,true)) if (ignored(target.relative+item.path.slice(source.relative.length))) throw fail(403, 'De doelmap zou uitgesloten bestanden bevatten.');
    if (req.body.operation === 'copy') await fsp.cp(source.absolute, target.absolute, { recursive: true, force: false, errorOnExist: true, filter: async p => !(await fsp.lstat(p)).isSymbolicLink() });
    else await moves.move(source,target);
    res.json({ ok: true, path:target.relative });
  });
  write.post('/api/trash', writable, async (req, res) => {
    const { relative, absolute } = await resolve(req.body.path);
    if (!relative) throw fail(400, 'De hoofdmap kan niet worden verwijderd.');
    if (ignoreMatchers.length) for await(const _item of walkEntries(relative,true)) { /* Validate every descendant before deleting a parent. */ }
    const id = crypto.randomUUID();
    await trashOperations.move('trash', { id, path: relative, deleted: Date.now(), owner: req.auth.id });
    res.json({ ok: true, id });
  });
  app.get('/api/trash', (req, res) => res.json({ items: req.auth.role === 'admin' ? db.prepare('SELECT * FROM trash ORDER BY deleted DESC').all() : db.prepare('SELECT * FROM trash WHERE owner=? ORDER BY deleted DESC').all(req.auth.id) }));
  write.delete('/api/trash/:id', writable, async (req, res) => {
    const row = db.prepare('SELECT * FROM trash WHERE id=?').get(req.params.id);
    if (!row || (row.owner !== req.auth.id && req.auth.role !== 'admin')) throw fail(404, 'Item niet gevonden.');
    const target = path.resolve(trashDir,row.id);
    if (path.dirname(target) !== path.resolve(trashDir)) throw fail(400, 'Ongeldig prullenbakitem.');
    // rm removes directory links themselves; it must never dereference them.
    await fsp.rm(target,{recursive:true,force:true});
    db.prepare('DELETE FROM trash WHERE id=?').run(row.id);
    res.json({ok:true});
  });
  write.post('/api/restore', writable, async (req, res) => {
    const row = db.prepare('SELECT * FROM trash WHERE id=?').get(req.body.id);
    if (!row || (row.owner !== req.auth.id && req.auth.role !== 'admin')) throw fail(404, 'Item niet gevonden.');
    const { absolute } = await resolve(row.path, false);
    await absent(absolute); await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await trashOperations.move('restore', row);
    res.json({ ok: true });
  });
  app.get('/api/shares', (req, res) => res.json({ items: req.auth.role === 'admin' ? db.prepare('SELECT * FROM shares ORDER BY expires DESC').all() : db.prepare('SELECT * FROM shares WHERE owner=? ORDER BY expires DESC').all(req.auth.id) }));
  write.post('/api/shares', writable, async (req, res) => {
    const { relative } = await resolve(req.body.path);
    if (!relative) throw fail(400, 'Deel een bestand of submap.');
    const hours = Number(req.body.hours ?? 0);
    if (!Number.isFinite(hours) || (hours !== 0 && hours < 1) || hours > 720) throw fail(400, 'Kies 0 (geen vervaldatum) of 1–720 uur.');
    const id = token(), expires = hours === 0 ? 0 : Date.now() + hours * 3600000;
    db.prepare('INSERT INTO shares VALUES (?,?,?,?)').run(id, relative, expires, req.auth.id);
    res.status(201).json({ id, url: '/s/' + id, expires });
  });
  write.delete('/api/shares/:id', (req, res) => {
    const share = db.prepare('SELECT * FROM shares WHERE id=?').get(req.params.id);
    if (!share || (share.owner !== req.auth.id && req.auth.role !== 'admin')) throw fail(404, 'Link niet gevonden.');
    db.prepare('DELETE FROM shares WHERE id=?').run(share.id); res.json({ ok: true });
  });
  app.get('/api/users', admin, (_req, res) => res.json({ items: db.prepare('SELECT id,name,role FROM users ORDER BY name').all() }));
  write.post('/api/users', admin, async (req, res) => { const u = await addUser(req.body.name, req.body.password, req.body.role); res.status(201).json(publicUser(u)); });
  write.put('/api/users/:id', admin, throttle, async (req, res) => {
    if (req.params.id === req.auth.id) throw fail(400, 'Wijzig je eigen wachtwoord via Mijn account. Je kunt je eigen rol niet wijzigen.');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) throw fail(404, 'Gebruiker niet gevonden.');
    const {role=user.role,password} = req.body || {};
    if (!['admin','editor','viewer'].includes(role)) throw fail(400, 'Onbekende rol.');
    if (password !== undefined && (typeof password !== 'string' || password.length < 12 || password.length > 1024)) throw fail(400, 'Gebruik een wachtwoord van 12–1024 tekens.');
    if (password === undefined && role === user.role) return res.json(publicUser(user));
    let salt=user.salt, digest=user.digest;
    if (password !== undefined) { salt=token(); digest=(await scrypt(password,salt,64)).toString('hex'); }
    // All mutations use the same queue: session revocation and this update cannot
    // interleave with another password or role change inside this process.
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET role=?,salt=?,digest=? WHERE id=?').run(role,salt,digest,user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      db.exec('COMMIT');
    } catch (error) {db.exec('ROLLBACK');throw error;}
    res.json(publicUser({...user,role}));
  });
  write.delete('/api/users/:id', admin, (req, res) => {
    if (req.params.id === req.auth.id) throw fail(400, 'Je kunt je eigen account niet verwijderen.');
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.params.id);
    db.prepare('DELETE FROM shares WHERE owner=?').run(req.params.id);
    db.prepare('DELETE FROM users WHERE id=?').run(req.params.id); res.json({ ok: true });
  });
  app.use('/api', (_req, _res, next) => next(fail(404, 'Onbekend API-adres.')));
  app.use(express.static(path.join(here, 'public'), { etag: true, maxAge: 0 }));
  app.use((error, _req, res, _next) => {
    if (res.destroyed) return;
    if (res.headersSent) return res.destroy();
    const known = { ENOENT: [404, 'Bestand of map niet gevonden.'], EEXIST: [409, 'Deze naam bestaat al.'], ENOTDIR: [400, 'Dit is geen map.'], EISDIR: [400, 'Dit is een map.'], EACCES: [403, 'Geen toegang tot dit bestand.'], EPERM: [403, 'Deze bewerking is niet toegestaan.'], ENOSPC: [507, 'Onvoldoende schijfruimte.'] };
    const mapped = known[error.code];
    const duplicate = String(error.message).includes('UNIQUE constraint failed');
    const status = mapped?.[0] || (duplicate ? 409 : error.status || 500);
    if (status >= 500) console.error(error.code || error.name, error.message);
    res.status(status).json({ error: mapped?.[1] || (duplicate ? 'Deze gebruikersnaam bestaat al.' : status === 500 ? 'Er ging iets mis op de server.' : error.message) });
  });
  const stopEvents = () => {watcher?.close();clearTimeout(watchTimer);clearInterval(pollTimer);for(const client of eventClients)client.end();};
  const listen=(...args)=>(tlsOptions?createHttpsServer:createServer)({...tlsOptions,requestTimeout:Math.max(300000,uploadTimeout),headersTimeout:60000},app).listen(...args);
  return { app, listen, protocol:tlsOptions?'https':'http', stopEvents, close: () => {if(closed)return;closed=true;stopEvents();db.close();}, root, config, setupTokenRequired: !countUsers() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const instance = await createApp();
  if (instance.setupTokenRequired) console.log('Initial setup: enter the code from the setup-token file in CONFIG_DIR.');
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT ?? 8094);
  const server = instance.listen(port, host, () => console.log(`Droppy Next: ${instance.protocol}://${host}:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {instance.stopEvents();server.close(() => { instance.close(); process.exit(0); });});
}
