/**
 * buildTrack: phoneme events → 15-channel viseme animation track.
 *
 * This is the deterministic, model-free heuristic path (the "OpenFaceFX
 * naive" / FaceFX-style idea, in pure TS):
 *
 *   1. Map each phoneme to its Oculus viseme (visemes.ts).
 *   2. Give each phoneme an attack-sustain-release envelope
 *      (raised-cosine, lengths scaled by phoneme duration).
 *   3. Where phonemes overlap in time (natural co-articulation), weight
 *      each by a Cohen–Massaro-style dominance priority, so e.g. a plosive
 *      "swallows" the neighboring vowel instead of both showing at full.
 *   4. Per-channel value = max of (priority-weighted) contributions of all
 *      active events on that channel, scaled by the viseme's target
 *      amplitude.
 *   5. Optional one-pole temporal smoothing, clamp to [0, 1], sample to fps.
 *
 * No ML, no audio — just text timing and a lookup table.
 */

import {
  AMPLITUDE,
  PRIORITY,
  NUM_VISEMES,
  VISEMES,
  phonemeToViseme,
  type VisemeId,
} from './visemes.js';

const VISEMES_INDEX: Record<VisemeId, number> = Object.fromEntries(
  VISEMES.map((v, i) => [v, i]),
) as Record<VisemeId, number>;
import { clamp01, eventEnvelope, OnePole } from './easing.js';
import type { CurveOptions, PhraseFile, VisemeTrack } from './types.js';

const DEFAULTS = {
  fps: 60,
  phraseGapMs: 140,
  smoothTauMs: 22,
  attackFrac: 0.35,
  releaseFrac: 0.45,
};

/** A phoneme event rebased to absolute (track-relative) time, with derived fields. */
interface ActiveEvent {
  t0: number;
  d: number;
  att: number;
  rel: number;
  viseme: VisemeId;
  prio: number;
  amp: number;
}

/**
 * Flatten a phrase file into absolute-time events (inserting `phraseGapMs`
 * of silence between phrases) and derive per-event envelope parameters.
 */
export function flattenPhrases(file: PhraseFile, opts: CurveOptions = {}): ActiveEvent[] {
  const phraseGapMs = opts.phraseGapMs ?? DEFAULTS.phraseGapMs;
  const attackFrac = opts.attackFrac ?? DEFAULTS.attackFrac;
  const releaseFrac = opts.releaseFrac ?? DEFAULTS.releaseFrac;

  const events: ActiveEvent[] = [];
  let phraseOffset = 0;

  for (let pi = 0; pi < file.phrases.length; pi++) {
    if (pi > 0) phraseOffset += phraseGapMs;
    for (const ev of file.phrases[pi].phonemes) {
      const viseme = phonemeToViseme(ev.p);
      if (viseme === 'viseme_sil') continue; // silence carries no shape
      const d = Math.max(ev.d, 1);
      events.push({
        t0: phraseOffset + ev.t,
        d,
        // Attack: 20–70 ms, Release: 35–130 ms (scales with duration, clamped).
        att: clamp01(0) !== undefined ? Math.min(70, Math.max(20, attackFrac * d)) : 20,
        rel: Math.min(130, Math.max(35, releaseFrac * d)),
        viseme,
        prio: PRIORITY[viseme],
        amp: AMPLITUDE[viseme],
      });
    }
  }

  events.sort((a, b) => a.t0 - b.t0);
  return events;
}

/**
 * Build the full 15-channel track.
 *
 * @param file  canned phoneme timeline (format "phenomes.phrase")
 * @param opts  see CurveOptions
 */
export function buildTrack(file: PhraseFile, opts: CurveOptions = {}): VisemeTrack {
  const fps = opts.fps ?? DEFAULTS.fps;
  const events = flattenPhrases(file, opts);

  // Track length: last event end + its release + a short resting tail.
  let endMs = 0;
  for (const e of events) endMs = Math.max(endMs, e.t0 + e.d + e.rel);
  endMs += 200;
  const frameCount = Math.max(1, Math.round((endMs / 1000) * fps));
  const dtMs = 1000 / fps;

  // Per-channel raw contributions, recomputed per frame (events are cheap:
  // only those whose envelope window contains the frame matter).
  const raw = new Float32Array(NUM_VISEMES);
  const smoothers = new Array<OnePole>(NUM_VISEMES);
  for (let c = 0; c < NUM_VISEMES; c++) {
    smoothers[c] = new OnePole(opts.smoothTauMs ?? DEFAULTS.smoothTauMs);
  }

  const frames = new Float32Array(frameCount * NUM_VISEMES);
  const maxPerChannel = new Array<number>(NUM_VISEMES).fill(0);

  for (let f = 0; f < frameCount; f++) {
    const t = f * dtMs;

    raw.fill(0);
    let anyActive = false;
    // Dominance weighting over all active events this frame.
    let weightSum = 0;
    for (const e of events) {
      if (e.t0 > t) break; // sorted by t0
      const env = eventEnvelope(t, e.t0, e.d, e.att, e.rel);
      if (env <= 0) continue;
      anyActive = true;
      weightSum += e.prio * env;
    }
    if (anyActive && weightSum > 0) {
      for (const e of events) {
        if (e.t0 > t) break;
        const env = eventEnvelope(t, e.t0, e.d, e.att, e.rel);
        if (env <= 0) continue;
        const w = (e.prio * env) / weightSum; // dominance blend
        const ch = VISEMES_INDEX[e.viseme];
        // Contribution: dominance weight × amplitude × the event's own
        // envelope. The env factor matters on its own: without it a *lone*
        // releasing event (weight normalizes to 1.0 once rivals hit zero)
        // would snap to full amplitude for a frame or two instead of
        // decaying — the "mouth moves in the pause" artifact. During full
        // holds (env=1) this is identical to the old weight-only blend.
        const v = w * env * e.amp;
        if (v > raw[ch]) raw[ch] = v;
      }
    }

    const base = f * NUM_VISEMES;
    for (let c = 0; c < NUM_VISEMES; c++) {
      const s = smoothers[c].step(raw[c], dtMs);
      frames[base + c] = clamp01(s);
      if (frames[base + c] > maxPerChannel[c]) maxPerChannel[c] = frames[base + c];
    }
  }

  return {
    channels: [...VISEMES],
    fps,
    frames,
    frameCount,
    durationMs: Math.round(frameCount / fps * 1000),
    maxPerChannel,
    eventCount: events.length,
  };
}

/**
 * Sample a track at an arbitrary time (ms). Linear interpolation between
 * frames — used by the driver and by tests.
 *
 * @returns Float32Array of NUM_VISEMES values.
 */
export function sampleTrack(track: VisemeTrack, tMs: number, out: Float32Array): Float32Array {
  const f = (tMs / 1000) * track.fps;
  const f0 = Math.floor(f);
  const n = track.frameCount;
  const c0 = Math.max(0, Math.min(n - 1, f0));
  const c1 = Math.min(n - 1, c0 + 1);
  const frac = c1 === c0 ? 0 : f - f0;
  const b0 = c0 * NUM_VISEMES;
  const b1 = c1 * NUM_VISEMES;
  for (let c = 0; c < NUM_VISEMES; c++) {
    out[c] = track.frames[b0 + c] + (track.frames[b1 + c] - track.frames[b0 + c]) * frac;
  }
  return out;
}
