/**
 * M2 demo: procedural test head driven by in-browser neural TTS.
 *
 *   text → Kokoro-82M (HeadTTS, WebGPU/WASM worker) → audio buffer + real
 *        word & viseme timings → viseme-core track → 15 morph targets
 *
 * Audio: the TTS buffer (24 kHz) is the clock source — the track is built
 * from the model's own timings, so audio and head share one clock with no
 * remapping (NeuralSpeech.getPlayedMs() drives the track directly).
 *
 * Until the model is downloaded — and whenever neural TTS is unavailable —
 * the M1 interim path stands in: the system voice (speechSynthesis) speaks
 * the sentence while per-word boundary events feed a TimeMap that remaps
 * the real speech clock onto the canned track's clock.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import {
  buildTrack,
  NUM_VISEMES,
  VISEMES,
  clampEventsToSilences,
  detectSilences,
  type PhraseFile,
  type VisemeTrack,
} from './viseme-core/index.js';
import {
  SystemSpeech,
  TimeMap,
  wordAtChar,
  wordSpans,
} from './demo/speech-bridge.js';
import { NeuralSpeech, type TTSResult } from './tts/index.js';
import {
  buildTestHead,
  mouthOffset,
  mouthScale,
  type TestHead,
} from './renderer/test-head.js';
import { VisemeDriver } from './renderer/viseme-driver.js';
import { makeChannelBars, type BarCanvas } from './renderer/bars.js';

// ------------------------------------------------------------------
// scene
// ------------------------------------------------------------------
const container = document.getElementById('app') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const timeEl = document.getElementById('time') as HTMLDivElement;
const sampleSel = document.getElementById('sample') as HTMLSelectElement;
const wireChk = document.getElementById('wireframe') as HTMLInputElement;
const soundChk = document.getElementById('sound') as HTMLInputElement;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const pauseBtn = document.getElementById('pause') as HTMLButtonElement;
const stopBtn = document.getElementById('stop') as HTMLButtonElement;
const voiceInfoEl = document.getElementById('voiceinfo') as HTMLDivElement;
const neuralInfoEl = document.getElementById('neuralinfo') as HTMLDivElement;
const domEl = document.getElementById('dom') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(container.clientWidth, container.clientHeight);
container.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101318);

const camera = new THREE.PerspectiveCamera(
  42,
  container.clientWidth / container.clientHeight,
  0.1,
  100,
);
camera.position.set(0, 0.08, 0.62);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.02, 0);
controls.enableDamping = true;
controls.update();

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20242c, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(0.5, 0.8, 0.7);
scene.add(key);

// ------------------------------------------------------------------
// head + driver + mouth stickers
// ------------------------------------------------------------------
const head: TestHead = buildTestHead();
scene.add(head.group);
const driver = new VisemeDriver(head.headMesh);

// The mouth opening (dark disc) and lip ring are separate stickers that
// must follow the morphed surface; buildTestHead leaves them at rest pose,
// the demo re-positions/scales them each frame via mouthOffset/mouthScale.
const mouthRest = {
  interiorPos: head.mouthInterior.position.clone(),
  interiorScale: head.mouthInterior.scale.clone(),
  lipsPos: head.lips.position.clone(),
  lipsScale: head.lips.scale.clone(),
};

function updateMouthStickers(vals: ArrayLike<number>): void {
  const { dy, dz } = mouthOffset(vals);
  const { w, h } = mouthScale(vals);
  head.mouthInterior.position.set(
    mouthRest.interiorPos.x,
    mouthRest.interiorPos.y + dy,
    mouthRest.interiorPos.z + dz,
  );
  head.mouthInterior.scale.set(
    mouthRest.interiorScale.x * w,
    mouthRest.interiorScale.y * h,
    mouthRest.interiorScale.z,
  );
  head.lips.position.set(
    mouthRest.lipsPos.x,
    mouthRest.lipsPos.y + dy * 0.9,
    mouthRest.lipsPos.z + dz * 0.9,
  );
  head.lips.scale.set(
    mouthRest.lipsScale.x * w,
    mouthRest.lipsScale.y * h,
    mouthRest.lipsScale.z,
  );
}

// channel value meters
const bars: BarCanvas = makeChannelBars(
  document.getElementById('bars') as HTMLCanvasElement,
);
const scratch = new Float32Array(NUM_VISEMES);
let domName = '';

// ------------------------------------------------------------------
// demo state
// ------------------------------------------------------------------
let track: VisemeTrack | null = null;
/** Playback end on the current clock — the track length, or longer when the
 *  audio buffer outruns it (clamped events can shorten the track). */
