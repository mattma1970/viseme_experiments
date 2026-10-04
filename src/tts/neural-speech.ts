/**
 * M2: in-browser neural TTS — Kokoro-82M via the vendored HeadTTS modules
 * (`./vendor`, MIT — met4citizen/HeadTTS v1.3.0) running in a module Web
 * Worker: WebGPU preferred, WASM fallback.
 *
 * Model: `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped` (Apache-2.0),
 * fetched from the HuggingFace CDN on first use (~325 MB fp32 on WebGPU,
 * ~305 MB q4 on WASM) and cached by transformers.js via the Cache API,
 * which is on by default in browsers — later sessions load from cache.
 *
 * The seam: like `SystemSpeech` (demo/speech-bridge.ts) this plays over a
 * shared AudioContext and exposes speak/stop/onFinished, but the model
 * provides *exact* word and viseme timings, so a track built from
 * `TTSResult.phonemes` shares the audio's clock 1:1 — the demo needs no
 * TimeMap remap on this path.
 *
 * English only (G2P = CMU Pronouncing Dictionary, en-us).
 */

import type { PhonemeEvent } from '../viseme-core/types.js';
import type { HeadTTSAudioData } from './vendor/headtts.mjs';
import { HeadTTS } from './vendor/headtts.mjs';
import { isModuleWebWorkers, isWebGPU } from './vendor/utils.mjs';

export type NeuralEngine = 'webgpu' | 'wasm';
export type NeuralState =
  | 'unsupported' // no module workers in this browser
  | 'idle' // not yet connected (model not downloaded)
  | 'loading' // model/voice download in flight
  | 'ready' // connected; synthesis works
  | 'error'; // connect or runtime failure — fall back to system voice

/** A word token with the model's exact timing (ms, buffer-relative). */
export interface TTSWord {
  text: string;
  tMs: number;
  dMs: number;
}

/** One synthesized utterance (parts merged into a single audio clock). */
export interface TTSResult {
  /** Decoded speech (24 kHz mono, 16-bit). */
  buffer: AudioBuffer;
  words: TTSWord[];
  /**
   * Viseme events on the buffer's clock: `p` is the Oculus viseme name
   * (aa, E, I, O, U, PP, SS, TH, DD, FF, kk, nn, RR, CH, sil) — these pass
   * straight through viseme-core's IPA lookup into buildTrack().
   */
  phonemes: PhonemeEvent[];
  durationMs: number;
}

export class NeuralSpeech {
  /** Shared audio clock (the demo's tick() reads it for the neural path). */
  readonly audioCtx: AudioContext;
  /** Inference backend chosen at construction, or null if unsupported. */
  readonly engine: NeuralEngine | null;

  state: NeuralState = 'idle';

  /** e.g. "Kokoro af_bella (WebGPU)" for the voice readout. */
  get voiceName(): string {
    if (!this.engine) return 'system voice (neural unavailable)';
    return `Kokoro af_bella (${this.engine === 'webgpu' ? 'WebGPU' : 'WASM'})`;
  }

  /** Model/voice download progress during load(). totalBytes = 0 if unknown. */
  onProgress: (loadedBytes: number, totalBytes: number) => void = () => {};
  /** Fired on every state transition. */
  onState: (state: NeuralState, detail?: string) => void = () => {};
  /** Fired when the current utterance's buffer ends naturally (not stop()). */
  onFinished: () => void = () => {};

  private tts: HeadTTS | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startCtxTime = 0;
  private startOffsetSec = 0;
  private stopped = true; // guards the spurious onended fired by stop()
  private lastResult: TTSResult | null = null;
  private lastText = '';

  constructor() {
    this.audioCtx = new AudioContext();
    if (!isModuleWebWorkers()) {
      this.engine = null;
      this.state = 'unsupported';
      return;
    }
    this.engine = isWebGPU() ? 'webgpu' : 'wasm';
    this.tts = new HeadTTS(
      {
        // Prefer WebGPU, fall back to WASM if that endpoint fails (the
        // client tries endpoints in order); WASM-only browsers get wasm.
        endpoints: this.engine === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
        audioCtx: this.audioCtx,
        voices: ['af_bella'],
        // Absolute URL: the worker resolves relative fetches against its
        // own script URL, not the page (see vendored worker-tts.mjs).
        dictionaryURL: new URL('tts/dictionaries/', document.baseURI).href,
      },
      (err) => this.setState('error', errorMessage(err)),
    );
  }

  /**
   * Connect: spins up the worker, downloads the model (progress via
   * onProgress), preloads the voice. Idempotent — safe to call from any
   * user gesture. Resolves once synthesis is ready.
   */
  async load(): Promise<void> {
    if (!this.tts || this.state === 'unsupported' || this.state === 'error') {
      return;
    }
    if (this.state === 'loading' || this.state === 'ready') return;
    this.setState('loading');
    try {
      await this.tts.connect(null, (ev) => {
        this.onProgress(
          ev.loaded ?? 0,
          ev.lengthComputable ? ev.total ?? 0 : 0,
        );
      });
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      this.setState('ready');
    } catch (err) {
      this.setState('error', errorMessage(err));
    }
  }

