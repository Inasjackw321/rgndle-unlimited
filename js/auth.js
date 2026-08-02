/**
 * Sign-in facade over the available providers.
 *
 * The rest of the game talks only to this module and never needs to know which
 * provider a player used. Sessions are normalised to:
 *
 *   { provider, token, tokenExpiresAt, expiresAt, user: {id, name, avatar, accent} }
 *
 * Player identity is `provider:id` — Discord snowflakes and Google subjects
 * live in different namespaces, and prefixing keeps them from ever colliding
 * on a leaderboard or in per-account storage.
 */

import * as discord from './discord.js';
import * as google from './google.js';

const TOKEN_KEY = 'rngdle_session';
const SEEN_KEY = 'rngdle_last_provider';

/** Re-auth once a Discord token has less than this long to live. */
const RENEW_BEFORE_MS = 12 * 60 * 60 * 1000;

export const PROVIDERS = { discord, google };

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
      localStorage.setItem(TOKEN_KEY, JSON.stringify(next));
      localStorage.setItem(SEEN_KEY, next.provider);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* private mode — the session still works until reload */
  }
  emit();
  return next;
}

function readStored() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.provider || !data.expiresAt || Date.now() >= data.expiresAt) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** The provider this browser last signed in with, if any. Drives "Reconnect". */
export function lastProvider() {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function hasSignedInBefore() {
  return Boolean(lastProvider() && PROVIDERS[lastProvider()]?.isConfigured());
}

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

/** Providers that are configured and therefore offerable. */
export function availableProviders() {
  return Object.values(PROVIDERS).filter((p) => p.isConfigured());
}

export function isConfigured() {
  return availableProviders().length > 0;
}

/* ------------------------------------------------------------------ *
 * Session shape helpers
 * ------------------------------------------------------------------ */

export function currentSession() {
  return session;
}

export function currentUser() {
  return session?.user || null;
}

/** Stable cross-provider identity, used for storage and leaderboard rows. */
export function playerKey(current = session) {
  return current ? `${current.provider}:${current.user.id}` : null;
}

export function displayName(user) {
  return user?.name || 'Player';
}

export function avatarUrl(user) {
  return user?.avatar || null;
}

export function accentColor(user) {
  return user?.accent || null;
}

export function timeUntilExpiry() {
  return session ? session.expiresAt - Date.now() : null;
}

/** Only Discord sessions need renewing on this timescale; Google auto-renews. */
export function needsRenewal() {
  if (!session || session.provider !== 'discord') return false;
  const left = timeUntilExpiry();
  return left !== null && left < RENEW_BEFORE_MS;
}

/* ------------------------------------------------------------------ *
 * Sign in / out
 * ------------------------------------------------------------------ */

/**
 * @param {string} providerId  'discord' | 'google'
 * @param {object} [opts]      { silent, allowRedirect }
 */
export async function login(providerId, opts = {}) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Unknown sign-in provider: ${providerId}`);

  const next = await provider.login(opts);
  if (!next) return null; // silent attempt declined without interaction
  return store(next);
}

/**
 * Accepts a session produced outside `login()` — specifically Google's
 * rendered button, which delivers credentials through its own callback rather
 * than a promise we awaited.
 */
export function adoptSession(next) {
  return store(next);
}

export function logout() {
  PROVIDERS[session?.provider]?.logout?.();
  store(null);
}

/**
 * Called on page load. Picks up a redirect-flow result if there is one,
 * otherwise restores a stored session. Returns an error string, or null.
 */
export async function initAuth() {
  try {
    const redirected = await discord.consumePendingRedirect();
    if (redirected) {
      store(redirected);
      return null;
    }
  } catch (err) {
    return err.code === 'access_denied' ? null : err.message;
  }

  const stored = readStored();
  if (!stored) return null;

  const provider = PROVIDERS[stored.provider];
  if (!provider) {
    store(null);
    return null;
  }

  // Google sessions carry a self-contained JWT, so there is nothing to call.
  // Discord tokens can be revoked server-side and must be re-validated.
  if (!provider.restore) {
    store(stored);
    return null;
  }

  try {
    store(await provider.restore(stored));
    return null;
  } catch (err) {
    if (err.code === 'unauthorized') {
      store(null);
      return null;
    }
    // Network trouble: keep the identity so the profile still loads.
    store(stored);
    return `Could not reach ${provider.label}. You may need to sign in again to post scores.`;
  }
}

/** True when the session's token is still good enough to submit a score. */
export function hasFreshToken() {
  const provider = PROVIDERS[session?.provider];
  return Boolean(provider?.tokenIsFresh?.(session));
}

/**
 * Re-runs sign-in after a 401, or when the token has aged out but the identity
 * hasn't. Returns true if the caller should retry its request.
 */
export async function refreshToken() {
  if (!session) return false;
  const providerId = session.provider;
  try {
    const next = await PROVIDERS[providerId].login({ silent: true, allowRedirect: false });
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
