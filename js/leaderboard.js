/**
 * Leaderboard with two interchangeable backends:
 *
 *   LocalBoard   — localStorage, always available, per-device.
 *   RemoteBoard  — a shared HTTP endpoint (see worker/), gated on Discord auth.
 *
 * Both expose the same { list, submit } interface so the UI doesn't care which
 * one is active.
 */

import { resolved } from './config.js';
import { currentSession, avatarUrl, displayName } from './discord.js';

const LOCAL_KEY = 'rngdle_leaderboard';

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLocal(entries) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(entries));
  } catch {
    /* quota or private mode — the board is simply not persisted */
  }
}

const LocalBoard = {
  shared: false,

  async list(limit) {
    return readLocal()
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  },

  /** Keeps one row per player: their personal best. */
  async submit(entry) {
    const entries = readLocal();
    const existing = entries.findIndex((e) => e.playerId === entry.playerId);
    if (existing === -1) entries.push(entry);
    else if (entries[existing].score < entry.score) entries[existing] = entry;
    else return { improved: false };
    writeLocal(entries);
    return { improved: true };
  },
};

function remoteBoard(endpoint) {
  const base = endpoint.replace(/\/$/, '');
  return {
    shared: true,

    async list(limit) {
      const res = await fetch(`${base}/leaderboard?limit=${limit}`);
      if (!res.ok) throw new Error(`Leaderboard unavailable (${res.status})`);
      const data = await res.json();
      return data.entries || [];
    },

    async submit(entry) {
      const session = currentSession();
      if (!session) return { improved: false, reason: 'not-signed-in' };

      const res = await fetch(`${base}/scores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          digits: entry.digits,
          cosmic: entry.cosmic,
          multipliers: entry.multipliers,
        }),
      });
      if (!res.ok) throw new Error(`Score rejected (${res.status})`);
      return res.json();
    },
  };
}

export function activeBoard() {
  const { leaderboardEndpoint } = resolved();
  return leaderboardEndpoint ? remoteBoard(leaderboardEndpoint) : LocalBoard;
}

export function isShared() {
  return activeBoard().shared;
}

/** Builds the row we send/store for a completed roll. */
export function entryFor(result, percentile, rank) {
  const session = currentSession();
  const user = session?.user;
  return {
    playerId: user ? user.id : 'guest',
    name: user ? displayName(user) : 'Guest',
    avatar: user ? avatarUrl(user, 64) : null,
    score: result.total,
    digits: result.display,
    cosmic: result.cosmic?.value ?? 1,
    multipliers: result.multiplier,
    rank: rank.label,
    percentile,
    at: Date.now(),
  };
}

export async function listTop() {
  return activeBoard().list(resolved().leaderboardLimit);
}

export async function submitScore(entry) {
  return activeBoard().submit(entry);
}
