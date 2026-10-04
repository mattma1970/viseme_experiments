// Dump what the 15 viseme channels contain during REAL silence gaps in a
// comma sentence, using the exact browser pipeline:
//   raw Kokoro viseme timings → buildTrack() → sampleTrack(t)
//
// Pause windows are found from the actual audio (RMS per 20 ms window) —
// i.e. the silences the user hears — and cross-checked against the raw
// model viseme stream.
import { readFileSync } from 'node:fs';
import {
  buildTrack, sampleTrack, VISEMES,
  detectSilences, clampEventsToSilences,
} from '../src/viseme-core/index.js';
import type { PhraseFile } from '../src/viseme-core/index.js';

const raw = JSON.parse(readFileSync('/tmp/pause-synth.json', 'utf8')) as {
  text: string; words: string[]; wtimes: number[]; wdurations: number[];
  visemes: string[]; vtimes: number[]; vdurations: number[];
};
const { text, words, wtimes, wdurations, visemes, vtimes, vdurations } = raw;

// ---- 1. silence windows from the WAV (24 kHz, 16-bit PCM mono) ------------
const wav = new Uint8Array(readFileSync('/tmp/pause-audio.wav'));
const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
// walk RIFF chunks to the fmt/data headers
let off = 12, sr = 24000, dataOff = 0;
while (off + 8 <= wav.length) {
  const id = String.fromCharCode(wav[off], wav[off + 1], wav[off + 2], wav[off + 3]);
  const size = dv.getUint32(off + 4, true);
  if (id === 'fmt ') sr = dv.getUint32(off + 12, true);
  if (id === 'data') { dataOff = off + 8; break; }
  off += 8 + size + (size & 1);
}
const n = Math.floor((wav.length - dataOff) / 2);
const samples = new Float32Array(n);
for (let i = 0; i < n; i++) samples[i] = dv.getInt16(dataOff + i * 2, true) / 32768;
const durMs = (n / sr) * 1000;

const win = 20; // ms
const rms: number[] = [];
let peak = 0;
for (let t = 0; t < n; t += (sr * win) / 1000) {
  let s = 0;
  const e = Math.min(n, t + (sr * win) / 1000);
  for (let i = t; i < e; i++) s += samples[i] * samples[i];
  const r = Math.sqrt(s / Math.max(1, e - t));
  rms.push(r);
  if (r > peak) peak = r;
}
const silentThresh = peak * 0.08; // relative gate
const silent = rms.map((r) => r < silentThresh);

// contiguous silent runs (min 90 ms — punctuation pauses, not inter-phoneme gaps)
const gaps: Array<[number, number]> = [];
let run = -1;
for (let i = 0; i < silent.length; i++) {
  if (silent[i] && run < 0) run = i;
  if ((!silent[i] || i === silent.length - 1) && run >= 0) {
    const s = run * win, e = (i - 1) * win;
    if (e - s >= 90 && s > 100 && e < durMs - 250) gaps.push([s, e]); // ignore lead/trail
    run = -1;
  }
}
console.log(`text: ${text}\n`);
console.log(`audio: ${Math.round(durMs)} ms @ ${sr} Hz, peak RMS ${peak.toFixed(3)}, gate ${silentThresh.toFixed(3)}`);
console.log(`silence windows (≥90 ms, interior): ${gaps.map(([s, e]) => `${s}–${e} ms (${e - s} ms)`).join(', ') || 'none'}\n`);
console.log('raw model visemes:');
console.log('  ' + visemes.map((v, i) => `${v}[${vtimes[i]}+${vdurations[i]}]`).join(' '));
console.log(`worker words field (${words.length} word(s) — real browser shape, one per word for pause/resume):`);

// ---- 2. build the track exactly like the browser ---------------------------
const file: PhraseFile = {
  format: 'phenomes.phrase',
  version: 1,
  text,
  phrases: [{ text, phonemes: visemes.map((v, i) => ({ p: v, t: vtimes[i], d: vdurations[i] })) }],
};
const track = buildTrack(file);
console.log(`buildTrack (before clamping): ${track.durationMs} ms, ${track.frameCount} frames @ ${track.fps} fps`);

