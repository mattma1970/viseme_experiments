# Handover — phenomes

For a coding agent taking over this repository. Read top-to-bottom once (~10 min);
§6 (gotchas) is the highest-value section.

---

## 1. What this project is

**phenomes** generates **visemes** — the 15-standard mouth-shape control values
(Azure Speech / Meta avatar convention) — from text-to-speech, to drive a 3D
character's mouth in the browser. The reference behavior is Azure's
`viseme_received` event, but the whole pipeline runs **locally in the browser**
(no server). Internal term "phenome" = viseme; use **viseme** in user-facing text.

Two generation paths (hybrid by design):

1. **Phoneme-driven (primary, deterministic):** TTS emits per-phoneme timings
   (`p`, `t`, `d`) → IPA→viseme lookup → raised-cosine envelopes →
   dominance-priority blending → one-pole smoothing → 15-channel track @ 60 fps.
   No model inference; latency ≈ 0. Used whenever the spoken text is known
   (TTS output).
2. **Audio classifier (fallback, M3):** MFCC → Gaussian-prototype classifier in
   an `AudioWorklet` (HeadAudio style) for mic input / arbitrary audio.

## 2. Fixed user decisions — do NOT re-litigate

- **Voice source:** local in-browser TTS via **HeadTTS / Kokoro-82M**
  (met4citizen, MIT). Not Azure, not a Node TTS server.
- **Approach:** the hybrid above (phoneme-driven primary + audio fallback).
- **Rig target:** **three.js / WebGL** with the **15 Oculus viseme morph names**
  (`viseme_aa, E, I, O, U, PP, SS, TH, DD, FF, kk, nn, RR, CH, sil`), one morph
  target each, driven 0→1.
- **Priority order:** simplicity > low latency > real-time > local > in-browser.

Assumed defaults (flag them if the user objects):
- the procedural test head stands in until a final character asset is chosen;
- the pipeline is strictly in-browser: model weights fetched from CDN and
  cached locally, no backend of any kind.

## 3. Status

| Milestone | State |
|---|---|
| **M0** scaffold (Vite + TS strict) | ✅ |
| **M1** `viseme-core` + three.js test head (15 morphs) + demo driven by canned phoneme JSON; **visible mouth** (lip colors + opening sticker + lip ring); **audible speech** via interim system-voice bridge with word-boundary clock remap; dominant-viseme readout | ✅ — **kept as the M2 fallback path** (system voice speaks the canned timeline while Kokoro downloads / if neural is unavailable) |
| **M2** **HeadTTS (Kokoro-82M ONNX) in-browser** → real per-phoneme timings feed `buildTrack()`; audio playback sync (the TTS buffer *is* the clock); WebGPU + WASM fallback; model fetch + Cache-API local cache; download progress in UI | ✅ done — see §8. **M2.1** (follow-up, ✅): punctuation pauses no longer animate the mouth — silence clamping + envelope fix, see §8.1. **Remaining: the user's in-browser verification** (WebGPU vs WASM, first-play download, pause/resume, fallback) |
| **M3** HeadAudio-style MFCC/Gaussian viseme classifier as an `AudioWorklet` (bootstrap from MIT `model-en-mixed.bin`); feeds the driver's existing live mode (`setAll`) | ⬜ |
| **M4** polish: latency measurement, TTS-vs-audio A/B demo, final character asset via the driver's `nameMap` remap, docs | ⬜ |

Recent feedback loop: the user judges **sync by ear** in the running demo.
The last two rounds reported (a) "no visible mouth" and (b) "no sound" — both
fixed (see §6.3, §6.4). If asked to "improve sync", the tuning knobs are the
per-viseme `PARAMS` table in `src/renderer/test-head.ts` and the envelope
timings in `src/viseme-core/curves.ts`.

## 4. Repository map