  /**
   * Speak `text` starting at word `fromWord` (0 = beginning). Synthesizes
   * at most once per distinct text (cached on the instance), then
   * (re)starts playback at that word. Resolves with the full result —
   * audio buffer plus exact word/viseme timings — or null if the engine
   * became unavailable.
   */
  async speak(text: string, fromWord = 0): Promise<TTSResult | null> {
    if (this.state !== 'ready' || !this.tts) return null;
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    let result: TTSResult;
    if (this.lastResult && this.lastText === text) {
      result = this.lastResult;
    } else {
      // The worker applies no defaults in non-REST mode, so pass all of
      // them explicitly ("undefined.bin" otherwise — see worker-tts.mjs).
      const messages = await this.tts.synthesize({
        input: text,
        voice: 'af_bella',
        language: 'en-us',
        audioEncoding: 'wav',
      });
      const parts: TTSResult[] = [];
      for (const m of messages) {
        if (m.type === 'error' || !m.data) {
          throw new Error(m.data?.error ?? 'TTS synthesis failed');
        }
        parts.push(toResult(m.data));
      }
      if (parts.length === 0) throw new Error('TTS produced no audio');
      result = mergeParts(parts);
      this.lastResult = result;
      this.lastText = text;
    }

    this.stopSource();
    const offsetSec = wordOffsetSec(result, fromWord);
    const src = this.audioCtx.createBufferSource();
    src.buffer = result.buffer;
    this.stopped = false;
    src.onended = () => {
      if (this.source === src) this.source = null;
      if (!this.stopped) this.onFinished();
    };
    this.source = src;
    this.startCtxTime = this.audioCtx.currentTime;
    this.startOffsetSec = offsetSec;
    src.start(this.startCtxTime, offsetSec);
    return result;
  }

  /**
   * Stop playback. The synthesis cache is kept (so a later resume is
   * instant); any still-queued synthesis is cancelled. The spurious
   * onended this causes is suppressed.
   */
  stop(): void {
    this.stopSource();
    this.tts?.clear();
  }

  /** Elapsed ms of the current utterance, clamped to its duration. */
  getPlayedMs(): number {
    if (!this.source || !this.lastResult) return 0;
    const ms =
      (this.startOffsetSec +
        (this.audioCtx.currentTime - this.startCtxTime)) *
      1000;
    return Math.max(0, Math.min(ms, this.lastResult.durationMs));
  }

  private stopSource(): void {
    this.stopped = true;
    if (this.source) {
      const s = this.source;
      this.source = null;
      s.onended = null;
      try {
        s.stop();
      } catch {
        // not started / already stopped
      }
    }
  }

  private setState(state: NeuralState, detail?: string): void {
    if (this.state === state) return;
    this.state = state;
    this.onState(state, detail);
  }
}

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message?: unknown }).message ?? '');
  }
  return String(err);
}

function toResult(data: HeadTTSAudioData): TTSResult {
  const buffer = data.audio instanceof AudioBuffer ? data.audio : null;
  if (!buffer) throw new Error('TTS result has no decodable audio');
  const visemes = data.visemes ?? [];
  const vtimes = data.vtimes ?? [];
  const vdurations = data.vdurations ?? [];
  return {
    buffer,
    words: (data.words ?? []).map((text, i) => ({
      text,
      tMs: data.wtimes?.[i] ?? 0,
      dMs: data.wdurations?.[i] ?? 0,
    })),
    phonemes: visemes.map((p, i) => ({
      p,
      t: vtimes[i] ?? 0,
      d: vdurations[i] ?? 0,
    })),
    durationMs: buffer.duration * 1000,
  };
}

/** Merge sentence parts (>500-char text) onto one audio + time axis. */
function mergeParts(parts: TTSResult[]): TTSResult {
  if (parts.length === 1) return parts[0];
  const rate = parts[0].buffer.sampleRate;
  const totalSamples = parts.reduce((a, p) => a + p.buffer.length, 0);
  const buffer = new AudioBuffer({
    length: totalSamples,
    sampleRate: rate,
    numberOfChannels: 1,
  });
  const out = buffer.getChannelData(0);
  let sampleOff = 0;
  let msOff = 0;
  for (const p of parts) {
    out.set(p.buffer.getChannelData(0), sampleOff);
    for (const w of p.words) w.tMs += msOff;
    for (const e of p.phonemes) e.t += msOff;
    sampleOff += p.buffer.length;
    msOff += p.durationMs;
  }
  return {
    buffer,
    words: parts.flatMap((p) => p.words),
    phonemes: parts.flatMap((p) => p.phonemes),
    durationMs: (totalSamples / rate) * 1000,
  };
}

function wordOffsetSec(result: TTSResult, fromWord: number): number {
  if (fromWord <= 0) return 0;
  const w =
    result.words[fromWord] ??
    (result.words.length ? result.words[result.words.length - 1] : undefined);
  if (!w) return 0;
  const max = Math.max(0, result.buffer.duration - 0.05);
  return Math.min(Math.max(0, w.tMs / 1000), max);
}
