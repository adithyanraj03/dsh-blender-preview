// blender-preview — video and audio previews.
//
// These files are too big to hand to the browser as one blob, and a player needs
// byte ranges to seek, so the body points the media element at the host half's
// streaming route (`/plugin-data/blender-preview/media`) and lets the element do
// the buffering. The tab registers these types with `loading: 'renderer'`, which
// means no bytes are read up front: the body owns loading and reports back
// through `content.loaded()`.

import React from 'react';
import { extensionOf, fileNameOf, formatBytes, formatDimensions, formatClock, mediaUrl } from './util.js';

const h = React.createElement;
const { useEffect, useRef, useState } = React;

/** Containers and codecs a Chromium renderer can usually decode, with a hint when it cannot. */
const CODEC_HINTS = {
  mkv: 'Chromium plays Matroska only when it carries H.264, VP9 or Opus. Remux to .webm or .mp4 to view it here.',
  avi: 'AVI is not a browser container. Convert to MP4 (H.264/AAC) or WebM.',
  wmv: 'Windows Media Video is not a browser container. Convert to MP4 (H.264/AAC) or WebM.',
  flv: 'Flash Video is not a browser container. Convert to MP4 (H.264/AAC) or WebM.',
  mpg: 'MPEG-1/2 program streams are not supported. Convert to MP4 (H.264/AAC) or WebM.',
  mpeg: 'MPEG-1/2 program streams are not supported. Convert to MP4 (H.264/AAC) or WebM.',
  ts: 'MPEG transport streams are not supported. Convert to MP4 (H.264/AAC) or WebM.',
  '3gp': '3GP is not supported by this renderer. Convert to MP4 (H.264/AAC).',
  mov: 'QuickTime plays when it carries H.264/AAC. Otherwise remux it to MP4.',
};

/** Ask the streaming route for size and media type without fetching the body. */
export function useMediaProbe(src, attempt) {
  const [probe, setProbe] = useState({ phase: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setProbe({ phase: 'loading' });
    (async () => {
      try {
        const response = await fetch(src, { method: 'HEAD' });
        if (cancelled) return;
        if (!response.ok) {
          setProbe({
            phase: 'error',
            message: response.status === 404
              ? 'The streaming route is not mounted. Restart DeepSeek Harness so the updated plugin loads.'
              : `The file could not be read (HTTP ${response.status}).`,
          });
          return;
        }
        setProbe({
          phase: 'ready',
          size: Number(response.headers.get('content-length') || 0),
          type: response.headers.get('content-type') || '',
        });
      } catch (cause) {
        if (!cancelled) setProbe({ phase: 'error', message: String(cause?.message ?? cause) });
      }
    })();
    return () => { cancelled = true; };
  }, [src, attempt]);
  return probe;
}

/* ---- video ---------------------------------------------------------------- */

