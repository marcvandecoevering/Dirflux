import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createTrashJournal } from '../lib/trash.js';
import { createApp } from '../server.js';

async function fixture(t, separateVolume = false) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'file-app-trash-'));
  const files = path.join(temp, 'files');
  const trash = separateVolume ? await fs.mkdtemp('/dev/shm/file-app-trash-') : path.join(temp, 'trash');
  await fs.mkdir(files); await fs.mkdir(trash, { recursive: true });
  let db;
  const open = () => {
    db = new DatabaseSync(path.join(temp, 'state.sqlite'));
    db.exec('CREATE TABLE IF NOT EXISTS trash (id TEXT PRIMARY KEY,path TEXT,deleted INTEGER,owner TEXT); CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY,path TEXT)');
    return db;
  };
  open();
  t.after(async () => {
    db.close();
    assert.equal(path.dirname(temp), os.tmpdir()); await fs.rm(temp, { recursive: true, force: true });
    if (separateVolume) { assert.equal(path.dirname(trash), '/dev/shm'); await fs.rm(trash, { recursive: true, force: true }); }
  });
  const resolve = async relative => ({ relative, absolute: path.join(files, relative) });
  return { files, trash, resolve, get db() { return db; }, reopen() { db.close(); return open(); } };
}
const forcedCrossDevice = async () => { throw Object.assign(new Error('Cross-device'), { code: 'EXDEV' }); };

for (const kind of ['trash', 'restore']) for (const crossDevice of [false, true]) {
  for (const phase of crossDevice ? ['prepared', 'copying', 'copied', 'ready', 'published', 'removed'] : ['prepared', 'renamed']) {
    test(`${kind} recovers ${crossDevice ? 'cross-device' : 'atomic'} interruption at ${phase}`, async t => {
      const f = await fixture(t);
      const item = { id: crypto.randomUUID(), path: 'folder', deleted: 1234, owner: 'user' };
      const file = path.join(f.files, item.path), stored = path.join(f.trash, item.id);
      const source = kind === 'trash' ? file : stored, target = kind === 'trash' ? stored : file;
      await fs.mkdir(source); await fs.writeFile(path.join(source, 'content.txt'), 'original data');
      await fs.writeFile(path.join(source, 'second.txt'), 'second file');
      if (kind === 'restore') f.db.prepare('INSERT INTO trash VALUES (?,?,?,?)').run(item.id, item.path, item.deleted, item.owner);
      else f.db.prepare('INSERT INTO shares VALUES (?,?)').run('link', 'folder/content.txt');
      const journal = createTrashJournal(f.db, f.resolve, f.trash, async at => {
        if (at === phase) {
          if (at === 'published') await fs.rm(path.join(source, 'second.txt')); // Interrupted recursive source cleanup.
          if (at === 'copying') {
            const row = JSON.parse(f.db.prepare('SELECT data FROM trash_operations').get().data);
            await fs.writeFile(path.join(path.dirname(target), '.app-tmp-' + row.id, 'payload'), 'incomplete copy');
          }
          throw new Error('Simulated interruption');
        }
      }, crossDevice ? forcedCrossDevice : undefined);
      await assert.rejects(journal.move(kind, item), /Simulated interruption/);
      assert.equal(journal.hasPending(), true);
      assert.equal(journal.blocks('folder/content.txt'), true);
      const recovery = createTrashJournal(f.reopen(), f.resolve, f.trash);
      await recovery.recover();
      const completed = !['prepared', 'copying', 'copied'].includes(phase);
      assert.equal(await fs.readFile(path.join(completed ? target : source, 'content.txt'), 'utf8'), 'original data');
      assert.equal(await fs.readFile(path.join(completed ? target : source, 'second.txt'), 'utf8'), 'second file');
      await assert.rejects(fs.stat(completed ? source : target), { code: 'ENOENT' });
      assert.equal(f.db.prepare('SELECT count(*) AS n FROM trash').get().n, Number(kind === 'trash' ? completed : !completed));
      assert.equal(f.db.prepare('SELECT count(*) AS n FROM shares').get().n, Number(kind === 'trash' && !completed));
      assert.equal(recovery.hasPending(), false);
      for (const directory of [f.files, f.trash]) assert.equal((await fs.readdir(directory)).some(name => name.startsWith('.app-tmp-')), false);
      await recovery.recover(); // A second startup must not change the result.
    });
  }
}

