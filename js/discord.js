/**
 * Discord sign-in via the OAuth2 *implicit grant* (`response_type=token`).
 *
 * The implicit flow is what makes this work on GitHub Pages: the access token
 * comes back in the URL fragment, so there is no token exchange and therefore
 * no client secret and no server. We only ever ask for the `identify` scope —
 * username and avatar, nothing else.
 */

import { resolved, redirectUri } from './config.js';

const API = 'https://discord.com/api/v10';
const TOKEN_KEY = 'rngdle_token';
const STATE_KEY = 'rngdle_oauth_state';

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
 * Token storage
 * ------------------------------------------------------------------ */

function readStoredToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.token || !data.expiresAt || Date.now() >= data.expiresAt) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function storeToken(token, expiresIn) {
  const data = { token, expiresAt: Date.now() + expiresIn * 1000 };
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(data));
  } catch {
    /* private mode — the session still works until reload */
  }
  return data;
}

/* ------------------------------------------------------------------ *
 * Flow
 * ------------------------------------------------------------------ */

export function isConfigured() {
  return Boolean(resolved().discordClientId);
}

export function login() {
  const { discordClientId } = resolved();
  if (!discordClientId) throw new Error('Discord client ID is not configured');

  const state = crypto.randomUUID();
  try {
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    /* fall through — state check is skipped if storage is unavailable */
  }

  const params = new URLSearchParams({
    client_id: discordClientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: 'identify',
    state,
  });
  window.location.href = `https://discord.com/oauth2/authorize?${params}`;
}

export function logout() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  session = null;
  emit();
}

/**
 * Consumes an OAuth2 fragment if we were just redirected back from Discord.
 * Returns an error string on failure, or null.
 */
function consumeCallback() {
  if (!window.location.hash.includes('access_token')) {
    if (window.location.hash.includes('error=')) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      history.replaceState(null, '', redirectUri());
      return params.get('error_description') || params.get('error');
    }
    return null;
  }

  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('access_token');
  const expiresIn = Number(params.get('expires_in') || 604800);
  const returnedState = params.get('state');

  // Scrub the token out of the address bar before doing anything else.
  history.replaceState(null, '', redirectUri());

  let expectedState = null;
  try {
    expectedState = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* ignore */
  }
  if (expectedState && returnedState !== expectedState) {
    return 'Sign-in state mismatch — please try again.';
  }

  storeToken(token, expiresIn);
  return null;
}

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
  const index = user.discriminator && user.discriminator !== '0'
    ? Number(user.discriminator) % 5
    : Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function displayName(user) {
  return user?.global_name || user?.username || 'Unknown';
}

/** Call once on page load. Returns an error string, or null. */
export async function initAuth() {
  const callbackError = consumeCallback();
  if (callbackError) return callbackError;

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

export function currentSession() {
  return session;
}