```
index.html                    UI panel: sample select, play/pause/stop, 🔊 sound
                              checkbox, wireframe checkbox, 15-bar canvas,
                              dominant-viseme readout, status, voice info
src/viseme-core/              PURE TS — no three.js, no DOM
  visemes.ts                  the 15 visemes, IPA→viseme table (HeadAudio App. A),
                              dominance PRIORITY, per-viseme AMPLITUDE
  easing.ts                   clamp, raisedCosine (C1), eventEnvelope(t,t0,d,att,rel),
                              OnePole smoother (τ ms)
  curves.ts                   flattenPhrases() + buildTrack() → VisemeTrack,
                              sampleTrack() (linear interp). Contribution
                              v = w·env·amp (the env factor is load-bearing —
                              gotcha 20)
  silence.ts                  M2.1: detectSilences(samples, sampleRate) →
                              silence windows from the actual audio (RMS,
                              peak-relative gate); clampEventsToSilences() →
                              truncate/shift viseme events so pauses stay still
  types.ts                    PhonemeEvent{p,t,d}, PhraseFile
                              ("phenomes.phrase" v1), VisemeTrack, CurveOptions
  index.ts                    re-exports
src/renderer/
  viseme-driver.ts            VisemeDriver: 15 channels → morphTargetInfluences;
                              track mode (loadTrack/updateTrack), live mode
                              (setViseme/setAll), nameMap remap for other rigs
  test-head.ts                procedural 1617-vert head, 15 baked morphs from
                              PARAMS table, vertex-colored lips, mouth-opening
                              disc + lip ring (sticker meshes), exports
                              mouthOffset()/mouthScale() for per-frame sticker tracking
src/tts/
  neural-speech.ts            M2: NeuralSpeech — owns the shared AudioContext
                              and the vendored HeadTTS client; load() (model
                              download + progress), speak(text, fromWord)
                              (cached synthesis → AudioBuffer playback at the
                              resume word), stop(), getPlayedMs(); TTSResult
                              = {buffer, words[{text,tMs,dMs}], phonemes[p,t,d],
                              durationMs}. WebGPU preferred, WASM fallback;
                              states: unsupported/idle/loading/ready/error
  index.ts                    barrel
  vendor/                     HeadTTS v1.3.0 (met4citizen, MIT — LICENSE in
                              dir), UNMODIFIED: headtts.mjs (browser client),
                              worker-tts.mjs (module worker: G2P → tokenizer
                              → Kokoro ONNX → WAV + word/viseme timings),
                              language.mjs + language-en-us.mjs (CMU-dict G2P),
                              utils.mjs; plus hand-written type declarations
                              headtts.d.mts / utils.d.mts
src/demo/
  speech-bridge.ts            M1 FALLBACK (kept in M2): SystemSpeech
                              (speechSynthesis wrapper), TimeMap (piecewise-linear
                              audio→track remap), wordSpans(), wordAtChar()
src/main.ts                   three.js demo: dual-path voice — neural primary,
                              system-voice fallback; playSeq/playBusy guard
                              async synthesis races; neural path: TTSResult
                              timings → buildTrack() → track, buffer is clock;
                              fallback path: speak(slice) + onBoundary
                              → TimeMap remap
scripts/
  check-core.ts               headless assertions on buildTrack output
  check-head.ts               headless three.js: morph names/count, driver
                              binding, influence bounds, jaw-motion check
  gen-sample.ts               regenerates public/samples/*.json from hand-timed
                              IPA word lists
public/samples/               sentence-1.json, sentence-2.json (canned timelines,
                              used by the system-voice fallback)
public/tts/dictionaries/      en-us.txt — CMU Pronouncing Dictionary (~2.8 MB),
                              served to the browser worker for G2P
                             (voices are NOT vendored: the HeadTTS client's
                              default voiceURL pulls af_bella from HuggingFace)
docs/viseme-generation-research.md   background research (landscape, comparison)
README.md                     user-facing: quick start, architecture, viseme table
```

