/**
 * Silence-aware event clamping (M2.1).
 *
 * The Kokoro model's viseme stream is coarser than its audio: a single
 * viseme can span a punctuation pause (e.g. one ~240 ms "nn" event over a
 * comma), which leaves the mouth visibly moving during what is audibly a
 * full stop.
 *
 * This module is pure TS (no audio decoding — pass in a mono sample stream):
 *
 *   - detectSilences(): RMS-gated silence windows from an audio buffer
 *   - clampEventsToSilences(): truncate phoneme events that straddle a
 *     silence, and shift events that begin inside one, so envelopes
 *     release/attack around the pause instead of across it.
 */

import type { PhonemeEvent } from './types.js';

export interface SilenceWindow {
  startMs: number;
  endMs: number;
}

export interface SilenceOptions {
  /** RMS window size, ms (default 20). */
  windowMs?: number;
  /** Silence gate as a fraction of peak RMS (default 0.08). */
  gate?: number;
  /** Ignore windows shorter than this, ms (default 90). */
  minMs?: number;
  /** Ignore windows within this many ms of the buffer edges (default 100). */
  edgeTrimMs?: number;
  /** Merge windows separated by less than this, ms (default 60). */
  mergeGapMs?: number;
}

const DEFAULTS: Required<SilenceOptions> = {
  windowMs: 20,
  gate: 0.08,
  minMs: 90,
  edgeTrimMs: 100,
  mergeGapMs: 60,
};

/**
 * Find interior silence windows in a mono sample stream (any sample rate;
 * Web Audio buffers are [-1, 1]). Returns sorted, merged windows in ms.
 */
export function detectSilences(
  samples: ArrayLike<number>,
  sampleRate: number,
  opts: SilenceOptions = {},
): SilenceWindow[] {
  const windowMs = opts.windowMs ?? DEFAULTS.windowMs;
  const gate = opts.gate ?? DEFAULTS.gate;
  const minMs = opts.minMs ?? DEFAULTS.minMs;
  const edgeTrimMs = opts.edgeTrimMs ?? DEFAULTS.edgeTrimMs;
  const mergeGapMs = opts.mergeGapMs ?? DEFAULTS.mergeGapMs;

  const winN = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const count = Math.floor(samples.length / winN);
  if (count < 3) return [];

  const rms = new Float32Array(count);
  let peak = 0;
  for (let w = 0; w < count; w++) {
    let s = 0;
    const off = w * winN;
    for (let i = 0; i < winN; i++) {
      const v = samples[off + i];
      s += v * v;
    }
    const r = Math.sqrt(s / winN);
    rms[w] = r;
    if (r > peak) peak = r;
  }
  if (peak <= 0) return [];
  const thr = peak * gate;

  // contiguous runs of windows below the gate
  const raw: SilenceWindow[] = [];
  let runStart = -1;
  for (let w = 0; w <= count; w++) {
    const silent = w < count && rms[w] < thr;
    if (silent && runStart < 0) runStart = w;
    if (!silent && runStart >= 0) {
      raw.push({ startMs: runStart * windowMs, endMs: w * windowMs });
      runStart = -1;
    }
  }

  const totalMs = count * windowMs;
  const kept = raw
    .filter((w) => w.endMs - w.startMs >= minMs)
    .filter((w) => w.startMs >= edgeTrimMs && w.endMs <= totalMs - edgeTrimMs)
    .sort((a, b) => a.startMs - b.startMs);

  const out: SilenceWindow[] = [];
  for (const w of kept) {
    const last = out[out.length - 1];
    if (last && w.startMs - last.endMs <= mergeGapMs) last.endMs = w.endMs;
    else out.push({ ...w });
  }
  return out;
}

/**
 * Return a phoneme array where events are adjusted around silences:
 *  - an event that straddles a window is truncated to end at the window's
 *    start — its release envelope then plays during the pause;
 *  - an event that begins inside a window is shifted to the window's end
 *    — it attacks when the speech resumes.
 * Events outside every window pass through unchanged (same objects).
 */
export function clampEventsToSilences(
  events: PhonemeEvent[],
  silences: SilenceWindow[],
): PhonemeEvent[] {
  if (silences.length === 0) return events;
  const out: PhonemeEvent[] = [];
  for (const ev of events) {
    let t = ev.t;
    let d = ev.d;
    for (const s of silences) {
      if (t >= s.startMs && t < s.endMs) t = s.endMs; // begins inside → shift
      const end = t + d;
      if (s.startMs >= t && s.startMs < end) {
        d = Math.max(30, s.startMs - t); // straddles → truncate (min 30 ms envelope)
      }
      if (s.endMs > end) break; // later windows cannot touch this event
    }
    out.push(t === ev.t && d === ev.d ? ev : { ...ev, t, d });
  }
  return out;
}
