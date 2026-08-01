/**
 * Monte-Carlo the scoring engine and emit js/percentiles.js.
 *
 *   node tools/gen-percentiles.mjs [sampleCount]
 *
 * The table lets the game report a *real* percentile ("top 0.0041%") instead
 * of a hand-waved one. Re-run whenever js/scoring.js changes.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performRoll } from '../js/scoring.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const N = Number(process.argv[2] || 2_000_000);

/* Deterministic PRNG (mulberry32) so the committed table is reproducible. */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x524e4744);

console.log(`Sampling ${N.toLocaleString()} rolls…`);
const started = Date.now();
const scores = new Float64Array(N);
for (let i = 0; i < N; i++) {
  scores[i] = performRoll(rand).total;
  if (i > 0 && i % 250_000 === 0) {
    process.stdout.write(`  ${((i / N) * 100).toFixed(0)}%\r`);
  }
}
console.log(`Sampled in ${((Date.now() - started) / 1000).toFixed(1)}s. Sorting…`);
scores.sort();

/* Probability grid: dense in the body, logarithmic in the upper tail. */
const probs = [];
const BODY_STEPS = 495;
for (let i = 0; i < BODY_STEPS; i++) probs.push((i / BODY_STEPS) * 0.99);
const TAIL_STEPS = 320;
const finestTail = 1 - 5 / N; // don't claim more resolution than we sampled
const decades = Math.log10(0.01 / (1 - finestTail));
for (let j = 0; j <= TAIL_STEPS; j++) {
  probs.push(1 - 0.01 * Math.pow(10, -decades * (j / TAIL_STEPS)));
}

const quantile = (p) => scores[Math.min(N - 1, Math.max(0, Math.floor(p * N)))];
const table = probs.map(quantile);

/* Round-trip sanity: the table must be non-decreasing. */
for (let i = 1; i < table.length; i++) {
  if (table[i] < table[i - 1]) throw new Error(`table not monotonic at ${i}`);
}

const mean = scores.reduce((a, b) => a + b, 0) / N;
const stats = {
  n: N,
  mean: Number(mean.toFixed(2)),
  median: quantile(0.5),
  p90: quantile(0.9),
  p99: quantile(0.99),
  p999: quantile(0.999),
  max: scores[N - 1],
};
console.log('Distribution:', stats);

const out = `/**
 * GENERATED FILE — do not edit by hand.
 * Produced by tools/gen-percentiles.mjs from ${N.toLocaleString()} simulated rolls.
 * Regenerate with: npm run percentiles
 */

export const SAMPLE_SIZE = ${N};

export const DISTRIBUTION = ${JSON.stringify(stats)};

/** Probability grid (ascending). */
export const PROBS = ${JSON.stringify(probs.map((p) => Number(p.toFixed(9))))};

/** Score at each probability in PROBS (ascending). */
export const QUANTILES = ${JSON.stringify(table)};
`;

mkdirSync(resolve(__dirname, '../js'), { recursive: true });
writeFileSync(resolve(__dirname, '../js/percentiles.js'), out);
console.log(`Wrote js/percentiles.js (${(out.length / 1024).toFixed(1)} KB)`);
