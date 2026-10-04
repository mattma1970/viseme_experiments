/**
 * Type declarations for the vendored HeadTTS client
 * (met4citizen/HeadTTS v1.3.0, MIT — see LICENSE in this directory).
 *
 * Only the surface phenomes uses is declared; see the upstream README for
 * the full API.
 */

export interface HeadTTSProgressData {
  loaded: number;
  total: number;
  lengthComputable: boolean;
}

/**
 * TalkingHead-style audio metadata (upstream README, Appendix A).
 * Times are milliseconds, relative to this (sentence part's) audio.
 */
export interface HeadTTSAudioData {
  words?: string[];
  wtimes?: number[];
  wdurations?: number[];
  visemes?: string[];
  vtimes?: number[];
  vdurations?: number[];
  phonemes?: string[];
  /** Decoded AudioBuffer for "wav" (the default), raw ArrayBuffer for "pcm". */
  audio?: AudioBuffer | ArrayBuffer;
  audioEncoding?: string;
  error?: string;
}

export interface HeadTTSMessage {
  type: 'audio' | 'error' | 'custom' | 'progress' | 'ready';
  ref?: number;
  data?: HeadTTSAudioData;
}

export interface HeadTTSInputItem {
  type:
    | 'text'
    | 'speech'
    | 'phonetic'
    | 'characters'
    | 'number'
    | 'date'
    | 'time'
    | 'break';
  value: string | number;
  subtitles?: string;
}

export interface HeadTTSOptions {
  endpoints?: Array<'webgpu' | 'wasm' | string>;
  audioCtx?: AudioContext;
  workerModule?: string | null;
  transformersModule?: string;
  model?: string;
  dtypeWebgpu?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
  dtypeWasm?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
  styleDim?: number;
  frameRate?: number;
  audioSampleRate?: number;
  languages?: string[];
  dictionaryURL?: string | null;
  voiceURL?: string;
  voices?: string[];
  deltaStart?: number;
  deltaEnd?: number;
  splitSentences?: boolean;
  splitLength?: number;
  defaultVoice?: string;
  defaultLanguage?: string;
  defaultSpeed?: number;
  defaultAudioEncoding?: 'wav' | 'pcm';
  trace?: number;
}

export class HeadTTS {
  constructor(settings?: HeadTTSOptions, onerror?: (error: unknown) => void);

  onstart: (() => void) | null;
  onmessage: ((message: HeadTTSMessage) => void) | null;
  onend: (() => void) | null;
  onerror: ((error: unknown) => void) | null;

  /**
   * Connect to the first supported endpoint (module worker running
   * WebGPU or WASM inference). Resolves when the model and preloaded
   * voices are ready; reports download progress via onprogress.
   */
  connect(
    settings?: HeadTTSOptions | null,
    onprogress?: (ev: ProgressEvent) => void,
    onerror?: (error: unknown) => void,
  ): Promise<void>;

  /** Clear both work queues; pending items resolve as cancelled errors. */
  clear(): void;

  setup(
    data: {
      voice?: string;
      language?: string;
      speed?: number;
      audioEncoding?: 'wav' | 'pcm';
    },
    onerror?: (error: unknown) => void,
  ): Promise<unknown>;

  /**
   * Synthesize. Text is split into parts of at most `splitLength` chars
   * (default 500); resolves with one message per part, in order.
   * `data.audio` is a decoded `AudioBuffer`; timing arrays are
   * part-relative.
   * In in-page (non-REST) mode the client always sends voice/language/
   * speed/audioEncoding to the worker (from ttsSetup, which defaults to
   * af_bella / en-us / 1 / wav); passing them here overrides ttsSetup
   * (also required for REST mode).
   */
  synthesize(
    data: {
      input: string | HeadTTSInputItem[];
      voice?: string;
      language?: string;
      speed?: number;
      audioEncoding?: 'wav' | 'pcm';
      userData?: unknown;
    },
    onmessage?: (message: HeadTTSMessage) => void,
    onerror?: (error: unknown) => void,
  ): Promise<HeadTTSMessage[]>;

  custom(
    data: Record<string, unknown>,
    onmessage?: (message: HeadTTSMessage) => void,
    onerror?: (error: unknown) => void,
  ): Promise<HeadTTSMessage>;
}
