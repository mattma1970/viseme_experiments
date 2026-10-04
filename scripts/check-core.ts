/**
 * Headless sanity checks for viseme-core (no browser needed).
 * Run: npm run check
 *
 * Verifies on the generated samples:
 *  - buildTrack produces a plausible-length track
 *  - every non-sil viseme in the coverage sentence reaches a healthy level
 *  - curves are smooth (bounded per-frame delta) and bounded to [0,1]
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTrack,
  NUM_VISEMES,
  VISEMES,
  VISeme_INDEX,
  clampEventsToSilences,
  detectSilences,
  phonemeToViseme,
  sampleTrack,
  type PhraseData,
  type PhraseFile,
  type VisemeId,
} from '../src/viseme-core/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

for (const file of ['sentence-1.json', 'sentence-2.json']) {
  console.log(`\n== ${file} ==`);
  const doc = JSON.parse(
    readFileSync(join(root, 'public', 'samples', file), 'utf8'),
  ) as PhraseFile;
  const track = buildTrack(doc);

  console.log(
    `  ${track.eventCount} phoneme events, ${track.durationMs} ms, ` +
      `${track.frameCount} frames @ ${track.fps} fps`,
  );

  const plausibleDuration =
    file === 'sentence-1.json'
      ? track.durationMs > 2500 && track.durationMs < 12000
      : track.durationMs > 1000 && track.durationMs < 6000;
  check('duration plausible', plausibleDuration);

  // all values within [0, 1]
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < track.frames.length; i++) {
    if (track.frames[i] < min) min = track.frames[i];
    if (track.frames[i] > max) max = track.frames[i];
  }
  check('values within [0,1]', min >= 0 && max <= 1, `min=${min.toFixed(3)} max=${max.toFixed(3)}`);

  // per-frame delta bounded (smoothness): raised-cosine + one-pole should
  // keep single-frame jumps well below 1.
  let maxDelta = 0;
  for (let c = 0; c < NUM_VISEMES; c++) {
    for (let f = 1; f < track.frameCount; f++) {
      const d = Math.abs(
        track.frames[f * NUM_VISEMES + c] -
          track.frames[(f - 1) * NUM_VISEMES + c],
      );
      if (d > maxDelta) maxDelta = d;
    }
  }
  check('per-frame delta < 0.5', maxDelta < 0.5, `maxDelta=${maxDelta.toFixed(3)}`);

  // per-channel peaks
  const peaks: Array<[string, number]> = track.maxPerChannel.map(
    (m, i) => [VISEMES[i], m],
  );
  peaks
    .filter(([, m]) => m > 0.3)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, m]) => console.log(`  peak  ${name.padEnd(12)} ${m.toFixed(3)}`));

  if (file === 'sentence-1.json') {
    // This sentence is designed to cover all 15 visemes — verify coverage.
    const missing = VISEMES.filter(
      (v) => v !== 'viseme_sil' && track.maxPerChannel[VISeme_INDEX[v]] < 0.4,
    );
    check(
      'all 14 speech visemes covered (peak ≥ 0.4)',
      missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : '',
    );
  }

  // a few frames of the timeline, to eyeball dominance behavior
  console.log('  sample frames (aa  E  I  O  U | PP SS TH DD FF kk nn RR CH):');
  for (const frac of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]) {
    const f = Math.min(track.frameCount - 1, Math.floor(frac * track.frameCount));
    const vals = VISEMES.slice(0, 14)
      .map((v) => track.frames[f * NUM_VISEMES + VISeme_INDEX[v]].toFixed(2).padStart(4));
    console.log(`  t=${(track.fps > 0 ? (f / track.fps * 1000) : 0).toFixed(0).padStart(5)}ms  ${vals.join(' ')}`);
  }
}

// ------------------------------------------------------------------
// M2: viseme-name pass-through — HeadTTS emits the Oculus viseme names
// directly as `p`, so they must map onto the matching morph channels
// with zero translation, and a model-shaped phrase must build cleanly.
// ------------------------------------------------------------------
console.log('\n== viseme-name pass-through (M2) ==');
{
  const passthrough: Array<[string, string]> = [
    ['aa', 'viseme_aa'],
    ['E', 'viseme_E'],
    ['I', 'viseme_I'],
    ['O', 'viseme_O'],
    ['U', 'viseme_U'],
    ['PP', 'viseme_PP'],
    ['SS', 'viseme_SS'],
    ['TH', 'viseme_TH'],
    ['DD', 'viseme_DD'],
    ['FF', 'viseme_FF'],
    ['kk', 'viseme_kk'],
    ['nn', 'viseme_nn'],
    ['RR', 'viseme_RR'],
    ['CH', 'viseme_CH'],
    ['sil', 'viseme_sil'],
  ];
  for (const [p, want] of passthrough) {
    const got = phonemeToViseme(p);
    check(`"${p}" -> ${want}`, got === want, `got ${got}`);
  }

  // a synthetic phrase shaped exactly like M2 feeds buildTrack():
  // viseme names as `p`, model timings
  const phrase: PhraseData = {
    text: 'peek',
    phonemes: [
      { p: 'sil', t: 0, d: 120 },
      { p: 'PP', t: 120, d: 90 },
      { p: 'I', t: 210, d: 300 },
      { p: 'kk', t: 510, d: 70 },
      { p: 'sil', t: 580, d: 120 },
    ],
  };
  const tr = buildTrack({
    format: 'phenomes.phrase',
    version: 1,
    text: 'peek',
    phrases: [phrase],
  });
  const peak = (name: VisemeId) => tr.maxPerChannel[VISeme_INDEX[name]] ?? 0;
  check('synthetic: PP peaks', peak('viseme_PP') > 0.4, `got ${peak('viseme_PP').toFixed(3)}`);
  check('synthetic: I peaks', peak('viseme_I') > 0.4, `got ${peak('viseme_I').toFixed(3)}`);
  check('synthetic: kk peaks', peak('viseme_kk') > 0.4, `got ${peak('viseme_kk').toFixed(3)}`);
  check(
    'synthetic: values stay in [0,1]',
    tr.frames.every((x) => x >= 0 && x <= 1),
  );
}

// ═══════════════════ M2.1: silence clamping ═══════════════════
console.log('\n== M2.1: silence clamping ==');
{
  // pseudo-audio: 440 Hz tone with a 300 ms gap at 400–700 ms
  const sr = 24000;
  const n = sr; // 1 s buffer
  const sig = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tMs = (i / sr) * 1000;
    if (tMs >= 400 && tMs < 700) continue;
    sig[i] = 0.3 * Math.sin(2 * Math.PI * 440 * (i / sr));
  }

  const sil = detectSilences(sig, sr);
  check('one interior silence window found', sil.length === 1, `found ${sil.length}`);
  const w = sil[0];
  check(
    'window ≈ 400–700 ms',
    !!w && w.startMs >= 360 && w.startMs <= 440 && w.endMs >= 660 && w.endMs <= 740,
    w ? `${w.startMs}–${w.endMs}` : 'n/a',
  );

  const tone = new Float32Array(n);
  for (let i = 0; i < n; i++) tone[i] = 0.3 * Math.sin(2 * Math.PI * 440 * (i / sr));
  check('continuous tone has no windows', detectSilences(tone, sr).length === 0);

  const evs = clampEventsToSilences(
    [
      { p: 'nn', t: 350, d: 400 }, // straddles 400–700 → truncate at 400
      { p: 'I', t: 500, d: 60 },   // begins inside → shift to 700
      { p: 'PP', t: 800, d: 50 },  // untouched
    ],
    sil,
  );
  check('straddling event truncated', evs[0].t === 350 && evs[0].d === 50, `${evs[0].t}+${evs[0].d}`);
  check('in-window event shifted', evs[1].t === 700 && evs[1].d === 60, `${evs[1].t}+${evs[1].d}`);
  check('later event untouched', evs[2].t === 800 && evs[2].d === 50);

  const tr = buildTrack({
    format: 'phenomes.phrase',
    version: 1,
    text: 'x',
    phrases: [{ text: 'x', phonemes: evs }],
  });
  const out = new Float32Array(NUM_VISEMES);
  const peakAt = (tMs: number): number => {
    sampleTrack(tr, tMs, out);
    let m = 0;
    for (const v of out) if (v > m) m = v;
    return m;
  };
  check('track near-still mid-pause (550 ms)', peakAt(550) < 0.1, `max ${peakAt(550).toFixed(3)}`);
  check('track near-still mid-pause (650 ms)', peakAt(650) < 0.1, `max ${peakAt(650).toFixed(3)}`);
  sampleTrack(tr, 750, out);
  check('shifted I event still fires (750 ms)', out[VISeme_INDEX['viseme_I']] > 0.3,
    `I=${out[VISeme_INDEX['viseme_I']].toFixed(3)}`);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