Sample JSON (the M1 fallback's on-disk format):

```json
{ "format": "phenomes.phrase", "version": 1, "text": "…",
  "phrases": [{ "text": "…", "phonemes": [ { "p": "b", "t": 0, "d": 45 } ] }] }
```

`t`/`d` are ms (start, duration). IPA symbols verbatim (`ˈ ˌ ː` allowed);
`"sil"` marks silence gaps.

## 5. The pipeline in one diagram

```
text ──► TTS  [M2: HeadTTS/Kokoro in-browser — primary]   [M1: speechSynthesis — fallback]
            │  audio buffer + per-phoneme timings (p,t,d) + word times
            ▼
   M2: the AudioBuffer IS the clock (timings are buffer-relative by
       construction — no remap). M1: word-boundary events feed TimeMap,
       which remaps the speech clock onto the track clock.
viseme-core:  IPA→viseme → envelopes (att 20–70 ms / rel 35–130 ms)
              → per-frame dominance blend (w = prioᵢ·envᵢ / Σ; ch = max w·env·amp)
              → one-pole smooth (τ≈22 ms) → VisemeTrack
                    {channels[15], fps=60, frames: Float32Array(15·F) row-major,
                     frameCount, durationMs, maxPerChannel, eventCount}
            ▼
VisemeDriver → mesh.morphTargetInfluences[dict["viseme_*"]]
```

## 6. Gotchas — read before touching geometry or audio

1. **three.js r151+ morph semantics.** `geometry.morphTargetsRelative` defaults
   to **false**, which means morph attributes hold **ABSOLUTE positions** and
   the shader computes `(1−Σinf)·base + Σ infᵢ·morphᵢ`. `test-head.ts` bakes
   absolute positions (base + delta per morph) and this is *correct* — do not
   "fix" them into deltas (that would make the head explode). Verified against
   `node_modules/three/build/three.module.js` (r169, line ~17996).
2. **Morph count cap.** three.js only wires 8 morph targets by default.
   `material.defines.MAX_MORPH_TARGETS = 15` in `test-head.ts` is load-bearing.
3. **Occluded geometry.** Anything placed *behind* the closed skull surface is
   invisible. The mouth stickers sit ~5–10 mm **in front** of the surface
   (`mouthSurfaceZ + 0.005/+0.01`) and are re-positioned/scaled every frame by
   `mouthOffset()`/`mouthScale()` (which mirror the morph math at the mouth
   center). This was the root cause of the "no visible mouth" bug.
4. **speechSynthesis quirks.** Chrome needs `syn.cancel()` before a fresh
   `speak()`; `getVoices()` is empty until the async `voiceschanged` event;
   **word-level** boundary events don't fire on every engine (Firefox often
   none). `SystemSpeech`/`main.ts` already degrade: no voices → identity
   wall-clock pacing; never assume `onboundary` fires.
5. **TimeMap design** (`speech-bridge.ts`). Anchors are (trackMs, audioMs) word
   pairs added *relative to the resume base*; `toTrack()` is identity with
   <2 anchors, first-segment slope before the first anchor, last-slope
   extrapolation after. `main.ts` clamps `elapsed ≥ pausedAt`. If you change
   this, keep: pause/stop calls `speech.cancel()`, and `onFinished` must
   ignore the spurious end-event that `cancel()` produces (it's guarded by
   the `playing` flag).
6. **IPA table:** `oʊ` (American "oh") must map to `viseme_O` — it was missing
   and broke vowel coverage. Strip `ˈ ˌ ː` before lookup. Unknown phoneme →
   `viseme_sil`, never throw (future TTS may emit unfamiliar symbols).
7. **Dominance blending** keeps plosives dominant over vowels during overlap
   (Cohen–Massaro priority: PP 10 > CH 9 > kk/DD 8 > TH/FF 7 > SS 6 > nn 5 >
   RR 4 > vowels 3 > sil 0). Don't average channels — that's why it's a
   max-of-weights, not a sum.
8. **`npm install` must use `--cache ./.npm-cache`** (the user's `~/.npm` is
   not writable; do not attempt sudo/chown). `node_modules` is committed to
   the workspace; a plain `npm install` with the cache flag is idempotent.
9. **The `web_search` tool is broken** (firecrawl unavailable) in this
   environment. Use `web_fetch` on `https://api.github.com/...` or
   `https://raw.githubusercontent.com/...` instead.
10. **Killing dev/preview servers:** `pkill -f "vite[ ]preview"` (bracketed) —
    the naive pattern matches the calling shell's own command line and kills
    it. Ports: dev **5173**, preview **4173**.
