/**
 * Daily Challenge.
 *
 * One roll per player per UTC day, derived deterministically from
 * (date, playerId). Two things fall out of that:
 *
 *   1. You cannot reroll it. Refreshing, clearing storage or opening another
 *      browser all reproduce the same nine digits.
 *   2. It is the one mode a server can *fully* verify. The Worker recomputes
 *      the digits from the authenticated user's ID and the date, so a daily
 *      submission cannot claim a roll the player didn't get — unlike the
 *      endless mode, where the roll genuinely happens client-side.
 *
 * The derivation is public, so a player can compute future days in advance.
 * That is harmless: knowing tomorrow's roll doesn't let you change it.
 *
 * Shared verbatim by the browser and the Worker — keep it dependency-free.
 */

import { rollDigits, rollCosmic } from './scoring.js';

/** UTC so the whole world plays the same day. */
export function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function msUntilNextDaily(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

/* --- Deterministic PRNG (xmur3 seed -> mulberry32 stream) ----------- */

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The roll for a given player on a given day.
 * @returns {{ digits: number[], cosmic: object }}
 */
export function dailyRoll(day, playerId) {
  const seed = xmur3(`rngdle-daily::${day}::${playerId}`);
  // Discard the first value: xmur3's initial output correlates with input
  // length, which would bias the leading digit across short/long player IDs.
  seed();
  const rand = mulberry32(seed());
  return { digits: rollDigits(rand), cosmic: rollCosmic(rand) };
}

/** Stable per-browser identity so guests get a consistent daily too. */
const GUEST_KEY = 'rngdle_guest_id';

export function guestId() {
  try {
    let id = localStorage.getItem(GUEST_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(GUEST_KEY, id);
    }
    return id;
  } catch {
    return 'guest';
  }
}

/* --- Local record of today's attempt -------------------------------- */

const PLAYED_KEY = 'rngdle_daily_played';

export function readPlayed() {
  try {
    return JSON.parse(localStorage.getItem(PLAYED_KEY) || '{}');
  } catch {
    return {};
  }
}

export function playedToday(playerId, day = dateKey()) {
  const played = readPlayed();
  const record = played[`${day}::${playerId}`];
  return record || null;
}

export function markPlayed(playerId, entry, day = dateKey()) {
  const played = readPlayed();
  played[`${day}::${playerId}`] = entry;

  // Keep the store from growing without bound.
  const keys = Object.keys(played);
  if (keys.length > 30) {
    for (const key of keys.sort().slice(0, keys.length - 30)) delete played[key];
  }
  try {
    localStorage.setItem(PLAYED_KEY, JSON.stringify(played));
  } catch {
    /* ignore */
  }
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
