/**
 * RNGDLE Unlimited — scoring engine.
 *
 * Pure, dependency-free, and DOM-free so the exact same code runs in the
 * browser and in tools/gen-percentiles.mjs. Any change here invalidates the
 * percentile table: re-run `npm run percentiles` afterwards.
 */

export const ROLL_LENGTH = 9;

/* ------------------------------------------------------------------ *
 * Primality (trial division against a small sieve).
 * Rolls are < 1e9, so primes up to 31623 are sufficient.
 * ------------------------------------------------------------------ */

const SMALL_PRIMES = (() => {
  const limit = 31623;
  const sieve = new Uint8Array(limit + 1);
  const primes = [];
  for (let i = 2; i <= limit; i++) {
    if (sieve[i]) continue;
    primes.push(i);
    for (let j = i * i; j <= limit; j += i) sieve[j] = 1;
  }
  return primes;
})();

function isPrime(n) {
  if (n < 2) return false;
  for (const p of SMALL_PRIMES) {
    if (p * p > n) break;
    if (n % p === 0) return n === p;
  }
  return true;
}

function isPerfectSquare(n) {
  if (n < 0) return false;
  const r = Math.round(Math.sqrt(n));
  return r * r === n;
}

/* ------------------------------------------------------------------ *
 * Digit pattern helpers
 * ------------------------------------------------------------------ */

/** Longest run of an identical digit, plus every run of length >= 2. */
function identicalRuns(d) {
  const runs = [];
  let start = 0;
  for (let i = 1; i <= d.length; i++) {
    if (i === d.length || d[i] !== d[start]) {
      if (i - start >= 2) runs.push({ digit: d[start], length: i - start, start });
      start = i;
    }
  }
  return runs;
}