test('trash recovery preserves an unrelated destination instead of overwriting it', async t => {
  const f = await fixture(t);
  const item = { id: crypto.randomUUID(), path: 'file.txt', deleted: 1234, owner: 'user' };
  await fs.writeFile(path.join(f.files, item.path), 'original');
  const journal = createTrashJournal(f.db, f.resolve, f.trash, at => { if (at === 'ready') throw new Error('Stop'); }, forcedCrossDevice);
  await assert.rejects(journal.move('trash', item), /Stop/);
  await fs.writeFile(path.join(f.trash, item.id), 'unrelated');
  await assert.rejects(createTrashJournal(f.reopen(), f.resolve, f.trash).recover(), /ambiguous/);
  assert.equal(await fs.readFile(path.join(f.files, item.path), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(f.trash, item.id), 'utf8'), 'unrelated');
});

for (const phase of ['prepared', 'renamed']) test(`server restart recovers trash at ${phase} and protects public links`, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'file-app-trash-http-'));
  const options = { files: path.join(temp, 'files'), config: path.join(temp, 'config') };
  let app, server, base;
  async function start(extra = {}) {
    app = await createApp({ ...options, ...extra }); server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); app.close(); server = null; } }
  t.after(async () => { await stop(); assert.equal(path.dirname(temp), os.tmpdir()); await fs.rm(temp, { recursive: true, force: true }); });
  await start({ trashCheckpoint: at => { if (at === phase) throw Object.assign(new Error('Interrupted trash'), { status: 503 }); } });
  const setupToken = (await fs.readFile(path.join(options.config, 'setup-token'), 'utf8')).trim();
  const setup = await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: 'trash-recovery-test-password', setupToken }) });
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get('set-cookie').split(';')[0], csrf = (await setup.json()).csrf;
  const request = (route, body) => fetch(base + '/api' + route, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await fs.writeFile(path.join(options.files, 'file.txt'), 'protected contents');
  const share = await request('/shares', { path: 'file.txt' }); assert.equal(share.status, 201);
  const link = (await share.json()).url;
  assert.equal((await request('/trash', { path: 'file.txt' })).status, 503);
  assert.equal((await fetch(base + link)).status, 503);
  assert.equal((await request('/create', { path: 'other.txt' })).status, 503);
  await stop(); await start();
  const listing = await fetch(base + '/api/trash', { headers: { Cookie: cookie } }); assert.equal(listing.status, 200);
  const items = (await listing.json()).items;
  assert.equal(items.length, phase === 'renamed' ? 1 : 0);
  const shared = await fetch(base + link); assert.equal(shared.status, phase === 'renamed' ? 404 : 200);
  if (phase === 'renamed') {
    assert.equal((await request('/restore', { id: items[0].id })).status, 200);
    assert.equal((await fetch(base + link)).status, 404, 'Restoring must not revive a revoked link');
  }
  assert.equal(await fs.readFile(path.join(options.files, 'file.txt'), 'utf8'), 'protected contents');
});

test('trash and restore cross real Linux filesystem boundaries', { skip: process.platform !== 'linux' }, async t => {
  const f = await fixture(t, true);
  assert.notEqual((await fs.stat(f.files)).dev, (await fs.stat(f.trash)).dev, 'Test requires distinct filesystem devices');
  const item = { id: crypto.randomUUID(), path: 'folder', deleted: 1234, owner: 'user' };
  await fs.mkdir(path.join(f.files, item.path));
  await fs.writeFile(path.join(f.files, item.path, 'test.txt'), 'cross-volume bytes');
  const journal = createTrashJournal(f.db, f.resolve, f.trash);
  await journal.move('trash', item);
  await assert.rejects(fs.stat(path.join(f.files, item.path)), { code: 'ENOENT' });
  await journal.move('restore', item);
  assert.equal(await fs.readFile(path.join(f.files, item.path, 'test.txt'), 'utf8'), 'cross-volume bytes');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM trash').get().n, 0);
  assert.equal(journal.hasPending(), false);
});
