/**
 * The daily target.
 *
 * One nine-digit number per UTC day, the same for every player. Unlike the
 * rolls, the target is *meant* to be public — you are shown it before you play,
 * so there is nothing to hide and the derivation can live in the client.
 */

import { ROLL_LENGTH } from './scoring.js';

/** UTC so the whole world plays the same day. */
export function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function msUntilNextDaily(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
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

/** The nine digits everyone is aiming at on a given day. */
export function dailyTarget(day = dateKey()) {
  const seed = xmur3(`gussle::target::${day}`);
  seed(); // xmur3's first output correlates with input length; discard it
  const rand = mulberry32(seed());
  return Array.from({ length: ROLL_LENGTH }, () => Math.floor(rand() * 10));
}

/** Puzzle number, counting from launch, for share text. */
const EPOCH = Date.UTC(2026, 0, 1);
export function puzzleNumber(day = dateKey()) {
  return Math.floor((Date.parse(`${day}T00:00:00Z`) - EPOCH) / 86400000) + 1;
}

/* --- Stable per-browser identity for guests ------------------------ */

const GUEST_KEY = 'gussle_guest_id';

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
