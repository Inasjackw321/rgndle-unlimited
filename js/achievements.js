/**
 * Achievements. Purely client-side and purely cosmetic — they exist to give
 * you something to chase besides the day's rank.
 *
 * Each definition gets a context describing the day that just finished plus
 * running totals, and returns true to unlock.
 */

import { STORES, read, write } from './profile.js';
import { REROLLS_PER_DAY } from './scoring.js';

const has = (ctx, name) => ctx.result.factors.some((f) => f.name === name);
const spent = (ctx) => REROLLS_PER_DAY - ctx.result.rerollsLeft;

export const ACHIEVEMENTS = [
  /* --- Getting started ------------------------------------------- */
  { id: 'first-day', icon: '🎯', name: 'First Contact', desc: 'Play your first day', test: (c) => c.totals.days >= 1 },
  { id: 'days-7', icon: '📅', name: 'A Week In', desc: 'Play 7 days', test: (c) => c.totals.days >= 7 },
  { id: 'days-30', icon: '🗓️', name: 'A Month In', desc: 'Play 30 days', test: (c) => c.totals.days >= 30 },
  { id: 'days-100', icon: '💯', name: 'Centurion', desc: 'Play 100 days', test: (c) => c.totals.days >= 100 },

  /* --- Streaks ---------------------------------------------------- */
  { id: 'streak-3', icon: '🔥', name: 'Warming Up', desc: 'Play 3 days in a row', test: (c) => c.totals.streak >= 3 },
  { id: 'streak-7', icon: '🌋', name: 'Seven Straight', desc: 'Play 7 days in a row', test: (c) => c.totals.streak >= 7 },
  { id: 'streak-30', icon: '👑', name: 'Unbroken', desc: 'Play 30 days in a row', test: (c) => c.totals.streak >= 30 },

  /* --- Ranks ------------------------------------------------------ */
  { id: 'rank-c', icon: '🟩', name: 'Passable', desc: 'Reach rank C', test: (c) => c.rankIndex >= 3 },
  { id: 'rank-b', icon: '🔷', name: 'Respectable', desc: 'Reach rank B', test: (c) => c.rankIndex >= 4 },
  { id: 'rank-a', icon: '🟣', name: 'Excellent', desc: 'Reach rank A', test: (c) => c.rankIndex >= 5 },
  { id: 'rank-aplus', icon: '🔮', name: 'Exceptional', desc: 'Reach rank A+', test: (c) => c.rankIndex >= 6 },
  { id: 'rank-s', icon: '⭐', name: 'Extraordinary', desc: 'Reach rank S', test: (c) => c.rankIndex >= 7 },
  { id: 'rank-splus', icon: '🌠', name: 'Phenomenal', desc: 'Reach rank S+', test: (c) => c.rankIndex >= 8 },
  { id: 'rank-ss', icon: '🌟', name: 'Legendary', desc: 'Reach rank SS', test: (c) => c.rankIndex >= 9 },
  { id: 'rank-sss', icon: '✨', name: 'Mythic', desc: 'Reach rank SSS', test: (c) => c.rankIndex >= 10 },
  { id: 'rank-ultra', icon: '💠', name: 'Beyond Reason', desc: 'Reach rank ULTRA', test: (c) => c.rankIndex >= 11 },
  { id: 'rank-cosmic', icon: '🪐', name: 'Cosmic Anomaly', desc: 'Reach rank COSMIC', test: (c) => c.rankIndex >= 12 },
  { id: 'rank-eternal', icon: '♾️', name: 'Eternal', desc: 'Reach rank ETERNAL', secret: true, test: (c) => c.rankIndex >= 13 },
  { id: 'rank-omega', icon: '🕳️', name: 'Reality Error', desc: 'Reach rank Ω', secret: true, test: (c) => c.rankIndex >= 14 },

  /* --- Bullseyes --------------------------------------------------- */
  { id: 'bull-1', icon: '◎', name: 'On The Nose', desc: 'Land one digit exactly', test: (c) => c.result.bullseyes >= 1 },
  { id: 'bull-2', icon: '🎯', name: 'Double Bullseye', desc: 'Land two digits exactly', test: (c) => c.result.bullseyes >= 2 },
  { id: 'bull-3', icon: '🏹', name: 'Triple Bullseye', desc: 'Land three digits exactly', test: (c) => c.result.bullseyes >= 3 },
  { id: 'bull-4', icon: '🎖️', name: 'Quad Bullseye', desc: 'Land four digits exactly', test: (c) => c.result.bullseyes >= 4 },
  { id: 'bull-5', icon: '🏆', name: 'Five On The Nose', desc: 'Land five digits exactly', secret: true, test: (c) => c.result.bullseyes >= 5 },
  { id: 'bull-7', icon: '👁️', name: 'Seeing The Future', desc: 'Land seven digits exactly', secret: true, test: (c) => c.result.bullseyes >= 7 },
  { id: 'bull-9', icon: '🌌', name: 'PERFECT DAY', desc: 'Land all nine digits exactly', secret: true, test: (c) => c.result.bullseyes >= 9 },
  { id: 'run-2', icon: '🔗', name: 'Back To Back', desc: 'Two bullseyes in a row', test: (c) => has(c, 'Bullseye Run') },

  /* --- Accuracy ----------------------------------------------------- */
  { id: 'tight', icon: '📏', name: 'Tight Grouping', desc: 'Finish with a total distance of 12 or less', test: (c) => c.result.totalDistance <= 12 },
  { id: 'tight-8', icon: '🪡', name: 'Threading It', desc: 'Finish with a total distance of 8 or less', test: (c) => c.result.totalDistance <= 8 },
  { id: 'tight-4', icon: '💎', name: 'Surgical', desc: 'Finish with a total distance of 4 or less', secret: true, test: (c) => c.result.totalDistance <= 4 },
  { id: 'consistent', icon: '🧱', name: 'No Bad Digits', desc: 'Finish with no digit further than 2 away', test: (c) => has(c, 'No Bad Digits') },
  { id: 'nomiss', icon: '🛡️', name: 'Nothing Wild', desc: 'Finish with no digit further than 1 away', secret: true, test: (c) => c.result.worst <= 1 },

  /* --- Re-roll discipline -------------------------------------------- */
  { id: 'thrifty', icon: '🪙', name: 'Thrifty', desc: 'Finish a day without spending a re-roll', test: (c) => spent(c) === 0 },
  { id: 'allin', icon: '🎰', name: 'All In', desc: 'Spend all three re-rolls in one day', test: (c) => spent(c) === REROLLS_PER_DAY },
  {
    id: 'thrifty-good',
    icon: '🧘',
    name: 'Calm Hands',
    desc: 'Reach rank A or better without spending a re-roll',
    test: (c) => spent(c) === 0 && c.rankIndex >= 5,
  },
  {
    id: 'clutch',
    icon: '🫰',
    name: 'Clutch',
    desc: 'Spend all three re-rolls and still reach rank A',
    test: (c) => spent(c) === REROLLS_PER_DAY && c.rankIndex >= 5,
  },

  /* --- The other end -------------------------------------------------- */
  {
    id: 'rough',
    icon: '🫠',
    name: 'Rough Day',
    desc: 'Finish with a total distance of 33 or more',
    test: (c) => c.result.totalDistance >= 33,
  },
  {
    id: 'antipode',
    icon: '🙃',
    name: 'PERFECTLY WRONG',
    desc: 'Land every single digit as far from the target as possible',
    secret: true,
    test: (c) => has(c, 'PERFECTLY WRONG'),
  },
  {
    id: 'zero-bulls',
    icon: '🌵',
    name: 'Dry Spell',
    desc: 'Finish a day without a single bullseye',
    test: (c) => c.result.bullseyes === 0,
  },
];

/* ------------------------------------------------------------------ */

export function loadUnlocked(playerId) {
  return read(STORES.achievements, playerId, {});
}

/**
 * Evaluates every achievement against a finished day.
 * @returns {Array} the definitions unlocked by *this* day
 */
export function evaluate(ctx) {
  const unlocked = loadUnlocked(ctx.playerId);
  const fresh = [];

  for (const achievement of ACHIEVEMENTS) {
    if (unlocked[achievement.id]) continue;
    let passed = false;
    try {
      passed = achievement.test(ctx);
    } catch {
      passed = false; // a broken predicate must never break the game loop
    }
    if (passed) {
      unlocked[achievement.id] = Date.now();
      fresh.push(achievement);
    }
  }

  if (fresh.length) write(STORES.achievements, ctx.playerId, unlocked);
  return fresh;
}

export function progress(playerId) {
  const unlocked = loadUnlocked(playerId);
  return { unlocked, count: Object.keys(unlocked).length, total: ACHIEVEMENTS.length };
}
