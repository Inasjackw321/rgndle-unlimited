/**
 * Checks that the committed percentile table actually calibrates the scorer.
 *
 * Draws a fresh sample with a *different* seed than the one used to build the
 * table, then asserts the property the table is supposed to have:
 *
 *   percentileOf(s) == fraction of rolls scoring strictly below s
 *
 * Rank-band shares are reported too, but deliberately *not* asserted. The score
 * distribution is discrete and has large atoms — a single score value can be
 * 0.16% of all rolls — so a band boundary that falls inside an atom cannot
 * split it, and nominal band widths are unattainable by construction. Soundness
 * of the percentile is the real invariant; band drift is a consequence of it.
 */

import { performRoll } from '../js/scoring.js';
import { percentileOf, rankFor, RANKS } from '../js/ranks.js';

const N = Number(process.argv[2] || 400_000);
const MAX_ERROR = 0.004; // absolute percentile error allowed at any probe

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xbadc0ffe); // deliberately not the table's seed
const scores = new Float64Array(N);
for (let i = 0; i < N; i++) scores[i] = performRoll(rand).total;
scores.sort();

/** Fraction of the fresh sample scoring strictly below `s`. */
function empiricalBelow(s) {
  let lo = 0;
  let hi = N;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (scores[mid] < s) lo = mid + 1;
    else hi = mid;
  }
  return lo / N;
}

console.log(`Verifying against ${N.toLocaleString()} fresh rolls\n`);

/* ---- Assertion: the percentile function is sound ------------------ */

const probes = [];
for (let i = 1; i < 200; i++) probes.push(scores[Math.floor((i / 200) * N)]);
for (const p of [0.995, 0.999, 0.9995, 0.9999]) probes.push(scores[Math.floor(p * N)]);

let worst = { error: 0, score: null };
for (const score of new Set(probes)) {
  const error = Math.abs(percentileOf(score) - empiricalBelow(score));
  if (error > worst.error) worst = { error, score };
}

const sound = worst.error <= MAX_ERROR;
console.log(
  `Percentile soundness: max error ${worst.error.toFixed(5)} at score ` +
    `${worst.score?.toLocaleString()} (limit ${MAX_ERROR}) ${sound ? '✓' : '✗'}`,
);

/* ---- Monotonicity -------------------------------------------------- */

let monotonic = true;
for (let i = 1; i < probes.length; i++) {
  if (probes[i] > probes[i - 1] && percentileOf(probes[i]) < percentileOf(probes[i - 1])) {
    monotonic = false;
    break;
  }
}
console.log(`Monotonic in score: ${monotonic ? '✓' : '✗'}`);

/* ---- Informational: rank distribution ------------------------------ */

const counts = new Map(RANKS.map((r) => [r.id, 0]));
for (const s of scores) counts.set(rankFor(percentileOf(s)).id, counts.get(rankFor(percentileOf(s)).id) + 1);

console.log('\nRank distribution (informational — atoms make exact shares unattainable):');
console.log('rank     nominal    observed');
RANKS.forEach((rank, i) => {
  const nominal = ((RANKS[i + 1] ? RANKS[i + 1].min : 1) - rank.min) * 100;
  const observed = (counts.get(rank.id) / N) * 100;
  console.log(
    `${rank.label.padEnd(7)} ${nominal.toFixed(4).padStart(8)}% ${observed.toFixed(4).padStart(10)}%`,
  );
});

if (!sound || !monotonic) {
  console.error('\nPercentile table does not match the scorer — run `npm run percentiles`.');
  process.exit(1);
}
console.log('\nPercentile table is calibrated.');
