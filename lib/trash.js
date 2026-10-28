import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const identity = st => [st.dev, st.ino, st.birthtimeNs].map(String).join(':');
async function identify(file) {
  try { const st = await fs.lstat(file, { bigint: true }); return st.isSymbolicLink() ? 'symlink' : identity(st); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// The SQLite intent precedes filesystem changes. Cross-device copies remain in
// a reserved staging directory until complete; only then may cleanup begin.
export function createTrashJournal(db, resolve, trashDir, checkpoint = async () => {}, rename = fs.rename) {
  db.exec('CREATE TABLE IF NOT EXISTS trash_operations (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  const pending = () => db.prepare('SELECT data FROM trash_operations').all().map(row => JSON.parse(row.data));
  const persist = row => db.prepare('INSERT OR REPLACE INTO trash_operations VALUES (?,?)').run(row.id, JSON.stringify(row));
  const ambiguous = row => new Error(`Trash recovery is ambiguous (${row.id}); preserve both storage directories and investigate before restarting.`);
  async function paths(row) {
    if (!/^[a-f0-9-]{36}$/.test(row.id) || !/^[a-f0-9-]{36}$/.test(row.item.id) || !['trash', 'restore'].includes(row.kind)) throw ambiguous(row);
    const file = (await resolve(row.item.path, false)).absolute;
    const stored = path.join(trashDir, row.item.id);
    const source = row.kind === 'trash' ? file : stored;
    const target = row.kind === 'trash' ? stored : file;
    return { source, target, stage: path.join(path.dirname(target), '.app-tmp-' + row.id) };
  }
  function finish(row, completed) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (completed && row.kind === 'trash') {
        const { id, path: relative, deleted, owner } = row.item;
        db.prepare('INSERT INTO trash VALUES (?,?,?,?)').run(id, relative, deleted, owner);
        for (const share of db.prepare('SELECT id,path FROM shares').all()) {
          if (share.path === relative || share.path.startsWith(relative + '/')) db.prepare('DELETE FROM shares WHERE id=?').run(share.id);
        }
      } else if (completed) db.prepare('DELETE FROM trash WHERE id=?').run(row.item.id);
      db.prepare('DELETE FROM trash_operations WHERE id=?').run(row.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  async function recoverOne(row) {
    const { source, target, stage } = await paths(row);
    const sourceId = await identify(source), targetId = await identify(target);
    if (row.phase === 'prepared') {
      if (targetId === row.sourceId && sourceId !== row.sourceId) return finish(row, true);
      if (sourceId === row.sourceId && targetId === null) return finish(row, false);
      throw ambiguous(row);
    }
    if (row.phase === 'copying') {
      if (sourceId !== row.sourceId || targetId !== null) throw ambiguous(row);
      await fs.rm(stage, { recursive: true, force: true });
      return finish(row, false);
    }
    if (row.phase !== 'ready' || !row.copyId || (sourceId !== null && sourceId !== row.sourceId)) throw ambiguous(row);
    if (targetId === null) {
      if (sourceId !== row.sourceId || await identify(path.join(stage, 'payload')) !== row.copyId) throw ambiguous(row);
      await fs.rename(path.join(stage, 'payload'), target);
    } else if (targetId !== row.copyId) throw ambiguous(row);
    await checkpoint('published', row.kind);
    // A restart during recursive cleanup resumes against the same source object.
    if (sourceId !== null) await fs.rm(source, { recursive: true });
    await checkpoint('removed', row.kind);
    await fs.rm(stage, { recursive: true, force: true });
    finish(row, true);
  }
  return {
    hasPending: () => pending().length > 0,
    blocks: relative => pending().some(row => relative === row.item.path || relative.startsWith(row.item.path + '/') || row.item.path.startsWith(relative + '/')),
    async recover() { for (const row of pending()) await recoverOne(row); },
    async move(kind, item) {
      const row = { id: crypto.randomUUID(), kind, item, phase: 'prepared' };
      const { source, target, stage } = await paths(row);
      row.sourceId = await identify(source);
      if (!row.sourceId || row.sourceId === 'symlink') throw new Error('Prullenbakbron ontbreekt of is een symbolische link.');
      if (await identify(target) !== null) throw new Error('Prullenbakdoel bestaat al.');
      persist(row);
      await checkpoint('prepared', kind);
      try { await rename(source, target); }
      catch (error) {
        if (error.code !== 'EXDEV') { await recoverOne(row); throw error; }
        row.phase = 'copying'; persist(row);
        await fs.mkdir(stage);
        await checkpoint('copying', kind);
        try {
          await fs.cp(source, path.join(stage, 'payload'), {
            recursive: true, force: false, errorOnExist: true,
            filter: async file => {
              if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Symbolische links worden niet naar de prullenbak gekopieerd.');
              return true;
            }
          });
        } catch (error) { await recoverOne(row); throw error; }
        await checkpoint('copied', kind);
        row.copyId = await identify(path.join(stage, 'payload'));
        row.phase = 'ready'; persist(row);
        await checkpoint('ready', kind);
        await recoverOne(row);
        return;
      }
      await checkpoint('renamed', kind);
      finish(row, true);
    }
  };
}