11. `landlock-run: partial enforcement` on stderr is benign (old Landlock ABI).
12. **Typechecking only happens in `npm run build`** (`tsc --noEmit && vite
    build`). The `check*` scripts run under `tsx`, which transpiles without
    typechecking. `tsc` covers `src/` and `scripts/` (see tsconfig `include`).
13. `require('three/package.json')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` —
    that's normal for the three package; verify its version from
    `package-lock.json` / the build file instead.
14. **HeadTTS client ↔ worker protocol** (the repo's vendored copy — verified
    line-by-line against the source in this session; adapt to it):
    - `connect` data is the **flat settings object** (the client's
      `endpointSetup` picks: transformersModule, model, styleDim, frameRate,
      languages, dictionaryURL, voiceURL, voices, audioSampleRate,
      deltaStart/End, trace, plus `device` and `dtype` derived from the
      endpoint). Node-only `dictionaryPath`/`voicePath` are **not** forwarded
      by the client (browser uses the URL forms); a Node harness must add
      them itself (gotcha 18).
    - In in-page (non-REST) mode `processIn()` **always** stamps
      `voice`/`language`/`speed`/`audioEncoding` onto synthesize messages
      from `ttsSetup` (defaults af_bella / en-us / 1 / wav); per-call values
      override ttsSetup and are needed for REST mode. `NeuralSpeech` passes
      them explicitly either way.
    - The client sends `input` as an **array of raw strings**: a string input
      goes through `divideToParts()` (max `splitLength` 500 chars, sentence
      dividers `! . ?` when `splitSentences`) and each chunk is sent as
      `[chunk]`. The worker's `language.generate()` calls `splitText()` on
      plain-string elements → **word-granular `words`/`wtimes`** (verified:
      6 words for the comma sentence — this is what pause/resume relies on).
      ⚠ An *object* item `{type:'text', value: str}` bypasses splitText and
      comes back as **one giant word** (the whole sentence) — that shape is
      only ever produced by hand-rolled worker drivers, never by the client.
    - Multi-part text resolves as an array of part-messages; part-relative
      timings must be merged (see `mergeParts()` in `neural-speech.ts`) before
      feeding `buildTrack()`.
    - `clear()` empties the client's work queues (pending synthesize promises
      resolve as cancelled-error messages) but keeps the worker alive — the
      model stays loaded for the next speak; `main.ts`'s playSeq guard treats
      those as stale.
15. **Vite can't see the worker's dynamic language import**
    (`import("./language-" + lang + ".mjs")`). Dev is fine (files co-located in
    `src/tts/vendor/`); the production build needs the raw `.mjs` files next
    to the emitted worker chunk — the `phenomes:copy-worker-language-modules`
    plugin in `vite.config.ts` copies `language.mjs`, `language-en-us.mjs`,
    `utils.mjs` into `dist/assets/`. Don't remove it.
16. **`dictionaryURL` must be absolute** (`new URL('tts/dictionaries/',
    document.baseURI).href`): the worker resolves relative fetches against
    its own script URL, not the page.
17. **transformers.js in the browser is a CDN import**
    (`cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0/dist/transformers.min.js`,
    the client default). `env.useBrowserCache` defaults to **true** in browsers
    → the ~325 MB fp32 model (or ~305 MB q4 for WASM) downloads once into the
    **Cache API** and later loads are fast. No opfs/quota work needed; progress
    events drive the UI (see `NeuralSpeech.onProgress`).
18. **Node testing of the same worker:** Node's ESM loader rejects `https:`
    imports, so a Node harness must use a resolvable `transformersModule`
    (bare `@huggingface/transformers` — its Node export is
    `dist/transformers.node.mjs` — or a `file://` URL), plus Node-only settings
    `dictionaryPath`/`voicePath` (the browser uses `dictionaryURL`/`voiceURL`).
    The official server's REST route is `POST /v1/synthesize` with the text in
    the **`input`** field (not `text`). Smoke server from the M2 session:
    `/tmp/tts-smoke/` (config `headtts-node.json`, voices/, dictionaries/,
    model cached under its `node_modules/@huggingface/transformers/.cache`) —
    restart with `cd /tmp/tts-smoke && node headtts-node.mjs --config ./headtts-node.json`
    (port 8882). It verified the repo's vendored worker byte-for-byte:
    real WAV + words/wtimes + visemes/vtimes (all 15-name vocab) end-to-end.
