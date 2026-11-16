// blender-preview — host half.
//
// The browser half draws .glb / .gltf / .obj / .svg and streams video and audio
// from the route below. A .blend needs Blender, so the browser asks here:
//
//   POST /plugin-data/blender-preview/convert        {address}   → model/gltf-binary
//   POST /plugin-data/blender-preview/convert-bytes?name=…  raw .blend bytes → model/gltf-binary
//   GET  /plugin-data/blender-preview/media?address=…  → the file, with HTTP ranges for seeking
//   GET  /plugin-data/blender-preview/status                     → which Blender, cache folder
//
// `address` is the Files tab's own `dsh-resource://file/…` address. Reading the
// file where it lives keeps linked textures and libraries working; the bytes
// route is the fallback when the address cannot be resolved to a path here.
//
// Row config (all optional):
//   blenderPath   the Blender executable (default: found automatically)
//   timeoutMs     longest one export may take (default 180000)
//   cacheDir      where converted GLBs are kept (default <DSH_HOME>/storages/blender-preview)

import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConverter } from './convert.js';

export const name = 'blender-preview';
export const inject = ['webServer'];

export const BASE = '/plugin-data/blender-preview';
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

/* ---- dsh-blender boot self-check (read-only, from 0.2.0) ------------------ */

const DEPENDENCY = 'dsh-blender';

function packageOwnName() {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ).name;
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/**
 * For every profile that depends on this package, verify `dsh-blender` is
 * installed there AND mounted in its dsh.profile.bundles; when either is
 * missing, log the exact one-liner that repairs it. Never installs or edits.
 */
function checkBlenderDependency(log) {
  const dir = join(dshHome(), 'profiles');
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    log?.warn?.('[blender-preview] self-check: cannot list profiles; skipped');
    return;
  }
  const own = packageOwnName();
  let checked = 0;
  for (const entry of entries) {
    const profileDir = join(dir, entry.name);
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!pkg?.dependencies?.[own]) continue;
    checked += 1;
    const installed = existsSync(join(profileDir, 'node_modules', DEPENDENCY));
    const mounted =
      Array.isArray(pkg?.dsh?.profile?.bundles) && pkg.dsh.profile.bundles.includes(DEPENDENCY);
    if (installed && mounted) continue;
    const why = !installed
      ? `${DEPENDENCY} is not installed`
      : `${DEPENDENCY} is installed but not in dsh.profile.bundles`;
    log?.warn?.(
      `[blender-preview] ${why} in profile "${entry.name}" — run: npx @deepseek-ai/dsh plugin --profile ${entry.name} add ${DEPENDENCY}`,
    );
  }
  if (checked === 0) {
    log?.debug?.('[blender-preview] self-check: no profile depends on this package; nothing to check');
  }
}

/** Media types the Files tab can preview from a stream. */
const MEDIA_TYPES = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ts: 'video/mp2t',
  '3gp': 'video/3gpp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  opus: 'audio/ogg',
  weba: 'audio/webm',
};

