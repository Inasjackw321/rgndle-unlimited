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
 *
 * This module is a *provider*: it produces normalised sessions and knows
 * nothing about storage or listeners. auth.js owns those.
 */

import { resolved, redirectUri } from './config.js';

const API = 'https://discord.com/api/v10';
const STATE_KEY = 'rngdle_oauth_state';
const PENDING_KEY = 'rngdle_pending_auth';

export const id = 'discord';
export const label = 'Discord';

class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}
export { AuthError };

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
    /* private mode */
  }
};
const safeRemove = (store, key) => {
  try {
    store.removeItem(key);
  } catch {
    /* ignore */
  }
};

export function isConfigured() {
  return Boolean(resolved().discordClientId);
}

/* ------------------------------------------------------------------ *
 * Authorize URL
 * ------------------------------------------------------------------ */

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
 * Popup
 * ------------------------------------------------------------------ */

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

    const closedPoll = setInterval(() => {
      if (popup.closed) finish(reject, new AuthError('Sign-in cancelled', 'cancelled'));
    }, 400);

    const timeout = setTimeout(
      () => finish(reject, new AuthError('Sign-in timed out', 'timeout')),
      silent ? 15000 : 5 * 60 * 1000,
    );
  });
}

/* ------------------------------------------------------------------ *
 * Discord API
 * ------------------------------------------------------------------ */

async function fetchUser(token) {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new AuthError('Token expired', 'unauthorized');
  if (!res.ok) throw new AuthError(`Discord API returned ${res.status}`, 'api');
  return res.json();
}

function avatarUrl(user, size = 64) {
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

function sessionFrom(token, expiresIn, user) {
  const expiresAt = Date.now() + expiresIn * 1000;
  return {
    provider: 'discord',
    token,
    tokenExpiresAt: expiresAt,
    expiresAt,
    user: {
      id: user.id,
      name: user.global_name || user.username || 'Player',
      avatar: avatarUrl(user, 64),
      accent:
        typeof user.accent_color === 'number'
          ? `#${user.accent_color.toString(16).padStart(6, '0')}`
          : null,
    },
  };
}

async function adopt(payload) {
  if (payload.error) {
    throw new AuthError(payload.errorDescription || payload.error, payload.error);
  }
  if (!payload.token) throw new AuthError('No access token returned', 'no-token');
  if (!checkState(payload.state)) {
    throw new AuthError('Sign-in state mismatch — please try again.', 'state-mismatch');
  }
  const user = await fetchUser(payload.token);
  return sessionFrom(payload.token, payload.expiresIn, user);
}

/* ------------------------------------------------------------------ *
 * Provider interface
 * ------------------------------------------------------------------ */

export async function login({ silent = false, allowRedirect = true } = {}) {
  if (!isConfigured()) throw new AuthError('Discord client ID is not configured', 'not-configured');

  const state = newState();
  try {
    return await adopt(await popupAuth(state, { silent }));
  } catch (err) {
    // A silent attempt that needs user interaction is expected, not a failure.
    if (silent && err.code !== 'cancelled') {
      return login({ silent: false, allowRedirect });
    }
    if (err.code === 'popup-blocked' && allowRedirect) {
      window.location.href = authorizeUrl(state, { silent: false });
      return new Promise(() => {}); // navigation in flight
    }
    throw err;
  }
}

/** Picks up a result left behind by the redirect fallback, if there is one. */
export async function consumePendingRedirect() {
  const raw = safeGet(sessionStorage, PENDING_KEY);
  if (!raw) return null;
  safeRemove(sessionStorage, PENDING_KEY);
  return adopt(JSON.parse(raw));
}

/** Re-validates a stored token on page load. */
export async function restore(stored) {
  const user = await fetchUser(stored.token);
  return sessionFrom(stored.token, Math.max(0, (stored.expiresAt - Date.now()) / 1000), user);
}

export function logout() {
  /* Discord has no client-side sign-out beyond dropping the token. */
}

export function tokenIsFresh(session) {
  return Boolean(session?.tokenExpiresAt && Date.now() < session.tokenExpiresAt);
}
