/**
 * Saving and restoring what this browser knows about you.
 *
 * The boards live in `localStorage` until someone deploys the Worker, and
 * localStorage is one "clear site data" away from gone — on a new phone it was
 * never there at all. This writes the lot to a file you keep, and reads it back.
 *
 * Restoring **merges**, it doesn't replace. Two devices should add up to one
 * record, and a file from last month shouldn't undo this morning. Every merge
 * rule below resolves a conflict in the direction that can't lose something:
 * the higher score, the longer streak, the earlier unlock.
 */

import { STORES } from './profile.js';
import { resolved } from './config.js';

export const FORMAT = 'gussle-save';
export const VERSION = 1;

/** The all-time board and today's board, both device-wide rather than per-identity. */
const BOARD_KEYS = ['gussle_best', 'gussle_today'];

/**
 * Per-identity stores worth keeping. Deliberately not `gussle_day`: that is the
 * in-progress game, and letting a file overwrite it would hand out re-rolls you
 * had already spent — the exact rewind the whole day-state design exists to
 * prevent. Nothing from `rngdle_*` either; that is the session token and the
 * per-browser config, and a signed-in token has no business in a file you might
 * email to yourself.
 */
const PROFILE_BASES = [STORES.history, STORES.achievements, STORES.dailyStreak];

const readJSON = (key, fallback = null) => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const writeJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

/** Every stored key that starts with one of the per-identity bases. */
function profileKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (PROFILE_BASES.some((base) => key === base || key.startsWith(`${base}::`))) keys.push(key);
    }
  } catch {
    /* storage unavailable — an empty save is still a valid save */
  }
  return keys;
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export function collect() {
  const data = {};
  for (const key of [...BOARD_KEYS, ...profileKeys()]) {
    const value = readJSON(key);
    if (value !== null) data[key] = value;
  }
  return { format: FORMAT, version: VERSION, savedAt: new Date().toISOString(), data };
}

/** Rough shape of what's inside, for the confirmation line. */
export function describe(save) {
  const data = save?.data || {};
  const days = new Set();
  let players = 0;

  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith(STORES.history) && Array.isArray(value)) {
      for (const row of value) if (row?.day) days.add(row.day);
    }
    if (key === 'gussle_best' && Array.isArray(value)) players = value.length;
  }
  return { days: days.size, players };
}

