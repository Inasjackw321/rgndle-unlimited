/**
 * Discord sign-in via the OAuth2 *implicit grant* (`response_type=token`).
 *
 * The implicit flow is what makes this work on GitHub Pages: the access token
 * comes back in the URL fragment, so there is no token exchange and therefore
 * no client secret and no server. We only ever ask for the `identify` scope —
 * username and avatar, nothing else.
 *
 * Sign-in prefers a **popup**, so the game (and your roll history on screen)
 * is never torn down by a full-page navigation. If the popup is blocked we
 * fall back to a normal redirect. Both routes land on callback.html.
 */

import { resolved, redirectUri, baseUri } from './config.js';

const API = 'https://discord.com/api/v10';
const TOKEN_KEY = 'rngdle_token';
const STATE_KEY = 'rngdle_oauth_state';
const PENDING_KEY = 'rngdle_pending_auth';
const SEEN_KEY = 'rngdle_has_signed_in';

/** Re-auth once the token has less than this long to live. */
const RENEW_BEFORE_MS = 12 * 60 * 60 * 1000;

const listeners = new Set();
let session = null; // { token, expiresAt, user }

export function onAuthChange(fn) {
  listeners.add(fn);
  fn(session);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(session);
}

/* ------------------------------------------------------------------ *
 * Storage helpers
 * ------------------------------------------------------------------ */

const safeGet = (store, key) => {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (store, key, value) => {
  try {
    store.setItem(key, value);
  } catch {
    /* private mode — session works until reload */
  }
};

const safeRemove = (store, key) => {
  try {
    store.removeItem(key);
  } catch {
    /* ignore */
  }
};

function readStoredToken() {
  const raw = safeGet(localStorage, TOKEN_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data.token || !data.expiresAt || Date.now() >= data.expiresAt) {
      safeRemove(localStorage, TOKEN_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function storeToken(token, expiresIn) {
  const data = { token, expiresAt: Date.now() + expiresIn * 1000 };
  safeSet(localStorage, TOKEN_KEY, JSON.stringify(data));
  safeSet(localStorage, SEEN_KEY, '1');
  return data;
}

/** True if this browser has ever completed a sign-in. Drives "Reconnect" UI. */
export function hasSignedInBefore() {
  return safeGet(localStorage, SEEN_KEY) === '1';
}

/** Milliseconds until the current token expires, or null when signed out. */
export function timeUntilExpiry() {
  return session ? session.expiresAt - Date.now() : null;
}

export function needsRenewal() {
  const left = timeUntilExpiry();
  return left !== null && left < RENEW_BEFORE_MS;
}

/* ------------------------------------------------------------------ *
 * Authorize URL
 * ------------------------------------------------------------------ */

export function isConfigured() {
  return Boolean(resolved().discordClientId);
}

function authorizeUrl(state, { silent }) {
  const params = new URLSearchParams({
    client_id: resolved().discordClientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: 'identify',
    state,
  });
  // prompt=none returns immediately for anyone who has already authorised the
  // app, so returning players get a no-click re-auth instead of a consent
  // screen. It errors with consent_required/login_required otherwise, which
  // callers handle by retrying interactively.
  if (silent) params.set('prompt', 'none');
  return `https://discord.com/oauth2/authorize?${params}`;
}

function newState() {
  const state = crypto.randomUUID();
  safeSet(sessionStorage, STATE_KEY, state);
  return state;
}

function checkState(returned) {
  const expected = safeGet(sessionStorage, STATE_KEY);
  safeRemove(sessionStorage, STATE_KEY);
  // If sessionStorage is unavailable we can't verify; don't hard-fail there.
  return !expected || expected === returned;
}

/* ------------------------------------------------------------------ *
 * Popup flow
 * ------------------------------------------------------------------ */

class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** Opens the popup and resolves with the OAuth fragment payload. */
function popupAuth(state, { silent }) {
  const width = 520;
  const height = 720;
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);

  const popup = window.open(
    authorizeUrl(state, { silent }),
    'rngdle-discord-auth',
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
  );
  if (!popup) throw new AuthError('Popup blocked', 'popup-blocked');

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedPoll);
      clearTimeout(timeout);
      try {
        popup.close();
      } catch {
        /* already gone */
      }
      fn(value);
    };

    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'rngdle-auth') return;
      finish(resolve, event.data);
    };

    window.addEventListener('message', onMessage);

    // The user can always just close the window.
    const closedPoll = setInterval(() => {
      if (popup.closed) finish(reject, new AuthError('Sign-in cancelled', 'cancelled'));
    }, 400);

    const timeout = setTimeout(
      () => finish(reject, new AuthError('Sign-in timed out', 'timeout')),
      silent ? 15000 : 5 * 60 * 1000,
    );
  });
}

