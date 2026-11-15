#!/usr/bin/env node
// Downloads the MediaMTX RTSP server used by the camera streams into vendor/mediamtx/ (a
// VERSION file there records which release it is, so changing the pin below re-downloads).
// Runs on `npm install` (postinstall), so the project installs with everything it needs. The
// archive is checked against the release's checksums.sha256 before it is unpacked.
//   MEDIAMTX_SKIP_DOWNLOAD=1   skip (e.g. when publishing to an existing MediaMTX, or offline)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MEDIAMTX_VERSION = 'v1.21.4';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'vendor', 'mediamtx');
const versionFile = path.join(dir, 'VERSION');
const exe = path.join(dir, process.platform === 'win32' ? 'mediamtx.exe' : 'mediamtx');

function asset() {
  const os = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!os || !arch || (os === 'windows' && arch !== 'amd64')) return null;
  return `mediamtx_${MEDIAMTX_VERSION}_${os}_${arch}.${os === 'windows' ? 'zip' : 'tar.gz'}`;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  if (process.env.MEDIAMTX_SKIP_DOWNLOAD === '1') return console.log('mediamtx: download skipped (MEDIAMTX_SKIP_DOWNLOAD=1)');
  if (existsSync(exe) && existsSync(versionFile) && readFileSync(versionFile, 'utf8').trim() === MEDIAMTX_VERSION) return;
  const name = asset();
  if (!name) return console.warn(`mediamtx: no ${MEDIAMTX_VERSION} build for ${process.platform}/${process.arch}; set MEDIAMTX_PATH or RTSP_PUBLISH_URL to stream cameras`);

  const base = `https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}`;
  console.log(`mediamtx: downloading ${name}`);
  const [archive, sums] = await Promise.all([download(`${base}/${name}`), download(`${base}/checksums.sha256`).then(String)]);
  const expected = sums.split('\n').find((l) => l.trim().endsWith(name))?.split(/\s+/)[0];
  const actual = createHash('sha256').update(archive).digest('hex');
  if (!expected) throw new Error(`${name} is not in checksums.sha256`);
  if (expected !== actual) throw new Error(`${name}: checksum mismatch (expected ${expected}, got ${actual})`);

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, archive);
  try {
    // Windows 10+ ships bsdtar, which unpacks .zip too. Call it by path: a GNU tar (Git Bash)
    // earlier on PATH can't.
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    execFileSync(tar, ['-xf', name], { cwd: dir, stdio: 'inherit' });
  } finally {
    rmSync(file, { force: true });
  }
  if (!existsSync(exe)) throw new Error(`${name} did not contain ${path.basename(exe)}`);
  writeFileSync(versionFile, `${MEDIAMTX_VERSION}\n`);
  console.log(`mediamtx: installed ${path.relative(root, exe)}`);
}

main().catch((err) => {
  // Don't fail the whole install: the simulator works without camera streams.
  console.warn(`mediamtx: ${err.message}. Camera streams need it; re-run \`npm run fetch:mediamtx\`.`);
});
