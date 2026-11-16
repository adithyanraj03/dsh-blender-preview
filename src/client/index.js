// blender-preview — browser half: previews in dsh's Files tab.
//
// dsh's right sidebar owns file preview. A type is two halves: metadata in
// ctx.documentPreviews (extensions, loading mode) and a body in the KEYED slot
// "sidebar.right.tab.document" under the same id. Priority "extension" is tried
// before the built-ins, so:
//
//   .blend / .glb / .gltf / .obj   3D model (bytes; .blend converts via the host half)
//   .svg                           vector drawing with pixel-true zoom and pan
//   .mp4 / .webm / .mov / …        video, streamed with HTTP ranges
//   .mp3 / .wav / .flac / …        audio, streamed the same way
//
// Streaming matters for the last two: a video is never read into memory, so the
// player can seek in a multi-gigabyte file.

import React from 'react';
import { ModelViewer, parseGltf, parseObj, statsOf } from './viewer.js';
import { SvgPreview, lengthPx, parseSvg, parseViewBox, svgText } from './svg.js';
import { AudioPreview, VideoPreview } from './media.js';
import { BASE, extensionOf, fileNameOf, formatBytes, formatClock, formatDimensions, formatTime, mediaUrl } from './util.js';

const h = React.createElement;
const { useEffect, useRef, useState, useCallback } = React;

export { extensionOf, fileNameOf, formatTime, formatBytes, formatClock, formatDimensions, mediaUrl, parseSvg, parseViewBox, lengthPx, svgText };

// Every ctx service apply() touches must be declared, or the loader refuses
// the property read ("cannot get property … without inject").
export const inject = ['slots', 'documentPreviews'];

/* ---- the preview types ---------------------------------------------------- */

export const MODEL_ID = 'blender-preview/model';
export const SVG_ID = 'blender-preview/svg';
export const VIDEO_ID = 'blender-preview/video';
export const AUDIO_ID = 'blender-preview/audio';

export const MODEL_EXTENSIONS = ['blend', 'glb', 'gltf', 'obj'];
export const SVG_EXTENSIONS = ['svg'];
// `.ts` is deliberately absent: TypeScript owns that suffix in the code viewer.
export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', '3gp'];
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'];

/** Back-compat aliases for the original 3D-only registration. */
export const PREVIEW_ID = MODEL_ID;
export const EXTENSIONS = MODEL_EXTENSIONS;

/**
 * Registration order is dropdown order within one priority band. SVG stays out
 * of binaryExtensions because its XML source is worth reading as text.
 */
export const PREVIEWS = [
  {
    id: MODEL_ID,
    title: '3D model',
    extensions: MODEL_EXTENSIONS,
    binaryExtensions: MODEL_EXTENSIONS,
    loading: 'bytes-complete',
    component: ModelPreviewBody,
  },
  {
    id: SVG_ID,
    title: 'SVG',
    extensions: SVG_EXTENSIONS,
    binaryExtensions: [],
    loading: 'bytes-complete',
    component: SvgPreview,
  },
  {
    id: VIDEO_ID,
    title: 'Video',
    extensions: VIDEO_EXTENSIONS,
    binaryExtensions: VIDEO_EXTENSIONS,
    loading: 'renderer',
    component: VideoPreview,
  },
  {
    id: AUDIO_ID,
    title: 'Audio',
    extensions: AUDIO_EXTENSIONS,
    binaryExtensions: AUDIO_EXTENSIONS,
    loading: 'renderer',
    component: AudioPreview,
  },
];

/* ---- look ---------------------------------------------------------------- */

