/**
 * Saving what this browser knows about you, and reading it back.
 *
 * Everything is on-device, and localStorage is one "clear site data" away from
 * gone — on a new phone it was never there at all. This writes your results,
 * streak and achievements to a file you keep.
 *
 * Restoring **merges**, it doesn't replace. Two devices should add up to one
 * record, and a file from last month shouldn't undo this morning. The merge
 * rules live in `profile.js` so the same ones apply everywhere.
 */

import {
  STORES,
  read,
  write,
  mergeHistory,
  mergeAchievements,
  mergeStreak,
} from './profile.js';

export const FORMAT = 'gussle-save';
export const VERSION = 2;

/**
 * What goes in the file. Deliberately not `gussle_day`: that is the
 * in-progress game, and letting a file overwrite it would hand out re-rolls
 * you had already spent — the exact rewind the day-state design exists to
 * prevent.
 */
const MERGERS = {
  [STORES.history]: mergeHistory,
  [STORES.achievements]: mergeAchievements,
  [STORES.dailyStreak]: mergeStreak,
};

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export function collect() {
  const data = {};
  for (const key of Object.keys(MERGERS)) {
    const value = read(key);
    if (value !== null) data[key] = value;
  }
  return { format: FORMAT, version: VERSION, savedAt: new Date().toISOString(), data };
}

/** Rough shape of what's inside, for the confirmation line. */
export function describe(save) {
  const history = save?.data?.[STORES.history];
  const awards = save?.data?.[STORES.achievements];
  return {
    days: Array.isArray(history) ? history.length : 0,
    awards: awards ? Object.keys(awards).length : 0,
  };
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
 * Import
 * ------------------------------------------------------------------ */

export class RestoreError extends Error {}

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
 * Version 1 files were written when the game still had accounts, so their keys
 * carry a player suffix (`gussle_history::google:1098…`). The suffix is dropped
 * and everything under the same store merges together, which is what those
 * identities collapsed into anyway.
 *
 * @returns {{restored: string[], failed: string[]}}
 */
export function restore(save) {
  const restored = new Set();
  const failed = new Set();

  for (const [rawKey, incoming] of Object.entries(save.data)) {
    const base = rawKey.split('::')[0];
    const merge = MERGERS[base];
    if (!merge) continue; // anything else in the file is ignored, not trusted

    // Read back per key so several suffixed entries accumulate rather than
    // clobber each other.
    const merged = merge(read(base), incoming);
    if (merged === null || merged === undefined) continue;
    if (write(base, merged)) restored.add(base);
    else failed.add(base);
  }

  return { restored: [...restored], failed: [...failed] };
}
