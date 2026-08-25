/**
 * One day's game, and the rules that govern it.
 *
 * Phases, in order, for each of the nine digits:
 *
 *   ready     — digit i has not been rolled yet
 *   deciding  — digit i has landed; keep it, or spend a re-roll on it
 *   done      — all nine settled
 *
 * Every transition is written to storage immediately. That matters most in
 * `deciding`: if the pending roll were only kept in memory, reloading the page
 * after a bad digit would hand out a free re-roll, which is exactly the thing
 * the three-per-day budget exists to prevent.
 */

import { ROLL_LENGTH, REROLLS_PER_DAY, distance, scoreRound } from './scoring.js';
import { dateKey, dailyTarget } from './daily.js';
import { STORES, read, write } from './profile.js';

/**
 * The target lives in the state rather than being re-derived from the date, so
 * a practice run can carry its own. Run 1 of a day is always the real daily
 * target; later runs (test mode only) get fresh random ones.
 */
function freshState(day, target, run = 1) {
  return {
    day,
    target,
    run,
    phase: 'ready',
    index: 0,
    rolled: [],
    rerollsLeft: REROLLS_PER_DAY,
    rerollsUsed: 0,
    pending: null,
    finishedAt: null,
  };
}

let state = null;
let owner = null;

/** Loads (or starts) today's game for a player. Safe to call repeatedly. */
export function load(playerId, day = dateKey()) {
  owner = playerId;
  const stored = read(STORES.dayState, playerId, null);
  state =
    stored && stored.day === day && Array.isArray(stored.target)
      ? stored
      : freshState(day, dailyTarget(day));
  persist();
  return snapshot();
}

/**
 * Starts another run on a fresh target, keeping the run counter going.
 * Only reachable in test mode; the daily limit is enforced by the caller.
 */
export function newRun(randomTarget) {
  state = freshState(state.day, randomTarget, (state.run || 1) + 1);
  persist();
  return snapshot();
}

function persist() {
  if (owner) write(STORES.dayState, owner, state);
}

/** Everything the UI needs, with nothing it can mutate by accident. */
export function snapshot() {
  const target = state.target;
  const distances = state.rolled.map((d, i) => distance(target[i], d));
  return {
    day: state.day,
    run: state.run || 1,
    phase: state.phase,
    index: state.index,
    target,
    rolled: [...state.rolled],
    distances,
    pending: state.pending,
    rerollsLeft: state.rerollsLeft,
    rerollsUsed: state.rerollsUsed,
    bullseyes: distances.filter((d) => d === 0).length,
    total: distances.reduce((a, b) => a + b, 0),
    worst: distances.length ? Math.max(...distances) : 0,
    digitsLeft: ROLL_LENGTH - state.rolled.length,
    finishedAt: state.finishedAt,
  };
}

export function isFinished() {
  return state?.phase === 'done';
}

/**
 * Records a landed digit.
 *
 * With no re-rolls left there is no decision to offer, so the digit is kept
 * straight away rather than making the player confirm something they cannot
 * change.
 */
export function settle(digit) {
  if (state.phase !== 'ready') return snapshot();
  state.pending = digit;
  state.phase = 'deciding';
  persist();
  if (state.rerollsLeft <= 0) return keep();
  return snapshot();
}

export function keep() {
  if (state.phase !== 'deciding' || state.pending === null) return snapshot();
  state.rolled.push(state.pending);
  state.pending = null;
  state.index = state.rolled.length;

  if (state.rolled.length >= ROLL_LENGTH) {
    state.phase = 'done';
    state.finishedAt = Date.now();
  } else {
    state.phase = 'ready';
  }
  persist();
  return snapshot();
}

export function reroll() {
  if (state.phase !== 'deciding' || state.rerollsLeft <= 0) return snapshot();
  state.rerollsLeft--;
  state.rerollsUsed++;
  state.pending = null;
  state.phase = 'ready';
  persist();
  return snapshot();
}

/** The finished day's scorecard. Null until every digit is settled. */
export function result() {
  if (state?.phase !== 'done') return null;
  return scoreRound(state.target, state.rolled, { rerollsLeft: state.rerollsLeft });
}

/** Distance of the digit currently awaiting a decision. */
export function pendingDistance() {
  if (state?.phase !== 'deciding' || state.pending === null) return null;
  return distance(state.target[state.index], state.pending);
}
