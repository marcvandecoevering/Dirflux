import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

const within = (candidate, directory) => candidate === directory || candidate.startsWith(directory + '/');
const identity = st => [st.dev, st.ino, st.birthtimeNs].map(String).join(':');

// Persist intent before touching the filesystem. A process restart can then
// identify which side of an atomic rename contains the original object.
export function createMoveJournal(db, resolve, checkpoint = async () => {}, rename = fs.rename) {
  db.exec(`CREATE TABLE IF NOT EXISTS file_moves (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, target TEXT NOT NULL,
    identity TEXT NOT NULL, links TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS file_move_copies (
    id TEXT PRIMARY KEY, phase TEXT NOT NULL, identity TEXT
  )`);
  const pending = () => db.prepare('SELECT * FROM file_moves').all();
  async function matches(relative, expected) {
    try {
      const {absolute}=await resolve(relative);
      return identity(await fs.lstat(absolute,{bigint:true})) === expected;
    } catch(error) {
      if(error.code==='ENOENT'||error.status===403)return false;
      throw error;
    }
  }
  function finish(row, moved) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if(moved) for(const link of JSON.parse(row.links)) {
        db.prepare('UPDATE shares SET path=? WHERE id=? AND path=?').run(link.to,link.id,link.from);
      }
      db.prepare('DELETE FROM file_moves WHERE id=?').run(row.id);
      db.prepare('DELETE FROM file_move_copies WHERE id=?').run(row.id);
      db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }
  async function recoverOne(row) {
    const copy = db.prepare('SELECT * FROM file_move_copies WHERE id=?').get(row.id);
    if (copy) return recoverCopy(row, copy);
    const source=await matches(row.source,row.identity),target=await matches(row.target,row.identity);
    if(source===target) throw new Error(`Move recovery is ambiguous (${row.id}); preserve both storage directories and investigate before restarting.`);
    finish(row,target);
  }
  const ambiguous = row => new Error(`Move recovery is ambiguous (${row.id}); preserve both storage directories and investigate before restarting.`);
  async function identify(absolute) {
    try { const st = await fs.lstat(absolute, { bigint: true }); return st.isSymbolicLink() ? 'symlink' : identity(st); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  function staging(row, target) {
    if (!/^[a-f0-9-]{36}$/.test(row.id)) throw ambiguous(row);
    return path.join(path.dirname(target), '.app-tmp-' + row.id);
  }
  async function recoverCopy(row, copy) {
    const source = (await resolve(row.source, false)).absolute;
    const target = (await resolve(row.target, false)).absolute;
    const stage = staging(row, target);
    const sourceId = await identify(source), targetId = await identify(target);
    if (copy.phase === 'copying') {
      if (sourceId !== row.identity || targetId !== null) throw ambiguous(row);
      await fs.rm(stage, { recursive: true, force: true });
      return finish(row, false);
    }
    if (copy.phase !== 'ready' || !copy.identity || (sourceId !== null && sourceId !== row.identity)) throw ambiguous(row);
    if (targetId === null) {
      if (sourceId !== row.identity || await identify(path.join(stage, 'payload')) !== copy.identity) throw ambiguous(row);
      await fs.rename(path.join(stage, 'payload'), target);
    } else if (targetId !== copy.identity) throw ambiguous(row);
    await checkpoint('published');
    if (sourceId !== null) await fs.rm(source, { recursive: true });
    await checkpoint('removed');
    await fs.rm(stage, { recursive: true, force: true });
    finish(row, true);
  }
  return {
    hasPending: () => pending().length > 0,
    blocks: relative => pending().some(row => within(relative,row.source)||within(relative,row.target)||within(row.source,relative)||within(row.target,relative)),
    async recover() { for(const row of pending()) await recoverOne(row); },
    async move(source,target) {
      const row={id:crypto.randomUUID(),source:source.relative,target:target.relative,
        identity:identity(await fs.lstat(source.absolute,{bigint:true})),
        links:JSON.stringify(db.prepare('SELECT id,path FROM shares').all().filter(link=>within(link.path,source.relative)).map(link=>({
          id:link.id,from:link.path,to:target.relative+link.path.slice(source.relative.length)
        })))};
      db.prepare('INSERT INTO file_moves VALUES (?,?,?,?,?)').run(row.id,row.source,row.target,row.identity,row.links);
      await checkpoint('prepared');
      try { await rename(source.absolute,target.absolute); }
      catch(error) {
        if (error.code !== 'EXDEV') { await recoverOne(row);throw error; }
        const stage = staging(row, target.absolute);
        db.prepare('INSERT INTO file_move_copies VALUES (?,?,?)').run(row.id, 'copying', null);
        await fs.mkdir(stage);
        await checkpoint('copying');
        try {
          await fs.cp(source.absolute, path.join(stage, 'payload'), {
            recursive: true, force: false, errorOnExist: true,
            filter: async file => {
              if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Symbolische links worden niet tussen bestandssystemen verplaatst.');
              return true;
            }
          });
        } catch (copyError) { await recoverOne(row); throw copyError; }
        await checkpoint('copied');
        const copiedId = await identify(path.join(stage, 'payload'));
        db.prepare('UPDATE file_move_copies SET phase=?,identity=? WHERE id=?').run('ready', copiedId, row.id);
        await checkpoint('ready');
        await recoverOne(row);
        return;
      }
      await checkpoint('renamed');
      finish(row,true);
    }
  };
}
