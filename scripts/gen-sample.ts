/**
 * Generates the canned phoneme-timeline sample files used by the M1 demo.
 *
 * Each sentence is specified as words → IPA phonemes with hand-estimated
 * durations (a deliberately naive G2P+durations stand-in — M2 will replace
 * this with HeadTTS's real phoneme timings, and M4 may add a CMUdict-backed
 * generator). Run: npm run gen:samples
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type PhonemeSpec = readonly [ipa: string, durMs: number];
type WordSpec = readonly [text: string, phonemes: readonly PhonemeSpec[]];

interface Sample {
  file: string;
  text: string;
  gapMs: number; // silence inserted between words
  words: readonly WordSpec[];
}

const SAMPLES: Sample[] = [
  {
    file: 'sentence-1.json',
    text: "I think the cat and you should catch the red cup full of cheese at dusk, but we'll go home.",
    gapMs: 70,
    words: [
      ['I', [['ɪ', 110]]],
      ['think', [['θ', 50], ['ɪ', 90], ['ŋ', 55], ['k', 60]]],
      ['the', [['ð', 45]]],
      ['cat', [['k', 55], ['ɑ', 130], ['t', 55]]],
      ['and', [['ə', 70], ['n', 50], ['d', 55]]],
      ['you', [['j', 40], ['uː', 150]]],
      ['should', [['ʃ', 70], ['ʊ', 90], ['d', 60]]],
      ['catch', [['k', 55], ['æ', 105], ['tʃ', 65]]],
      ['the', [['ð', 45]]],
      ['red', [['ɹ', 50], ['e', 100], ['d', 60]]],
      ['cup', [['k', 55], ['ʌ', 95], ['p', 50]]],
      ['full', [['f', 50], ['uː', 140], ['l', 55]]],
      ['of', [['ə', 70], ['v', 50]]],
      ['cheese', [['tʃ', 60], ['iː', 140], ['z', 70]]],
      ['at', [['ə', 70], ['t', 55]]],
      ['dusk', [['d', 55], ['ʌ', 95], ['s', 60], ['k', 60]]],
      // comma pause
      ['but', [['b', 45], ['ʌ', 95], ['t', 55]]],
      ["we'll", [['w', 45], ['ɪ', 90], ['l', 55]]],
      ['go', [['ɡ', 55], ['oʊ', 120]]],
      ['home', [['h', 50], ['oʊ', 120], ['m', 55]]],
    ],
  },
  {
    file: 'sentence-2.json',
    text: 'Blue moon, what do you mean?',
    gapMs: 80,
    words: [
      ['Blue', [['b', 45], ['l', 50], ['uː', 150]]],
      ['moon', [['m', 50], ['uː', 150], ['n', 55]]],
      // comma pause handled by a longer gap below
      ['what', [['w', 45], ['ɒ', 90], ['t', 55]]],
      ['do', [['d', 50], ['uː', 100]]],
      ['you', [['j', 40], ['uː', 140]]],
      ['mean', [['m', 50], ['iː', 140], ['n', 55]]],
    ],
  },
];

function buildPhonemes(sample: Sample) {
  const phonemes: { p: string; t: number; d: number }[] = [];
  let t = 0;
  let prevWord = '';
  for (const [word, specs] of sample.words) {
    if (prevWord !== '') {
      // comma after "moon" gets a longer pause
      const gap = sample.gapMs * (prevWord === 'moon' ? 2 : 1);
      phonemes.push({ p: 'sil', t, d: gap });
      t += gap;
    }
    for (const [ipa, d] of specs) {
      phonemes.push({ p: ipa, t, d });
      t += d;
    }
    prevWord = word;
  }
  return phonemes;
}

const outDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'samples',
);
mkdirSync(outDir, { recursive: true });

for (const sample of SAMPLES) {
  const doc = {
    format: 'phenomes.phrase',
    version: 1,
    text: sample.text,
    phrases: [{ text: sample.text, phonemes: buildPhonemes(sample) }],
  };
  const path = join(outDir, sample.file);
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  const total = doc.phrases[0].phonemes.at(-1)!;
  console.log(
    `${sample.file}: ${doc.phrases[0].phonemes.length} phonemes, ` +
      `${(total.t + total.d).toFixed(0)} ms`,
  );
}
