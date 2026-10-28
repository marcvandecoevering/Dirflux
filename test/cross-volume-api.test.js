import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../server.js';

// The container job supplies two distinct disposable tmpfs mounts. Never use
// this fixed directory on a user's host without that explicit test switch.
for (const phase of ['normal', 'published', 'removed']) test(`HTTP transfer across mounted filesystems: ${phase}`, {
  skip: process.env.FILE_APP_CROSS_VOLUME_TEST !== '1'
}, async t => {
  assert.equal(process.platform, 'linux');
  const root = '/cross-files', second = '/cross-files/volume';
  assert.notEqual((await fs.stat(root)).dev, (await fs.stat(second)).dev);
  const config = await fs.mkdtemp(path.join(os.tmpdir(), 'file-app-cross-http-'));
  const name = 'test-' + crypto.randomUUID(), target = 'volume/' + name;
  let app, server, base;
  async function start(extra = {}) {
    app = await createApp({ files: root, config, ...extra }); server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); app.close(); server = null; } }
  t.after(async () => {
    await stop(); assert.equal(path.dirname(config), os.tmpdir());
    await fs.rm(config, { recursive: true, force: true });
    for (const file of [path.join(root, name), path.join(second, name)]) {
      assert.ok([root, second].includes(path.dirname(file)) && path.basename(file) === name);
      await fs.rm(file, { recursive: true, force: true });
    }
  });
  await start({ moveCheckpoint: at => { if (at === phase) throw Object.assign(new Error('Interrupted cross-volume API transfer'), { status: 503 }); } });
  const setupToken = (await fs.readFile(path.join(config, 'setup-token'), 'utf8')).trim();
  const setup = await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: 'cross-volume-test-password', setupToken }) });
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get('set-cookie').split(';')[0], csrf = (await setup.json()).csrf;
  const post = (route, body) => fetch(base + '/api' + route, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await fs.mkdir(path.join(root, name)); await fs.writeFile(path.join(root, name, 'child.txt'), 'mounted filesystem content');
  const shared = await post('/shares', { path: name + '/child.txt' }); assert.equal(shared.status, 201);
  const url = (await shared.json()).url;
  const moved = await post('/transfer', { source: name, target, operation: 'move' });
  assert.equal(moved.status, phase === 'normal' ? 200 : 503);
  if (phase !== 'normal') assert.equal((await fetch(base + url)).status, 503);
  await stop(); await start();
  const download = await fetch(base + url); assert.equal(download.status, 200); assert.equal(await download.text(), 'mounted filesystem content');
  await assert.rejects(fs.stat(path.join(root, name)), { code: 'ENOENT' });
  // Reusing the old name must not redirect the public link to unrelated data.
  await fs.mkdir(path.join(root, name)); await fs.writeFile(path.join(root, name, 'child.txt'), 'unrelated');
  assert.equal(await fetch(base + url).then(response => response.text()), 'mounted filesystem content');
  assert.equal((await post('/transfer', { source: target, target: name, operation: 'move' })).status, 409);
  await fs.rm(path.join(root, name), { recursive: true });
  assert.equal((await post('/transfer', { source: target, target: name, operation: 'move' })).status, 200);
  assert.equal(await fetch(base + url).then(response => response.text()), 'mounted filesystem content');
});
