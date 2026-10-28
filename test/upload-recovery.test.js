import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';
import crypto from 'node:crypto';

for (const phase of ['receiving', 'staged', 'published']) for (const replace of [false, true]) {
  test(`killed ${replace ? 'replacement' : 'new'} upload at ${phase} cleans only its temporary paths on restart`, { timeout: 20000 }, async t => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'file-app-upload-crash-'));
    const files = path.join(temp, 'files'), config = path.join(temp, 'config');
    const child = fork(new URL('../scripts/upload-crash-worker.js', import.meta.url), [files, config, phase], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
    const exited = once(child, 'exit'); let recovery, pending;
    let stderr = ''; child.stderr.on('data', data => { stderr = (stderr + data).slice(-10000); });
    t.after(async () => {
      pending?.destroy();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited; recovery?.close();
      assert.equal(path.dirname(temp), os.tmpdir()); await fs.rm(temp, { recursive: true, force: true });
    });
    const startup = await Promise.race([once(child, 'message').then(([message]) => message), exited.then(() => { throw new Error('Worker exited before startup: ' + stderr); })]);
    const base = `http://127.0.0.1:${startup.port}`;
    const session = await fetch(base + '/api/session'); assert.equal(session.status, 200);
    const headers = { Cookie: session.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': (await session.json()).csrf };
    const destination = path.join(files, 'file.txt');
    await fs.writeFile(path.join(files, '.app-tmp-unrelated'), 'unrelated user file');
    await fs.writeFile(path.join(config, 'tmp', 'unrelated.txt'), 'untracked config file');
    let query = 'path=file.txt';
    if (replace) {
      await fs.writeFile(destination, 'original bytes');
      const target = await fetch(base + '/api/upload-target?path=file.txt', { headers }); assert.equal(target.status, 200);
      query += '&conflict=replace&version=' + (await target.json()).version;
    }
    if (phase === 'receiving') {
      pending = http.request(base + '/api/upload?' + query, { method: 'PUT', headers });
      pending.on('error', () => {}); pending.write('partial incoming bytes');
      const deadline = Date.now() + 5000;
      for (;;) {
        const names = (await fs.readdir(path.join(config, 'tmp'))).filter(name => name !== 'unrelated.txt');
        if (names.length && (await fs.stat(path.join(config, 'tmp', names[0]))).size > 0) break;
        assert.ok(Date.now() < deadline, 'Receiving file was not created'); await new Promise(resolve => setTimeout(resolve, 10));
      }
      child.kill('SIGKILL');
    } else {
      await assert.rejects(fetch(base + '/api/upload?' + query, { method: 'PUT', headers, body: 'complete new bytes', signal: AbortSignal.timeout(10000) }));
    }
    const [code, signal] = await exited; assert.ok(code !== 0 || signal, 'Worker must have been interrupted');
    const before = new DatabaseSync(path.join(config, 'state.sqlite'));
    assert.equal(before.prepare('SELECT count(*) AS n FROM upload_files').get().n, 1); before.close();
    recovery = await createApp({ files, config, publicMode: true, watch: false, pollingInterval: 0 });
    assert.deepEqual(await fs.readdir(path.join(config, 'tmp')), ['unrelated.txt']);
    assert.equal((await fs.readdir(files)).filter(name => name.startsWith('.app-tmp-upload-')).length, 0);
    assert.equal(await fs.readFile(path.join(files, '.app-tmp-unrelated'), 'utf8'), 'unrelated user file');
    assert.equal(await fs.readFile(path.join(config, 'tmp', 'unrelated.txt'), 'utf8'), 'untracked config file');
    if (phase === 'published') assert.equal(await fs.readFile(destination, 'utf8'), 'complete new bytes');
    else if (replace) assert.equal(await fs.readFile(destination, 'utf8'), 'original bytes');
    else await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
    const after = new DatabaseSync(path.join(config, 'state.sqlite'));
    assert.equal(after.prepare('SELECT count(*) AS n FROM upload_files').get().n, 0); after.close();
    recovery.close(); recovery = await createApp({ files, config, publicMode: true, watch: false, pollingInterval: 0 });
  });
}

test('upload recovery refuses a replaced parent directory without touching external content', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'file-app-upload-parent-'));
  const files = path.join(temp, 'files'), config = path.join(temp, 'config'), outside = path.join(temp, 'outside');
  const initial = await createApp({ files, config, watch: false, pollingInterval: 0 }); initial.close();
  t.after(async () => { assert.equal(path.dirname(temp), os.tmpdir()); await fs.rm(temp, { recursive: true, force: true }); });
  const id = crypto.randomUUID(); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, '.app-tmp-upload-' + id), 'must survive');
  await fs.symlink(outside, path.join(files, 'replaced'), process.platform === 'win32' ? 'junction' : 'dir');
  const db = new DatabaseSync(path.join(config, 'state.sqlite'));
  db.prepare('INSERT INTO upload_files VALUES (?,?)').run(id, 'replaced'); db.close();
  await assert.rejects(createApp({ files, config }), error => error.status === 403);
  assert.equal(await fs.readFile(path.join(outside, '.app-tmp-upload-' + id), 'utf8'), 'must survive');
});

test('upload recovery rejects a malformed temporary identifier', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'file-app-upload-id-'));
  const files = path.join(temp, 'files'), config = path.join(temp, 'config');
  const initial = await createApp({ files, config, watch: false, pollingInterval: 0 }); initial.close();
  t.after(async () => { assert.equal(path.dirname(temp), os.tmpdir()); await fs.rm(temp, { recursive: true, force: true }); });
  await fs.writeFile(path.join(config, 'preserve.txt'), 'must survive');
  const db = new DatabaseSync(path.join(config, 'state.sqlite'));
  db.prepare('INSERT INTO upload_files VALUES (?,NULL)').run('../preserve.txt'); db.close();
  await assert.rejects(createApp({ files, config }), /Invalid upload recovery record/);
  assert.equal(await fs.readFile(path.join(config, 'preserve.txt'), 'utf8'), 'must survive');
});