const STYLE_ID = 'blender-preview-style';
const CSS = [
  '.bpv-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:320px;overflow:hidden;font-size:12px;color:var(--dsw-alias-label-primary,#e8e8ea)}',
  '.bpv-stage{position:relative;flex:1;min-height:0}',
  '.bpv-chips{position:absolute;left:10px;top:10px;display:flex;flex-wrap:wrap;gap:6px;pointer-events:none;max-width:calc(100% - 200px);z-index:2}',
  '.bpv-chip{padding:2px 8px;border-radius:999px;background:rgba(12,12,16,.72);color:#e8e8ea;white-space:nowrap}',
  '.bpv-tools{position:absolute;right:10px;top:10px;display:flex;gap:4px;align-items:center;z-index:3}',
  '.bpv-btn{border:1px solid rgba(255,255,255,.14);background:rgba(12,12,16,.72);color:#e8e8ea;border-radius:7px;padding:4px 8px;cursor:pointer;font:inherit}',
  '.bpv-btn:hover{background:rgba(255,255,255,.12)}',
  '.bpv-btn[aria-pressed="true"]{background:rgba(64,140,255,.35);border-color:rgba(64,140,255,.6)}',
  '.bpv-anim{display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:1px solid var(--dsw-alias-separator-primary,rgba(255,255,255,.1))}',
  '.bpv-anim input[type=range]{flex:1;min-width:60px;accent-color:#3b82f6}',
  '.bpv-anim select{background:transparent;color:inherit;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:2px 4px;font:inherit;max-width:160px}',
  '.bpv-anim select option{color:#111}',
  '.bpv-play{width:28px;height:28px;border-radius:50%;border:none;background:#3b82f6;color:#fff;cursor:pointer;display:grid;place-items:center;flex:none}',
  '.bpv-time{font-variant-numeric:tabular-nums;opacity:.8;white-space:nowrap}',
  '.bpv-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;z-index:4}',
  '.bpv-center-solid{background:rgba(10,10,12,.82)}',
  '.bpv-spin{width:26px;height:26px;border-radius:50%;border:3px solid rgba(255,255,255,.15);border-top-color:#3b82f6;animation:bpv-spin .8s linear infinite}',
  '@keyframes bpv-spin{to{transform:rotate(360deg)}}',
  '.bpv-err{max-width:520px;white-space:pre-wrap;text-align:left;font-family:ui-monospace,monospace;font-size:11px;opacity:.85;max-height:40vh;overflow:auto;background:rgba(0,0,0,.25);padding:8px 10px;border-radius:8px}',
  '.bpv-hint{position:absolute;left:10px;bottom:8px;opacity:.5;pointer-events:none}',
  /* SVG */
  '.bpv-svg-stage{overflow:hidden;touch-action:none;cursor:grab;display:block}',
  '.bpv-svg-stage:active{cursor:grabbing}',
  '.bpv-bg-checker{background-color:#17171b;background-image:conic-gradient(#24242b 90deg,#17171b 90deg 180deg,#24242b 180deg 270deg,#17171b 270deg);background-size:20px 20px}',
  '.bpv-bg-dark{background:#0e0e11}',
  '.bpv-bg-light{background:#f2f2f4}',
  '.bpv-svg-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}',
  '.bpv-zoom{font-variant-numeric:tabular-nums;color:#e8e8ea;text-shadow:0 1px 3px rgba(0,0,0,.75);min-width:38px;text-align:center;padding:0 2px}',
  /* video / audio */
  '.bpv-media{background:#0b0b0e;color-scheme:dark}',
  '.bpv-video-stage{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#000}',
  '.bpv-video{width:100%;height:100%;display:block;background:#000}',
  '.bpv-video[data-fit=contain]{object-fit:contain}',
  '.bpv-video[data-fit=cover]{object-fit:cover}',
  '.bpv-mediabar{display:flex;align-items:center;gap:6px;padding:8px 10px;flex-wrap:wrap;border-top:1px solid var(--dsw-alias-separator-primary,rgba(255,255,255,.1));color:var(--dsw-alias-label-primary,#e8e8ea)}',
  '.bpv-mediabar select{background:transparent;color:inherit;border:1px solid rgba(128,128,128,.35);border-radius:6px;padding:3px 4px;font:inherit}',
  '.bpv-mediabar select option{color:#111}',
  '.bpv-mediabar .bpv-btn{background:transparent;border-color:rgba(128,128,128,.35);backdrop-filter:none}',
  '.bpv-mediabar-name{flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.7}',
  '.bpv-audio-card{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;min-height:0}',
  '.bpv-audio-icon{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;font-size:28px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;flex:none}',
  '.bpv-audio-name{font-size:14px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.bpv-audio-sub{opacity:.6;font-size:11px;min-height:14px}',
  '.bpv-audio{width:100%;max-width:460px}',
  '.bpv-audio-error{display:flex;flex-direction:column;gap:8px;align-items:center;max-width:460px;opacity:.9}',
].join('\n');

function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/* ---- helpers -------------------------------------------------------------- */

const numberFmt = new Intl.NumberFormat('en-US');

