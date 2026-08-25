/**
 * Sign-in, backed by Google Identity Services.
 *
 * GIS hands the browser a signed JWT ID token directly, so there is no token
 * exchange, no client secret and no server — which is what lets sign-in work on
 * a static host like GitHub Pages.
 *
 * Sessions are normalised to:
 *   { provider, token, tokenExpiresAt, expiresAt, user: {id, name, avatar} }
 *
 * Player identity is `google:<sub>`. The prefix is deliberate: it keeps stored
 * profiles and leaderboard rows namespaced by provider, so adding another
 * provider later can never collide with existing identities.
 */

import * as google from './google.js';

const SESSION_KEY = 'rngdle_session';
const SEEN_KEY = 'rngdle_has_signed_in';

const listeners = new Set();
let session = null;

export function onAuthChange(fn) {
  listeners.add(fn);
  fn(session);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(session);
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

function store(next) {
  session = next;
  try {
    if (next) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      localStorage.setItem(SEEN_KEY, '1');
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* private mode — the session still works until reload */
  }
  emit();
  return next;
}

function readStored() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.user?.id || !data.expiresAt || Date.now() >= data.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function hasSignedInBefore() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1' && isConfigured();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export function isConfigured() {
  return google.isConfigured();
}

export function currentSession() {
  return session;
}

export function currentUser() {
  return session?.user || null;
}

/** Stable identity used for per-account storage and leaderboard rows. */
export function playerKey(current = session) {
  return current ? `google:${current.user.id}` : null;
}

export function displayName(user) {
  return user?.name || 'Player';
}

/* ------------------------------------------------------------------ *
 * Sign in / out
 * ------------------------------------------------------------------ */

/** Renders Google's own button into `host`. Completing it fires onSession. */
export function mountButton(host) {
  return google.renderButton(host);
}

export function onSession(fn) {
  return google.onSession(fn);
}

/** Accepts a session produced by the rendered button's own callback. */
export function adoptSession(next) {
  return store(next);
}

export async function login({ silent = false } = {}) {
  const next = await google.login({ silent });
  if (!next) return null; // silent attempt declined without interaction
  return store(next);
}

export function logout() {
  google.logout();
  store(null);
}

/**
 * Call once on page load. A Google ID token is self-contained, so restoring a
 * session needs no network round-trip.
 */
export async function initAuth() {
  const stored = readStored();
  if (stored) store(stored);
  return null;
}

/** True when the stored JWT is still good enough to submit a score. */
export function hasFreshToken() {
  return google.tokenIsFresh(session);
}

/**
 * Tops the token up when it has aged out but the identity has not.
 * Returns true if the caller should retry its request.
 */
export async function refreshToken() {
  if (!session) return false;
  try {
    const next = await google.login({ silent: true });
    if (!next) return false;
    store(next);
    return true;
  } catch {
    return false;
  }
}

export async function recoverFromUnauthorized() {
  if (await refreshToken()) return true;
  logout();
  return false;
}
