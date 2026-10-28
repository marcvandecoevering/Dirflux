// Disposable child process for upload crash/restart integration tests.
import { createApp } from '../server.js';
const [files, config, phase] = process.argv.slice(2);
const app = await createApp({ files, config, publicMode: true, secureCookie: false, watch: false, pollingInterval: 0,
  uploadCheckpoint: point => { if (point === phase) process.kill(process.pid, 'SIGKILL'); }
});
const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
