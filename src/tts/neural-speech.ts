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
 *
 * Failure policy: synthesis is capped by a timeout (default 120 s), any
 * failure (timeout, worker error message, decode failure, dead
 * AudioContext) puts the engine into 'error' and spins up a fresh worker
 * in the background; the demo speaks with the system voice meanwhile
 * and neural TTS recovers without a page reload. The vendored worker and
 * client carry small local patches (marked "phenomes patch") so a
 * mid-synthesis exception is reported back as an error message instead
 * of wedging the worker's queue.
 */

import type { PhonemeEvent } from '../viseme-core/types.js';
import type { HeadTTSAudioData, HeadTTSMessage, HeadTTSOptions } from './vendor/headtts.mjs';
import { HeadTTS } from './vendor/headtts.mjs';
import { isModuleWebWorkers, isWebGPU } from './vendor/utils.mjs';

export type NeuralEngine = 'webgpu' | 'wasm';

/** Default: give up on a fresh synthesis after this long (ms). */
const SYNTH_TIMEOUT_MS = 120_000;
/** Backoff between neural-engine recovery attempts after a failure (ms). */
const RECONNECT_AFTER_MS = 60_000;

/**
 * Reject a promise that does not settle within `ms`. A wedged TTS worker
 * (stalled GPU inference, dropped message) must never be able to keep
 * the demo's play loop blocked.
 */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  msg: string,
): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    t = setTimeout(() => reject(new Error(msg)), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
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
  /**
   * Shared audio clock (the demo's tick() reads it for the neural path).
   * Re-created if the context ever ends up 'closed' — a BufferSource on
   * a dead context plays silence.
   */
  private audioCtx: AudioContext;
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
  private lastErrorAt = 0;
  private synthTimeoutMs = SYNTH_TIMEOUT_MS;
  private stopCalled = false; // stop() since speak() started (not a failure)

  constructor(extra: Partial<HeadTTSOptions> & { synthTimeoutMs?: number } = {}) {
    const { synthTimeoutMs: timeoutOverride, ...headtts } = extra;
    if (timeoutOverride !== undefined) {
      this.synthTimeoutMs = timeoutOverride;
    }
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
        ...headtts, // test/dev overrides (e.g. workerModule)
      },
      (err) => this.setState('error', errorMessage(err)),
    );
  }

  /**
   * Connect: spins up the worker, downloads the model (progress via
   * onProgress), preloads the voice. Idempotent — safe to call from any
   * user gesture. After a failure the engine backs off for a while, then
   * retries (a failed worker is replaced wholesale by reconnectWorker()).
   * Resolves once synthesis is ready.
   */
  async load(): Promise<void> {
    if (!this.tts || this.state === 'unsupported') return;
    if (this.state === 'error') {
      // Back off after a failure; the demo keeps using the system voice
      // meanwhile and calls load() again on each play click.
      if (performance.now() - this.lastErrorAt < RECONNECT_AFTER_MS) return;
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
      await this.ensureAudioRunning();
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
    this.stopCalled = false;
    // A suspended/closed context plays silence — verify it is running
    // before scheduling audio (throws so the caller can fall back).
    await this.ensureAudioRunning();

    let result: TTSResult;
    if (this.lastResult && this.lastText === text) {
      result = this.lastResult;
    } else {
      let messages: HeadTTSMessage[];
      try {
        // The worker can hang (wedged inference session, GPU stall) —
        // cap the wait so one bad synthesis cannot block the demo.
        messages = await withTimeout(
          this.tts.synthesize({
            input: text,
            voice: 'af_bella',
            language: 'en-us',
            audioEncoding: 'wav',
          }),
          this.synthTimeoutMs,
          `TTS synthesis timed out after ${Math.round(
            this.synthTimeoutMs / 1000,
          )}s`,
        );
      } catch (e) {
        this.failSynthesis(e);
        throw e instanceof Error ? e : new Error(String(e));
      }
      // The worker reports a failure as a resolved "error" message
      // (inference exception, decode failure, ...). Same recovery path —
      // unless the user paused/stopped mid-synthesis, which cancels the
      // request rather than failing it.
      for (const m of messages) {
        if (m.type === 'error' || !m.data) {
          if (this.stopCalled) return null;
          const err = new Error(m.data?.error ?? 'TTS synthesis failed');
          this.failSynthesis(err);
          throw err;
        }
      }
      let parts: TTSResult[];
      try {
        parts = messages.map((m) => toResult(m.data!));
      } catch (e) {
        this.failSynthesis(e);
        throw e instanceof Error ? e : new Error(String(e));
      }
      if (parts.length === 0) {
        const err = new Error('TTS produced no audio');
        this.failSynthesis(err);
        throw err;
      }
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
    this.stopCalled = true;
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

  /**
   * Make sure the shared AudioContext can actually play: browsers start
   * it 'suspended' until a user gesture and it can end up 'closed' — in
   * either case a started BufferSource would be silent. Throws when it
   * cannot be made running, so the caller falls back to the system voice.
   */
  private async ensureAudioRunning(): Promise<void> {
    let ctx = this.audioCtx;
    if (ctx.state === 'closed') {
      ctx = new AudioContext();
      this.audioCtx = ctx;
      // HeadTTS decodes the synthesized WAV through this same context.
      if (this.tts && this.tts.settings.audioCtx !== ctx) {
        this.tts.settings.audioCtx = ctx;
      }
    }
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
    if (ctx.state !== 'running') {
      throw new Error(`audio output unavailable (AudioContext ${ctx.state})`);
    }
  }

  /**
   * Recover from a failed or wedged synthesis: mark the engine failed
   * (the demo falls back to the system voice for subsequent plays) and
   * spin up a fresh worker in the background, so neural TTS comes back
   * on its own without a page reload.
   */
  private failSynthesis(e: unknown): void {
    this.lastErrorAt = performance.now();
    // Drop anything still queued client-side before the worker dies.
    this.tts?.clear();
    this.setState('error', errorMessage(e));
    void this.reconnectWorker();
  }

  /**
   * Force a fresh worker and restore the 'ready' state. HeadTTS's
   * connect(null) is a no-op while it believes it is connected, so pass
   * an (empty) settings object to force a full disconnect/reconnect.
   */
  private async reconnectWorker(): Promise<void> {
    if (!this.tts || this.state === 'unsupported') return;
    this.setState('loading');
    try {
      await this.tts.connect({}, (ev) => {
        this.onProgress(
          ev.loaded ?? 0,
          ev.lengthComputable ? ev.total ?? 0 : 0,
        );
      });
      await this.ensureAudioRunning();
      this.setState('ready');
    } catch (err) {
      this.setState('error', errorMessage(err));
    }
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
    if (state === 'error') this.lastErrorAt = performance.now();
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
