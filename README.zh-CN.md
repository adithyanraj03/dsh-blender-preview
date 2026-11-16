<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.png">
  <img alt="dsh-blender-preview" src="assets/banner-light.png" width="1012">
</picture>

<br>

# dsh-blender-preview

[English](README.md) | 中文

![language](https://img.shields.io/badge/language-javascript-f7dc6f) ![license](https://img.shields.io/badge/license-MIT-blue) ![node](https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen) ![dsh](https://img.shields.io/badge/dsh-web_%2B_desktop-orange) ![status](https://img.shields.io/badge/status-v0.3.0-blue) ![tests](https://img.shields.io/badge/tests-8%2F8_passing-brightgreen)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，在右侧边栏的 Files 标签中预览 Blender `.blend` 文件（以及更多格式）：宿主半区通过本机 Blender 以无头模式导出带缓存的 GLB，浏览器半区在可交互的 WebGL 视口中渲染，并显示场景统计信息。

> **状态：v0.3.0——预览功能已可用。** `.blend` / `.glb` / `.gltf` / `.obj` 在 3D 视口中打开，`.svg` 以像素级精确的矢量查看器呈现，视频/音频以可拖动进度的流式方式播放。本包将 `dsh-blender@^0.2.4` 作为依赖随包发布（启动时进行非变更式自检），不发起任何网络请求、不收集任何遥测。`.blend` 转换需要本机安装 Blender；其余格式无需 Blender 即可预览。

## 安装

从 npm 安装：

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-blender-preview
```

或直接从 GitHub 安装：

```sh
npx @deepseek-ai/dsh plugin --profile web add github:adithyanraj03/dsh-blender-preview
```

本包不运行任何安装脚本（无 `postinstall`），因此不会触发 pnpm 的 ignored-builds 提示。安装时会随本插件在 profile 中一并拉取一个依赖 `dsh-blender@^0.2.4`——见[与 dsh-blender 配合使用](#与-dsh-blender-配合使用)。确认挂载成功——插件必须**同时**出现在 `dependencies` 和 `dsh.profile.bundles` 中：

```sh
cd ~/.dsh/profiles/web && node -e "const p=require('./package.json');
  console.log(p.dependencies['dsh-blender-preview'],
              p.dsh.profile.bundles.includes('dsh-blender-preview'))"
```

### 在桌面应用中

打开 **Plugins**（设置，左侧边栏）→ **Add plugin**，粘贴仓库地址，点击 **Install**：

```
https://github.com/adithyanraj03/dsh-blender-preview
```

已安装的插件尚不支持自动更新——升级时需先卸载再重新安装。宿主半区在启动时加载，因此安装或升级后需重启应用。

## 功能

- **3D 视口**：支持 `.blend`、`.glb`、`.gltf`、`.obj`。拖拽旋转、右键拖拽平移、滚轮缩放，并提供重置视角、自转、线框、网格与浅色背景开关。场景标签显示三角面/网格/材质数量、动画数量以及是否带绑定。
- **`.blend` 转换**：在后台调用本机 Blender（`blender -b --factory-startup … --python export_glb.py`），并将 GLB 缓存于 `<DSH_HOME>/storages/blender-preview`，以路径 + 大小 + 修改时间（上传字节则按内容）为键。重复打开同一文件即时完成；文件被修改后才会重新转换。
- **动画播放**：模型带动画时提供片段选择、播放/暂停、进度条与倍速控制。
- **`.svg`**：以矢量方式渲染，支持像素级精确的缩放与平移。
- **视频 / 音频**：通过 HTTP Range 流式传输，数 GB 的文件也可拖动进度而无需整体读入内存。

行配置（均可选，位于 `blender-preview` 行）：

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `blenderPath` | 自动探测（`BLENDER_PATH`、常见安装目录、PATH） | Blender 可执行文件 |
| `timeoutMs` | `180000` | 单次导出的最长耗时 |
| `cacheDir` | `<DSH_HOME>/storages/blender-preview` | 转换后 GLB 的存放位置 |

## 与 dsh-blender 配合使用

本包将 [CheshireJCat](https://github.com/cheshirejcat) 的 [`dsh-blender`](https://github.com/cheshirejcat/blender)（npm 包名 `dsh-blender`）声明为依赖，因此从 npm 或 GitHub 安装时，`dsh-blender@^0.2.4` 会与本插件一起进入 profile。启动时，宿主半区执行**非变更式自检**：对每个依赖本包的 profile，检查 `dsh-blender` 是否已安装、且已挂载进该 profile 的 `dsh.profile.bundles`；任一缺失时，日志中给出可直接执行的修复命令：

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-blender
```

自检只读，从不自行安装或修改任何内容。这对 `link:` 开发型 profile 尤为重要——pnpm 不会为被链接的包安装其自身依赖，自检会如实报告缺口而不是默认其存在。

**致谢：** `dsh-blender` 是 [CheshireJCat](https://github.com/cheshirejcat) 的社区插件——面向 dsh 的 Blender 建模工具与技能集。

## 已有同类插件

npm 上的 `dsh-blend-preview` 已被占用且已弃用；其作者将其更名为 `dsh-preview-blender`，后者已实现无头 GLB + WebGL 侧边栏预览。本插件是以 `dsh-blender-preview` 名称（创建时已验证该名称在 npm 可用）进行的独立实现。

## 开发

```sh
npm install                     # 开发依赖：three + esbuild-wasm（无原生 esbuild，无 postinstall）
npm run build                   # 将 src/client 打包为 lib/client.js（esbuild-wasm）
npm test                        # 接线测试 + 单元测试 + e2e 导出
BLEND_SAMPLE=/path/to/file.blend npm test   # 启用真实 Blender .blend->GLB e2e 测试
python scripts/make-banner.py   # 重新生成 README 横幅（Pillow）
```

| 路径 | 职责 |
| --- | --- |
| `src/index.js` | 宿主半区——dsh-blender 启动自检、convert/media/status 路由 |
| `src/convert.js` | Blender 探测、无头导出、磁盘 GLB 缓存 |
| `src/export_glb.py` | Blender 侧导出脚本 |
| `src/client/` | 浏览器半区源码——视口、SVG、媒体、注册 |
| `lib/client.js` | 构建后的浏览器 bundle（由 `build.mjs` 生成） |
| `build.mjs` | esbuild-wasm 打包器，包裹进 dsh 模块加载器 |
| `cordis.patch.yml` | 挂载宿主行；`name` 必须与包名一致 |
| `scripts/test-harness.mjs` | 无依赖接线测试 |
| `test/preview.test.mjs` | 单元 + 缓存 + Blender e2e 测试 |
| `docs/` | GitHub Pages 站点 |
| `assets/` | 图标与横幅 |

## 兼容性

| 宿主 | 状态 |
| --- | --- |
| dsh 0.2.x（web + 桌面版） | 可用；安装/升级后需重启以加载宿主半区 |

`.blend` 转换需要本机安装 Blender（已针对 Blender 5.2 LTS 测试）。`.glb` / `.gltf` / `.obj` / `.svg` / 视频 / 音频预览无需 Blender。

## 许可证

MIT © Adithya N Raj
