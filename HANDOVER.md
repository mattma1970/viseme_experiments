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
| **M4** polish: latency measurement, TTS-vs-audio A/B demo, final character asset via the driver's `nameMap` remap, docs | ⬜ in progress — **three realistic heads wired** (UI head selector: procedural default, or `julia`/`david` Ready Player Me GLBs, or fully-textured CC0 `mpfb.glb`, all driven through the same 15 channels — see gotchas 23–32). **Fixed in the latest round: the mpfb head rendered with eyes/mouth but no face** — a NaN morph-influence bug in `VisemeDriver` (gotcha 32); head now renders fully textured and deforms |

Recent feedback loop: the user judges **sync by ear** and **heads by eye** in the running demo.
Reports so far: (a) "no visible mouth" and (b) "no sound" (both fixed — see §6.3,
§6.4); (c) GLB avatars showed body+hair but no head (fixed — camera framing bug,
gotcha 27); (d) mpfb head showed eyes and mouth but no face (fixed — NaN morph
influence, gotcha 32). If asked to "improve sync", the tuning knobs are the
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
  glb-head.ts                 M4: loadGlbHead() — GLTFLoader wrapper for the
                              vendored Ready Player Me avatars (public/avatars/
                              julia.glb, david.glb); one VisemeDriver per morph
                              mesh (head/teeth/beard/eyes each carry all 15
                              Oculus viseme names) → MultiMeshVisemeDriver;
                              frameCameraOnHead() reframes camera at head height
                              (full-body model, head ≈ y 1.55 m). Lazy-loaded
                              from main.ts so GLTFLoader stays out of the
                              initial bundle.
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
                              binding, influence bounds, jaw-motion check,
                              GLB JSON-chunk assertions (RPM generator +
                              targetNames coverage on head/teeth)
  gen-sample.ts               regenerates public/samples/*.json from hand-timed
                              IPA word lists
devcheck-glb.mjs              (repo root, plain node — not tsx) headless run of
                              the real GLTFLoader.parseAsync path: parse, 15-name
                              binding, relative-morph geometry, camera-framing
                              math for the vendored avatars (gotchas 25/26)
public/samples/               sentence-1.json, sentence-2.json (canned timelines,
                              used by the system-voice fallback)
public/avatars/               julia.glb (~4.7 MB), david.glb (~4.8 MB) — realistic
                              Ready Player Me avatars (CC BY-NC 4.0, see
                              ATTRIBUTION.md in that dir), driven by the same
                              15 Oculus viseme names via glb-head.ts
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
23. **Ready Player Me GLB morph conventions** (the vendored `julia`/`david`
    heads; verified byte-level, see `public/avatars/ATTRIBUTION.md`):
    - morph target **names live in `mesh.extras.targetNames`** (an array
      parallel to `primitives[].targets`), not in per-target extras.
      three.js GLTFLoader (r155+) reads that into `morphTargetDictionary`
      automatically, so the 15 Oculus names bind with the identity `nameMap`.
    - GLTF morphs are **relative deltas**: the loader sets
      `geometry.morphTargetsRelative = true`. That is the *opposite* of our
      hand-baked procedural head (absolute positions, gotcha 1) — both are
      correct in their own conventions; don't "unify" them.
    - **No morph-count cap** on this path: r169's renderer auto-detects the
      count per geometry (texture-morph encoding, `WebGLMorphtargets`), so
      the 72-morph face meshes need no `MAX_MORPH_TARGETS` define (that
      define in `test-head.ts` only matters for the procedural head's
      absolute-morph path).
    - The viseme morphs are spread over **several meshes** (head, teeth,
      beard, eyes each carry the full set) — hence `MultiMeshVisemeDriver`
      in `viseme-driver.ts` (one `VisemeDriver` per mesh, same 15 values).
      Outfit meshes carry unrelated morphs and are skipped (boundCount 0).
    - The avatar is a full-body Mixamo rig: origin at the feet, head around
      y ≈ 1.55 m. `frameCameraOnHead()` finds the head by object name
      (`Wolf3D_Head`, eyes `EyeLeft`/`EyeRight` — RPM/Mixamo conventions) and
      points the camera ~0.45 m in front of it.
24. **Avatar licensing (CC BY-NC 4.0).** `julia.glb`/`david.glb` are Ready
    Player Me models; per met4citizen's own attribution for the byte-identical
    file (TalkingHead README) they are "free to all developers for
    non-commercial use under the CC BY-NC 4.0 deed". While they are vendored,
    **phenomes must stay non-commercial** (and the repo's pending MIT license
    is not compatible with shipping them in a commercial/MIT build). They are
    a development/evaluation asset by default in the demo (procedural head
    remains the default). If commercial use ever matters: swap in the CC0
    `mpfb.glb` from met4citizen/TalkingHead (same 15-name visemes, ~36.8 MB,
    Blender/MPFB/MakeHuman), or a self-made RPM avatar, or another licensed
    rig. Ask the user before adding more RPM files.
25. **three's *core* `Mesh.updateMorphTargets()` wipes the GLTFLoader's
    dictionary.** GLTFLoader populates `mesh.morphTargetDictionary` from
    `mesh.extras.targetNames` (the RPM convention) at load time. But the
    core `Object3D/Mesh.updateMorphTargets()` rebuilds the dictionary from
    geometry-morph-attribute *names* — and GLTFLoader never sets those
    (they are empty strings), so calling it on a GLB mesh destroys the
    targetNames dictionary and all name binding silently breaks. `VisemeDriver`
    therefore calls it only when the dictionary is already empty (the
    procedural-head case). Never call it unconditionally on loaded GLBs —
    this exact mistake (calling it before checking the dictionary) is what
    made a headless parse look like the names were missing.
26. **Headless GLB verification (no GPU needed).** `devcheck-glb.mjs` (repo
    root, run with **`npx tsx`** — it imports the production
    `src/renderer/glb-head.ts` so the exact `computeHeadFraming` code path
    runs, and tsx lets a `.mjs` entry import `.ts`) runs the real
    `GLTFLoader.parseAsync` path against all three vendored GLBs with
    stubbed `document`/`window`/`self` (ImageLoader's data-URL images) and
    asserts: parse, relative-morph geometry, per-mesh viseme-name binding
    (face mesh must cover all 14 non-sil channels; `viseme_sil` is a rest
    no-op and may be absent, as in mpfb), influence writes, and the
    `computeHeadFraming` outputs (finite anchors, head center in the head
    region, eye center found, unit face direction facing +Z). Run:
    `npx tsx devcheck-glb.mjs`. It cannot verify actual WebGL rendering or
    texture decoding — those still need the user's browser (F12 console is
    the diagnostic path).
27. **three.js `Vector3` methods mutate in place — this was the root cause of
    the "body and hair, but no head" bug in `frameCameraOnHead`.** The code
    read `faceDir = eyeCenter.sub(headCenter).normalize()`: `sub()` and
    `normalize()` mutate the receiver and return it, so after that line
    `eyeCenter` was no longer the eye *position* (~0, 1.73, 0.09) but the
    unit *direction* (0, 0.576, 0.818). The follow-up line
    `camPos.y = eyeCenter.y` then parked the camera at y≈0.58 — **1.1 m below
    the head**, looking up — so the face was hidden behind the body's rim and
    only the hair-top and torso were visible. Diagnosed by instrumenting
    `camera.position.copy` / `controls.update` in a headless run (camera was
    literally at (0, 0.576, 0.396)); fix is `faceDir.copy(eyeCenter).sub(
    headCenter).normalize()`. General rule: almost all three vector methods
    mutate in place (`.set/.add/.sub/.normalize/.multiplyScalar/...`); only
    build chains that end in a fresh vector (`.copy(a).sub(b).normalize()`).
    When a value is needed twice, keep the original in a `.clone()`/`.copy()`
    — never reuse a vector you already subtracted/normalized.
28. **The vendored RPM GLBs are quirky; three.js eats the quirks fine, so do
    not "fix" them.** (a) Each file contains several *unnamed* placeholder
    meshes (tiny boxes around the origin; one ~1617-vert full-body-sized
    ghost) that do not show up as visible garbage in three.js rendering
    (screenshots are clean; met4citizen's own demos ship the identical files
    unmodified). (b) The vertex buffers are **interleaved** (bufferView
    `byteStride = 52`: position, UV, normal, …) — any manual file-level parse
    must honor the stride; naive stride-3 reads produce garbage values (this
    burned several analysis sessions in this project). (c) The declared
    accessor `min`/`max` metadata is stale in places — never frame the camera
    from metadata; use computed `Box3` (that is what
    `frameCameraOnHead`/`devcheck-glb.mjs` do). (d) Housekeeping: `julia.glb`
    was at one point missing from `public/avatars/` (404 → the "julia" UI
    option silently broke); it was restored byte-identical from
    met4citizen/HeadAudio (SHA-256 in `ATTRIBUTION.md`). If a vendored asset
    404s, re-fetch from the source repo and verify the recorded SHA.
29. **three.js GLTFLoader sanitizes node names — it strips dots.**
    MPFB-style assets name nodes like `Human.high-poly` / `Humanteeth_base`-
    style; three's internal name sanitizer rewrites `Human.high-poly` to
    `Humanhigh-poly` (and `Human.teeth_base` to `Humanteeth_base`) before the
    node lands in the scene, so `getObjectByName('Human.high-poly')` finds
    nothing. Any name-based lookup (`EYE_NAME_CANDIDATES` in
    `glb-head.ts`) must include *both* the authored spelling and the
    dot-stripped spelling. (RPM names have no dots, which is why this only
    bit with mpfb.)
30. **The MPFB `base` mesh (`Human`) is the full body, not just the head.**
    Its bbox is y ∈ [-0.002, 1.773], so a naive `Box3.setFromObject` head
    center lands at the *waist* (y ≈ 0.89) and the camera ends up framing
    the torso with the head in a corner. `computeHeadFraming` handles this
    generically: it takes the named eye object(s) for the camera height,
    keeps only head-region vertices of the head mesh (`y ≥ eyeCenter.y −
    0.22`, which drops the torso for full-body meshes and is a no-op filter
    for RPM's head-only mesh), and derives the face direction from the
    front-most vertex in that region (initial +Z guess, refined by max
    projection) instead of assuming the face points along the object's
    local +Z. Result: one code path frames both RPM (head mesh) and MPFB
    (full-body mesh) avatars.
31. **RPM avatars ship *placeholder* textures — the eyes and teeth are
    single-color images baked into the GLB** (64×64 near-black eyes, 128×128
    dark teeth, 2×2 solid skin), which is why `david`/`julia` render as a
    faceless skin blob with dark smudges. The asset is unfixable as-is
    (met4citizen ships it unchanged), so `patchPlaceholderTextures()` in
    `glb-head.ts` regenerates them at load time: it down-scales each
    eye/teeth material's map to 32×32 and counts distinct quantized colors;
    ≤ 2 ⇒ placeholder ⇒ the eye map is replaced with a generated 256×256
    canvas texture (off-white sclera, brown iris + pupil drawn at the UV of
    the front-most vertex — verified that RPM's eye UVs are a standard
    equirectangular unwrap with the front vertex at uv ≈ (0.5, 0.5)) and the
    teeth map with flat ivory. Real textures (mpfb) never trip the 2-color
    test and are left untouched. No-op outside a browser (check scripts).
32. **A non-finite value in `morphTargetInfluences` silently makes the whole
    mesh disappear** — and this was the mpfb "eyes and mouth but no face"
    bug. `VisemeDriver` stored its per-channel values in a 15-slot buffer but
    indexed it with the *asset's morph-target index* (`values[meshIdx]`), and
    `commit()` wrote that slot back into `mesh.morphTargetInfluences[meshIdx]`.
    For the RPM avatars the 15 visemes happen to sit at morph indices 0–14 in
    exactly our channel order, so the mis-indexed read/write round-tripped
    harmlessly (a coincidence that masked the bug for two rounds). For mpfb
    the visemes sit at scattered indices (19–64); reading `values[19..64]` of
    a 15-slot `Float32Array` yields `undefined`, which the driver wrote into
    the mesh's influences array. three uploads that array as a GLSL uniform
    (undefined → NaN), and in the morph chunk
    `if (morphTargetInfluences[i] != 0.0)` is **true for NaN** (IEEE-754:
    NaN ≠ 0), so every vertex got `transformed += delta * NaN = NaN` — the
    whole `Human` body mesh rasterized nothing (no console error, no WebGL
    warning). What the user actually saw as the "face" was the ponytail hair
    cap (a full head-covering mesh with openings for eyes/mouth) over the
    missing skin. Diagnosis path: headless A/B with a *non-skinned twin*
    sharing the body's geometry+material (twin rendered a bright face; the
    SkinnedMesh rendered nothing) → then dumping `morphTargetInfluences` and
    finding `undefined` exactly at the bound viseme indices. Fix:
    (a) `VisemeDriver` now indexes its buffers by channel (0–14) and maps to
    the mesh index only in `commit()`, with a finiteness guard on every
    write; (b) `loadGlbHead()` runs `sanitizeMorphInfluences()`, which scrubs
    non-finite entries **in place** (never replace the array — the renderer
    caches a reference to it). General rule: if a GLB mesh renders nothing
    with no errors, check `morphTargetInfluences` for NaN/undefined before
    suspecting skinning — and remember at rest the skinning pipeline is the
    identity (all-identity `boneTexture`), so it's a poor suspect for
    brightness/visibility bugs.
33. **HeadTTS failures are fail-once-die-forever: one wedged synthesis can
    silence every later play, on every head, with no visible error** — the
    "works the first time, second time is silent" bug. Four independent gaps
    combined: (a) the vendored worker's `process()` had no try/catch — any
    exception inside `model(inputs)` (e.g. a WebGPU session stall) or G2P/
    tokenizer left `isProcessing = true` forever, so every later
    `synthesize` message was silently dropped at the `isProcessing` guard
    (the worker's queue can wedge with no message ever reaching the client);
    (b) the client's `processData` awaited `audioCtx.decodeAudioData()` with
    no catch — a rejected decode left the item at status 1 and its deferred
    never resolved; (c) `NeuralSpeech.speak()` had no timeout, so a hung
    `tts.synthesize()` hung `play()` in `main.ts` forever; (d) `main.ts`
    released `playBusy` only after `playNeural()` returned, so a hung play
    wedged `playBusy = true` and every later `play()` early-returned — all
    heads silent, status stuck at "synthesizing…". **Fix (all four):**
    1. `src/tts/vendor/worker-tts.mjs` — *surgical, documented "phenomes
       local patch" in the file header*: `process()` now has an outer
       `try/finally` (resets `isProcessing` even on throw) and a per-item
       `try/catch` that posts `{type:'error', ref, data:{error}}` for the
       failed item and keeps draining the queue.
    2. `src/tts/vendor/headtts.mjs` — *surgical, documented patch*:
       `processData` wraps `decodeAudioData` in try/catch (failure → error
       message + `item.status = 2` so `processOut` resolves the deferred),
       and the worker `onmessage` handler is `void this.processData(ev.data)
       .catch(console.error)` so a rejection can't escape unobserved.
    3. `src/tts/neural-speech.ts` — `speak()` caps `tts.synthesize()` with
       `withTimeout()` (default 120 s, `SYNTH_TIMEOUT_MS`); any failure
       (timeout, worker error message, decode failure, non-finite result)
       calls `failSynthesis()` = `tts.clear()` + state 'error' + background
       `reconnectWorker()`; `reconnectWorker()` calls **`tts.connect({})`
       with an object, never `null`** — `connect(null)` is a no-op while
       `isConnected` is true, so only an object forces the full
       terminate/rebuild; `ensureAudioRunning()` recreates the `AudioContext`
       if 'closed' and resumes it if 'suspended' before every play (a dead
       context plays silence — this is also why `audioCtx` is no longer
       readonly and is mirrored into `tts.settings.audioCtx`); `load()` is
       retryable from 'error' with a 60 s backoff (`RECONNECT_AFTER_MS`);
       `stop()` sets a `stopCalled` flag so a user cancel mid-synthesis is
       *not* treated as a failure.
    4. `src/main.ts` — `playNeural()` returns `'ok' | 'cancelled' | 'failed'`
       (a user pause is 'cancelled', no fallback); `play()` races it against
       a 180 s hard `withTimeout` (`PLAY_STALL_TIMEOUT_MS`) and, on
       'failed', falls back to the **system voice for that utterance**
       (`startSpeechFrom(pausedAt)`) and always releases `playBusy` — the
       demo degrades, it never wedges. The fallback branch now also
       re-triggers `neural.load()` from the 'error' state (its backoff is
       enforced inside `load()`).
    **Tested** (headless): `?tts-worker=<url>&tts-timeout=<ms>` query params
    (dev hook in `main.ts`) swap in a fake worker module and shorten the
    timeout; `/tmp/pwtest/fake-worker-server.mjs` serves the fake worker plus
    a per-call mode endpoint (`good`/`hang`/`crash`) — state lives on the
    server because **blob:-URL workers have no `localStorage` in headless
    Chromium** (a `self.localStorage.getItem` crash inside the worker is
    exactly how the first fake-worker version died, which itself exercised
    the new timeout path). `/tmp/pwtest/tts-failure.mjs` drives the real
    page through: system-voice first play → neural (good) → cached repeat
    (no worker call) → **hang** → timeout → system-voice fallback → worker
    replaced → ready → neural again → **crash** → error message → fallback →
    recovery. 7/7 pass, zero page errors. `/tmp/pwtest/tts-baseline.mjs`
    confirms the unmodified production page still boots, plays, and starts
    the real model download with no errors.

## 7. Commands & baselines

```sh
npm install --cache ./.npm-cache   # if node_modules is absent
npm run dev                        # http://localhost:5173 (the demo)
npm run check                      # check-core.ts — see baselines below
npm run check:head                 # check-head.ts — headless three.js checks
npx tsx devcheck-glb.mjs           # headless GLTFLoader parse/bind check + production computeHeadFraming (no GPU)
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
  track peak, jaw region drops under aa; **GLB section**: all three
  vendored avatars parse — RPM pair: generator = "Ready Player Me", head
  & teeth `targetNames` match their 72 morphs and cover all 15 viseme
  names; `mpfb.glb` (CC0): face mesh `base` has 66 names / 66 targets
  covering all 14 non-sil channels, `teeth_base`/`tongue01` carry the
  lip-relevant 8, `high-poly` eyeballs carry eye-look morphs only.
- `build` → `index-*.js` ≈ 580 kB (151 kB gzip) + **`glb-head-*.js` ≈ 51 kB
  (15.5 kB gzip, lazy-loaded only when a realistic head is chosen)** +
  `worker-tts-*.mjs` ≈ 12 kB + the three copied language assets +
  `tts/dictionaries/en-us.txt` (2.8 MB) in dist. The ">500 kB chunk" warning
  is expected (three.js) and harmless.
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

- **`src/tts/vendor/`** — HeadTTS v1.3.0 (MIT) modules vendored; **two of
  them carry small documented "phenomes local patch" changes** (gotcha 33):
  `worker-tts.mjs` (guarded `process()`) and `headtts.mjs` (guarded decode
  + observed `processData`). Everything else is byte-identical upstream:
  `language.mjs` + `language-en-us.mjs` (CMU G2P), `utils.mjs`, `LICENSE`;
  plus hand-written `headtts.d.mts` / `utils.d.mts` declarations for the
  surface used (`HeadTTS.settings` was added to the d.mts for the
  `audioCtx` mirror).
- **`src/tts/neural-speech.ts`** — `NeuralSpeech`: shared `AudioContext`
  (re-created if 'closed' by `ensureAudioRunning()`); engine = WebGPU (fp32)
  if available else WASM (q4); `load()` = connect the client (model download
  from the HF CDN → Cache API, progress via `onProgress`), retryable from
  'error' with a 60 s backoff; `speak(text, fromWord)` = synthesize (cached
  per distinct text; multi-part results merged with `mergeParts()`) capped
  by a 120 s timeout, any failure → `failSynthesis()` (clear queue, 'error'
  state, background worker rebuild) — see gotcha 33; then play the
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
  invalidate in-flight async synthesis on pause/stop, and a neural failure
  falls back to the system voice *for that utterance* instead of wedging
  (gotcha 33). UI shows engine state + download progress (`#neuralinfo`);
  auto-starts the model download on first play (and again after a failure,
  backoff-gated) so the *next* play is neural. Dev hook: `?tts-worker=<url>&
  tts-timeout=<ms>` (fake worker / short timeout for the failure test).
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

### 8.2 M2.2 — "second play is silent" (TTS wedge; fixed, gotcha 33)

**Reported:** TTS audio works the first time; the second play (same head) and
all other heads are then silent, forever, with no visible error.
**Diagnosis:** the failure chain is four compounding gaps (worker
`process()` without try/catch → `isProcessing` stuck → silent message drop;
client `decodeAudioData` rejection unhandled → deferred never resolves;
no synthesis timeout → `play()` hangs; `playBusy` only released after
`playNeural` returns → permanently stuck). A single bad synthesis — most
likely a WebGPU inference-session stall in the user's browser — wedges the
whole voice system; the first play only worked because it was the *only*
play that got to run. **Fix:** the four changes itemized in gotcha 33
(vendored worker guard, vendored client guard, `NeuralSpeech` timeout +
worker-rebuild recovery + audio-context liveness check, `main.ts` outcome-
based fallback + hard play timeout). **Verified headlessly** with the fake-
worker scenario (`/tmp/pwtest/tts-failure.mjs`, 7/7 incl. hang and crash
modes, zero page errors) and the production baseline
(`/tmp/pwtest/tts-baseline.mjs`).
**Needs the user's browser:** confirm that (a) two consecutive plays both
speak (second one may be the cached-buffer play), (b) if a neural play ever
fails the status briefly shows the error + "using system voice" and later
plays recover to neural, and (c) switching heads after a failure no longer
silences playback.

## 9. M3 / M4 briefs

- **M3:** MFCC extraction in an `AudioWorklet`, Gaussian-prototype classifier
  per viseme (HeadAudio's `model-en-mixed.bin`, MIT — retrain later on
  labels generated from our own TTS). Output feeds `driver.setAll()` (live
  mode already exists). Used for mic input / arbitrary audio files — the
  fallback path from §1.
- **M4:** latency measurement (phoneme timestamp → rendered frame), TTS-
  driven vs audio-classified A/B toggle in the demo, final character asset
  (the **julia/david RPM heads are already wired** as selectable demo heads
  via `glb-head.ts` — the remaining M4 asset work is deciding the shipped
  default given the CC BY-NC constraint, gotcha 24), docs pass.

## 10. Open questions to confirm with the user (ask, don't assume)

- **M2 TTS wedge (fixed this round, §8.2):** the "second play is silent"
  failure is fixed (gotcha 33) — confirm with the user by playing twice in
  a row, then (if it ever fails) switching heads and playing again: it must
  never stay permanently silent; a failed neural play degrades to the system
  voice for that utterance and recovers on its own.
- Which viseme shapes/pacings look wrong to their ear — the standing
  invitation after each sync fix.
- Final character asset (M4): **realistic RPM heads (`julia`/`david`) are
  now in the demo behind a head selector** (procedural stays the default);
  confirm with the user (a) that the CC BY-NC 4.0 restriction (gotcha 24) is
  acceptable while they are vendored, and (b) whether either head actually
  shows the jaw "sinking" they want to evaluate, or which rig ships final.
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