/** Media type by suffix; unknown suffixes are served as opaque bytes. */
export function mediaTypeFor(path) {
  const clean = String(path ?? '').replace(/[?#].*$/, '');
  const dot = clean.lastIndexOf('.');
  const suffix = dot < 0 ? '' : clean.slice(dot + 1).toLowerCase();
  return MEDIA_TYPES[suffix] ?? 'application/octet-stream';
}

/**
 * One `Range: bytes=…` header → the byte window to send.
 * @returns `{start, end}`, `'unsatisfiable'`, or undefined to serve the whole file.
 */
export function parseRange(header, size) {
  if (!header) return undefined;
  const hit = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!hit) return undefined;
  const [, rawStart, rawEnd] = hit;
  if (rawStart === '' && rawEnd === '') return undefined;
  if (size === 0) return 'unsatisfiable';
  let start;
  let end;
  if (rawStart === '') {
    const length = Number(rawEnd);
    if (!Number.isFinite(length) || length <= 0) return 'unsatisfiable';
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
    if (!Number.isFinite(start) || start >= size) return 'unsatisfiable';
    if (!Number.isFinite(end) || end >= size) end = size - 1;
    if (end < start) return 'unsatisfiable';
  }
  return { start, end };
}


const PREFIX = 'dsh-resource://file/';

/** Read a Files-tab address into {scope:'absolute', path} or {scope:'session', sessionId, path}. */
export function parseAddress(address) {
  if (typeof address !== 'string' || !address.startsWith(PREFIX)) return undefined;
  try {
    const end = address.search(/[?#]/);
    const [scope, ...rest] = address.slice(PREFIX.length, end === -1 ? undefined : end).split('/');
    if (scope === 'session') {
      const [id, ...segments] = rest;
      if (!id || segments.length === 0) return undefined;
      return { scope, sessionId: decodeURIComponent(id), path: segments.map(decodeURIComponent).join('/') };
    }
    if (scope === 'absolute') {
      const unc = rest[0] === '' && rest.length > 1;
      const segments = (unc ? rest.slice(1) : rest).map(decodeURIComponent);
      if (segments.length === 0 || segments[0] === '') return undefined;
      if (unc) return { scope, path: `//${segments.join('/')}` };
      return { scope, path: /^[A-Za-z]:$/.test(segments[0]) ? segments.join('/') : `/${segments.join('/')}` };
    }
  } catch { /* a malformed segment */ }
  return undefined;
}

/** A .blend: plain (`BLENDER`), or saved compressed (zstd since Blender 3.0, gzip before). */
export function isBlendBytes(bytes) {
  if (!bytes || bytes.length < 12) return false;
  if (bytes.subarray(0, 7).toString('latin1') === 'BLENDER') return true;
  if (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) return true;
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function service(ctx, id) {
  try {
    return ctx?.get?.(id);
  } catch {
    return undefined;
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function sendGlb(res, result) {
  const bytes = readFileSync(result.glbPath);
  res.writeHead(200, {
    'content-type': 'model/gltf-binary',
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
    'x-blender-preview-cached': result.cached ? '1' : '0',
    'x-blender-preview-info': encodeURIComponent(JSON.stringify(result.info ?? {})),
  });
  res.end(bytes);
}

async function readRaw(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req ?? []) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('file too large'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const text = (await readRaw(req, 64 * 1024)).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch { return null; }
}

/** Serve one file, honouring a single byte range so a player can seek. */
export function sendMedia(req, res, path, stat) {
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const ifNoneMatch = req.headers?.['if-none-match'];
  if (ifNoneMatch && ifNoneMatch === etag) {
    res.writeHead(304, { etag, 'cache-control': 'no-store' });
    res.end();
    return;
  }
  const range = parseRange(req.headers?.range, stat.size);
  if (range === 'unsatisfiable') {
    res.writeHead(416, { 'content-range': `bytes */${stat.size}`, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
    res.end();
    return;
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : Math.max(0, stat.size - 1);
  const partial = Boolean(range);
  res.writeHead(partial ? 206 : 200, {
    'content-type': mediaTypeFor(path),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    etag,
    'x-content-type-options': 'nosniff',
    ...(partial
      ? { 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': String(end - start + 1) }
      : { 'content-length': String(stat.size) }),
  });
  if ((req.method || 'GET').toUpperCase() === 'HEAD' || stat.size === 0) {
    res.end();
    return;
  }
  const stream = createReadStream(path, { start, end });
  stream.on('data', (chunk) => {
    if (!res.write(chunk)) stream.pause();
  });
  res.on?.('drain', () => stream.resume());
  stream.on('end', () => res.end());
  stream.on('error', () => {
    try { res.destroy?.(); } catch { /* response already gone */ }
  });
  res.on?.('close', () => {
    if (!res.writableEnded) stream.destroy();
  });
}

export function apply(ctx, config = {}) {
  // Boot self-check for the dsh-blender dependency — read-only, never throws.
  try {
    checkBlenderDependency({
      info: (m) => ctx.logger?.info?.(m),
      warn: (m) => ctx.logger?.warn?.(m),
      debug: (m) => ctx.logger?.debug?.(m),
    });
  } catch { /* self-check must never break the mount */ }

  const converter = createConverter({
    ...(config.blenderPath ? { blenderPath: config.blenderPath } : {}),
    ...(config.cacheDir ? { cacheDir: config.cacheDir } : {}),
    ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
  });

  /** A session-relative address → absolute path, through the chat's working folder. */
  async function resolvePath(parsed) {
    if (parsed.scope === 'absolute') return normalize(parsed.path);
    if (isAbsolute(parsed.path)) return normalize(parsed.path);
    try {
      const rows = await service(ctx, 'sessionQuery')?.filterSessions?.([{ kind: 'id', values: [parsed.sessionId] }]);
      const cwd = rows?.[0]?.header?.cwd;
      return cwd ? normalize(join(cwd, parsed.path)) : undefined;
    } catch {
      return undefined;
    }
  }

  const failed = (res, error) => {
    ctx.logger?.warn?.(`blender-preview: ${error?.message ?? error}`);
    sendJson(res, error?.status ?? 500, { error: String(error?.message ?? error) });
  };

  const web = ctx.webServer;
  if (!web?.register) {
    ctx.logger?.warn?.('blender-preview: webServer unavailable; .blend files cannot be converted (GLB/OBJ previews still work)');
    return;
  }
  const off = [];
  off.push(web.register({
    kind: 'exact',
    path: `${BASE}/status`,
    handler: async (_req, res) => sendJson(res, 200, { blender: converter.blender(), cacheDir: converter.cacheDir }),
  }));
  off.push(web.register({
    kind: 'exact',
    path: `${BASE}/convert`,
    handler: async (req = {}, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      try {
        const body = await readJson(req);
        const parsed = parseAddress(body?.address);
        if (!parsed) return sendJson(res, 400, { error: 'not a file address' });
        const path = await resolvePath(parsed);
        // 409: the browser falls back to sending the bytes it already has.
        if (!path) return sendJson(res, 409, { error: 'could not resolve the file on this machine', needBytes: true });
        sendGlb(res, await converter.convertFile(path));
      } catch (error) {
        if (/file not found/.test(String(error?.message))) return sendJson(res, 409, { error: error.message, needBytes: true });
        failed(res, error);
      }
    },
  }));
  off.push(web.register({
    kind: 'exact',
    path: `${BASE}/convert-bytes`,
    handler: async (req = {}, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      try {
        const name = new URL(req.url ?? '/', 'http://x').searchParams.get('name') || 'upload.blend';
        const bytes = await readRaw(req, MAX_UPLOAD_BYTES);
        if (!isBlendBytes(bytes)) return sendJson(res, 400, { error: 'not a .blend file' });
        sendGlb(res, await converter.convertBytes(bytes, name));
      } catch (error) {
        failed(res, error);
      }
    },
  }));
  off.push(web.register({
    kind: 'exact',
    path: `${BASE}/media`,
    handler: async (req = {}, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
      try {
        const url = new URL(req.url ?? '/', 'http://x');
        const parsed = parseAddress(url.searchParams.get('address'));
        if (!parsed) return sendJson(res, 400, { error: 'not a file address' });
        const path = await resolvePath(parsed);
        if (!path) return sendJson(res, 404, { error: 'could not resolve the file on this machine' });
        let stat;
        try {
          stat = statSync(path);
        } catch {
          return sendJson(res, 404, { error: 'file not found' });
        }
        if (!stat.isFile()) return sendJson(res, 404, { error: 'not a regular file' });
        sendMedia(req, res, path, stat);
      } catch (error) {
        failed(res, error);
      }
    },
  }));
  ctx.logger?.info?.(`blender-preview: mounted; Blender = ${converter.blender()}`);
  ctx.on?.('dispose', () => {
    for (const dispose of off) {
      try { dispose?.(); } catch { /* keep going */ }
    }
  });
}

export default { apply, inject, name };
