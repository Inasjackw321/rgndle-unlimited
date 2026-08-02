/**
 * Achievements. Purely client-side and purely cosmetic — they exist to give
 * the endless mode something to chase besides the leaderboard.
 *
 * Each definition gets a context object describing the roll that just happened
 * plus running totals, and returns true to unlock.
 */

import { STORES, read, write } from './profile.js';

const has = (ctx, name) => ctx.result.factors.some((f) => f.name === name);
const factor = (ctx, name) => ctx.result.factors.find((f) => f.name === name);

export const ACHIEVEMENTS = [
  /* --- Getting started ------------------------------------------- */
  { id: 'first-roll', icon: '🎲', name: 'First Contact', desc: 'Roll for the first time', test: (c) => c.totals.rolls >= 1 },
  { id: 'rolls-25', icon: '🔁', name: 'Warmed Up', desc: 'Roll 25 times', test: (c) => c.totals.rolls >= 25 },
  { id: 'rolls-100', icon: '💯', name: 'Committed', desc: 'Roll 100 times', test: (c) => c.totals.rolls >= 100 },
  { id: 'rolls-1000', icon: '🗿', name: 'Ask For Help', desc: 'Roll 1,000 times', test: (c) => c.totals.rolls >= 1000 },

  /* --- Ranks ------------------------------------------------------ */
  { id: 'rank-b', icon: '🔷', name: 'Respectable', desc: 'Reach rank B', test: (c) => c.rankIndex >= 3 },
  { id: 'rank-a', icon: '🟣', name: 'Excellent', desc: 'Reach rank A', test: (c) => c.rankIndex >= 4 },
  { id: 'rank-s', icon: '⭐', name: 'Extraordinary', desc: 'Reach rank S', test: (c) => c.rankIndex >= 5 },
  { id: 'rank-ss', icon: '🌟', name: 'Legendary', desc: 'Reach rank SS', test: (c) => c.rankIndex >= 6 },
  { id: 'rank-sss', icon: '✨', name: 'Mythic', desc: 'Reach rank SSS', test: (c) => c.rankIndex >= 7 },
  { id: 'rank-ultra', icon: '💠', name: 'Beyond Reason', desc: 'Reach rank ULTRA', test: (c) => c.rankIndex >= 8 },
  { id: 'rank-omega', icon: '🕳️', name: 'Reality Error', desc: 'Reach rank Ω', test: (c) => c.rankIndex >= 9 },

  /* --- Score milestones -------------------------------------------- */
  { id: 'score-10k', icon: '📈', name: 'Five Figures', desc: 'Score 10,000 in one roll', test: (c) => c.result.total >= 10000 },
  { id: 'score-100k', icon: '🚀', name: 'Six Figures', desc: 'Score 100,000 in one roll', test: (c) => c.result.total >= 100000 },
  { id: 'score-1m', icon: '🌌', name: 'Seven Figures', desc: 'Score 1,000,000 in one roll', test: (c) => c.result.total >= 1000000 },

  /* --- Patterns ---------------------------------------------------- */
  { id: 'pair', icon: '👯', name: 'Two of a Kind', desc: 'Roll a pair', test: (c) => has(c, 'Pair') },
  { id: 'triple', icon: '🎰', name: 'Three of a Kind', desc: 'Roll three identical digits in a row', test: (c) => has(c, 'Triple') },
  { id: 'quad', icon: '🧱', name: 'Four of a Kind', desc: 'Roll four identical digits in a row', test: (c) => has(c, 'Quad') },
  { id: 'quint', icon: '🏛️', name: 'Five of a Kind', desc: 'Roll five identical digits in a row', test: (c) => has(c, 'Quint') },
  {
    id: 'palindrome',
    icon: '🪞',
    name: 'Same Both Ways',
    desc: 'Roll a nine-digit palindrome',
    test: (c) => has(c, 'PERFECT PALINDROME'),
  },
  {
    id: 'straight',
    icon: '🪜',
    name: 'Staircase',
    desc: 'Roll five or more consecutive digits',
    test: (c) => {
      const f = factor(c, 'Ascending Straight') || factor(c, 'Descending Straight');
      return Boolean(f) && Number(f.detail.match(/\d+/)?.[0] || 0) >= 5;
    },
  },
  { id: 'prime', icon: '🔱', name: 'Indivisible', desc: 'Roll a prime number', test: (c) => has(c, 'Prime') },
  { id: 'square', icon: '⬜', name: 'Perfectly Square', desc: 'Roll a perfect square', test: (c) => has(c, 'Perfect Square') },
  {
    id: 'pandigital',
    icon: '🌈',
    name: 'All Different',
    desc: 'Roll nine distinct digits',
    test: (c) => has(c, 'Near-Pandigital'),
  },
  { id: 'round', icon: '⭕', name: 'Nice And Round', desc: 'Roll three or more trailing zeros', test: (c) => has(c, 'Round Number') },
  { id: 'alternating', icon: '🦓', name: 'Zebra', desc: 'Roll a perfect ABABABABA pattern', test: (c) => has(c, 'PERFECT ALTERNATION') },

  /* --- Culture ----------------------------------------------------- */
  { id: 'nice', icon: '😎', name: 'Nice', desc: 'Roll a 69', test: (c) => has(c, 'Nice') },
  { id: 'blaze', icon: '🌿', name: 'Blaze It', desc: 'Roll a 420', test: (c) => has(c, 'Blaze It') },
  { id: 'leet', icon: '🕶️', name: 'Elite', desc: 'Roll a 1337', test: (c) => has(c, 'Leetspeak') },
  { id: 'sacred', icon: '🛐', name: 'The Sacred Number', desc: 'Roll 42069', secret: true, test: (c) => has(c, 'The Sacred Number') },
  { id: 'beast', icon: '😈', name: 'Number of the Beast', desc: 'Roll a 666', test: (c) => has(c, 'Number of the Beast') },
  { id: 'pi', icon: '🥧', name: 'Irrational', desc: 'Roll the first digits of π', secret: true, test: (c) => has(c, 'Slice of π') },

  /* --- Multipliers and streaks -------------------------------------- */
  { id: 'cosmic-5', icon: '🔮', name: 'Divine Favour', desc: 'Land a ×5 cosmic multiplier', test: (c) => c.result.cosmic.value >= 5 },
  { id: 'cosmic-10', icon: '☄️', name: 'Transcendent', desc: 'Land a ×10 cosmic multiplier', test: (c) => c.result.cosmic.value >= 10 },
  { id: 'cosmic-25', icon: '💥', name: 'Reality Broken', desc: 'Land a ×25 cosmic multiplier', secret: true, test: (c) => c.result.cosmic.value >= 25 },
  { id: 'streak-5', icon: '🔥', name: 'On A Roll', desc: 'Beat your previous score five times running', test: (c) => c.totals.streak >= 5 },
  { id: 'streak-8', icon: '🌋', name: 'Unstoppable', desc: 'Beat your previous score eight times running', test: (c) => c.totals.streak >= 8 },

  /* --- Daily -------------------------------------------------------- */
  { id: 'daily-first', icon: '📅', name: 'Daily Habit', desc: 'Play a Daily Challenge', test: (c) => c.mode === 'daily' },
  { id: 'daily-7', icon: '🗓️', name: 'Seven Days', desc: 'Play the Daily seven days in a row', test: (c) => c.totals.dailyStreak >= 7 },
  { id: 'daily-30', icon: '👑', name: 'A Whole Month', desc: 'Play the Daily thirty days in a row', test: (c) => c.totals.dailyStreak >= 30 },

  /* --- Odds and ends ------------------------------------------------ */
  {
    id: 'the-void',
    icon: '🌑',
    name: 'The Void',
    desc: 'Roll nine identical digits',
    secret: true,
    test: (c) => has(c, 'MONOLITH'),
  },
  {
    id: 'witching',
    icon: '🕐',
    name: 'Right On Time',
    desc: 'Roll during a mirror hour',
    test: (c) => c.result.multipliers.some((m) => m.id === 'time'),
  },
];

/* ------------------------------------------------------------------ */

export function loadUnlocked(playerId) {
  return read(STORES.achievements, playerId, {});
}

/**
 * Evaluates every achievement against a completed roll.
 * @returns {Array} the definitions unlocked by *this* roll
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