export function download(save, filename) {
  const blob = new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ *
 * Merge rules
 * ------------------------------------------------------------------ */

const scoreOf = (row) => Number(row?.score) || 0;

/** One row per key, keeping whichever scored higher. */
function mergeByBest(mine, theirs, keyOf) {
  const out = new Map();
  for (const row of [...(mine || []), ...(theirs || [])]) {
    if (!row) continue;
    const id = keyOf(row);
    if (id === undefined || id === null) continue;
    const standing = out.get(id);
    if (!standing || scoreOf(standing) < scoreOf(row)) out.set(id, row);
  }
  return [...out.values()].sort((a, b) => scoreOf(b) - scoreOf(a));
}

/**
 * Today's board is only comparable within one day. A file saved yesterday holds
 * yesterday's rows under yesterday's target; merging those into today would put
 * scores from a different puzzle on the same board.
 */
function mergeDailyBoard(mine, theirs) {
  const day = mine?.day || theirs?.day || null;
  if (!day) return null;
  const rows = [
    ...(mine?.day === day ? mine.entries || [] : []),
    ...(theirs?.day === day ? theirs.entries || [] : []),
  ];
  return { day, entries: mergeByBest(rows, [], (row) => row.playerId) };
}

/** One row per day, keeping the better attempt at each. */
function mergeHistory(mine, theirs) {
  return mergeByBest(mine, theirs, (row) => row.day)
    .sort((a, b) => String(b.day).localeCompare(String(a.day)))
    .slice(0, resolved().historyLimit);
}

/** Union of unlocks, keeping the earlier timestamp — you earned it when you earned it. */
function mergeAchievements(mine, theirs) {
  const out = { ...(mine || {}) };
  for (const [id, at] of Object.entries(theirs || {})) {
    if (!(id in out) || Number(at) < Number(out[id])) out[id] = at;
  }
  return out;
}

function mergeStreak(mine, theirs) {
  if (!theirs) return mine;
  if (!mine) return theirs;
  return Number(theirs.count) > Number(mine.count) ? theirs : mine;
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

export class RestoreError extends Error {}

/**
 * Is this player key the same person on any device?
 *
 * Account keys look like `google:1098765…` and mean the same thing everywhere.
 * A guest key is a UUID minted per browser, so the one in the file names *that*
 * browser's guest and matches nothing here — restoring it verbatim would file
 * your record under an identity this device never uses, and the boards would
 * come back looking empty. Guest-scoped data is re-homed onto whoever is
 * playing here instead, which is what "restore my record" means.
 */
const isPortableId = (id) => id.includes(':');

/** The identity part of `gussle_history::google:123`, or null for a bare key. */
function scopeOf(key, base) {
  return key.length > base.length ? key.slice(base.length + 2) : null;
}

function targetKey(key, base, currentPlayerId) {
  const scope = scopeOf(key, base);
  if (!scope || isPortableId(scope)) return key;
  return currentPlayerId ? `${base}::${currentPlayerId}` : key;
}

/** Board rows carry the identity that earned them; guests get re-homed too. */
function rehomeRows(rows, currentPlayerId) {
  if (!Array.isArray(rows) || !currentPlayerId) return rows;
  return rows.map((row) =>
    row && row.playerId && !isPortableId(row.playerId)
      ? { ...row, playerId: currentPlayerId }
      : row,
  );
}

export function parse(text) {
  let save;
  try {
    save = JSON.parse(text);
  } catch {
    throw new RestoreError("That file isn't valid JSON.");
  }
  if (save?.format !== FORMAT) {
    throw new RestoreError('That is not a Gussle save file.');
  }
  if (Number(save.version) > VERSION) {
    throw new RestoreError('That save was written by a newer version of the game.');
  }
  if (!save.data || typeof save.data !== 'object') {
    throw new RestoreError('That save file has no data in it.');
  }
  return save;
}

/**
 * Merges a parsed save into this browser.
 *
 * @param save             a value from `parse()`
 * @param currentPlayerId  who is playing here, for re-homing guest-scoped data
 * @returns {{restored: string[], failed: string[]}}
 */
export function restore(save, currentPlayerId = null) {
  const restored = new Set();
  const failed = new Set();

  // Each write reads the target key back first, so two guest identities in one
  // file — or two files restored in a row — accumulate instead of clobbering.
  const apply = (key, merge) => {
    const merged = merge(readJSON(key));
    if (merged === null || merged === undefined) return;
    if (writeJSON(key, merged)) restored.add(key);
    else failed.add(key);
  };

  const isStore = (key, base) => key === base || key.startsWith(`${base}::`);

  for (const [key, incoming] of Object.entries(save.data)) {
    if (key === 'gussle_best') {
      const rows = rehomeRows(incoming, currentPlayerId);
      apply(key, (mine) => mergeByBest(mine, rows, (row) => row.playerId));
    } else if (key === 'gussle_today') {
      const board = incoming && {
        ...incoming,
        entries: rehomeRows(incoming.entries, currentPlayerId),
      };
      apply(key, (mine) => mergeDailyBoard(mine, board));
    } else if (isStore(key, STORES.history)) {
      apply(targetKey(key, STORES.history, currentPlayerId), (mine) => mergeHistory(mine, incoming));
    } else if (isStore(key, STORES.achievements)) {
      apply(targetKey(key, STORES.achievements, currentPlayerId), (mine) =>
        mergeAchievements(mine, incoming),
      );
    } else if (isStore(key, STORES.dailyStreak)) {
      apply(targetKey(key, STORES.dailyStreak, currentPlayerId), (mine) =>
        mergeStreak(mine, incoming),
      );
    }
    // Anything else in the file is ignored rather than trusted.
  }

  return { restored: [...restored], failed: [...failed] };
}
