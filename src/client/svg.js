// blender-preview — SVG preview.
//
// The file arrives as complete bytes (the Files tab's shared reader), so the body
// never touches the disk: it wraps those bytes in a Blob, decodes that into an
// Image, and paints the image into a canvas at the exact device scale.
//
// Canvas instead of an <img> sized by CSS: Chromium leaves stale raster tiles when
// a scaled SVG image is re-composited, which showed up as ghost copies of the
// drawing after zooming. Repainting the canvas each frame is both artifact-free
// and vector-sharp at high zoom. Scripts inside the SVG never run: an Image is
// inert, exactly like the built-in image preview's <img>.

import React from 'react';
import { formatBytes, formatDimensions } from './util.js';

const h = React.createElement;
const { useEffect, useLayoutEffect, useRef, useState } = React;

const MIN_SCALE = 0.02;
const MAX_SCALE = 64;

/* ---- SVG source inspection ------------------------------------------------ */

const UNIT_PX = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

/** One SVG length → CSS pixels, or undefined when it cannot be resolved without layout. */
export function lengthPx(value) {
  if (value === undefined) return undefined;
  const hit = /^\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(String(value));
  if (!hit) return undefined;
  const n = Number(hit[1]);
  if (!Number.isFinite(n)) return undefined;
  return n * (UNIT_PX[(hit[2] ?? 'px').toLowerCase()] ?? 1);
}

/** `0 0 1200 800` → { minX, minY, width, height }. */
export function parseViewBox(value) {
  if (typeof value !== 'string') return undefined;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [minX, minY, width, height] = parts;
  if (width <= 0 || height <= 0) return undefined;
  return { minX, minY, width, height };
}

/** Read the root <svg> tag: declared size, viewBox, and whether it has scripts. */
export function parseSvg(text) {
  const source = String(text ?? '');
  const root = /<svg\b[^>]*>/i.exec(source.replace(/<!--[\s\S]*?-->/g, ''));
  if (!root) return { valid: false };
  const tag = root[0];
  const attr = (name) => {
    const hit = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
    return hit ? (hit[2] ?? hit[3] ?? '') : undefined;
  };
  const viewBox = parseViewBox(attr('viewBox'));
  const declaredWidth = attr('width');
  const declaredHeight = attr('height');
  const width = lengthPx(declaredWidth) ?? viewBox?.width ?? 300;
  const height = lengthPx(declaredHeight) ?? viewBox?.height ?? 150;
  return {
    valid: true,
    width,
    height,
    viewBox,
    declared: { width: declaredWidth, height: declaredHeight },
    scripts: /<script\b/i.test(source),
  };
}