let trackEndMs = 0;
let elapsedMs = 0;
let playing = false;
let playStartWall = 0;
let pausedAt = 0;
let timeMap: TimeMap | null = null;

let sampleText = '';
/**
 * Word spans of the *active* track (canned JSON or neural TTS), used to
 * resume mid-sentence at word granularity.
 */
let words: {
  words: string[];
  wordStartMs: number[];
  charOffsets: number[];
} | null = null;

// M2: neural engine state in the demo
let neuralActive = false; // true while the neural buffer drives the clock
let playBusy = false;
let playSeq = 0; // invalidates in-flight neural plays on pause/stop
let neuralPct = -1; // -1 = no progress reported yet

const fmt = (ms: number): string => `${(ms / 1000).toFixed(1).padStart(5, ' ')}s`;
const status = (s: string): void => {
  statusEl.textContent = s;
};
function updateTime(): void {
  timeEl.textContent = track
    ? `${fmt(elapsedMs)} / ${fmt(trackEndMs)}`
    : 'track: –';
}

// ------------------------------------------------------------------
// voice: M2 neural (Kokoro/HeadTTS) with the M1 system-voice fallback
// ------------------------------------------------------------------
const neural = new NeuralSpeech();
const speech = new SystemSpeech();
let speechRunning = false;

function describeNeural(): string {
  switch (neural.state) {
    case 'unsupported':
      return 'neural TTS: unavailable in this browser (no module workers)';
    case 'idle':
      return `neural TTS: Kokoro ${
        neural.engine === 'webgpu' ? '(WebGPU)' : '(WASM)'
      } — downloads on first play, English only`;
    case 'loading':
      return neuralPct >= 0
        ? `neural TTS: downloading model ${neuralPct}%`
        : 'neural TTS: downloading model…';
    case 'ready':
      return `neural TTS: ready — ${neural.voiceName}`;
    case 'error':
      return 'neural TTS: failed — using system voice';
  }
}

neural.onProgress = (loaded, total) => {
  neuralPct =
    total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : -1;
  neuralInfoEl.textContent = describeNeural();
};
neural.onState = () => {
  neuralInfoEl.textContent = describeNeural();
};
neural.onFinished = () => {
  if (playing && neuralActive) finishPlayback();
};

// M1 fallback: boundary events → TimeMap anchors (relative to the resume
// point), so the canned track follows the voice's real pacing.
let wordsStartIdx = 0; // resume word index for the current system utterance
let sliceOff = 0; // char offset of the spoken slice in the full sentence

speech.onWord = (audioMs, charIndex) => {
  if (!timeMap || !words) return;
  // e.charIndex is relative to the spoken slice; map it back to the full
  // sentence's char offsets to find the word, then anchor at that word's
  // track time (relative to the resume point).
  const wi = wordAtChar(words.charOffsets, sliceOff + charIndex);
  timeMap.add(words.wordStartMs[wi] - words.wordStartMs[wordsStartIdx], audioMs);
};

if (speech.available) {
  voiceInfoEl.textContent = `system voice: ${speech.voiceName ?? 'default'}`;
} else {
  voiceInfoEl.textContent =
    'system voice unavailable — wall-clock pacing only';
}
neuralInfoEl.textContent = describeNeural();

/** M1 interim path: system voice (from word `fromMs`) on the canned track. */
function startSpeechFrom(fromMs: number): void {
  timeMap = new TimeMap();
  speechRunning = false;
  if (!words || words.words.length === 0) return;

  const wi = words.wordStartMs.reduce(
    (acc, s, i) => (s <= fromMs ? i : acc),
    0,
  );
  const base = words.wordStartMs[wi]; // track time of the resume word
  const off = words.charOffsets[wi]; // char offset of the resume word
  wordsStartIdx = wi;
  sliceOff = off;
  const slice = sampleText.slice(off);
  if (!slice.trim()) return;

  if (speech.speak(slice)) {
    speechRunning = true;
    pausedAt = base; // snap the track clock to the word boundary
  }
}