19. **`speechSynthesis` boundary `charIndex` is relative to the spoken
    utterance** — when the fallback speaks a mid-sentence slice, `main.ts`
    adds the slice's char offset (`sliceOff`) before `wordAtChar()`; forgetting
    this mis-anchors every TimeMap point after the resume word.
20. **`buildTrack` contribution is `w·env·amp` — the `env` factor is
    load-bearing.** The dominance weight `w = (prio·env)/Σ` alone would pin a
    *lone releasing* event at its **full amplitude** for a frame or two (once
    rivals hit env=0, its weight normalizes to 1.0) — that one-frame spike is
    what made the mouth "keep moving" through pauses before M2.1. Don't
    simplify it back to `w·amp`.
21. **The model's viseme stream is coarser than its audio.** Kokoro can emit a
    single viseme that *straddles* a real punctuation pause (e.g. `nn` across
    a 240 ms comma silence), and its release envelope sustains full amplitude
    across the gap. `main.ts` (neural path) therefore detects silences from
    the actual synthesized buffer (`detectSilences`: 20 ms RMS windows,
    8 %-of-peak gate, ≥90 ms, edge-trim 100 ms) and clamps events with
    `clampEventsToSilences()` before `buildTrack()`; `trackEndMs =
    max(track.durationMs, audio duration)` guards the playback clock against
    a clamped-shorter track. `scripts/inspect-pause.ts` reproduces the whole
    pipeline headlessly against `/tmp/pause-synth.json` (regen: `node
    /tmp/tts-smoke/pause-test.mjs`).
22. **`Float32Array.prototype.map` returns a `Float32Array`** — mapping to
    strings coerces them to NaN, and `.filter(Boolean)` then silently drops
    them all (looked like "all zeros" during the M2.1 debug). Map over
    `[...arr]` or index in a plain loop.

## 7. Commands & baselines

```sh
npm install --cache ./.npm-cache   # if node_modules is absent
npm run dev                        # http://localhost:5173 (the demo)
npm run check                      # check-core.ts — see baselines below
npm run check:head                 # check-head.ts — headless three.js checks
npm run gen:samples                # regenerate public/samples/*.json
npm run build                      # tsc --noEmit (whole-project typecheck) + vite build
npm run preview                    # http://localhost:4173 (serves dist/)
```

Current green baselines (verified at M2 completion; re-run after any change):

- `check` → sentence-1: **51 events, 5300 ms, 318 frames**, all 14 speech
  visemes peak ≥ 0.4; sentence-2: **16 events, 1983 ms, 119 frames**;
  values ∈ [0,1]; per-frame delta max ≈ 0.478; **M2 section**: all 15
  viseme names pass through `phonemeToViseme()` and a synthetic
  PP/I/kk phrase peaks in the right channels; **M2.1 section** (9 asserts):
  silence detection on a synthetic tone-with-gap (one window ≈ 400–700 ms,
  no windows on a continuous tone), straddle-truncation, in-window shift,
  untouched events, near-still track mid-pause, shifted event still fires.
- `check:head` → 15 morph attrs with correct names, dictionary complete,
  driver bound 15/15, influences ∈ [0,1] over full track, aa influence ≈
  track peak, jaw region drops under aa.
- `build` → `index-*.js` ≈ 525 kB (135 kB gzip) + `worker-tts-*.mjs`
  ≈ 12 kB + the three copied language assets + `tts/dictionaries/en-us.txt`
  (2.8 MB) in dist. The ">500 kB chunk" warning is expected (three.js) and
  harmless.
- Smoke test after build: `curl -s -o /dev/null -w "%{http_code}"
  http://localhost:4173/` (+ `/samples/sentence-1.json`, `/assets/worker-tts-*.mjs`,
  `/assets/language-en-us.mjs`, `/tts/dictionaries/en-us.txt`) → all 200.
