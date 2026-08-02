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
   * Google OAuth client ID (Web application).
   * https://console.cloud.google.com/apis/credentials
   * Authorise this site's origin under "Authorised JavaScript origins".
   * Leave empty to hide Google sign-in.
   */
  googleClientId: '',

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

/** Directory the game is served from, with a trailing slash. */
export function baseUri() {
  const { origin, pathname } = window.location;
  return origin + pathname.replace(/(index|callback)\.html$/, '');
}

/**
 * The OAuth2 redirect URI. Discord requires an exact match, so the help panel
 * prints this string for copy-pasting into the developer portal.
 *
 * Both the popup flow and the redirect fallback land on callback.html, so there
 * is only ever one URI to register.
 */
export function redirectUri() {
  return baseUri() + 'callback.html';
}

const CLIENT_ID_KEY = 'rngdle_client_id';
const GOOGLE_ID_KEY = 'rngdle_google_client_id';
const ENDPOINT_KEY = 'rngdle_endpoint';

/**
 * Per-browser overrides, written by the in-app setup dialog. They let someone
 * enable sign-in on a deployment they can't edit — and let you test auth on
 * localhost without touching this file.
 */
export function saveOverrides({ discordClientId, googleClientId, leaderboardEndpoint }) {
  const write = (key, value) => {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  };
  try {
    write(CLIENT_ID_KEY, discordClientId);
    write(GOOGLE_ID_KEY, googleClientId);
    write(ENDPOINT_KEY, leaderboardEndpoint);
    return true;
  } catch {
    return false;
  }
}

export function clearOverrides() {
  return saveOverrides({});
}

/** The overrides currently in effect, for pre-filling the setup form. */
export function overrides() {
  try {
    return {
      discordClientId: localStorage.getItem(CLIENT_ID_KEY) || '',
      googleClientId: localStorage.getItem(GOOGLE_ID_KEY) || '',
      leaderboardEndpoint: localStorage.getItem(ENDPOINT_KEY) || '',
    };
  } catch {
    return { discordClientId: '', googleClientId: '', leaderboardEndpoint: '' };
  }
}

/** Discord snowflakes are 17-20 digit numbers. */
export function isValidClientId(value) {
  return /^\d{17,20}$/.test(value.trim());
}

/** Google web client IDs look like 1234-abc.apps.googleusercontent.com */
export function isValidGoogleClientId(value) {
  return /^[\w-]+\.apps\.googleusercontent\.com$/.test(value.trim());
}

/** Origin Google needs listed under "Authorised JavaScript origins". */
export function jsOrigin() {
  return window.location.origin;
}

export function resolved() {
  const merged = { ...CONFIG };
  for (const [key, value] of Object.entries(overrides())) if (value) merged[key] = value;
  return merged;
}
