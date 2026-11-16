// blender-preview — host side: find Blender, turn a .blend into a GLB, cache it.
//
// A browser cannot read Blender's own file format, so a .blend is exported to
// GLB by the user's Blender running in the background, once per version of
// the file: the result is cached under <DSH_HOME>/storages/blender-preview,
// keyed by path + size + modified time (or by content, for uploaded bytes),
// so reopening the same file is instant and an edited file converts again.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Bump when the export changes, so old cached GLBs are not reused. */
export const EXPORT_VERSION = 1;

const HERE = dirname(fileURLToPath(import.meta.url));
export const EXPORT_SCRIPT = join(HERE, 'export_glb.py');

export function defaultCacheDir() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'blender-preview');
}

/** Places Blender is commonly installed, newest first where a version is in the path. */
function candidates() {
  const out = [];
  if (process.env.BLENDER_PATH) out.push(process.env.BLENDER_PATH);
  if (process.platform === 'win32') {
    out.push('C:\\Application\\Blender\\blender.exe');
    for (const root of ['C:\\Program Files\\Blender Foundation', 'C:\\Program Files (x86)\\Blender Foundation']) {
      try {
        const dirs = readdirSync(root).filter((name) => /^Blender/i.test(name)).sort().reverse();
        for (const dir of dirs) out.push(join(root, dir, 'blender.exe'));
      } catch { /* not installed there */ }
    }
  } else if (process.platform === 'darwin') {
    out.push('/Applications/Blender.app/Contents/MacOS/Blender');
  } else {
    out.push('/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender');
  }
  return out;
}

/** The Blender executable: the configured one, else the first installed one found, else `blender` on PATH. */
export function findBlender(configured) {
  if (configured) return configured;
  for (const path of candidates()) if (existsSync(path)) return path;
  return 'blender';
}

/** Cache key for a file on disk. */
export function keyForFile(path) {
  const st = statSync(path);
  return createHash('sha1').update(`${EXPORT_VERSION}\0${path}\0${st.size}\0${st.mtimeMs}`).digest('hex');
}

/** Cache key for uploaded bytes. */
export function keyForBytes(bytes) {
  return createHash('sha1').update(`${EXPORT_VERSION}\0`).update(bytes).digest('hex');
}

/** Pull the info line the export script prints. */
export function parseInfo(stdout) {
  const line = String(stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('BLEND_PREVIEW_INFO '));
  if (!line) return null;
  try { return JSON.parse(line.slice('BLEND_PREVIEW_INFO '.length)); } catch { return null; }
}

/** The last useful lines of Blender's output, for an error message. */
function tail(text, lines = 12) {
  return String(text).split(/\r?\n/).filter((l) => l.trim() !== '').slice(-lines).join('\n');
}

/** Run Blender once. Resolves with stdout; rejects with a readable error. */
export function runBlender(blender, args, { timeoutMs = 180_000, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawnImpl(blender, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(new Error(`could not start Blender (${blender}): ${error.message}`));
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Blender took longer than ${Math.round(timeoutMs / 1000)}s to export this file`));
    }, timeoutMs);
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(error.code === 'ENOENT'
        ? `Blender was not found (${blender}). Install Blender or set blenderPath on the blender-preview row.`
        : `could not start Blender: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Blender exited with code ${code}:\n${tail(stderr || stdout)}`));
    });
  });
}

/**
 * The converter: one export per cache key at a time, results kept on disk.
 * `convertFile(path)` and `convertBytes(bytes)` resolve to { glbPath, info, cached }.
 */
export function createConverter({ blenderPath, cacheDir = defaultCacheDir(), timeoutMs, run = runBlender, maxCacheFiles = 200 } = {}) {
  const inflight = new Map();

  const infoPath = (key) => join(cacheDir, `${key}.json`);
  const glbPath = (key) => join(cacheDir, `${key}.glb`);

  function readCached(key) {
    if (!existsSync(glbPath(key))) return null;
    let info = null;
    try { info = JSON.parse(readFileSync(infoPath(key), 'utf8')); } catch { /* info is optional */ }
    return { glbPath: glbPath(key), info, cached: true };
  }

  function prune() {
    try {
      const files = readdirSync(cacheDir)
        .filter((name) => name.endsWith('.glb'))
        .map((name) => ({ name, at: statSync(join(cacheDir, name)).mtimeMs }))
        .sort((a, b) => b.at - a.at);
      for (const old of files.slice(maxCacheFiles)) {
        rmSync(join(cacheDir, old.name), { force: true });
        rmSync(join(cacheDir, old.name.replace(/\.glb$/, '.json')), { force: true });
      }
    } catch { /* pruning is best effort */ }
  }

  async function exportTo(key, sourcePath) {
    mkdirSync(cacheDir, { recursive: true });
    const partial = join(cacheDir, `${key}.partial.glb`);
    rmSync(partial, { force: true });
    const blender = findBlender(blenderPath);
    const stdout = await run(blender, ['-b', '--factory-startup', '-noaudio', sourcePath, '--python', EXPORT_SCRIPT, '--', partial], { timeoutMs });
    if (!existsSync(partial)) throw new Error(`Blender finished but wrote no GLB:\n${tail(stdout)}`);
    renameSync(partial, glbPath(key));
    const info = parseInfo(stdout);
    if (info) writeFileSync(infoPath(key), JSON.stringify(info));
    prune();
    return { glbPath: glbPath(key), info, cached: false };
  }

  function once(key, work) {
    const cached = readCached(key);
    if (cached) return Promise.resolve(cached);
    if (inflight.has(key)) return inflight.get(key);
    const job = work().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }

  return {
    cacheDir,
    blender: () => findBlender(blenderPath),
    convertFile(path) {
      if (!/\.blend$/i.test(path)) return Promise.reject(new Error('only .blend files are converted'));
      if (!existsSync(path)) return Promise.reject(new Error(`file not found: ${path}`));
      return once(keyForFile(path), () => exportTo(keyForFile(path), path));
    },
    convertBytes(bytes, name = 'upload.blend') {
      const key = keyForBytes(bytes);
      return once(key, async () => {
        const dir = join(tmpdir(), `blender-preview-${key.slice(0, 12)}`);
        mkdirSync(dir, { recursive: true });
        const source = join(dir, name.replace(/[^\w.-]+/g, '_').replace(/(\.blend)?$/i, '.blend'));
        writeFileSync(source, bytes);
        try {
          return await exportTo(key, source);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    },
  };
}
