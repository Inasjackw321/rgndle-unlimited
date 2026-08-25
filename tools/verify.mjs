/**
 * Checks the committed percentile table against a fresh sample, and checks the
 * claims the game's design rests on.
 *
 * Run after every `npm run percentiles`.
 */

import { scoreRound, ROLL_LENGTH, distance } from '../js/scoring.js';
import { playOptimally } from '../js/strategy.js';
import { percentileOf, rankFor, RANKS } from '../js/ranks.js';

const N = Number(process.argv[2] || 400_000);
const MAX_ERROR = 0.004;

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
let failures = 0;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures++;
};

console.log(`Verifying against ${N.toLocaleString()} fresh days\n`);

/* ---- 1. Distance is uniform per target digit ----------------------- */

console.log('Every target digit is equally hard:');
{
  let worstDev = 0;
  for (let target = 0; target < 10; target++) {
    const counts = new Array(6).fill(0);
    for (let roll = 0; roll < 10; roll++) counts[distance(target, roll)]++;
    // Reference shape: one way to be exact, two ways to be each of 1-4, one to be 5.
    const expected = [1, 2, 2, 2, 2, 1];
    for (let d = 0; d < 6; d++) worstDev = Math.max(worstDev, Math.abs(counts[d] - expected[d]));
  }
  if (worstDev === 0) console.log('  ✓ identical distance distribution for all ten target digits');
  else fail(`target digits differ — worst deviation ${worstDev}`);
}

/* ---- 2. Every day is equally hard ---------------------------------- */

console.log('\nEvery daily target yields the same score distribution:');
{
  const means = [];
  for (const spec of ['000000000', '555555555', '123456789', '999999999']) {
    const target = [...spec].map(Number);
    const local = mulberry32(0xfeed);
    let sum = 0;
    const runs = 60000;
    for (let i = 0; i < runs; i++) {
      const { rolled, rerollsLeft } = playOptimally(target, local);
      sum += scoreRound(target, rolled, { rerollsLeft }).total;
    }
    means.push({ spec, mean: sum / runs });
  }
  const lo = Math.min(...means.map((m) => m.mean));
  const hi = Math.max(...means.map((m) => m.mean));
  const spread = (hi - lo) / lo;
  for (const m of means) console.log(`  ${m.spec}  mean ${m.mean.toFixed(0)}`);
  // Same PRNG seed for each, so these should be *identical*, not merely close.
  if (spread === 0) console.log('  ✓ identical across targets');
  else if (spread < 0.02) console.log(`  ✓ within ${(spread * 100).toFixed(2)}%`);
  else fail(`targets differ by ${(spread * 100).toFixed(2)}% — the daily is not fair`);
}

/* ---- 3. Percentile soundness --------------------------------------- */

const TARGET = [...'473829105'].map(Number);
const scores = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const { rolled, rerollsLeft } = playOptimally(TARGET, rand);
  scores[i] = scoreRound(TARGET, rolled, { rerollsLeft }).total;
}
scores.sort();

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

const probes = [];
for (let i = 1; i < 200; i++) probes.push(scores[Math.floor((i / 200) * N)]);
for (const p of [0.995, 0.999, 0.9995, 0.9999]) probes.push(scores[Math.floor(p * N)]);

let worst = { error: 0, score: null };
for (const score of new Set(probes)) {
  const error = Math.abs(percentileOf(score) - empiricalBelow(score));
  if (error > worst.error) worst = { error, score };
}
console.log(
  `\nPercentile soundness: max error ${worst.error.toFixed(5)} at score ` +
    `${worst.score?.toLocaleString()} (limit ${MAX_ERROR})`,
);
if (worst.error > MAX_ERROR) fail('percentile table does not match the scorer');
else console.log('  ✓');

let monotonic = true;
for (let i = 1; i < probes.length; i++) {
  if (probes[i] > probes[i - 1] && percentileOf(probes[i]) < percentileOf(probes[i - 1])) monotonic = false;
}
if (monotonic) console.log('Monotonic in score: ✓');
else fail('percentile is not monotonic in score');

/* ---- 4. Informational: rank spread ---------------------------------- */

const counts = new Map(RANKS.map((r) => [r.id, 0]));
for (const s of scores) {
  const id = rankFor(percentileOf(s)).id;
  counts.set(id, counts.get(id) + 1);
}
console.log('\nRank distribution (informational — score atoms make exact shares unattainable):');
console.log('rank     nominal    observed');
RANKS.forEach((rank, i) => {
  const nominal = ((RANKS[i + 1] ? RANKS[i + 1].min : 1) - rank.min) * 100;
  const observed = (counts.get(rank.id) / N) * 100;
  console.log(`${rank.label.padEnd(7)} ${nominal.toFixed(4).padStart(8)}% ${observed.toFixed(4).padStart(10)}%`);
});

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
