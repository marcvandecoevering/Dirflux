import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createMoveJournal } from '../lib/moves.js';

async function fixture(t, realVolume = false) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'file-app-cross-move-'));
  const destination = realVolume ? await fs.mkdtemp('/dev/shm/file-app-cross-move-') : path.join(temp, 'destination');
  await fs.mkdir(destination, { recursive: true });
  let db;
  function open() {
    db = new DatabaseSync(path.join(temp, 'state.sqlite'));
    db.exec('CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY,path TEXT)');
  }
  open();
  t.after(async () => {
    db.close(); assert.equal(path.dirname(temp), os.tmpdir()); await fs.rm(temp, { recursive: true, force: true });
    if (realVolume) { assert.equal(path.dirname(destination), '/dev/shm'); await fs.rm(destination, { recursive: true, force: true }); }
  });
  const resolve = async relative => ({ relative, absolute: relative.startsWith('target') ? path.join(destination, relative) : path.join(temp, relative) });
  const source = await resolve('source'), target = await resolve('target');
  await fs.mkdir(source.absolute);
  await fs.writeFile(path.join(source.absolute, 'first.txt'), 'first original file');
  await fs.writeFile(path.join(source.absolute, 'second.txt'), 'second original file');
  for (const relative of ['source', 'source/first.txt', 'source/second.txt']) db.prepare('INSERT INTO shares VALUES (?,?)').run(relative, relative);
  return { temp, destination, resolve, source, target, get db() { return db; }, reopen() { db.close(); open(); return db; } };
}
const crossDevice = async () => { throw Object.assign(new Error('Cross-device'), { code: 'EXDEV' }); };

for (const phase of ['copying', 'copied', 'ready', 'published', 'removed']) {
  test(`cross-filesystem move recovers ${phase} without losing content or shared links`, async t => {
    const f = await fixture(t);
    const journal = createMoveJournal(f.db, f.resolve, async at => {
      if (at !== phase) return;
      if (at === 'published') await fs.rm(path.join(f.source.absolute, 'second.txt'));
      if (at === 'copying') {
        const { id } = f.db.prepare('SELECT id FROM file_moves').get();
        await fs.writeFile(path.join(f.destination, '.app-tmp-' + id, 'payload'), 'partial copy');
      }
      throw new Error('Interrupted transfer');
    }, crossDevice);
    await assert.rejects(journal.move(f.source, f.target), /Interrupted transfer/);
    assert.equal(journal.hasPending(), true);
    for (const relative of ['source', 'source/first.txt', 'target', 'target/first.txt']) assert.equal(journal.blocks(relative), true);
    const recovery = createMoveJournal(f.reopen(), f.resolve);
    await recovery.recover();
    const completed = !['copying', 'copied'].includes(phase);
    const kept = completed ? f.target : f.source, removed = completed ? f.source : f.target;
    assert.equal(await fs.readFile(path.join(kept.absolute, 'first.txt'), 'utf8'), 'first original file');
    assert.equal(await fs.readFile(path.join(kept.absolute, 'second.txt'), 'utf8'), 'second original file');
    await assert.rejects(fs.stat(removed.absolute), { code: 'ENOENT' });
    const prefix = completed ? 'target' : 'source';
    assert.deepEqual(f.db.prepare('SELECT path FROM shares ORDER BY path').all().map(row => row.path), [prefix, prefix + '/first.txt', prefix + '/second.txt']);
    assert.equal(recovery.hasPending(), false);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM file_move_copies').get().n, 0);
    assert.equal((await fs.readdir(f.destination)).some(name => name.startsWith('.app-tmp-')), false);
    await recovery.recover();
  });
}

test('cross-filesystem recovery does not overwrite a new destination', async t => {
  const f = await fixture(t);
  const journal = createMoveJournal(f.db, f.resolve, at => { if (at === 'ready') throw new Error('Stop'); }, crossDevice);
  await assert.rejects(journal.move(f.source, f.target), /Stop/);
  await fs.writeFile(f.target.absolute, 'unrelated destination');
  await assert.rejects(createMoveJournal(f.reopen(), f.resolve).recover(), /ambiguous/);
  assert.equal(await fs.readFile(f.target.absolute, 'utf8'), 'unrelated destination');
  assert.equal(await fs.readFile(path.join(f.source.absolute, 'first.txt'), 'utf8'), 'first original file');
  assert.equal(f.db.prepare('SELECT path FROM shares WHERE id=?').get('source').path, 'source');
});

test('real Linux cross-filesystem move updates directory and child share paths', { skip: process.platform !== 'linux' }, async t => {
  const f = await fixture(t, true);
  assert.notEqual((await fs.stat(f.temp)).dev, (await fs.stat(f.destination)).dev);
  const journal = createMoveJournal(f.db, f.resolve);
  await journal.move(f.source, f.target);
  assert.equal(await fs.readFile(path.join(f.target.absolute, 'first.txt'), 'utf8'), 'first original file');
  assert.equal(await fs.readFile(path.join(f.target.absolute, 'second.txt'), 'utf8'), 'second original file');
  await assert.rejects(fs.stat(f.source.absolute), { code: 'ENOENT' });
  assert.deepEqual(f.db.prepare('SELECT path FROM shares ORDER BY path').all().map(row => row.path), ['target', 'target/first.txt', 'target/second.txt']);
  assert.equal(journal.hasPending(), false);
});