- In-browser runtime (WebGPU/WASM worker, download progress, pause/resume,
  system-voice fallback) is **not verifiable headlessly** here — it needs the
  user's browser (`npm run dev`).

## 8. M2 — done (implementation record)

**Goal (met):** in-browser **HeadTTS** (Kokoro-82M ONNX) so the user hears a
real neural voice and the timeline is the *model's own* per-phoneme timings;
system voice stays as the graceful fallback.
What was built:

- **`src/tts/vendor/`** — HeadTTS v1.3.0 (MIT) modules vendored **unmodified**:
  `headtts.mjs` (client), `worker-tts.mjs` (worker), `language.mjs` +
  `language-en-us.mjs` (CMU G2P), `utils.mjs`, `LICENSE`; plus hand-written
  `headtts.d.mts` / `utils.d.mts` declarations for the surface used.
- **`src/tts/neural-speech.ts`** — `NeuralSpeech`: shared `AudioContext`;
  engine = WebGPU (fp32) if available else WASM (q4); `load()` = connect the
  vendored client (model download from the HF CDN → Cache API, progress
  surfaced via `onProgress`); `speak(text, fromWord)` = synthesize (cached per
  distinct text; multi-part results merged with `mergeParts()`), then play the
  `AudioBuffer` at the resume word via `AudioBufferSourceNode`; `stop()`;
  `getPlayedMs()` = audio-clock elapsed (clamped to duration).
- **`src/viseme-core/visemes.ts`** — the 15-name table now also maps the
  **Oculus viseme names to themselves** (PP, SS, DD, FF, kk, nn, RR pass
  through; aa/E/I/O/U/TH/CH/sil already did). Kokoro's visemes are exactly
  those names, so the neural `phonemes` feed `buildTrack()` **unchanged**.
- **`src/main.ts`** — dual-path voice: neural primary (TTSResult timings →
  `buildTrack` → `VisemeDriver`; the buffer is the clock, so sync is exact by
  construction); M1 system-voice fallback (slice from the resume word,
  boundary events → `TimeMap` remap — see gotcha 19). `playSeq`/`playBusy`
  invalidate in-flight async synthesis on pause/stop. UI shows engine state +
  download progress (`#neuralinfo`); auto-starts the model download on first
  play so the *next* play is neural.
- **`vite.config.ts`** — `phenomes:copy-worker-language-modules` (gotcha 15).
- **`public/tts/dictionaries/en-us.txt`** — CMU dictionary served to the worker
  (gotchas 16, 18). Voices come from the client's default HF `voiceURL`.

Verified (headlessly, in this environment):

- `tsc --noEmit`, `check` (incl. M2 pass-through section), `check:head`,
  `build` all green (baselines in §7).
- The repo's vendored worker **byte-identical** to the upstream set that a
  working HeadTTS-Node server ran; driven with the exact client message
  protocol it produced a valid 24 kHz WAV plus words/wtimes and visemes/vtimes
  (all inside the 15-name vocabulary) for both a short and a long sentence,
  WASM/CPU fp32, model served from the transformers.js Node cache.

