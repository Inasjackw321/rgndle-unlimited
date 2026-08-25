/**
 * Google sign-in via Google Identity Services (GIS).
 *
 * GIS hands the browser a signed JWT ID token directly: no token exchange, no
 * client secret and no server, which is what lets sign-in work on a static
 * host. It authorises a **JavaScript origin** rather than an exact redirect
 * URL, so there is no redirect path to get wrong.
 *
 * Two lifetimes matter here and they are not the same:
 *
 *   tokenExpiresAt  — the JWT's own `exp`, about an hour. This is the only
 *                     thing a server should ever trust, and it's what the
 *                     leaderboard needs when submitting a score.
 *   expiresAt       — how long we keep showing you as signed in locally. Much
 *                     longer, because your roll history and achievements are
 *                     client-side anyway; an hourly re-prompt just to look at
 *                     your own history would be obnoxious.
 */

import { resolved } from './config.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const IDENTITY_DAYS = 30;

let scriptPromise = null;

/** Loads the GIS client once. Resolves with `google.accounts.id`. */
function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    const script = existing || document.createElement('script');

    const done = () => {
      if (window.google?.accounts?.id) resolve(window.google.accounts.id);
      else reject(new Error('Google Identity Services loaded but is unavailable'));
    };

    script.addEventListener('load', done, { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error('Could not reach Google Identity Services')),
      { once: true },
    );

    if (!existing) {
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }
  });
  return scriptPromise;
}

/**
 * Reads the claims out of a JWT without verifying it.
 *
 * That is fine here and only here: these claims drive what we draw on screen.
 * Nothing security-relevant depends on them — the Worker re-verifies the token
 * signature against Google's public keys before it will record a score.
 */
export function decodeIdToken(jwt) {
  const [, payload] = String(jwt).split('.');
  if (!payload) throw new Error('Malformed ID token');
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  // atob gives Latin-1; names commonly contain non-ASCII.
  const text = decodeURIComponent(
    Array.from(json, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
  );
  return JSON.parse(text);
}

export const id = 'google';
export const label = 'Google';

export function isConfigured() {
  return Boolean(resolved().googleClientId);
}

function sessionFromCredential(credential) {
  const claims = decodeIdToken(credential);
  if (!claims.sub) throw new Error('ID token has no subject');

  return {
    provider: 'google',
    token: credential,
    tokenExpiresAt: (claims.exp || 0) * 1000,
    expiresAt: Date.now() + IDENTITY_DAYS * 86400000,
    user: {
      id: claims.sub,
      name: claims.name || claims.given_name || claims.email?.split('@')[0] || 'Player',
      avatar: claims.picture || null,
      accent: null,
    },
  };
}

/**
 * GIS delivers every credential through one global callback — the rendered
 * button and silent auto-select both land here — so fan it out to listeners
 * rather than tying it to a single in-flight promise.
 */
const sessionListeners = new Set();

export function onSession(fn) {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

function handleCredential(response) {
  let next;
  try {
    next = sessionFromCredential(response.credential);
  } catch {
    return; // a credential we can't read is not a session
  }
  for (const fn of [...sessionListeners]) fn(next);
}

async function initialise({ autoSelect }) {
  const gis = await loadGis();
  gis.initialize({
    client_id: resolved().googleClientId,
    callback: handleCredential,
    auto_select: autoSelect,
    cancel_on_tap_outside: true,
    use_fedcm_for_prompt: true,
  });
  return gis;
}

/**
 * Renders Google's own button. Their branding terms require their button
 * rather than a look-alike, so this is deliberately not restyled beyond the
 * options GIS itself offers. Completing the flow fires the onSession
 * listeners; there is no promise to await here.
 */
export async function renderButton(container, { width = 210 } = {}) {
  const gis = await initialise({ autoSelect: false });
  container.replaceChildren();
  gis.renderButton(container, {
    type: 'standard',
    theme: 'filled_black',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    logo_alignment: 'left',
    width,
  });
}

/**
 * One Tap / auto-select, used for silent renewal when a JWT has aged out.
 * Resolves null rather than throwing when Google declines to sign the user in
 * without interaction — that's an expected outcome, not an error.
 */
export async function login({ silent = false } = {}) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Google client ID is not configured'), { code: 'not-configured' });
  }

  const gis = await initialise({ autoSelect: silent });

  return new Promise((resolve, reject) => {
    const off = onSession((next) => {
      clearTimeout(timer);
      off();
      resolve(next);
    });
    const timer = setTimeout(
      () => {
        off();
        if (silent) resolve(null);
        else reject(Object.assign(new Error('Sign-in timed out'), { code: 'timeout' }));
      },
      silent ? 12000 : 5 * 60 * 1000,
    );
    gis.prompt();
  });
}

export function logout() {
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch {
    /* nothing to clean up */
  }
}

/** True when the stored JWT is too old to be worth sending to the Worker. */
export function tokenIsFresh(session) {
  return Boolean(session?.tokenExpiresAt && Date.now() < session.tokenExpiresAt - 30000);
}
