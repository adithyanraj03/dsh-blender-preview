<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.png">
  <img alt="dsh-blender-preview" src="assets/banner-light.png" width="1012">
</picture>

<br>

# dsh-blender-preview

English | [中文](README.zh-CN.md)

![language](https://img.shields.io/badge/language-javascript-f7dc6f) ![license](https://img.shields.io/badge/license-MIT-blue) ![node](https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen) ![dsh](https://img.shields.io/badge/dsh-web_%2B_desktop-orange) ![status](https://img.shields.io/badge/status-scaffold-orange) ![tests](https://img.shields.io/badge/tests-wiring_passing-brightgreen)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that will preview Blender `.blend` files in the right sidebar: the host half exports a cached GLB headlessly through your local Blender install, and the browser half renders it in an interactive WebGL viewport with scene statistics.

> **Status: scaffold (v0.1.0).** This release publishes the wiring, not the feature: the bundle row mounts, the package makes no network calls and collects no telemetry, and nothing previews a scene yet. The headless-GLB export and the WebGL viewport land in the next version.

## Install

From npm:

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-blender-preview
```

Or straight from GitHub:

```sh
npx @deepseek-ai/dsh plugin --profile web add github:adithyanraj03/dsh-blender-preview
```

The package runs no install scripts (no `postinstall`), so pnpm's ignored-builds prompt does not apply. Confirm it mounted — the plugin must appear in **both** `dependencies` and `dsh.profile.bundles`:

```sh
cd ~/.dsh/profiles/web && node -e "const p=require('./package.json');
  console.log(p.dependencies['dsh-blender-preview'],
              p.dsh.profile.bundles.includes('dsh-blender-preview'))"
```

### In the desktop app

Open **Plugins** (settings, left sidebar) → **Add plugin**, paste the repository address, click **Install**:

```
https://github.com/adithyanraj03/dsh-blender-preview
```

Installed plugins do not update automatically yet — to upgrade, uninstall and install again. The host half loads at startup, so restart the app after installing or upgrading.

## What this scaffold ships today

- The host row (`id: blender-preview`) mounts on dsh web and desktop. The row id is permanent from this release forward — later versions replace the row's config, never its id.
- `npm test` — a dependency-free wiring harness that checks the three places the package name lives agree and that every shipped file exists.
- The bilingual README pair, the documentation site (GitHub Pages), and the release process: every release ships a `plugin.tgz` asset with detailed notes.

The planned feature, in one line: a local `blender --background` process exports the active `.blend` to a cached GLB (re-exported only when the file changes), and the right sidebar renders that GLB in an interactive WebGL viewport with scene statistics. Everything runs against your local Blender installation — no cloud, no API keys.

## Prior art

`dsh-blend-preview` on npm is taken and deprecated; its author renamed it to `dsh-preview-blender`, which already implements headless-GLB + WebGL sidebar preview. This is an independent implementation under the `dsh-blender-preview` name, verified available on npm when this scaffold was created.

## Development

```sh
npm test                        # wiring harness
python scripts/make-banner.py   # regenerate the README banners (Pillow)
```

Layout mirrors [dsh-graft](https://github.com/adithyanraj03/dsh-graft-plugin):

| Path | Role |
| --- | --- |
| `src/index.js` | host half — Blender resolution + cached GLB export (stub) |
| `src/client.js` | browser half — sidebar tab + WebGL viewport (stub) |
| `cordis.patch.yml` | mounts the host row; `name` must equal the package name |
| `scripts/test-harness.mjs` | dependency-free wiring test |
| `scripts/make-banner.py` | regenerates `assets/banner-*.png` |
| `docs/` | GitHub Pages site |
| `assets/` | icon and banners |

## Compatibility

| Host | Status |
| --- | --- |
| dsh 0.2.x (web + desktop) | row mounts; feature not implemented |

The feature will require a local Blender installation at runtime (resolution logic lands with the implementation).

## License

MIT © Adithya N Raj
