/**
 * Per-identity storage.
 *
 * Signing in should give you *your* account, not just a different name on the
 * leaderboard. Results, achievements, streaks and today's in-progress game are
 * therefore namespaced by player key, so two people sharing a browser — or one
 * person with a guest session and a signed-in one — never see each other's
 * progress or each other's half-finished day.
 *
 * Storage keys look like `gussle_history::google:1098765…`.
 */

const LEGACY_MIGRATED = 'gussle_legacy_migrated';

export const STORES = {
  history: 'gussle_history',
  achievements: 'gussle_achievements',
  dailyStreak: 'gussle_streak',
  /** Today's in-progress or finished game, so a reload can't rewind it. */
  dayState: 'gussle_day',
};

const scopedKey = (base, playerId) => `${base}::${playerId}`;

export function read(base, playerId, fallback) {
  try {
    const raw = localStorage.getItem(scopedKey(base, playerId));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function write(base, playerId, value) {
  try {
    localStorage.setItem(scopedKey(base, playerId), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function hasData(base, playerId) {
  try {
    return localStorage.getItem(scopedKey(base, playerId)) !== null;
  } catch {
    return false;
  }
}

/**
 * Moves a guest's progress onto their account the first time they sign in, so
 * signing in never looks like it wiped everything.
 *
 * This is a *move*, not a copy. The guest profile is emptied afterwards, which
 * matters when a browser is shared: without it, the next person to sign in
 * would inherit the same guest session all over again and start with someone
 * else's history and achievements.
 *
 * Only fills stores the account hasn't got yet — an established account keeps
 * its own history rather than having a stranger's guest session merged in.
 *
 * @returns {string[]} names of the stores that were moved
 */
export function adoptGuestData(guestPlayerId, accountPlayerId) {
  if (!guestPlayerId || !accountPlayerId || guestPlayerId === accountPlayerId) return [];

  const moved = [];
  for (const [name, base] of Object.entries(STORES)) {
    if (!hasData(base, guestPlayerId)) continue;

    // The account already has its own progress for this store — leave both
    // sides alone rather than overwriting or merging.
    if (hasData(base, accountPlayerId)) continue;

    const value = read(base, guestPlayerId, null);
    if (value === null) continue;
    if (!write(base, accountPlayerId, value)) continue;

    try {
      localStorage.removeItem(scopedKey(base, guestPlayerId));
    } catch {
      /* the copy succeeded, which is the part that matters */
    }
    moved.push(name);
  }
  return moved;
}

/**
 * One-time upgrade from the pre-namespacing layout, where everything lived
 * under a bare key shared by every identity. Existing progress becomes the
 * guest's, which is where it actually came from.
 */
export function migrateLegacy(guestPlayerId) {
  try {
    if (localStorage.getItem(LEGACY_MIGRATED)) return false;
  } catch {
    return false;
  }

  let moved = false;
  for (const base of Object.values(STORES)) {
    try {
      const legacy = localStorage.getItem(base);
      if (legacy === null) continue;
      if (!hasData(base, guestPlayerId)) {
        localStorage.setItem(scopedKey(base, guestPlayerId), legacy);
        moved = true;
      }
      localStorage.removeItem(base);
    } catch {
      /* keep going; a single failed key shouldn't block the rest */
    }
  }

  try {
    localStorage.setItem(LEGACY_MIGRATED, '1');
  } catch {
    /* ignore */
  }
  return moved;
}
