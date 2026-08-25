/**
 * Leaderboard with two interchangeable backends:
 *
 *   LocalBoard   — localStorage, always available, per-device.
 *   RemoteBoard  — a shared HTTP endpoint (see worker/), gated on sign-in.
 *
 * Both expose the same { list, submit } interface so the UI doesn't care which
 * one is active, and both support two scopes: the all-time board and the
 * current day's Daily Challenge board.
 */

import { resolved } from './config.js';
import {
  currentSession,
  currentUser,
  playerKey,
  hasFreshToken,
  refreshToken,
  recoverFromUnauthorized,
} from './auth.js';
import { dateKey, guestId } from './daily.js';

const LOCAL_KEY = 'gussle_best';
const LOCAL_DAILY_KEY = 'gussle_today';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode — the board simply isn't persisted */
  }
}

/* ------------------------------------------------------------------ *
 * Local
 * ------------------------------------------------------------------ */

const LocalBoard = {
  shared: false,

  async list(limit, scope) {
    if (scope === 'daily') {
      const store = read(LOCAL_DAILY_KEY, { day: null, entries: [] });
      const entries = store.day === dateKey() ? store.entries : [];
      return entries.slice().sort((a, b) => b.score - a.score).slice(0, limit);
    }
    return read(LOCAL_KEY, [])
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  },

  /**
   * Today's board holds one row per player; the all-time board holds each
   * player's single best day.
   */
  async submit(entry) {
    const store = read(LOCAL_DAILY_KEY, { day: null, entries: [] });
    const today = store.day === entry.day ? store.entries : [];
    const at = today.findIndex((e) => e.playerId === entry.playerId);
    if (at === -1) today.push(entry);
    else today[at] = entry;
    write(LOCAL_DAILY_KEY, { day: entry.day, entries: today });

    const best = read(LOCAL_KEY, []);
    const existing = best.findIndex((e) => e.playerId === entry.playerId);
    if (existing === -1) best.push(entry);
    else if (best[existing].score < entry.score) best[existing] = entry;
    else return { improved: false };
    write(LOCAL_KEY, best);
    return { improved: true };
  },
};

/**
 * Re-labels a guest's local rows under their account identity, so signing in
 * doesn't look like it wiped your board. Merges into an existing row if the
 * player already has one, keeping whichever score is higher.
 */
export function migrateGuestScores(session) {
  if (!session) return 0;
  const guest = guestId();
  const accountId = playerKey(session);
  const identity = {
    playerId: accountId,
    name: session.user.name,
    avatar: session.user.avatar,
  };

  let moved = 0;
  const entries = read(LOCAL_KEY, []);
  const mine = entries.filter((e) => e.playerId === 'guest' || e.playerId === guest);
  if (!mine.length) return 0;

  const best = mine.reduce((a, b) => (a.score >= b.score ? a : b));
  const rest = entries.filter((e) => e.playerId !== 'guest' && e.playerId !== guest);
  const existing = rest.find((e) => e.playerId === accountId);

  if (existing) {
    if (best.score > existing.score) Object.assign(existing, best, identity);
  } else {
    rest.push({ ...best, ...identity });
  }
  moved = mine.length;
  write(LOCAL_KEY, rest);
  return moved;
}

/* ------------------------------------------------------------------ *
 * Remote
 * ------------------------------------------------------------------ */

function remoteBoard(endpoint) {
  const base = endpoint.replace(/\/$/, '');

  async function post(path, body, retrying = false) {
    const session = currentSession();
    if (!session) return { improved: false, reason: 'not-signed-in' };

    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(body),
    });

    // The implicit-grant token can expire mid-session; try a silent renewal
    // once before giving up.
    if (res.status === 401 && !retrying) {
      if (await recoverFromUnauthorized()) return post(path, body, true);
      return { improved: false, reason: 'not-signed-in' };
    }
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error || `Score rejected (${res.status})`);
    }
    return res.json();
  }

  return {
    shared: true,

    async list(limit, scope) {
      const params = new URLSearchParams({ limit: String(limit), scope });
      if (scope === 'daily') params.set('day', dateKey());
      const res = await fetch(`${base}/leaderboard?${params}`);
      if (!res.ok) throw new Error(`Leaderboard unavailable (${res.status})`);
      const data = await res.json();
      return data.entries || [];
    },

    async submit(entry) {
      // The stored identity outlives the token (Google ID tokens last about an
      // hour), so top it up before posting rather than eating a 401 first.
      if (currentSession() && !hasFreshToken()) await refreshToken();
      return post('/scores', {
        day: entry.day,
        digits: entry.digits,
        rerollsLeft: entry.rerollsLeft,
      });
    },
  };
}

/* ------------------------------------------------------------------ *
 * Facade
 * ------------------------------------------------------------------ */

export function activeBoard() {
  const { leaderboardEndpoint } = resolved();
  return leaderboardEndpoint ? remoteBoard(leaderboardEndpoint) : LocalBoard;
}

export function isShared() {
  return activeBoard().shared;
}

/** Builds the row we send/store for a finished day. */
export function entryFor(result, percentile, rank) {
  const user = currentUser();
  return {
    playerId: playerKey() || guestId(),
    name: user ? user.name : 'Guest',
    avatar: user ? user.avatar : null,
    score: result.total,
    day: dateKey(),
    digits: result.display,
    target: result.targetDisplay,
    bullseyes: result.bullseyes,
    totalDistance: result.totalDistance,
    rerollsLeft: result.rerollsLeft,
    rank: rank.label,
    percentile,
    at: Date.now(),
  };
}

export async function listTop(scope = 'daily') {
  return activeBoard().list(resolved().leaderboardLimit, scope);
}

export async function submitScore(entry, scope = 'daily') {
  return activeBoard().submit(entry, { scope });
}
