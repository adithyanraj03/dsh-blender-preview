// blender-preview — shared browser-half helpers.

export const BASE = '/plugin-data/blender-preview';

const numberFmt = new Intl.NumberFormat('en-US');

/** Lowercase suffix of an address, ignoring query and fragment. */
export function extensionOf(address) {
  const clean = String(address ?? '').replace(/[?#].*$/, '');
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Decoded file name of an address, ignoring query and fragment. */
export function fileNameOf(address) {
  const clean = String(address ?? '').replace(/[?#].*$/, '');
  try {
    return decodeURIComponent(clean.slice(clean.lastIndexOf('/') + 1));
  } catch {
    return clean.slice(clean.lastIndexOf('/') + 1);
  }
}

/** `m:ss.xx` for a duration in seconds. */
export function formatTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}

/** `m:ss` — or `h:mm:ss` past an hour — for a clip length. */
export function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const hr = Math.floor(total / 3600);
  const mm = hr > 0 ? String(m).padStart(2, '0') : String(m);
  return `${hr > 0 ? `${hr}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** `1.4 MB`-style size. */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

/** `1200 × 800` with thousands separators. */
export function formatDimensions(width, height) {
  if (!width || !height) return '';
  return `${numberFmt.format(Math.round(width))} × ${numberFmt.format(Math.round(height))}`;
}

/** Same-origin URL that streams a Files-tab address through the host half, with Range support. */
export function mediaUrl(address) {
  return `${BASE}/media?address=${encodeURIComponent(String(address ?? ''))}`;
}
