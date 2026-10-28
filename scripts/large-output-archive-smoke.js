// Explicit disk-backed smoke check: needs ~4.1 GiB free, never buffers the ZIP.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inflateRawSync, crc32 } from 'node:zlib';
import { createApp } from '../server.js';

if (process.platform !== 'linux' || !process.argv[2]) throw new Error('Run in Linux with an explicit disposable disk-backed storage directory.');
const storage = await fs.realpath(process.argv[2]);
const disk = await fs.statfs(storage);
assert.ok(disk.bavail * disk.bsize > 6 * 1024 ** 3, 'At least 6 GiB free storage required');
const temporary = await fs.mkdtemp(path.join(storage, 'zip64-output-smoke-'));
const count = 32770, source = crypto.randomBytes(128 * 1024), expectedCrc = crc32(source);
const filename = index => `entry-${String(index).padStart(5, '0')}.bin`;
let app, server, archive;
async function read(length, position) {
  assert.ok(Number.isSafeInteger(position) && position >= 0);
  const buffer = Buffer.alloc(length); let done = 0;
  while (done < length) { const result = await archive.read(buffer, done, length - done, position + done); assert.ok(result.bytesRead > 0, 'Unexpected ZIP EOF'); done += result.bytesRead; }
  return buffer;
}
try {
  app = await createApp({ files: path.join(temporary, 'files'), config: path.join(temporary, 'config'), publicMode: true, watch: false, pollingInterval: 0 });
  const original = path.join(app.root, filename(0)); await fs.writeFile(original, source);
  for (let first = 1; first < count; first += 64) await Promise.all(Array.from({ length: Math.min(64, count - first) }, (_, offset) => fs.link(original, path.join(app.root, filename(first + offset)))));
  assert.equal((await fs.stat(original)).nlink, count);
  console.log(`ZIP64 output: ${count} hard-linked fixtures ready; only ${source.length} source bytes allocated.`);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(base + '/api/session'); assert.equal(session.status, 200);
  const response = await fetch(base + '/api/zip', { headers: { Cookie: session.headers.get('set-cookie').split(';')[0] }, signal: AbortSignal.timeout(900000) });
  assert.equal(response.status, 200);
  let received = 0, reported = 0;
  const progress = new Transform({ transform(chunk, _encoding, callback) {
    received += chunk.length;
    if (Math.floor(received / 1024 ** 3) > reported) { reported = Math.floor(received / 1024 ** 3); console.log(`ZIP64 output: ${reported} GiB received.`); }
    callback(null, chunk);
  } });
  const output = path.join(temporary, 'download.zip');
  await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(output));
  const size = (await fs.stat(output)).size; assert.equal(received, size); assert.ok(size > 2 ** 32);
  archive = await fs.open(output, 'r');
  const tail = await read(42, size - 42);
  assert.equal(tail.readUInt32LE(20), 0x06054b50); assert.equal(tail.readUInt32LE(0), 0x07064b50);
  assert.equal(tail.readUInt32LE(36), 0xffffffff, 'Classic central offset must use ZIP64 sentinel');
  const zip64Offset = Number(tail.readBigUInt64LE(8));
  const zip64 = await read(56, zip64Offset); assert.equal(zip64.readUInt32LE(0), 0x06064b50);
  assert.equal(zip64.readBigUInt64LE(32), BigInt(count));
  const centralSize = Number(zip64.readBigUInt64LE(40)), centralStart = Number(zip64.readBigUInt64LE(48));
  assert.ok(centralStart > 2 ** 32); assert.ok(centralSize < 8 * 1024 ** 2); assert.equal(centralStart + centralSize, zip64Offset);
  const central = await read(centralSize, centralStart); let cursor = 0, largeOffsets = 0;
  const seen = new Set();
  for (let entry = 0; entry < count; entry++) {
    assert.equal(central.readUInt32LE(cursor), 0x02014b50);
    const nameLength = central.readUInt16LE(cursor + 28), extraLength = central.readUInt16LE(cursor + 30), commentLength = central.readUInt16LE(cursor + 32);
    const name = central.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    assert.match(name, /^entry-\d{5}\.bin$/); const index = Number(name.slice(6, 11)); assert.ok(index < count);
    assert.equal(seen.has(name), false); seen.add(name);
    assert.equal(central.readUInt32LE(cursor + 16), expectedCrc);
    let unpacked = central.readUInt32LE(cursor + 24), compressed = central.readUInt32LE(cursor + 20), local = central.readUInt32LE(cursor + 42);
    if ([unpacked, compressed, local].includes(0xffffffff)) {
      let found = false;
      for (let extra = cursor + 46 + nameLength; extra < cursor + 46 + nameLength + extraLength;) {
        const id = central.readUInt16LE(extra), length = central.readUInt16LE(extra + 2);
        if (id === 1) {
          let at = extra + 4;
          if (unpacked === 0xffffffff) { unpacked = Number(central.readBigUInt64LE(at)); at += 8; }
          if (compressed === 0xffffffff) { compressed = Number(central.readBigUInt64LE(at)); at += 8; }
          if (local === 0xffffffff) { local = Number(central.readBigUInt64LE(at)); at += 8; }
          assert.ok(at <= extra + 4 + length); found = true;
        }
        extra += 4 + length;
      }
      assert.ok(found);
    }
    assert.equal(unpacked, source.length); assert.ok(compressed < 192 * 1024);
    if (local > 2 ** 32) largeOffsets++;
    const header = await read(30, local); assert.equal(header.readUInt32LE(0), 0x04034b50);
    const localNameLength = header.readUInt16LE(26), localExtraLength = header.readUInt16LE(28);
    assert.equal((await read(localNameLength, local + 30)).toString('utf8'), name);
    const start = local + 30 + localNameLength + localExtraLength; assert.ok(start + compressed <= centralStart);
    assert.equal(central.readUInt16LE(cursor + 10), 8);
    const content = inflateRawSync(await read(compressed, start)); assert.deepEqual(content, source); assert.equal(crc32(content), expectedCrc);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(cursor, centralSize); assert.equal(seen.size, count); assert.ok(largeOffsets > 0);
  console.log(`ZIP64 large download passed: ${size} downloaded bytes, ${count} complete entries, ${largeOffsets} ZIP64 local offsets; every payload and CRC verified.`);
} finally {
  await archive?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  app?.close();
  assert.equal(path.dirname(temporary), storage); assert.ok(path.basename(temporary).startsWith('zip64-output-smoke-'));
  await fs.rm(temporary, { recursive: true, force: true });
}
