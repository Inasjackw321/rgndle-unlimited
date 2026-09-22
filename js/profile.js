/**
 * On-device storage.
 *
 * One player per browser: results, achievements, streak and today's
 * in-progress game. There are no accounts, so there is nothing to namespace
 * against — the keys are bare.
 *
 * The merge rules live here too, because both the account migration below and
 * the save files in `backup.js` need them to agree. Every one resolves a
 * conflict in the direction that cannot lose something: the better score, the
 * longer streak, the earlier unlock.
 */

/** Results kept in the history panel. */
export const HISTORY_LIMIT = 50;

export const STORES = {
  history: 'gussle_history',
  achievements: 'gussle_achievements',
  dailyStreak: 'gussle_streak',
  /** Today's in-progress or finished game, so a reload can't rewind it. */
  dayState: 'gussle_day',
};

export function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to do about it */
  }
}

/* ------------------------------------------------------------------ *
 * Merge rules
 * ------------------------------------------------------------------ */

const scoreOf = (row) => Number(row?.score) || 0;

/** One row per day, keeping the better attempt at each, newest first. */
export function mergeHistory(mine, theirs) {
  const best = new Map();
  for (const row of [...(mine || []), ...(theirs || [])]) {
    if (!row?.day) continue;
    const standing = best.get(row.day);
    if (!standing || scoreOf(standing) < scoreOf(row)) best.set(row.day, row);
  }
  return [...best.values()]
    .sort((a, b) => String(b.day).localeCompare(String(a.day)))
    .slice(0, HISTORY_LIMIT);
}

/** Union of unlocks, keeping the earlier timestamp — you earned it when you earned it. */
export function mergeAchievements(mine, theirs) {
  const out = { ...(mine || {}) };
  for (const [id, at] of Object.entries(theirs || {})) {
    if (!(id in out) || Number(at) < Number(out[id])) out[id] = at;
  }
  return out;
}

export function mergeStreak(mine, theirs) {
  if (!theirs) return mine;
  if (!mine) return theirs;
  return Number(theirs.count) > Number(mine.count) ? theirs : mine;
}

/* ------------------------------------------------------------------ *
 * Migration off the account-era layout
 * ------------------------------------------------------------------ */

const MIGRATED = 'gussle_single_player';

/** Keys left behind by sign-in and the leaderboard, both now gone. */
const OBSOLETE = [
  'rngdle_session',
  'rngdle_has_signed_in',
  'rngdle_google_client_id',
  'rngdle_endpoint',
  'gussle_best',
  'gussle_today',
  'gussle_guest_id',
  'gussle_legacy_migrated',
];

function namespacedKeys(base) {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${base}::`)) keys.push(key);
    }
  } catch {
    /* storage unavailable */
  }
  return keys;
}

/**
 * Folds the old per-identity stores back into one.
 *
 * Progress used to be filed under a player key — `gussle_history::google:1098…`
 * for an account, a per-browser UUID for a guest. With sign-in gone, none of
 * those keys is reachable any more, so the data is merged rather than picked
 * between: one person playing partly signed in and partly as a guest should get
 * all of it back, and merging can't lose a day that picking a winner would.
 *
 * The one exception is the in-progress game, which can't be merged — the
 * furthest-along state for today wins, so this can never hand back a re-roll
 * that was already spent.
 */
export function migrateFromAccounts() {
  if (read(MIGRATED)) return false;

  let moved = false;
  const mergers = {
    [STORES.history]: mergeHistory,
    [STORES.achievements]: mergeAchievements,
    [STORES.dailyStreak]: mergeStreak,
  };

  for (const [base, merge] of Object.entries(mergers)) {
    const keys = namespacedKeys(base);
    if (!keys.length) continue;
    let merged = read(base);
    for (const key of keys) {
      merged = merge(merged, read(key));
      remove(key);
    }
    if (merged !== null && merged !== undefined) {
      write(base, merged);
      moved = true;
    }
  }

  // Day state: keep whichever copy of *today* got furthest.
  const dayKeys = namespacedKeys(STORES.dayState);
  if (dayKeys.length) {
    const progress = (s) => (Array.isArray(s?.rolled) ? s.rolled.length : -1);
    let best = read(STORES.dayState);
    for (const key of dayKeys) {
      const candidate = read(key);
      if (candidate && (!best || progress(candidate) > progress(best))) best = candidate;
      remove(key);
    }
    if (best) write(STORES.dayState, best);
  }

  for (const key of OBSOLETE) remove(key);
  write(MIGRATED, 1);
  return moved;
}
