import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

test('configuration directory permits one app and unlocks after normal close', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'file-app-instance-'));
  const options = { files: path.join(temp, 'files'), config: path.join(temp, 'config'), watch: false, pollingInterval: 0 };
  let first, second, independent;
  t.after(async () => { first?.close(); second?.close(); independent?.close(); assert.equal(path.dirname(temp), os.tmpdir()); await fs.rm(temp, { recursive: true, force: true }); });
  first = await createApp(options);
  await assert.rejects(createApp(options), { code: 'APP_ALREADY_RUNNING' });
  independent = await createApp({ ...options, files: path.join(temp, 'other-files'), config: path.join(temp, 'other-config') });
  first.close(); first.close();
  second = await createApp(options);
  await assert.rejects(createApp(options), { code: 'APP_ALREADY_RUNNING' });
});

test('failed startup releases its instance lock and startup resources', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'file-app-startup-failure-'));
  const options = { files: path.join(temp, 'files'), config: path.join(temp, 'config'), pollingInterval: 100 };
  let instance;
  t.after(async () => { instance?.close(); assert.equal(path.dirname(temp), os.tmpdir()); await fs.rm(temp, { recursive: true, force: true }); });
  await fs.mkdir(options.config); await fs.writeFile(path.join(options.config, 'setup-token'), 'invalid');
  await assert.rejects(createApp(options), /Invalid setup token file/);
  await fs.writeFile(path.join(options.config, 'setup-token'), 'valid-test-setup-token-with-at-least-32-characters');
  instance = await createApp(options);
  assert.equal(instance.setupTokenRequired, true);
});
