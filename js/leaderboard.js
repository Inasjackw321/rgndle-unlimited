/**
 * Leaderboard with two interchangeable backends:
 *
 *   LocalBoard   — localStorage, always available, per-device.
 *   RemoteBoard  — a shared HTTP endpoint (see worker/), gated on Discord auth.
 *
 * Both expose the same { list, submit } interface so the UI doesn't care which
 * one is active, and both support two scopes: the all-time board and the
 * current day's Daily Challenge board.
 */

import { resolved } from './config.js';
import { currentSession, avatarUrl, displayName, recoverFromUnauthorized } from './discord.js';
import { dateKey, guestId } from './daily.js';

const LOCAL_KEY = 'rngdle_leaderboard';
const LOCAL_DAILY_KEY = 'rngdle_leaderboard_daily';

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
    const entries =
      scope === 'daily' ? (read(LOCAL_DAILY_KEY, { day: null, entries: [] }).day === dateKey()
        ? read(LOCAL_DAILY_KEY, { entries: [] }).entries
        : []) : read(LOCAL_KEY, []);
    return entries.slice().sort((a, b) => b.score - a.score).slice(0, limit);
  },

  /** Keeps one row per player: their personal best. */
  async submit(entry, { scope }) {
    if (scope === 'daily') {
      const store = read(LOCAL_DAILY_KEY, { day: null, entries: [] });
      const entries = store.day === entry.day ? store.entries : [];
      if (entries.some((e) => e.playerId === entry.playerId)) return { improved: false };
      entries.push(entry);
      write(LOCAL_DAILY_KEY, { day: entry.day, entries });
      return { improved: true };
    }

    const entries = read(LOCAL_KEY, []);
    const at = entries.findIndex((e) => e.playerId === entry.playerId);
    if (at === -1) entries.push(entry);
    else if (entries[at].score < entry.score) entries[at] = entry;
    else return { improved: false };
    write(LOCAL_KEY, entries);
    return { improved: true };
  },
};

/**
 * Re-labels a guest's local rows under their Discord identity, so signing in
 * doesn't look like it wiped your board. Merges into an existing row if the
 * player already has one, keeping whichever score is higher.
 */
export function migrateGuestScores(user) {
  if (!user) return 0;
  const guest = guestId();
  const identity = {
    playerId: user.id,
    name: displayName(user),
    avatar: avatarUrl(user, 64),
  };

  let moved = 0;
  const entries = read(LOCAL_KEY, []);
  const mine = entries.filter((e) => e.playerId === 'guest' || e.playerId === guest);
  if (!mine.length) return 0;

  const best = mine.reduce((a, b) => (a.score >= b.score ? a : b));
  const rest = entries.filter((e) => e.playerId !== 'guest' && e.playerId !== guest);
  const existing = rest.find((e) => e.playerId === user.id);

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

    async submit(entry, { scope }) {
      return post('/scores', {
        mode: scope === 'daily' ? 'daily' : 'endless',
        day: entry.day,
        digits: entry.digits,
        cosmic: entry.cosmic,
        multipliers: entry.multipliers,
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

/** Builds the row we send/store for a completed roll. */
export function entryFor(result, percentile, rank, { mode = 'endless' } = {}) {
  const user = currentSession()?.user;
  return {
    playerId: user ? user.id : guestId(),
    name: user ? displayName(user) : 'Guest',
    avatar: user ? avatarUrl(user, 64) : null,
    score: result.total,
    digits: result.display,
    cosmic: result.cosmic?.value ?? 1,
    multipliers: result.multiplier,
    rank: rank.label,
    percentile,
    mode,
    day: mode === 'daily' ? dateKey() : undefined,
    at: Date.now(),
  };
}

export async function listTop(scope = 'all') {
  return activeBoard().list(resolved().leaderboardLimit, scope);
}

export async function submitScore(entry, scope = 'all') {
  return activeBoard().submit(entry, { scope });
}
