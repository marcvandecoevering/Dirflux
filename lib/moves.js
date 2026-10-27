import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const within = (candidate, directory) => candidate === directory || candidate.startsWith(directory + '/');
const identity = st => [st.dev, st.ino, st.birthtimeNs].map(String).join(':');

// Persist intent before touching the filesystem. A process restart can then
// identify which side of an atomic rename contains the original object.
export function createMoveJournal(db, resolve, checkpoint = async () => {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS file_moves (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, target TEXT NOT NULL,
    identity TEXT NOT NULL, links TEXT NOT NULL
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
      db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }
  async function recoverOne(row) {
    const source=await matches(row.source,row.identity),target=await matches(row.target,row.identity);
    if(source===target) throw new Error(`Move recovery is ambiguous (${row.id}); preserve both storage directories and investigate before restarting.`);
    finish(row,target);
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
      try { await fs.rename(source.absolute,target.absolute); }
      catch(error) { await recoverOne(row);throw error; }
      await checkpoint('renamed');
      finish(row,true);
    }
  };
}