/**
 * M2 path: play (or resume) the current sample with neural TTS.
 * Synthesizes at most once per sample; on resume the cached buffer is
 * simply restarted at the resume word, so track and audio stay in
 * perfect sync by construction.
 */
async function playNeural(mySeq: number): Promise<void> {
  const text = sampleText;
  const wi = words
    ? words.wordStartMs.reduce((acc, s, i) => (s <= pausedAt ? i : acc), 0)
    : 0;

  status('synthesizing…');
  let result: TTSResult | null = null;
  try {
    result = await neural.speak(text, wi);
  } catch (e) {
    if (mySeq === playSeq) {
      status(`TTS error: ${e instanceof Error ? e.message : String(e)}`);
      playing = false;
      neuralActive = false;
    }
    return;
  }
  if (mySeq !== playSeq || !result) {
    neural.stop(); // paused/stopped while synthesizing
    return;
  }

  // the model's own timings become the track (same seam as the JSON).
  // M2.1: the model's viseme stream is coarser than its audio (a single
  // viseme can span a punctuation pause), so clamp events against the
  // silences that are actually audible in the buffer.
  const silences = detectSilences(result.buffer.getChannelData(0), result.buffer.sampleRate);
  const clamped = clampEventsToSilences(result.phonemes, silences);
  const tr = buildTrack({
    format: 'phenomes.phrase',
    version: 1,
    text,
    phrases: [{ text, phonemes: clamped }],
  });
  track = tr;
  trackEndMs = Math.max(tr.durationMs, result.durationMs);
  words = {
    words: result.words.map((w) => w.text.trim() || w.text),
    wordStartMs: result.words.map((w) => w.tMs),
    charOffsets: wordCharOffsets(text, result.words.map((w) => w.text)),
  };
  driver.loadTrack(tr);
  pausedAt = wi < result.words.length ? result.words[wi].tMs : 0;
  playStartWall = performance.now();
  timeMap = null;
  neuralActive = true;
  playing = true;
  status(`speaking (Kokoro ${neural.engine}) — ${fmt(result.durationMs)}`);
}

/** char offset of each word in `text` (best effort, case-insensitive). */
function wordCharOffsets(text: string, wordList: string[]): number[] {
  const lower = text.toLowerCase();
  const out: number[] = [];
  let last = 0;
  for (const w of wordList) {
    const t = w.trim().toLowerCase();
    const idx = t ? lower.indexOf(t, last) : -1;
    out.push(idx >= 0 ? idx : last + (w.length || 1));
    if (idx >= 0) last = idx;
  }
  return out;
}

async function play(): Promise<void> {
  if (playBusy) return;
  if (!track) {
    playBusy = true;
    try {
      await loadSample();
    } catch (e) {
      status(`error: ${e instanceof Error ? e.message : String(e)}`);
      playBusy = false;
      return;
    }
  }
  playSeq++;
  const mySeq = playSeq;
  playBusy = true;
  if (!track) {
    status('no track');
    playBusy = false;
    return;
  }

  if (pausedAt >= trackEndMs) pausedAt = 0;
  playStartWall = performance.now();
  timeMap = null;

  if (!soundChk.checked) {
    // audio off: the wall clock is the only clock
    playing = true;
    neuralActive = false;
    speechRunning = false;
    status('playing (audio off)');
    playBusy = false;
    return;
  }

  if (neural.state === 'ready') {
    // M2: neural TTS. Synthesis takes a few seconds; playBusy blocks
    // re-entry while it runs, pause/stop invalidate it via playSeq.
    neuralActive = false;
    await playNeural(mySeq);
    playBusy = false;
  } else {
    // M1 fallback: system voice on the canned track (TimeMap remaps its
    // boundary events onto the track clock). Kick off the model download
    // if this is the first play — next play will be neural.
    if (neural.state === 'idle') void neural.load();
    playing = true;
    startSpeechFrom(pausedAt);
    status(
      speechRunning
        ? neural.state === 'loading'
          ? 'speaking (system voice — Kokoro downloading…)'
          : 'speaking (system voice)'
        : 'speaking (no TTS — wall-clock pacing)',
    );
    playBusy = false;
  }
}

