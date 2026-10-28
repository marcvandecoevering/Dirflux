import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

// A dedicated SQLite connection holds an OS-backed lock for the app lifetime.
// Do not unlink this file: doing so could let another process lock a new inode.
// Process termination releases the lock without stale PID-file heuristics.
export function acquireInstanceLock(config) {
  const lock = new DatabaseSync(path.join(config, 'instance-lock.sqlite'));
  try {
    lock.exec('PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS instance_guard (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE;');
  } catch (error) {
    lock.close();
    if (error.errcode === 5 || error.errcode === 6) throw Object.assign(new Error('This configuration directory is already in use by another application process.'), { code: 'APP_ALREADY_RUNNING', cause: error });
    throw error;
  }
  let closed = false;
  return { close() { if (!closed) { closed = true; lock.close(); } } };
}
