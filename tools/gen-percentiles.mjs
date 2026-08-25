/**
 * Monte-Carlo the game under optimal play and emit js/percentiles.js.
 *
 *   node tools/gen-percentiles.mjs [sampleCount]
 *
 * The reference player uses the exact policy solved in js/strategy.js, so a
 * percentile means "better than N% of optimally-played days" — beating it is
 * luck, not superior tactics. Re-run whenever scoring or strategy changes.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreRound, ROLL_LENGTH } from '../js/scoring.js';
import { playOptimally, expectedScore } from '../js/strategy.js';

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

const rand = mulberry32(0x47555353);

/**
 * The score depends only on the *distances*, and for a uniform roll those are
 * distributed identically whatever the target is. So the target used here is
 * arbitrary — and, more usefully, every day is exactly as hard as every other.
 * tools/verify.mjs asserts that rather than taking it on trust.
 */
const TARGET = Array.from({ length: ROLL_LENGTH }, () => Math.floor(rand() * 10));

console.log(`Sampling ${N.toLocaleString()} optimally-played days…`);
const started = Date.now();
const scores = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const { rolled, rerollsLeft } = playOptimally(TARGET, rand);
  scores[i] = scoreRound(TARGET, rolled, { rerollsLeft }).total;
  if (i > 0 && i % 250_000 === 0) process.stdout.write(`  ${((i / N) * 100).toFixed(0)}%\r`);
}
console.log(`Sampled in ${((Date.now() - started) / 1000).toFixed(1)}s. Sorting…`);
scores.sort();

/* Probability grid: dense in the body, logarithmic in the upper tail. */
const probs = [];
const BODY_STEPS = 495;
for (let i = 0; i < BODY_STEPS; i++) probs.push((i / BODY_STEPS) * 0.99);
const TAIL_STEPS = 320;
const finestTail = 1 - 5 / N;
const decades = Math.log10(0.01 / (1 - finestTail));
for (let j = 0; j <= TAIL_STEPS; j++) {
  probs.push(1 - 0.01 * Math.pow(10, -decades * (j / TAIL_STEPS)));
}

const quantile = (p) => scores[Math.min(N - 1, Math.max(0, Math.floor(p * N)))];
const table = probs.map(quantile);

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
  theoreticalMean: Number(
    expectedScore({ digitsLeft: ROLL_LENGTH, rerollsLeft: 3, bullseyes: 0, total: 0, worst: 0 }).toFixed(2),
  ),
};
console.log('Distribution:', stats);

/**
 * Cross-check the simulation against the solved MDP.
 *
 * These must not be equal: the DP deliberately ignores the consecutive
 * "Bullseye Run" bonus (see js/strategy.js), while scoreRound awards it. So the
 * simulated mean has to land *slightly above* the solved expectation. Below it
 * would mean the simulation is playing worse than optimally — a policy bug —
 * and far above would mean the bonus is bigger than intended.
 */
const drift = (stats.mean - stats.theoreticalMean) / stats.theoreticalMean;
console.log(
  `Simulated mean is ${(drift * 100).toFixed(3)}% above the solved expectation ` +
    '(expected: a little, from the un-modelled run bonus)',
);
if (drift < 0) throw new Error('simulation scores below optimal play — the policy is not being followed');
if (drift > 0.03) throw new Error('simulation far above optimal play — the run bonus is mis-scaled');

const out = `/**
 * GENERATED FILE — do not edit by hand.
 * Produced by tools/gen-percentiles.mjs from ${N.toLocaleString()} optimally-played days.
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
