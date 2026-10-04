import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const vendorDir = fileURLToPath(new URL('./src/tts/vendor/', import.meta.url));

/**
 * The Kokoro TTS worker (src/tts/vendor/worker-tts.mjs) loads its G2P
 * language module with a *dynamic* import built from a template literal:
 *
 *     import("./language-" + lang.toLowerCase() + ".mjs")
 *
 * Vite cannot resolve that statically, so in the production build the
 * raw .mjs files must sit next to the emitted worker chunk. In dev they
 * are already co-located under src/tts/vendor/. This plugin copies them
 * into dist/assets/ (the worker's import resolves relative to its own
 * URL, which lands in the same directory).
 */
const copyWorkerLanguageModules: Plugin = {
  name: 'phenomes:copy-worker-language-modules',
  apply: 'build',
  generateBundle() {
    for (const f of ['language.mjs', 'language-en-us.mjs', 'utils.mjs']) {
      this.emitFile({
        type: 'asset',
        fileName: `assets/${f}`,
        source: readFileSync(path.join(vendorDir, f), 'utf8'),
      });
    }
  },
};

export default defineConfig({
  base: './',
  plugins: [copyWorkerLanguageModules],
  server: { port: 5173 },
  build: { outDir: 'dist' },
});