/** Longest run where each digit is exactly +step from the previous. */
function longestStepRun(d, step) {
  let best = 1;
  let run = 1;
  for (let i = 1; i < d.length; i++) {
    run = d[i] - d[i - 1] === step ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/** Longest run with any constant difference (|diff| >= 2). */
function longestArithmeticRun(d) {
  let best = { length: 1, diff: 0 };
  let run = 1;
  let diff = null;
  for (let i = 1; i < d.length; i++) {
    const delta = d[i] - d[i - 1];
    if (delta === diff) run++;
    else {
      diff = delta;
      run = 2;
    }
    if (Math.abs(diff) >= 2 && run > best.length) best = { length: run, diff };
  }
  return best;
}

/** Longest ABABAB… run where A !== B. */
function longestAlternatingRun(d) {
  let best = 1;
  let run = 1;
  for (let i = 1; i < d.length; i++) {
    if (i >= 2 && d[i] === d[i - 2] && d[i - 1] !== d[i]) run++;
    else run = d[i] !== d[i - 1] ? 2 : 1;
    if (run > best) best = run;
  }
  return best;
}

/** Longest palindromic substring (expand around centre). */
function longestPalindrome(d) {
  let best = 1;
  const expand = (lo, hi) => {
    while (lo >= 0 && hi < d.length && d[lo] === d[hi]) {
      lo--;
      hi++;
    }
    return hi - lo - 1;
  };
  for (let i = 0; i < d.length; i++) {
    best = Math.max(best, expand(i, i), expand(i, i + 1));
  }
  return best;
}

/**
 * Indices of the single most notable contiguous pattern in the roll, so the UI
 * can light up the digits that actually earned something. Returns [] when the
 * roll has no run/straight/palindrome of length 3 or more.
 */
export function highlightIndices(d) {
  let best = { length: 2, start: -1 };
  const consider = (start, length) => {
    if (length > best.length) best = { start, length };
  };

  // Identical runs and ascending/descending straights. Alternating runs need
  // no case of their own: ABABA is itself a palindrome, caught below.
  const scan = (matches) => {
    let start = 0;
    for (let i = 1; i <= d.length; i++) {
      if (i === d.length || !matches(i)) {
        consider(start, i - start);
        start = i;
      }
    }
  };
  scan((i) => d[i] === d[i - 1]);
  scan((i) => d[i] === d[i - 1] + 1);
  scan((i) => d[i] === d[i - 1] - 1);

  // Palindromes.
  for (let c = 0; c < d.length; c++) {
    for (const [l0, h0] of [
      [c, c],
      [c, c + 1],
    ]) {
      let lo = l0;
      let hi = h0;
      while (lo >= 0 && hi < d.length && d[lo] === d[hi]) {
        lo--;
        hi++;
      }
      consider(lo + 1, hi - lo - 1);
    }
  }

  if (best.start < 0 || best.length < 3) return [];
  return Array.from({ length: best.length }, (_, i) => best.start + i);
}

const FACTORIAL = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];

/**
 * Exact probability that a random roll has this roll's "shape" — i.e. the same
 * partition of ROLL_LENGTH into per-digit counts, ignoring which digits and in
 * what order. Ranges from ~0.229 (two pairs + five singles) down to 1e-8 (all
 * nine identical), so it is a genuine, smoothly-varying rarity measure.
 */
export function shapeProbability(d) {
  const counts = new Array(10).fill(0);
  for (const x of d) counts[x]++;
  const used = counts.filter((c) => c > 0);

  // Ways to assign digits to the parts: falling factorial over 10, divided by
  // the permutations of equally-sized parts (which are interchangeable).
  let ways = 1;
  for (let i = 0; i < used.length; i++) ways *= 10 - i;
  const partSizes = new Map();
  for (const c of used) partSizes.set(c, (partSizes.get(c) || 0) + 1);
  for (const m of partSizes.values()) ways /= FACTORIAL[m];

  // Ways to arrange those counts into a sequence.
  let arrangements = FACTORIAL[d.length];
  for (const c of used) arrangements /= FACTORIAL[c];

  return (ways * arrangements) / Math.pow(10, d.length);
}

/** Human-readable shape, e.g. "3+2+1+1+1+1". */
function shapeLabel(d) {
  const counts = new Array(10).fill(0);
  for (const x of d) counts[x]++;
  return counts
    .filter((c) => c > 0)
    .sort((a, b) => b - a)
    .join('+');
}

function shannonEntropy(d) {
  const counts = new Array(10).fill(0);
  for (const x of d) counts[x]++;
  let h = 0;
  for (const c of counts) {
    if (!c) continue;
    const p = c / d.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/* ------------------------------------------------------------------ *
 * Cultural / numerological substrings. Flavour points, deliberately small
 * relative to the structural factors.
 * ------------------------------------------------------------------ */

const CULTURE = [
  { pattern: '42069', points: 54000, label: 'The Sacred Number' },
  { pattern: '80085', points: 15600, label: 'Calculator Classic' },
  { pattern: '58008', points: 15600, label: 'Calculator Classic (Inverted)' },
  { pattern: '1337', points: 9000, label: 'Leetspeak' },
  { pattern: '31415', points: 13200, label: 'Slice of π' },
  { pattern: '27182', points: 13200, label: "Euler's Fingerprint" },
  { pattern: '16180', points: 13200, label: 'Golden Ratio' },
  { pattern: '112358', points: 30000, label: 'Fibonacci Sighting' },
  { pattern: '666', points: 4200, label: 'Number of the Beast' },
  { pattern: '420', points: 2400, label: 'Blaze It' },
  { pattern: '1984', points: 1800, label: 'Big Brother' },
  { pattern: '007', points: 1500, label: 'Licence to Roll' },
  { pattern: '69', points: 720, label: 'Nice' },
];

/* ------------------------------------------------------------------ *
 * Cosmic multiplier — the second source of randomness. Rolled separately
 * from the digits and displayed on its own wheel.
 * ------------------------------------------------------------------ */

export const COSMIC_TABLE = [
  { weight: 0.6, value: 1, label: 'Mundane' },
  { weight: 0.2, value: 1.25, label: 'Favoured' },
  { weight: 0.1, value: 1.5, label: 'Blessed' },
  { weight: 0.06, value: 2, label: 'Ascendant' },
  { weight: 0.03, value: 3, label: 'Celestial' },
  { weight: 0.008, value: 5, label: 'Divine' },
  { weight: 0.0015, value: 10, label: 'Transcendent' },
  { weight: 0.0005, value: 25, label: 'Reality Broken' },
];

export function rollCosmic(rand) {
  let u = rand();
  for (const entry of COSMIC_TABLE) {
    if (u < entry.weight) return entry;
    u -= entry.weight;
  }
  return COSMIC_TABLE[COSMIC_TABLE.length - 1];
}

export function rollDigits(rand) {
  const digits = new Array(ROLL_LENGTH);
  for (let i = 0; i < ROLL_LENGTH; i++) digits[i] = Math.floor(rand() * 10);
  return digits;
}

/* ------------------------------------------------------------------ *
 * Time bonus — a small situational multiplier, excluded from the
 * percentile model on purpose (see README).
 * ------------------------------------------------------------------ */

export function timeBonus(date = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const stamp = hh + mm;
  if (stamp === '1337') return { value: 2, label: 'Leet Hour' };
  if (stamp === '0420' || stamp === '1620') return { value: 1.5, label: 'Four Twenty' };
  if (hh === mm) return { value: 1.5, label: 'Mirror Hour' };
  if (stamp === stamp.split('').reverse().join('')) return { value: 1.25, label: 'Palindrome Clock' };
  return null;
}

/* ------------------------------------------------------------------ *
 * The scorer
 * ------------------------------------------------------------------ */

/**
 * @param {number[]} digits    ROLL_LENGTH digits, 0-9, leading zeros allowed
 * @param {object}   cosmic    entry from COSMIC_TABLE
 * @param {object}   [extra]   { streak: {value,label}, time: {value,label} }
 */
export function scoreRoll(digits, cosmic, extra = {}) {
  const factors = [];
  const add = (id, name, detail, points) => {
    if (points > 0) factors.push({ id, name, detail, points: Math.round(points) });
  };

  const str = digits.join('');
  const value = Number(str);
  const distinct = new Set(digits).size;

  /* --- 0. Improbability ------------------------------------------- *
   * The smooth rarity floor every roll gets. Payout is proportional to
   * 1/sqrt(P), so a shape twice as rare pays ~1.41x. Deliberately blind to
   * digit *order* — the factors below are what reward arrangement.        */
  const shapeP = shapeProbability(digits);
  add(
    'improbability',
    'Improbability',
    `shape ${shapeLabel(digits)} — 1 in ${(1 / shapeP).toFixed(shapeP > 0.01 ? 1 : 0)}`,
    240 / Math.sqrt(shapeP),
  );

  /* --- 1. Identical runs ------------------------------------------ */
  for (const run of identicalRuns(digits)) {
    const pts = 60 * Math.pow(5, run.length - 2);
    const names = {
      2: 'Pair',
      3: 'Triple',
      4: 'Quad',
      5: 'Quint',
      6: 'Sextuple',
      7: 'Septuple',
      8: 'Octuple',
      9: 'MONOLITH',
    };
    add(
      `run${run.start}`,
      names[run.length] || `${run.length}-Run`,
      `${String(run.digit).repeat(run.length)}`,
      pts,
    );
  }

  /* --- 2. Straights ------------------------------------------------ */
  const asc = longestStepRun(digits, 1);
  const desc = longestStepRun(digits, -1);
  if (asc >= 3) add('asc', 'Ascending Straight', `${asc} digits climbing`, 120 * Math.pow(4, asc - 3));
  if (desc >= 3) add('desc', 'Descending Straight', `${desc} digits falling`, 120 * Math.pow(4, desc - 3));

  /* --- 3. Palindromes ---------------------------------------------- */
  const pal = longestPalindrome(digits);
  if (pal === ROLL_LENGTH) add('palindrome', 'PERFECT PALINDROME', 'reads the same both ways', 150000);
  else if (pal >= 5) add('palindrome', 'Palindromic Core', `${pal}-digit mirror`, 250 * Math.pow(2, pal - 5));

  /* --- 4. Distinct digit count ------------------------------------- */
  const distinctPoints = { 1: 300000, 2: 18000, 3: 2400, 8: 900, 9: 15000 };
  if (distinctPoints[distinct]) {
    const label = {
      1: 'Singularity',
      2: 'Duotone',
      3: 'Trichrome',
      8: 'Broad Spectrum',
      9: 'Near-Pandigital',
    }[distinct];
    add('distinct', label, `${distinct} unique digit${distinct === 1 ? '' : 's'}`, distinctPoints[distinct]);
  }

  /* --- 5. Digit sum extremity -------------------------------------- */
  const sum = digits.reduce((a, b) => a + b, 0);
  const deviation = Math.abs(sum - 40.5);
  if (deviation >= 18) {
    add(
      'digitsum',
      sum < 40 ? 'Featherweight' : 'Heavyweight',
      `digit sum ${sum}`,
      180 * Math.pow(1.35, deviation - 18),
    );
  }

  /* --- 6. Roundness ------------------------------------------------- */
  let trailing = 0;
  while (trailing < digits.length && digits[digits.length - 1 - trailing] === 0) trailing++;
  if (trailing >= 3) add('round', 'Round Number', `${trailing} trailing zeros`, 600 * Math.pow(4, trailing - 3));

  /* --- 7. Alternating ---------------------------------------------- */
  const alt = longestAlternatingRun(digits);
  if (alt === ROLL_LENGTH) add('alternating', 'PERFECT ALTERNATION', 'ABABABABA', 48000);
  else if (alt >= 6) add('alternating', 'Alternating Run', `${alt} digits`, 1800 * Math.pow(2, alt - 6));

  /* --- 8. Arithmetic progression ----------------------------------- */
  const arith = longestArithmeticRun(digits);
  if (arith.length >= 4) {
    add(
      'arithmetic',
      'Arithmetic Sequence',
      `${arith.length} digits, step ${arith.diff > 0 ? '+' : ''}${arith.diff}`,
      900 * Math.pow(3, arith.length - 4),
    );
  }

  /* --- 9. Repeated halves ------------------------------------------ */
  if (str.slice(0, 4) === str.slice(5, 9)) add('echo', 'Echo', 'first four = last four', 72000);

  /* --- 10. Culture -------------------------------------------------- */
  for (const c of CULTURE) {
    if (str.includes(c.pattern)) add(`culture-${c.pattern}`, c.label, `contains ${c.pattern}`, c.points);
  }

  /* --- 11. Number theory -------------------------------------------- */
  if (isPrime(value)) add('prime', 'Prime', 'indivisible', 7200);
  if (isPerfectSquare(value) && value > 0) {
    add('square', 'Perfect Square', `${Math.round(Math.sqrt(value))}²`, 180000);
  }

  /* --- 12. Entropy --------------------------------------------------- */
  const entropy = shannonEntropy(digits);
  if (entropy < 1.2) add('entropy', 'Low Entropy', `H = ${entropy.toFixed(2)} bits`, 4800);

  /* --- Multipliers --------------------------------------------------- */
  const base = factors.reduce((a, f) => a + f.points, 0);
  const multipliers = [{ id: 'cosmic', name: `Cosmic: ${cosmic.label}`, value: cosmic.value }];
  if (extra.streak && extra.streak.value > 1) {
    multipliers.push({ id: 'streak', name: extra.streak.label, value: extra.streak.value });
  }
  if (extra.time && extra.time.value > 1) {
    multipliers.push({ id: 'time', name: extra.time.label, value: extra.time.value });
  }
  const multiplier = multipliers.reduce((a, m) => a * m.value, 1);

  return {
    digits,
    display: str,
    value,
    base,
    factors,
    multipliers,
    multiplier,
    total: Math.round(base * multiplier),
    stats: { sum, distinct, entropy },
  };
}

/** Convenience wrapper used by the Monte Carlo tool and by the game. */
export function performRoll(rand, extra = {}) {
  const digits = rollDigits(rand);
  const cosmic = rollCosmic(rand);
  return { ...scoreRoll(digits, cosmic, extra), cosmic };
}
