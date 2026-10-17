/**
 * The trophy: score more than 7,500 in a day and win one — a real one, claimed
 * by posting a screenshot of the winner screen in #guessle.
 *
 * 7,500 is about a 1-in-38 day even for a solver that never misjudges a
 * re-roll, so a trophy means something. The odds below are read from the same
 * percentile table the ranks use, so the copy can't drift from the maths.
 */

import { STORES, read, write, mergeTrophies } from './profile.js';
import { percentileOf } from './ranks.js';

export const TROPHY_SCORE = 7500;

/** "More than 7,500" — exactly 7,500 doesn't count. */
export const earns = (score) => Number(score) > TROPHY_SCORE;

/** How many days, on average, it takes to win one: "1 in N". */
export function oneIn() {
  const p = 1 - percentileOf(TROPHY_SCORE + 1);
  return p > 0 ? Math.round(1 / p) : Infinity;
}

export function list() {
  return read(STORES.trophies, []);
}

/**
 * Records a winning day. Idempotent per day: replaying the award (a reload, a
 * restored save) keeps the better score rather than adding a second trophy.
 *
 * The digits and re-rolls are kept because the trophy is a real one, claimed
 * by screenshot: with the puzzle number they're everything needed to re-score
 * a claim, so an edited number in a screenshot doesn't hold up.
 *
 * @returns {{trophy: object, number: number, isNew: boolean}}
 */
export function award({ day, score, rank, digits, rerollsLeft }) {
  const before = list();
  const isNew = !before.some((t) => t.day === day);
  const next = mergeTrophies(before, [{ day, score, rank, digits, rerollsLeft, at: Date.now() }]);
  write(STORES.trophies, next);
  const number = next.findIndex((t) => t.day === day) + 1;
  return { trophy: next[number - 1], number, isNew };
}

/**
 * Trophies for winning days that happened before trophies existed. Any day in
 * history over the line earned one — it would be odd to tell someone with an
 * 8,000 already on the board that they've never won.
 */
export function backfill(history) {
  const earned = (history || [])
    .filter((h) => earns(h.score))
    .map((h) => ({
      day: h.day,
      score: h.score,
      rank: h.rank,
      digits: h.digits,
      rerollsLeft: h.rerollsLeft,
      at: h.at,
    }));
  if (!earned.length) return 0;
  const before = list();
  const next = mergeTrophies(before, earned);
  if (next.length !== before.length) write(STORES.trophies, next);
  return next.length - before.length;
}
