// blender-preview — host-half tests: pure helpers, cache behaviour, and a real
// .blend -> GLB export when BLEND_SAMPLE points at a .blend and Blender exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mediaTypeFor, parseRange, parseAddress, isBlendBytes } from '../src/index.js';
import { createConverter, keyForBytes, parseInfo, findBlender } from '../src/convert.js';

test('mediaTypeFor maps suffixes and ignores query strings', () => {
  assert.equal(mediaTypeFor('a.svg'), 'image/svg+xml');
  assert.equal(mediaTypeFor('a.mp4?x=1'), 'video/mp4');
  assert.equal(mediaTypeFor('a.flac'), 'audio/flac');
  assert.equal(mediaTypeFor('a.unknown'), 'application/octet-stream');
  assert.equal(mediaTypeFor('noext'), 'application/octet-stream');
});

test('parseRange handles full, suffix, open-ended and invalid ranges', () => {
  assert.equal(parseRange(undefined, 1000), undefined);
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.equal(parseRange('bytes=2000-', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-0', 0), 'unsatisfiable');
});

test('parseAddress resolves absolute and session addresses, rejects junk', () => {
  assert.deepEqual(parseAddress('dsh-resource://file/absolute/C:/x/y.blend'), { scope: 'absolute', path: 'C:/x/y.blend' });
  assert.deepEqual(parseAddress('dsh-resource://file/session/s1/a/b.blend'), { scope: 'session', sessionId: 's1', path: 'a/b.blend' });
  assert.equal(parseAddress('http://example.com'), undefined);
  assert.equal(parseAddress('dsh-resource://file/absolute/'), undefined);
});

test('isBlendBytes recognises plain, zstd and gzip .blend headers', () => {
  assert.equal(isBlendBytes(Buffer.from('BLENDER-v300...')), true);
  assert.equal(isBlendBytes(Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0, 0, 0, 0, 0, 0, 0, 0])), true);
  assert.equal(isBlendBytes(Buffer.from([0x1f, 0x8b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), true);
  assert.equal(isBlendBytes(Buffer.from('not a blend at all')), false);
  assert.equal(isBlendBytes(Buffer.from('short')), false);
});

test('keyForBytes is deterministic and parseInfo reads the export info line', () => {
  const a = keyForBytes(Buffer.from('abc'));
  assert.equal(a, keyForBytes(Buffer.from('abc')));
  assert.notEqual(a, keyForBytes(Buffer.from('abd')));
  assert.deepEqual(parseInfo('noise\nBLEND_PREVIEW_INFO {"blender":"5.2"}\n'), { blender: '5.2' });
  assert.equal(parseInfo('nothing here'), null);
});

test('converter caches by content and reuses the GLB on second call', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'bp-cache-'));
  try {
    let runs = 0;
    const run = async (_blender, args) => {
      runs += 1;
      writeFileSync(args[args.length - 1], Buffer.from('glTF-fake-glb'));
      return 'BLEND_PREVIEW_INFO {"blender":"fake"}\n';
    };
    const conv = createConverter({ cacheDir, run });
    const bytes = Buffer.from('BLENDER-fake-content');
    const first = await conv.convertBytes(bytes);
    assert.equal(first.cached, false);
    assert.equal(runs, 1);
    assert.deepEqual(first.info, { blender: 'fake' });
    const second = await conv.convertBytes(bytes);
    assert.equal(second.cached, true);
    assert.equal(runs, 1, 'second call must hit the cache, not re-run Blender');
    assert.equal(readFileSync(second.glbPath, 'utf8'), 'glTF-fake-glb');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('converter rejects non-.blend paths', async () => {
  const conv = createConverter({ cacheDir: mkdtempSync(join(tmpdir(), 'bp-rej-')) });
  await assert.rejects(() => conv.convertFile('C:/x/model.glb'), /only .blend/);
});

const sample = process.env.BLEND_SAMPLE;
test('e2e: real .blend exports to a valid GLB via local Blender', { skip: !sample }, async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'bp-e2e-'));
  try {
    const conv = createConverter({ cacheDir, timeoutMs: 180000 });
    const result = await conv.convertFile(sample);
    const magic = readFileSync(result.glbPath).subarray(0, 4).toString('latin1');
    assert.equal(magic, 'glTF', 'exported file must carry the glTF binary magic');
    assert.ok(result.info, 'export script should report info');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