function pause(): void {
  if (!playing) return;
  playSeq++;
  playing = false;
  if (neuralActive) {
    // the neural buffer is the clock: ask it how far we got
    pausedAt = Math.min(
      neural.getPlayedMs(),
      track ? trackEndMs : Infinity,
    );
    neural.stop();
  } else {
    pausedAt = elapsedMs;
    speech.cancel();
  }
  speechRunning = false;
  neuralActive = false;
  status(`paused @ ${fmt(pausedAt)}`);
}

function stop(): void {
  playSeq++;
  playing = false;
  neuralActive = false;
  neural.stop();
  speech.cancel();
  speechRunning = false;
  pausedAt = 0;
  elapsedMs = 0;
  timeMap = null;
  driver.setAllZero();
  updateTime();
  status('stopped');
}

function finishPlayback(): void {
  elapsedMs = track ? trackEndMs : 0;
  playing = false;
  neuralActive = false;
  neural.stop();
  speech.cancel();
  speechRunning = false;
  timeMap = null;
  pausedAt = 0;
  driver.setAllZero();
  status('finished');
}

// ------------------------------------------------------------------
// samples
// ------------------------------------------------------------------
async function loadSample(): Promise<void> {
  const name = sampleSel.value.replace(/^\//, '');
  const url = (name.includes('/')
    ? new URL(name, document.baseURI)
    : new URL(`samples/${name}`, document.baseURI)).href;
  const file = (await (await fetch(url)).json()) as PhraseFile;

  const phrase = file.phrases[0];
  sampleText = file.text ?? phrase?.text ?? '';
  track = buildTrack(file);
  trackEndMs = track.durationMs;
  words = phrase ? wordSpans(sampleText, phrase.phonemes) : null;

  pausedAt = 0;
  elapsedMs = 0;
  driver.loadTrack(track);
  updateTime();
  status(
    `loaded "${name}" — ${track.eventCount} phonemes, ${fmt(track.durationMs)}`,
  );
}

// ------------------------------------------------------------------
// UI
// ------------------------------------------------------------------
playBtn.addEventListener('click', () => {
  void play();
});
pauseBtn.addEventListener('click', pause);
stopBtn.addEventListener('click', stop);
sampleSel.addEventListener('change', () => {
  void loadSample();
});
wireChk.addEventListener('change', () => {
  (head.headMesh.material as THREE.MeshStandardMaterial).wireframe =
    wireChk.checked;
});
// the engine is chosen at play-time; toggling sound just re-arms it

window.addEventListener('resize', () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ------------------------------------------------------------------
// frame loop
// ------------------------------------------------------------------
function tick(): void {
  controls.update();

  if (playing && track) {
    const nowMs = performance.now() - playStartWall;
    let t: number;
    if (neuralActive) {
      // M2: the neural buffer is the clock (exact by construction)
      t = pausedAt + neural.getPlayedMs();
    } else if (timeMap) {
      // M1 fallback: remap the speech clock onto the track clock
      t = pausedAt + timeMap.toTrack(nowMs);
    } else {
      t = pausedAt + nowMs;
    }
    if (t >= trackEndMs) {
      finishPlayback();
      t = trackEndMs;
    }
    elapsedMs = t;
    driver.updateTrack(elapsedMs);
    updateTime();
  }

  driver.readAll(scratch);
  updateMouthStickers(scratch);
  bars.draw(scratch);
  // dominant-viseme readout (updated only when the winner changes)
  let best = 0;
  for (let i = 1; i < scratch.length; i++) if (scratch[i] > scratch[best]) best = i;
  if (domName !== VISEMES[best]) {
    domName = VISEMES[best];
    domEl.textContent = `dominant: ${VISEMES[best]} (${scratch[best].toFixed(2)})`;
  }
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(tick);

// load the default sample on startup
void loadSample();
