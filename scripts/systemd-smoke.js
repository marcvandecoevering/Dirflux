// Explicit Linux/root-only integration check against a running systemd manager.
// Installs one temporary runtime unit; never enables it or replaces a real unit.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Requires Linux, root, running systemd and Node 24.');
const manifest = process.argv[2] ? null : JSON.parse(await fs.readFile('package.json', 'utf8'));
const archive = path.resolve(process.argv[2] || `${manifest.name}-${manifest.version}.tgz`);
assert.equal((await fs.readFile('/proc/1/comm', 'utf8')).trim(), 'systemd');
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const name = 'file-app-smoke-' + crypto.randomUUID().slice(0, 12);
const temp = await fs.mkdtemp('/opt/file-app-systemd-');
const state = '/var/lib/' + name, unit = '/run/systemd/system/' + name + '.service';
const service = name + '.service';
let installed = false, accountCreated = false;
try {
  run('useradd', ['--system', '--user-group', '--no-create-home', '--shell', '/usr/sbin/nologin', name]); accountCreated = true;
  await fs.chmod(temp, 0o755);
  // PrivateTmp hides /tmp and /var/tmp, including a runtime downloaded there.
  const serviceNode = path.join(temp, 'node');
  await fs.copyFile(process.execPath, serviceNode); await fs.chmod(serviceNode, 0o755);
  run('tar', ['-xzf', archive, '-C', temp]);
  const release = path.join(temp, 'package');
  execFileSync(path.join(path.dirname(process.execPath), 'npm'), ['ci', '--omit=dev', '--ignore-scripts'], {
    cwd: release, encoding: 'utf8', timeout: 120000, env: { ...process.env, PATH: path.dirname(process.execPath) + ':' + process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await new Promise(resolve => probe.once('listening', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const env = path.join(temp, 'server.env');
  await fs.writeFile(env, `HOST=127.0.0.1\nPORT=${port}\nFILES_DIR=${state}/files\nCONFIG_DIR=${state}/config\nPUBLIC_MODE=false\nCOOKIE_SECURE=false\n`);
  const sandbox = path.join(temp, 'check-sandbox.mjs');
  await fs.writeFile(sandbox, `import fs from 'node:fs/promises'; import assert from 'node:assert/strict'; assert.notEqual(process.getuid(),0); await assert.rejects(fs.writeFile(${JSON.stringify(path.join(release, 'must-not-write'))},'x'),e=>['EROFS','EACCES'].includes(e.code));`);
  let template = await fs.readFile(path.join(release, 'deploy/file-manager.service'), 'utf8');
  template = template.replaceAll('/srv/file-manager/files', state).replaceAll('/var/lib/file-manager', state)
    .replace('User=file-manager', 'User=' + name).replace('Group=file-manager', 'Group=' + name)
    .replace('/opt/file-manager/current', release).replace('/usr/bin/node', serviceNode)
    .replace('/etc/file-manager/server.env', env).replace('StateDirectory=file-manager', 'StateDirectory=' + name)
    .replace('RestartSec=5', 'RestartSec=1')
    .replace('ExecStart=', `ExecStartPre=${serviceNode} ${sandbox}\nExecStart=`);
  await fs.writeFile(unit, template, { flag: 'wx' }); installed = true;
  run('systemd-analyze', ['verify', unit]); run('systemctl', ['daemon-reload']); run('systemctl', ['start', service]);
  const base = `http://127.0.0.1:${port}`;
  async function healthy() {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(base + '/api/health', { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Service did not become healthy');
  }
  await healthy();
  const pid = run('systemctl', ['show', service, '--property=MainPID', '--value']);
  const status = await fs.readFile('/proc/' + pid + '/status', 'utf8');
  const uid = Number(status.match(/^Uid:\s+(\d+)/m)[1]); assert.notEqual(uid, 0);
  assert.match(status, /^NoNewPrivs:\s+1$/m); assert.match(status, /^CapEff:\s+0+$/m);
  const token = (await fs.readFile(state + '/config/setup-token', 'utf8')).trim();
  const setup = await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: 'systemd-smoke-password', setupToken: token }) });
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get('set-cookie').split(';')[0], csrf = (await setup.json()).csrf;
  const headers = { Cookie: cookie, 'X-CSRF-Token': csrf };
  const upload = await fetch(base + '/api/upload?path=service.txt', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: 'native service persistence' });
  assert.equal(upload.status, 201);
  assert.equal((await fs.stat(state + '/files/service.txt')).uid, uid);
  assert.equal((await fs.stat(state + '/config')).mode & 0o077, 0);
  run('systemctl', ['kill', '--signal=SIGKILL', service]);
  for (let attempt = 0; attempt < 100; attempt++) {
    const next = run('systemctl', ['show', service, '--property=MainPID', '--value']);
    if (next !== '0' && next !== pid) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await healthy();
  assert.notEqual(run('systemctl', ['show', service, '--property=MainPID', '--value']), pid);
  const download = await fetch(base + '/api/file?path=service.txt', { headers });
  assert.equal(download.status, 200); assert.equal(await download.text(), 'native service persistence');
  run('systemctl', ['stop', service]);
  assert.equal(run('systemctl', ['show', service, '--property=Result', '--value']), 'success');
  console.log('Systemd service passed: production archive, unprivileged UID, no capabilities, read-only application, private config, automatic crash restart, persistent account/file, graceful stop.');
} catch (error) {
  if (installed) console.error(run('journalctl', ['-u', service, '-n', '30', '--no-pager']));
  throw error;
} finally {
  if (installed) {
    try { run('systemctl', ['stop', service]); } catch {}
    await fs.unlink(unit); run('systemctl', ['daemon-reload']);
    try { run('systemctl', ['reset-failed', service]); } catch {}
  }
  if (accountCreated) run('userdel', [name]);
  assert.equal(path.dirname(temp), '/opt'); assert.ok(path.basename(temp).startsWith('file-app-systemd-'));
  assert.equal(path.dirname(state), '/var/lib'); assert.equal(path.basename(state), name);
  await fs.rm(temp, { recursive: true, force: true }); await fs.rm(state, { recursive: true, force: true });
}
