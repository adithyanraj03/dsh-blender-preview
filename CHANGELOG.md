# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release notes live on [GitHub Releases](https://github.com/adithyanraj03/dsh-blender-preview/releases);
npm versions: [dsh-blender-preview](https://www.npmjs.com/package/dsh-blender-preview).

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
