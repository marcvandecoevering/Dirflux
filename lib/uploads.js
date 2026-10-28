import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Record only app-owned temporary paths, never the final upload destination.
// A killed process can leave a receiving file or a published hard link behind;
// removing the temporary names must not remove the published file's contents.
export function createUploadJournal(db, resolve, temporaryDirectory) {
  db.exec('CREATE TABLE IF NOT EXISTS upload_files (id TEXT PRIMARY KEY, directory TEXT)');
  function validate(id) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid upload recovery record; preserve storage and investigate.');
  }
  async function unlink(file) {
    try { await fs.unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async function cleanup(id) {
    validate(id);
    const row = db.prepare('SELECT * FROM upload_files WHERE id=?').get(id);
    if (!row) return;
    if (row.directory !== null) {
      const parent = await resolve(row.directory, false);
      await unlink(path.join(parent.absolute, '.app-tmp-upload-' + id));
    }
    await unlink(path.join(temporaryDirectory, id));
    db.prepare('DELETE FROM upload_files WHERE id=?').run(id);
  }
  return {
    begin() {
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO upload_files VALUES (?,NULL)').run(id);
      return { id, temporary: path.join(temporaryDirectory, id) };
    },
    async stage(id, directory) {
      validate(id);
      const parent = await resolve(directory, false);
      const updated = db.prepare('UPDATE upload_files SET directory=? WHERE id=?').run(parent.relative, id);
      if (updated.changes !== 1) throw new Error('Upload recovery record is missing.');
      return path.join(parent.absolute, '.app-tmp-upload-' + id);
    },
    cleanup,
    async recover() { for (const row of db.prepare('SELECT id FROM upload_files').all()) await cleanup(row.id); }
  };
}