/** Ask the host half to turn a .blend into GLB bytes. Falls back to uploading the bytes. */
export async function convertBlend(address, bytes, fetchImpl = fetch) {
  const read = async (res) => {
    if (res.ok) {
      let info = {};
      try { info = JSON.parse(decodeURIComponent(res.headers.get('x-blender-preview-info') || '%7B%7D')); } catch { /* optional */ }
      return { glb: new Uint8Array(await res.arrayBuffer()), info, cached: res.headers.get('x-blender-preview-cached') === '1' };
    }
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error || `HTTP ${res.status}`);
    error.needBytes = body.needBytes === true;
    error.status = res.status;
    throw error;
  };
  try {
    return await read(await fetchImpl(`${BASE}/convert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    }));
  } catch (error) {
    if (!error.needBytes || bytes === undefined) throw error;
    return read(await fetchImpl(`${BASE}/convert-bytes?name=${encodeURIComponent(fileNameOf(address))}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    }));
  }
}

/* ---- the 3D body ---------------------------------------------------------- */

function ModelPreviewBody(props) {
  ensureStyle();
  const bytes = props.content && props.content.kind === 'bytes' ? props.content.data : undefined;
  const address = String(props.resourceAddress ?? '');
  const ext = extensionOf(address);

  const stageRef = useRef(null);
  const viewerRef = useRef(null);
  const [state, setState] = useState({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [ui, setUi] = useState({ wireframe: false, grid: true, rotate: false, light: false });
  const [anim, setAnim] = useState({ clip: 0, playing: false, time: 0, duration: 0, speed: 1 });

  // One viewer per mounted body.
  useEffect(() => {
    const viewer = new ModelViewer(stageRef.current);
    viewerRef.current = viewer;
    let last = 0;
    viewer.onTick = () => {
      const now = performance.now();
      if (!viewer.action || now - last < 100) return;
      last = now;
      setAnim((a) => (a.time === viewer.time && a.playing === viewer.playing ? a : { ...a, time: viewer.time, playing: viewer.playing }));
    };
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  // Load (or reload) whenever the file's bytes change, or Retry is pressed.
  useEffect(() => {
    if (bytes === undefined && ext !== 'blend') return undefined;
    let cancelled = false;
    (async () => {
      try {
        let model;
        let source = null;
        if (ext === 'blend') {
          setState({ phase: 'converting' });
          const converted = await convertBlend(address, bytes);
          if (cancelled) return;
          model = await parseGltf(converted.glb);
          source = converted;
        } else if (ext === 'obj') {
          setState({ phase: 'loading' });
          model = parseObj(bytes);
        } else {
          setState({ phase: 'loading' });
          model = await parseGltf(bytes);
        }
        if (cancelled || !viewerRef.current) return;
        viewerRef.current.show(model);
        viewerRef.current.setWireframe(ui.wireframe);
        const clips = model.clips.map((clip, index) => ({ index, name: clip.name || `Clip ${index + 1}`, duration: clip.duration }));
        setAnim({ clip: 0, playing: clips.length > 0, time: 0, duration: clips[0]?.duration ?? 0, speed: 1 });
        setState({ phase: 'ready', stats: statsOf(model.root), clips, source });
      } catch (error) {
        if (!cancelled) setState({ phase: 'error', message: String(error?.message ?? error) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes, address, attempt]);

  const toggle = useCallback((key) => {
    setUi((current) => {
      const next = { ...current, [key]: !current[key] };
      const viewer = viewerRef.current;
      if (viewer) {
        if (key === 'wireframe') viewer.setWireframe(next.wireframe);
        if (key === 'grid') viewer.setGrid(next.grid);
        if (key === 'rotate') viewer.setAutoRotate(next.rotate);
        if (key === 'light') viewer.setBackground(next.light ? 'light' : 'dark');
      }
      return next;
    });
  }, []);

  const viewer = viewerRef.current;
  const ready = state.phase === 'ready';
  const clips = ready ? state.clips : [];

  const chips = [];
  if (ready) {
    const s = state.stats;
    chips.push(`${numberFmt.format(s.triangles)} triangles`, `${s.meshes} mesh${s.meshes === 1 ? '' : 'es'}`, `${s.materials} material${s.materials === 1 ? '' : 's'}`);
    if (clips.length) chips.push(`${clips.length} animation${clips.length === 1 ? '' : 's'}`);
    if (s.skinned) chips.push('rigged');
    if (state.source?.info?.blender) chips.push(`Blender ${state.source.info.blender}${state.source.cached ? ' · cached' : ''}`);
  }

  const toolButton = (key, label, title) =>
    h('button', { key, type: 'button', className: 'bpv-btn', 'aria-pressed': String(Boolean(ui[key])), title, onClick: () => toggle(key) }, label);

  return h(
    'div',
    { className: 'bpv-root', 'data-blender-preview': ext },
    h(
      'div',
      { className: 'bpv-stage', ref: stageRef },
      ready ? h('div', { className: 'bpv-chips' }, chips.map((text) => h('span', { key: text, className: 'bpv-chip' }, text))) : null,
      ready
        ? h(
            'div',
            { className: 'bpv-tools' },
            h('button', { type: 'button', className: 'bpv-btn', title: 'Frame the whole model', onClick: () => viewer?.frameModel() }, 'Reset view'),
            toolButton('rotate', 'Spin', 'Turn the model slowly'),
            toolButton('wireframe', 'Wire', 'Show the mesh wireframe'),
            toolButton('grid', 'Grid', 'Show the floor grid'),
            toolButton('light', 'Light bg', 'Light background'),
          )
        : null,
      ready ? h('div', { className: 'bpv-hint' }, 'Drag to rotate · right-drag to pan · scroll to zoom') : null,
      state.phase === 'converting' || state.phase === 'loading'
        ? h(
            'div',
            { className: 'bpv-center' },
            h('div', { className: 'bpv-spin' }),
            h('div', null, state.phase === 'converting' ? 'Converting with Blender… (first open only — cached after)' : 'Loading model…'),
          )
        : null,
      state.phase === 'error'
        ? h(
            'div',
            { className: 'bpv-center' },
            h('div', null, ext === 'blend' ? 'Could not convert this .blend' : 'Could not open this model'),
            h('div', { className: 'bpv-err' }, state.message),
            h('button', { type: 'button', className: 'bpv-btn', onClick: () => setAttempt((n) => n + 1) }, 'Retry'),
          )
        : null,
    ),
    ready && clips.length > 0
      ? h(
          'div',
          { className: 'bpv-anim' },
          h(
            'button',
            {
              type: 'button',
              className: 'bpv-play',
              'aria-label': anim.playing ? 'Pause' : 'Play',
              onClick: () => {
                viewer?.setPlaying(!anim.playing);
                setAnim((a) => ({ ...a, playing: !a.playing }));
              },
            },
            anim.playing ? '❚❚' : '▶',
          ),
          clips.length > 1
            ? h(
                'select',
                {
                  value: anim.clip,
                  'aria-label': 'Animation',
                  onChange: (event) => {
                    const index = Number(event.target.value);
                    viewer?.selectClip(index, anim.playing);
                    setAnim((a) => ({ ...a, clip: index, time: 0, duration: clips[index]?.duration ?? 0 }));
                  },
                },
                clips.map((clip) => h('option', { key: clip.index, value: clip.index }, clip.name)),
              )
            : h('span', { className: 'bpv-time', title: clips[0].name }, clips[0].name),
          h('input', {
            type: 'range',
            min: 0,
            max: anim.duration || 0,
            step: 0.001,
            value: Math.min(anim.time, anim.duration || 0),
            'aria-label': 'Animation time',
            onChange: (event) => {
              const time = Number(event.target.value);
              viewer?.seek(time);
              setAnim((a) => ({ ...a, time }));
            },
          }),
          h('span', { className: 'bpv-time' }, `${formatTime(anim.time)} / ${formatTime(anim.duration)}`),
          h(
            'select',
            {
              value: anim.speed,
              'aria-label': 'Playback speed',
              onChange: (event) => {
                const speed = Number(event.target.value);
                if (viewer) viewer.speed = speed;
                setAnim((a) => ({ ...a, speed }));
              },
            },
            [0.25, 0.5, 1, 1.5, 2].map((speed) => h('option', { key: speed, value: speed }, `${speed}×`)),
          ),
        )
      : null,
  );
}

/* ---- registration --------------------------------------------------------- */

export function apply(ctx) {
  ensureStyle();
  for (const preview of PREVIEWS) {
    ctx.effect(
      () => ctx.documentPreviews.register({
        id: preview.id,
        extensions: preview.extensions,
        binaryExtensions: preview.binaryExtensions,
        priority: 'extension',
        title: () => preview.title,
        loading: preview.loading,
        wrap: false,
      }),
      `blender-preview: ${preview.id}`,
    );
    ctx.effect(
      () => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
        name: 'sidebar.right.tab.document',
        key: preview.id,
      }, preview.component)),
      `blender-preview: ${preview.id} body`,
    );
  }
}

export { ModelPreviewBody };
