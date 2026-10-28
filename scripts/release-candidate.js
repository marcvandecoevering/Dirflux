// Assemble a traceable local/CI candidate; this never publishes a release.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { packRelease } from './package.js';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.name)) throw new Error('Candidate requires an unscoped lowercase package name.');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error('Invalid release version.');
if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('Candidate requires a clean source checkout.');
const revision = git('rev-parse', 'HEAD');
const tag = process.env.RELEASE_TAG || null;
if (tag) {
  if (tag !== 'v' + manifest.version) throw new Error('Release tag must match the package version.');
  if (git('rev-parse', `refs/tags/${tag}^{commit}`) !== revision) throw new Error('Release tag does not point to this checkout.');
}
const filename = `${manifest.name}-${manifest.version}.tgz`;
const bytes = await fs.readFile(await packRelease());
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
const output = path.resolve(process.argv[2] || 'release-candidate');
// Existing output is refused, including an earlier candidate of this version.
await fs.mkdir(output);
await fs.writeFile(path.join(output, filename), bytes, { flag: 'wx' });
await fs.writeFile(path.join(output, 'SHA256SUMS'), `${digest}  ${filename}\n`, { flag: 'wx' });
await fs.writeFile(path.join(output, 'release.json'), JSON.stringify({
  name: manifest.name, version: manifest.version, tag, revision,
  repository: process.env.GITHUB_REPOSITORY || null,
  verificationRun: process.env.GITHUB_RUN_ID || null,
  node: process.version, archive: filename, sha256: digest,
  status: 'candidate',
  note: 'Checksums detect changed bytes; they are not a digital signature or evidence that all release gates are complete.'
}, null, 2) + '\n', { flag: 'wx' });
console.log(`Candidate prepared at ${output}; revision ${revision}; SHA-256 ${digest}.`);