/** Decode SVG bytes to text for inspection; not every SVG declares UTF-8. */
export function svgText(bytes) {
  if (!bytes || typeof bytes.length !== 'number') return '';
  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

/* ---- the body ------------------------------------------------------------- */

export function SvgPreview(props) {
  const address = String(props.resourceAddress ?? '');
  const bytes = props.content && props.content.kind === 'bytes' ? props.content.data : undefined;

  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const frameRef = useRef(0);

  const [url, setUrl] = useState();
  const [info, setInfo] = useState(null);
  const [loaded, setLoaded] = useState(0);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(null); // null follows the pane
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [background, setBackground] = useState('checker');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(null);

  // One Blob URL per file version; revoked on replace and unmount.
  useEffect(() => {
    if (bytes === undefined) return undefined;
    let next;
    try {
      next = URL.createObjectURL(new Blob([bytes], { type: 'image/svg+xml' }));
    } catch (cause) {
      setError(String(cause?.message ?? cause));
      return undefined;
    }
    setError(null);
    setInfo(parseSvg(svgText(bytes)));
    setUrl(next);
    setZoom(null);
    setPan({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(next);
  }, [bytes, attempt]);

  // Decode the image once per URL; the canvas paints from it.
  useEffect(() => {
    if (!url) return undefined;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      imageRef.current = image;
      setLoaded((n) => n + 1);
    };
    image.onerror = () => setError('This SVG did not decode. It may be malformed, or reference a file it needs.');
    image.src = url;
    return () => {
      image.onload = null;
      image.onerror = null;
      if (imageRef.current === image) imageRef.current = null;
    };
  }, [url]);

  // Track the pane so "fit" follows a resize.
  useLayoutEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;
    const measure = () => setStage({ width: node.clientWidth, height: node.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [url]);

  // The SVG default when the root tag declares neither width nor viewBox.
  const natural = info?.valid
    ? { width: Math.max(1, info.width), height: Math.max(1, info.height) }
    : { width: 300, height: 150 };
  const fitScale = stage.width > 0 && stage.height > 0
    ? Math.min((stage.width - 32) / natural.width, (stage.height - 32) / natural.height, 1)
    : 1;
  const scale = zoom ?? Math.max(MIN_SCALE, fitScale);

  // Paint the visible window at device resolution; drawImage re-rasterizes the
  // vector at that scale, so zooming stays sharp instead of enlarging pixels.
  useEffect(() => {
    const canvas = canvasRef.current;
    const node = stageRef.current;
    const image = imageRef.current;
    if (!canvas || !node) return undefined;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const width = node.clientWidth;
      const height = node.clientHeight;
      const backingWidth = Math.max(1, Math.round(width * dpr));
      const backingHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      if (!image) return;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.translate(width / 2 + pan.x, height / 2 + pan.y);
      context.scale(scale, scale);
      context.drawImage(image, -natural.width / 2, -natural.height / 2, natural.width, natural.height);
    });
    return () => cancelAnimationFrame(frameRef.current);
  }, [loaded, scale, pan, stage, natural.width, natural.height]);

  const clampZoom = (next) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  const zoomBy = (factor) => setZoom(clampZoom(scale * factor));
  const fit = () => {
    setZoom(null);
    setPan({ x: 0, y: 0 });
  };

  const onWheel = (event) => {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    // The toolbar sits inside the stage; capturing the pointer there would
    // swallow the button's own click.
    if (event.target?.closest?.('button, a, input, select, textarea')) return;
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({ x: drag.panX + (event.clientX - drag.x), y: drag.panY + (event.clientY - drag.y) });
  };
  const endDrag = (event) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
  };

  const chips = [];
  if (info?.valid) {
    chips.push(`${formatDimensions(natural.width, natural.height)} px`);
    if (info.viewBox) {
      chips.push(`viewBox ${[info.viewBox.minX, info.viewBox.minY, info.viewBox.width, info.viewBox.height].join(' ')}`);
    }
  }
  if (bytes) chips.push(formatBytes(bytes.length));
  if (info?.scripts) chips.push('scripts not run');

  const percent = Math.round(scale * 100);
  const following = zoom === null;

  const toolButton = (label, title, onClick, pressed) =>
    h('button', { type: 'button', className: 'bpv-btn', title, 'aria-pressed': String(Boolean(pressed)), onClick }, label);

  return h(
    'div',
    { className: 'bpv-root', 'data-blender-preview': 'svg' },
    h(
      'div',
      {
        className: `bpv-stage bpv-svg-stage bpv-bg-${background}`,
        ref: stageRef,
        onWheel,
        onPointerDown,
        onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        onDoubleClick: fit,
      },
      h('canvas', { className: 'bpv-svg-canvas', ref: canvasRef, 'aria-label': address ? 'SVG preview' : undefined }),
      chips.length
        ? h('div', { className: 'bpv-chips' }, chips.map((text) => h('span', { key: text, className: 'bpv-chip' }, text)))
        : null,
      h(
        'div',
        { className: 'bpv-tools' },
        toolButton('Fit', 'Fit to the pane', fit, following),
        toolButton('100%', 'Actual pixels', () => setZoom(1), zoom === 1),
        toolButton('−', 'Zoom out', () => zoomBy(1 / 1.25), false),
        h('span', { className: 'bpv-zoom' }, `${percent}%`),
        toolButton('+', 'Zoom in', () => zoomBy(1.25), false),
        h(
          'button',
          {
            type: 'button',
            className: 'bpv-btn',
            title: 'Background: checkerboard, dark, light',
            onClick: () => setBackground((current) => (current === 'checker' ? 'dark' : current === 'dark' ? 'light' : 'checker')),
          },
          background === 'checker' ? 'Checker' : background === 'dark' ? 'Dark' : 'Light',
        ),
      ),
      error
        ? h(
            'div',
            { className: 'bpv-center bpv-center-solid' },
            h('div', null, 'Could not draw this SVG'),
            h('div', { className: 'bpv-err' }, error),
            h('button', { type: 'button', className: 'bpv-btn', onClick: () => setAttempt((n) => n + 1) }, 'Retry'),
          )
        : null,
      !error && loaded > 0 ? h('div', { className: 'bpv-hint' }, 'Drag to pan · scroll to zoom · double-click to fit') : null,
    ),
  );
}
