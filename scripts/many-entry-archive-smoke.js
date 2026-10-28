// Dedicated ZIP64 entry-count boundary check; kept out of the quick test suite.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inflateRawSync, crc32 } from 'node:zlib';
import { createApp } from '../server.js';

if (process.platform !== 'linux') throw new Error('Run this large-directory check in the Linux test container.');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zip64-count-smoke-'));
const count = 65540;
const name = index => `entry-${String(index).padStart(5, '0')}.txt`;
const contents = index => index === 0 || index === count - 1 ? Buffer.from(`boundary ${index}\n`) : Buffer.alloc(0);
let app, server;
try {
  app = await createApp({ files: path.join(temporary, 'files'), config: path.join(temporary, 'config'), publicMode: true, watch: false, pollingInterval: 0 });
  for (let first = 0; first < count; first += 64) {
    await Promise.all(Array.from({ length: Math.min(64, count - first) }, (_, offset) => fs.writeFile(path.join(app.root, name(first + offset)), contents(first + offset))));
  }
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(base + '/api/session'); assert.equal(session.status, 200);
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const response = await fetch(base + '/api/zip', { headers: { Cookie: cookie }, signal: AbortSignal.timeout(240000) });
  assert.equal(response.status, 200);
  const download = path.join(temporary, 'download.zip');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(download));
  assert.ok((await fs.stat(download)).size < 32 * 1024 ** 2, 'Synthetic archive must stay within the parser memory budget');
  const bytes = await fs.readFile(download), end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt16LE(end + 10), 0xffff, 'Classic entry count must use the ZIP64 sentinel');
  const locator = end - 20;
  assert.equal(bytes.readUInt32LE(locator), 0x07064b50);
  const zip64 = Number(bytes.readBigUInt64LE(locator + 8));
  assert.ok(Number.isSafeInteger(zip64) && zip64 >= 0 && zip64 + 56 <= locator);
  assert.equal(bytes.readUInt32LE(zip64), 0x06064b50);
  assert.equal(bytes.readBigUInt64LE(zip64 + 24), BigInt(count));
  assert.equal(bytes.readBigUInt64LE(zip64 + 32), BigInt(count));
  const centralSize = Number(bytes.readBigUInt64LE(zip64 + 40));
  const centralStart = Number(bytes.readBigUInt64LE(zip64 + 48));
  assert.equal(centralStart + centralSize, zip64);
  const seen = new Set(); let cursor = centralStart;
  for (let entry = 0; entry < count; entry++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    const filename = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    assert.match(filename, /^entry-\d{5}\.txt$/);
    const index = Number(filename.slice(6, 11)); assert.ok(index < count); assert.equal(filename, name(index));
    assert.equal(seen.has(filename), false, 'Duplicate central-directory entry'); seen.add(filename);
    const local = bytes.readUInt32LE(cursor + 42); assert.ok(local < centralStart);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    const localNameLength = bytes.readUInt16LE(local + 26);
    assert.equal(bytes.subarray(local + 30, local + 30 + localNameLength).toString('utf8'), filename);
    const start = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
    const compressedSize = bytes.readUInt32LE(cursor + 20), method = bytes.readUInt16LE(cursor + 10);
    assert.ok(start + compressedSize <= centralStart); assert.ok(method === 0 || method === 8);
    const packed = bytes.subarray(start, start + compressedSize), content = method === 8 ? inflateRawSync(packed) : packed;
    assert.deepEqual(content, contents(index));
    assert.equal(content.length, bytes.readUInt32LE(cursor + 24));
    assert.equal(crc32(content), bytes.readUInt32LE(cursor + 16));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(cursor, zip64); assert.equal(seen.size, count);
  console.log(`ZIP64 entry count passed: ${count} unique files, every path/content/CRC checked, ${bytes.length} downloaded bytes.`);
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  app?.close();
  if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('zip64-count-smoke-')) throw new Error('Unsafe cleanup path');
  await fs.rm(temporary, { recursive: true, force: true });
}
