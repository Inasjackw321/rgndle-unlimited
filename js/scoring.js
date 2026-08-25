/**
 * Gussle — scoring engine.
 *
 * The game: one nine-digit target, shared by everyone, changing daily. You roll
 * the digits one at a time and try to land close to the target. After each roll
 * you either keep it or spend one of three daily re-rolls on that digit.
 *
 * Pure, dependency-free and DOM-free so the exact same code runs in the browser,
 * in the Worker, and in tools/. Any change here invalidates the percentile
 * table: re-run `npm run percentiles` afterwards.
 */

export const ROLL_LENGTH = 9;
export const REROLLS_PER_DAY = 3;

/**
 * Distance is **circular**: digits wrap, so 9 and 0 are neighbours and every
 * distance is 0-5.
 *
 * This is not a stylistic choice. Under plain |a-b| the expected distance
 * depends on the target digit — 4.5 for a 0 or 9, but 2.5 for a 4 or 5 — so a
 * day whose target was 000000000 would be almost twice as hard as one of
 * 555555555. Since everybody plays the same target, that would make days
 * incomparable. Wrapping makes every target digit identical: expected distance
 * 2.5, worst case 5, always.
 */
export function distance(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 10 - d);
}

/** Points for a single digit, indexed by distance. */
export const DIGIT_POINTS = [1000, 400, 150, 50, 15, 0];

/** Points for each re-roll you finish the day without spending. */
export const UNUSED_REROLL_BONUS = 250;

/**
 * Bullseye combo bonus, indexed by how many digits landed exactly on target.
 * Scales far faster than the count itself: nine bullseyes is a 1-in-10^9 day
 * and should read like one.
 */
export const BULLSEYE_BONUS = [0, 0, 300, 900, 2500, 7000, 20000, 60000, 200000, 1000000];

/** Distance probabilities per digit, used by the strategy solver and tools. */
export const DISTANCE_WEIGHTS = (() => {
  const counts = new Array(6).fill(0);
  for (let roll = 0; roll < 10; roll++) counts[distance(0, roll)]++;
  return counts.map((c) => c / 10); // [0.1, 0.2, 0.2, 0.2, 0.2, 0.1]
})();

/* ------------------------------------------------------------------ *
 * Pattern helpers over the *distances*, which is what the game is about
 * ------------------------------------------------------------------ */

/** Longest run of consecutive bullseyes. */
function longestBullseyeRun(distances) {
  let best = 0;
  let run = 0;
  for (const d of distances) {
    run = d === 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

/**
 * @param {number[]} target     the day's nine digits
 * @param {number[]} rolled     what the player ended up with, same length
 * @param {object}   [options]
 * @param {number}   [options.rerollsLeft]  unspent re-rolls
 * @returns a breakdown the UI can render directly
 */
export function scoreRound(target, rolled, { rerollsLeft = 0 } = {}) {
  const distances = rolled.map((d, i) => distance(target[i], d));
  const factors = [];
  const add = (id, name, detail, points) => {
    if (points > 0) factors.push({ id, name, detail, points: Math.round(points) });
  };

  /* --- Per-digit accuracy: the bulk of every score ------------------ */
  const accuracy = distances.reduce((sum, d) => sum + DIGIT_POINTS[d], 0);
  const bullseyes = distances.filter((d) => d === 0).length;
  const totalDistance = distances.reduce((a, b) => a + b, 0);

  add(
    'accuracy',
    'Accuracy',
    `${bullseyes} bullseye${bullseyes === 1 ? '' : 's'} · total distance ${totalDistance}`,
    accuracy,
  );

  /* --- Bullseye combo ----------------------------------------------- */
  if (BULLSEYE_BONUS[bullseyes] > 0) {
    const names = {
      2: 'Double Bullseye',
      3: 'Triple Bullseye',
      4: 'Quad Bullseye',
      5: 'Five On The Nose',
      6: 'Six On The Nose',
      7: 'Seven On The Nose',
      8: 'Eight On The Nose',
      9: 'PERFECT DAY',
    };
    add('combo', names[bullseyes], `${bullseyes} exact matches`, BULLSEYE_BONUS[bullseyes]);
  }

  /* --- Consecutive bullseyes ---------------------------------------- */
  const streak = longestBullseyeRun(distances);
  if (streak >= 2) {
    add('run', 'Bullseye Run', `${streak} in a row`, 200 * Math.pow(3, streak - 2));
  }

  /* --- Tight overall play -------------------------------------------- */
  if (totalDistance <= 12) {
    // 12 is roughly half the expected total of 22.5, so this is a real result
    // rather than a participation award.
    add('tight', 'Tight Grouping', `total distance ${totalDistance}`, 150 * Math.pow(1.6, 12 - totalDistance));
  }

  /* --- No digit worse than ------------------------------------------- */
  const worst = Math.max(...distances);
  if (worst <= 2) add('consistent', 'No Bad Digits', `worst was ${worst}`, 1200 * Math.pow(3, 2 - worst));

  /* --- Restraint ------------------------------------------------------ */
  if (rerollsLeft > 0) {
    add(
      'restraint',
      'Re-rolls Unspent',
      `${rerollsLeft} left over`,
      rerollsLeft * UNUSED_REROLL_BONUS,
    );
  }

  /* --- The joke ending ------------------------------------------------ */
  if (distances.every((d) => d === 5)) {
    add('antipode', 'PERFECTLY WRONG', 'every digit as far away as possible', 1000000);
  }

  const total = factors.reduce((sum, f) => sum + f.points, 0);

  return {
    target,
    rolled,
    distances,
    display: rolled.join(''),
    targetDisplay: target.join(''),
    bullseyes,
    totalDistance,
    worst,
    rerollsLeft,
    factors,
    total,
  };
}

/** The best score physically reachable, for progress bars and copy. */
export const MAX_SCORE =
  ROLL_LENGTH * DIGIT_POINTS[0] +
  BULLSEYE_BONUS[ROLL_LENGTH] +
  200 * Math.pow(3, ROLL_LENGTH - 2) +
  150 * Math.pow(1.6, 12) +
  1200 * Math.pow(3, 2) +
  REROLLS_PER_DAY * UNUSED_REROLL_BONUS;

/* ------------------------------------------------------------------ *
 * Rolling
 * ------------------------------------------------------------------ */

export function rollDigit(rand) {
  return Math.floor(rand() * 10);
}