export function VideoPreview(props) {
  const address = String(props.resourceAddress ?? '');
  const ext = extensionOf(address);
  const src = mediaUrl(address);

  const videoRef = useRef(null);
  const contentRef = useRef(props.content);
  contentRef.current = props.content;

  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState('loading');
  const [failure, setFailure] = useState(null);
  const [meta, setMeta] = useState({ duration: 0, width: 0, height: 0 });
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [fit, setFit] = useState('contain');
  const [pip, setPip] = useState(false);
  const probe = useMediaProbe(src, attempt);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const onLoaded = () => {
      setPhase('ready');
      setMeta({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
      try { contentRef.current?.loaded?.(); } catch { /* the tab is gone */ }
    };
    const onError = () => {
      setPhase('error');
      setFailure(CODEC_HINTS[ext] ?? 'This file could not be played in the browser.');
    };
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };
  }, [src, attempt, ext]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = rate;
  }, [rate, phase]);

  useEffect(() => {
    const onEnter = () => setPip(true);
    const onLeave = () => setPip(false);
    const video = videoRef.current;
    if (!video) return undefined;
    video.addEventListener('enterpictureinpicture', onEnter);
    video.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter);
      video.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, [phase]);

  const retry = () => {
    setPhase('loading');
    setFailure(null);
    setAttempt((n) => n + 1);
    try { contentRef.current?.reload?.(); } catch { /* optional */ }
  };

  const togglePip = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch { /* the browser refused; the native control still exists */ }
  };

  const chips = [];
  if (meta.width && meta.height) chips.push(formatDimensions(meta.width, meta.height));
  if (meta.duration) chips.push(formatClock(meta.duration));
  if (probe.phase === 'ready' && probe.size) chips.push(formatBytes(probe.size));
  if (probe.phase === 'ready' && probe.type) chips.push(probe.type);
  if (loop) chips.push('looping');
  // A working video outranks a failed HEAD probe.
  const blocked = phase === 'error' || (probe.phase === 'error' && phase !== 'ready');

  return h(
    'div',
    { className: 'bpv-root bpv-media', 'data-blender-preview': 'video' },
    h(
      'div',
      { className: 'bpv-video-stage' },
      h('video', {
        key: `${src}#${attempt}`,
        ref: videoRef,
        className: 'bpv-video',
        src,
        controls: true,
        playsInline: true,
        preload: 'metadata',
        loop,
        'data-fit': fit,
      }),
      chips.length
        ? h('div', { className: 'bpv-chips' }, chips.map((text) => h('span', { key: text, className: 'bpv-chip' }, text)))
        : null,
      phase === 'loading' && probe.phase !== 'error'
        ? h('div', { className: 'bpv-center bpv-center-solid' }, h('div', { className: 'bpv-spin' }), h('div', null, 'Opening video…'))
        : null,
      blocked
        ? h(
            'div',
            { className: 'bpv-center bpv-center-solid' },
            h('div', null, 'Could not play this video'),
            h('div', { className: 'bpv-err' }, failure ?? probe.message ?? 'Unknown error.'),
            h('button', { type: 'button', className: 'bpv-btn', onClick: retry }, 'Retry'),
          )
        : null,
    ),
    h(
      'div',
      { className: 'bpv-mediabar' },
      h('span', { className: 'bpv-mediabar-name', title: fileNameOf(address) }, fileNameOf(address)),
      h(
        'select',
        {
          value: rate,
          'aria-label': 'Playback speed',
          onChange: (event) => setRate(Number(event.target.value)),
        },
        [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => h('option', { key: speed, value: speed }, `${speed}×`)),
      ),
      h('button', { type: 'button', className: 'bpv-btn', 'aria-pressed': String(loop), title: 'Loop this clip', onClick: () => setLoop((v) => !v) }, 'Loop'),
      h(
        'button',
        {
          type: 'button',
          className: 'bpv-btn',
          title: 'Contain the whole frame, or cover the pane',
          onClick: () => setFit((v) => (v === 'contain' ? 'cover' : 'contain')),
        },
        fit === 'contain' ? 'Contain' : 'Cover',
      ),
      typeof document !== 'undefined' && document.pictureInPictureEnabled
        ? h('button', { type: 'button', className: 'bpv-btn', 'aria-pressed': String(pip), title: 'Picture in picture', onClick: togglePip }, 'PiP')
        : null,
    ),
  );
}

/* ---- audio ---------------------------------------------------------------- */

export function AudioPreview(props) {
  const address = String(props.resourceAddress ?? '');
  const src = mediaUrl(address);
  const contentRef = useRef(props.content);
  contentRef.current = props.content;

  const audioRef = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState('loading');
  const [failure, setFailure] = useState(null);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const probe = useMediaProbe(src, attempt);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onLoaded = () => {
      setPhase('ready');
      setDuration(audio.duration);
      try { contentRef.current?.loaded?.(); } catch { /* the tab is gone */ }
    };
    const onError = () => {
      setPhase('error');
      setFailure('This audio file could not be decoded in the browser.');
    };
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('error', onError);
    };
  }, [src, attempt]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, phase]);

  const retry = () => {
    setPhase('loading');
    setFailure(null);
    setAttempt((n) => n + 1);
    try { contentRef.current?.reload?.(); } catch { /* optional */ }
  };

  const chips = [];
  if (duration) chips.push(formatClock(duration));
  if (probe.phase === 'ready' && probe.size) chips.push(formatBytes(probe.size));
  if (probe.phase === 'ready' && probe.type) chips.push(probe.type);
  const blocked = phase === 'error' || (probe.phase === 'error' && phase !== 'ready');

  return h(
    'div',
    { className: 'bpv-root bpv-media', 'data-blender-preview': 'audio' },
    h(
      'div',
      { className: 'bpv-audio-card' },
      h('div', { className: 'bpv-audio-icon', 'aria-hidden': 'true' }, '♪'),
      h('div', { className: 'bpv-audio-name', title: fileNameOf(address) }, fileNameOf(address)),
      h('div', { className: 'bpv-audio-sub' }, chips.length ? chips.join(' · ') : ' '),
      blocked
        ? h(
            'div',
            { className: 'bpv-audio-error' },
            h('div', null, failure ?? probe.message ?? 'Unknown error.'),
            h('button', { type: 'button', className: 'bpv-btn', onClick: retry }, 'Retry'),
          )
        : h('audio', {
            key: `${src}#${attempt}`,
            ref: audioRef,
            className: 'bpv-audio',
            src,
            controls: true,
            preload: 'metadata',
            loop,
          }),
      h(
        'div',
        { className: 'bpv-mediabar' },
        h(
          'select',
          {
            value: rate,
            'aria-label': 'Playback speed',
            onChange: (event) => setRate(Number(event.target.value)),
          },
          [0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => h('option', { key: speed, value: speed }, `${speed}×`)),
        ),
        h('button', { type: 'button', className: 'bpv-btn', 'aria-pressed': String(loop), title: 'Loop this clip', onClick: () => setLoop((v) => !v) }, 'Loop'),
      ),
    ),
  );
}
