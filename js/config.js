/**
 * Deployment configuration.
 *
 * Everything here is public — it ships to the browser. Never put a Discord
 * *client secret* in this file; the implicit OAuth2 flow used by the game does
 * not need one, which is exactly why it works on GitHub Pages.
 */

export const CONFIG = {
  /**
   * Discord application client ID.
   * https://discord.com/developers/applications -> your app -> OAuth2.
   * Leave empty to run the game in guest-only mode.
   */
  discordClientId: '',

  /**
   * Shared leaderboard endpoint (see worker/ for a ready-made Cloudflare
   * Worker). Leave empty to keep the leaderboard on-device in localStorage.
   */
  leaderboardEndpoint: '',

  /** Rolls kept in the local history panel. */
  historyLimit: 50,

  /** Entries requested from the leaderboard. */
  leaderboardLimit: 100,
};

/**
 * The OAuth2 redirect URI, derived from wherever the game is actually served.
 * Discord requires an exact match, so the setup panel prints this string for
 * copy-pasting into the developer portal.
 */
export function redirectUri() {
  const { origin, pathname } = window.location;
  return origin + pathname.replace(/index\.html$/, '');
}

/**
 * Local overrides for development, set from the browser console:
 *   localStorage.rngdle_client_id = '123…'
 * Saves editing this file just to test auth on localhost.
 */
export function resolved() {
  let overrides = {};
  try {
    overrides = {
      discordClientId: localStorage.getItem('rngdle_client_id') || undefined,
      leaderboardEndpoint: localStorage.getItem('rngdle_endpoint') || undefined,
    };
  } catch {
    /* storage blocked — fall back to the committed config */
  }
  const merged = { ...CONFIG };
  for (const [k, v] of Object.entries(overrides)) if (v) merged[k] = v;
  return merged;
}