// M2.1: exactly what main.ts does now
const wavSamples = samples;
const silences = detectSilences(wavSamples, sr);
const clamped = clampEventsToSilences(file.phrases[0].phonemes, silences);
const orig = file.phrases[0].phonemes;
const changed = clamped.filter((e, i) => e !== orig[i]);
console.log(`silences detected from audio: ${silences.map((s) => `${s.startMs}–${s.endMs}`).join(', ') || 'none'}`);
console.log(`clamped events (${changed.length} changed):`);
clamped.forEach((e, i) => {
  if (e === orig[i]) return;
  console.log(`  ${e.p}: [t=${orig[i].t}, d=${orig[i].d}] → [t=${e.t}, d=${e.d}]`);
});
const trackAfter = buildTrack({ ...file, phrases: [{ text, phonemes: clamped }] });
console.log(`buildTrack (after clamping): ${trackAfter.durationMs} ms, ${trackAfter.frameCount} frames @ ${trackAfter.fps} fps\n`);

// ---- 3. per-window dump (before vs after) -----------------------------------
for (const [s, e] of gaps) {
  console.log(`══ silence window ${s}–${e} ms ══`);
  const from = Math.max(0, s - 250), to = Math.min(Math.max(track.durationMs, trackAfter.durationMs), e + 200);
  console.log('t(ms)  BEFORE (per channel, 2dp / "." <0.01)');
  console.log('      ' + VISEMES.map((v) => v.padStart(3)).join(' '));
  let maxBefore = 0, maxAfter = 0;
  const perChB = new Map<string, number>(), perChA = new Map<string, number>();
  for (let t = from; t <= to; t += 50) {
    const ob = new Float32Array(VISEMES.length);
    const oa = new Float32Array(VISEMES.length);
    sampleTrack(track, t, ob);
    sampleTrack(trackAfter, t, oa);
    const cells = VISEMES.map((_, c) => (ob[c] < 0.01 ? '.' : ob[c].toFixed(2)).padStart(3));
    const mark = t >= s && t < e ? '   <<< SILENCE' : '';
    console.log(`${String(t).padStart(5)}  ${cells.join(' ')}${mark}`);
    for (let c = 0; c < ob.length; c++) {
      if (t >= s && t < e) {
        if (ob[c] > maxBefore) maxBefore = ob[c];
        if (oa[c] > maxAfter) maxAfter = oa[c];
        perChB.set(VISEMES[c], Math.max(perChB.get(VISEMES[c]) ?? 0, ob[c]));
        perChA.set(VISEMES[c], Math.max(perChA.get(VISEMES[c]) ?? 0, oa[c]));
      }
    }
  }
  console.log('      AFTER clamping (per channel)');
  console.log('      ' + VISEMES.map((v) => v.padStart(3)).join(' '));
  for (let t = from; t <= to; t += 50) {
    const oa = new Float32Array(VISEMES.length);
    sampleTrack(trackAfter, t, oa);
    const cells = VISEMES.map((_, c) => (oa[c] < 0.01 ? '.' : oa[c].toFixed(2)).padStart(3));
    const mark = t >= s && t < e ? '   <<< SILENCE' : '';
    console.log(`${String(t).padStart(5)}  ${cells.join(' ')}${mark}`);
  }
  console.log(`during silence: BEFORE peak ${maxBefore.toFixed(3)} (${[...perChB.entries()].filter(([, v]) => v >= 0.01).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ')})`);
  console.log(`during silence: AFTER  peak ${maxAfter.toFixed(3)} (${[...perChA.entries()].filter(([, v]) => v >= 0.01).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ') || 'all ~0'}`);
  const straddle = visemes.map((v, i) => ({ v, t: vtimes[i], d: vdurations[i] }))
    .filter((x) => x.t < e && x.t + x.d > s);
  console.log('raw model visemes overlapping the window: ' +
    (straddle.map((x) => `${x.v}[${x.t}+${x.d}→${x.t + x.d}]`).join(' ') || 'none'));
  console.log('');
}
