# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release notes live on [GitHub Releases](https://github.com/adithyanraj03/dsh-blender-preview/releases);
npm versions: [dsh-blender-preview](https://www.npmjs.com/package/dsh-blender-preview).

## [0.3.0] — 2026-11-17

### Added

- The preview feature itself, ported from the maintainer's working `blend-preview` implementation: `.blend` / `.glb` / `.gltf` / `.obj` in an interactive WebGL viewport (orbit/pan/zoom, wireframe, grid, spin, light background, scene-stat chips), animation playback (clip picker, scrub bar, speed), `.svg` pixel-true vector preview, and HTTP-range streamed video/audio.
- Headless `.blend` → GLB export through the user's local Blender (`src/convert.js` + `src/export_glb.py`), cached under `<DSH_HOME>/storages/blender-preview` keyed by path+size+mtime (or content for uploaded bytes); re-exports only when the file changes.
- Host routes `/plugin-data/blender-preview/{convert,convert-bytes,media,status}`; row config `blenderPath`, `timeoutMs`, `cacheDir`.
- Browser half built with esbuild-wasm (`build.mjs` → `lib/client.js`); dev deps `three` + `esbuild-wasm` only (no native esbuild, no postinstall).
- Test suite (`test/preview.test.mjs`): host helper units, cache behaviour, and a real Blender `.blend`→GLB e2e test gated on `BLEND_SAMPLE` (8/8 passing against Blender 5.2 LTS).

### Changed

- Row id, client loader id, preview ids, HTTP base and cache dir renamed `blend-preview` → `blender-preview`; package name stays `dsh-blender-preview`.
- The 0.2.0 `dsh-blender` dependency and read-only boot self-check are retained inside the ported host half.
- Disclosure description rewritten to match shipped behaviour (Files-tab previews, local-Blender requirement, no network/telemetry/postinstall).

## [0.2.0] — 2026-11-12

### Added

- `dsh-blender` (npm, by CheshireJCat) as a package dependency: registry or GitHub installs place `dsh-blender@^0.2.4` into the profile alongside this plugin.
- Boot self-check (host half, read-only): for every profile that depends on this package, verifies `dsh-blender` is installed there and mounted in its `dsh.profile.bundles`; when either is missing it logs the exact one-liner that repairs it — the row never installs or edits anything itself.
- README (EN + zh): "Works with dsh-blender" section with credit to CheshireJCat; updated the disclosure description to cover the new dependency and self-check.

## [0.1.0] — 2026-11-12

### Added

- Scaffold: the `blender-preview` bundle row (permanent id) mounts a host stub on dsh web and desktop, with a no-op client half.
- Dependency-free wiring harness (`npm test`): the package name agrees across `package.json`, `cordis.patch.yml` and `src/client.js`, and every shipped file exists.
- Public layer: README banner (light/dark) and app icon, bilingual README (`README.md` / `README.zh-CN.md`), GitHub Pages documentation site, `FUNDING.yml`, badge row.
- Disclosure-compliant package description: host-only scaffold, no UI, no network calls, no telemetry, no postinstall, uninstall removes the row.
- Release process: every GitHub release ships a `plugin.tgz` asset with detailed notes.