Not yet verified (needs the user's browser — `npm run dev`):

- first-play model download + progress UI (one-time ~325 MB fp32 WebGPU /
  ~305 MB q4 WASM), cached reload, WebGPU vs WASM selection, pause/resume
  mid-sentence on both paths, and the fallback when WebGPU/WASM/module-workers
  are unavailable.

### 8.1 M2.1 — "mouth keeps moving through the pause" (fixed)

**Reported:** with a comma in the sentence, the mouth animated through the
comma pause. **Diagnosis** (headless, exact browser pipeline):
`scripts/inspect-pause.ts` ran the real worker on *"Blue moon, what do you
mean?"* (fixtures `/tmp/pause-synth.json`, `/tmp/pause-audio.wav`) and sampled
`buildTrack()`: the audio has a real 240 ms silence at **960–1200 ms**, but the
model emitted one `nn[902+237]` viseme *straddling the whole pause* — its
release envelope held `viseme_nn ≈ 0.55` (plus a `U` bleed) across the entire
silence. Two compounding causes:

1. **Coarse viseme stream** (model behavior, not fixable in the model):
   **fix** — `src/viseme-core/silence.ts` (new): `detectSilences()` finds
   silence windows from the actual audio buffer (20 ms RMS, gate = 8 % of
   peak, min 90 ms, 100 ms edge-trim, 60 ms merge); `clampEventsToSilences()`
   truncates straddling events at the window start (release plays through the
   pause) and shifts in-window starts to the window end. Applied in
   `main.ts`'s neural path before `buildTrack()`; playback clock is
   `trackEndMs = max(track.durationMs, audio duration)`. The M1 fallback
   path needs no clamping: its canned JSON timelines are hand-timed with
   explicit `sil` gaps.
2. **`buildTrack` weight-only contribution** (core bug, gotcha 20): a *lone
   releasing* event rendered at full amplitude for its release tail. **Fix**:
   contribution is now `w·env·amp` (`curves.ts`).

**Result** (same sentence, same pipeline, `inspect-pause.ts`):

| t (ms, inside the 960–1200 silence) | before | after |
|---|---|---|
| 960 | nn 0.55, U 0.37 | nn 0.34 (releasing), U 0.24 |
| 1010 | nn 0.55 | nn 0.07, U 0.04 |
| 1060–1160 | **nn 0.55 held** | **all 15 channels ≈ 0** |

Mouth closes in the first ~50 ms of the pause, rests for the remainder, and
re-opens exactly when the audio resumes. Both `check` (new 9-assert M2.1
section) and `check:head` pass; all M1 baselines unchanged.

**Word-granularity check (pause/resume depends on it):** the real client's
message shape `data.input = ["…sentence…"]` was driven through the repo's
vendored worker in Node (warm model, `file://` transformers module) — the
response carries **6 word entries** with per-word times ("Blue" 442–707,
"moon," 687–1274, … "mean?" 1583–2385 ms), i.e. the in-page path gets proper
word timings; `NeuralSpeech.speak(text, fromWord)` resume works on that. No
vendored-code changes were needed (an earlier suspicion of a
"one-giant-word client quirk" came from driving the worker with object-form
input — gotchas 14/21). `NeuralSpeech` was re-verified against the actual
client source (constructor / `connect(null, onprogress, onerror)` /
`synthesize` → promise of messages with decoded `AudioBuffer` / `clear()`);
`endpoints` is now `['webgpu','wasm']` on WebGPU browsers so a WebGPU failure
falls back to WASM before hitting the system voice.

## 9. M3 / M4 briefs

- **M3:** MFCC extraction in an `AudioWorklet`, Gaussian-prototype classifier
  per viseme (HeadAudio's `model-en-mixed.bin`, MIT — retrain later on
  labels generated from our own TTS). Output feeds `driver.setAll()` (live
  mode already exists). Used for mic input / arbitrary audio files — the
  fallback path from §1.
- **M4:** latency measurement (phoneme timestamp → rendered frame), TTS-
  driven vs audio-classified A/B toggle in the demo, final character asset
  integration (the driver's `nameMap` is the only code that needs to change),
  docs pass.

## 10. Open questions to confirm with the user (ask, don't assume)

- Which viseme shapes/pacings look wrong to their ear — the standing
  invitation after each sync fix.
- Final character asset (M4): which rig/model, and whether its morph names
  need a `nameMap`.
- Model hosting for M2: **resolved** — CDN fetch (HF, via transformers.js)
  + browser Cache API, no weights vendored in-repo (only code + the 2.8 MB
  CMU dictionary). Confirm only if the user wants the weights vendored instead.
- Repo license is marked "MIT (pending maintainer confirmation)" — confirm.

## 11. Working style notes

- The user responds to terse status updates with what changed and how it was
  verified; they interact by playing the running demo and reporting
  perceptual bugs (sync, visibility, sound) — expect short, concrete feedback
  rounds.
- Verify before reporting: `check` + `check:head` + `build` + a server smoke
  test. Leave a dev server running as a managed background job when done so
  the user can refresh their browser.
- Do not re-ask the fixed-decision questions in §2; do flag assumed defaults
  if you change them.