/** Full-page redirect, used when popups are unavailable. Never returns. */
function redirectAuth(state) {
  window.location.href = authorizeUrl(state, { silent: false });
}

async function adopt(payload) {
  if (payload.error) {
    throw new AuthError(payload.errorDescription || payload.error, payload.error);
  }
  if (!payload.token) throw new AuthError('No access token returned', 'no-token');
  if (!checkState(payload.state)) {
    throw new AuthError('Sign-in state mismatch — please try again.', 'state-mismatch');
  }

  const stored = storeToken(payload.token, payload.expiresIn);
  const user = await fetchUser(stored.token);
  session = { ...stored, user };
  emit();
  return session;
}

/**
 * Signs in. Resolves with the session.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.silent]   try prompt=none first (no consent screen)
 * @param {boolean} [opts.allowRedirect]  fall back to a full-page redirect
 */
export async function login({ silent = false, allowRedirect = true } = {}) {
  if (!isConfigured()) throw new AuthError('Discord client ID is not configured', 'not-configured');

  const state = newState();

  try {
    return await adopt(await popupAuth(state, { silent }));
  } catch (err) {
    // A silent attempt that needs user interaction is expected, not a failure —
    // retry with the real consent screen.
    if (silent && err.code !== 'cancelled') {
      return login({ silent: false, allowRedirect });
    }
    if (err.code === 'popup-blocked' && allowRedirect) {
      redirectAuth(state);
      return new Promise(() => {}); // navigation in flight
    }
    throw err;
  }
}

export function logout() {
  safeRemove(localStorage, TOKEN_KEY);
  session = null;
  emit();
}

/* ------------------------------------------------------------------ *
 * Discord API
 * ------------------------------------------------------------------ */

async function fetchUser(token) {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw Object.assign(new Error('Token expired'), { unauthorized: true });
  if (!res.ok) throw new Error(`Discord API returned ${res.status}`);
  return res.json();
}

export function avatarUrl(user, size = 64) {
  if (!user) return null;
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=${size}`;
  }
  // Default avatar index for the post-discriminator username system.
  const index =
    user.discriminator && user.discriminator !== '0'
      ? Number(user.discriminator) % 5
      : Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function displayName(user) {
  return user?.global_name || user?.username || 'Unknown';
}

/** Discord profile accent, used to tint the signed-in chip. */
export function accentColor(user) {
  if (typeof user?.accent_color === 'number') {
    return `#${user.accent_color.toString(16).padStart(6, '0')}`;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Startup
 * ------------------------------------------------------------------ */

/**
 * Call once on page load. Picks up a redirect-flow result if there is one,
 * otherwise restores a stored token. Returns an error string, or null.
 */
export async function initAuth() {
  const pendingRaw = safeGet(sessionStorage, PENDING_KEY);
  if (pendingRaw) {
    safeRemove(sessionStorage, PENDING_KEY);
    try {
      await adopt(JSON.parse(pendingRaw));
      return null;
    } catch (err) {
      return err.code === 'access_denied' ? null : err.message;
    }
  }

  const stored = readStoredToken();
  if (!stored) return null;

  try {
    const user = await fetchUser(stored.token);
    session = { ...stored, user };
    emit();
    return null;
  } catch (err) {
    if (err.unauthorized) {
      logout();
      return null;
    }
    return 'Could not reach Discord. Playing as guest.';
  }
}

/**
 * Re-runs a request after a silent re-auth if the token has expired mid-session.
 * Returns true if the caller should retry.
 */
export async function recoverFromUnauthorized() {
  logout();
  if (!isConfigured() || !hasSignedInBefore()) return false;
  try {
    await login({ silent: true, allowRedirect: false });
    return true;
  } catch {
    return false;
  }
}

export function currentSession() {
  return session;
}

export { AuthError };

/** Kept so callers can surface the exact string to register with Discord. */
export { redirectUri, baseUri };
