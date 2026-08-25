/**
 * Deployment configuration.
 *
 * Everything here is public — it ships to the browser. A Google client ID is
 * public information; the *client secret* is not, and is never needed here,
 * which is exactly why this works on GitHub Pages.
 */

export const CONFIG = {
  /**
   * Google OAuth client ID (Web application).
   * https://console.cloud.google.com/apis/credentials
   * Authorise this site's origin under "Authorised JavaScript origins".
   * Leave empty to run the game in guest-only mode.
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

const GOOGLE_ID_KEY = 'rngdle_google_client_id';
const ENDPOINT_KEY = 'rngdle_endpoint';

/**
 * Per-browser overrides, written by the in-app setup dialog. They let someone
 * enable sign-in on a deployment they can't edit — and let you test auth on
 * localhost without touching this file.
 */
export function saveOverrides({ googleClientId, leaderboardEndpoint }) {
  const write = (key, value) => {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  };
  try {
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
      googleClientId: localStorage.getItem(GOOGLE_ID_KEY) || '',
      leaderboardEndpoint: localStorage.getItem(ENDPOINT_KEY) || '',
    };
  } catch {
    return { googleClientId: '', leaderboardEndpoint: '' };
  }
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
