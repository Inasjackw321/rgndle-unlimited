/**
 * Optional shared-leaderboard backend for Gussle.
 *
 * Cloudflare Worker + KV. Deploy it only if you want a shared board — the game
 * runs perfectly well on GitHub Pages without it, falling back to an on-device
 * board.
 *
 * Routes:
 *   GET  /leaderboard?scope=daily|all&day=YYYY-MM-DD&limit=100   public, cached
 *   POST /scores                                                 Google ID token
 *
 * Trust model — please read before deploying:
 *
 *   Identity is verified properly. Every Google ID token has its RS256
 *   signature checked against Google's published keys, with issuer, audience
 *   and expiry enforced. GOOGLE_CLIENT_ID must be set or every sign-in is
 *   rejected — without it a token minted for any other site would pass.
 *
 *   The *score* is recomputed here from the submitted digits and the day's
 *   target, which the Worker derives itself. So a score can never disagree with
 *   the digits it claims, and the target cannot be fudged.
 *
 *   What the Worker cannot check is whether those digits were honestly rolled.
 *   The rolls happen in the browser, so a determined player can submit nine
 *   digits they simply chose. Closing that would mean the Worker issuing each
 *   roll on request — perfectly doable on top of this, and the natural next
 *   step if the board ever matters enough to be worth cheating at.
 */

import { scoreRound, ROLL_LENGTH, REROLLS_PER_DAY } from '../../js/scoring.js';
import { percentileOf, rankFor, RANKS } from '../../js/ranks.js';
import { dailyTarget, dateKey } from '../../js/daily.js';

const BOARD_KEY = 'board:v1';
const BOARD_SIZE = 100;
const RATE_LIMIT = 40; // submissions per minute per user
const DAILY_TTL = 60 * 60 * 24 * 40; // keep daily boards for ~40 days

const dailyBoardKey = (day) => `board:daily:${day}`;

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, env, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env), ...extra },
  });
}

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function decodeSegment(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

async function googleKeys(env) {
  const cached = await env.GUSSLE.get('jwks:google', 'json');
  if (cached) return cached;

  const res = await fetch(GOOGLE_JWKS);
  if (!res.ok) throw new Error('could not fetch Google signing keys');
  const jwks = await res.json();
  // Google rotates these; an hour is well inside their cache headers.
  await env.GUSSLE.put('jwks:google', JSON.stringify(jwks), { expirationTtl: 3600 });
  return jwks;
}

/**
 * Verifies a Google ID token properly: RS256 signature against Google's
 * published keys, then issuer, audience and expiry. Decoding the payload
 * without this would let anyone mint whatever identity they liked.
 */
async function verifyGoogleToken(jwt, env) {
  if (!env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is not configured on the Worker');

  const parts = String(jwt).split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  let claims;
  try {
    header = decodeSegment(headerB64);
    claims = decodeSegment(payloadB64);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  const { keys } = await googleKeys(env);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.includes(claims.iss)) return null;
  if (claims.aud !== env.GOOGLE_CLIENT_ID) return null;
  if (!claims.exp || claims.exp <= now) return null;
  if (claims.nbf && claims.nbf > now + 60) return null;
  if (!claims.sub) return null;

  return {
    provider: 'google',
    id: claims.sub,
    name: claims.name || claims.email?.split('@')[0] || 'Player',
    picture: claims.picture || null,
  };
}

/** Resolves a bearer token to a user. Cached briefly, keyed by the token. */
async function identify(token, env) {
  const cacheKey = `token:${await sha256(token)}`;
  const cached = await env.GUSSLE.get(cacheKey, 'json');
  if (cached) return cached;

  const user = await verifyGoogleToken(token, env);
  if (!user) return null;

  // Never cache past the token's own lifetime.
  await env.GUSSLE.put(cacheKey, JSON.stringify(user), { expirationTtl: 300 });
  return user;
}

/** Stable identity; must match the client's playerKey(). */
const playerKey = (user) => `google:${user.id}`;

const avatarUrl = (user) => user.picture || null;

async function rateLimited(userId, env) {
  const key = `rate:${userId}:${Math.floor(Date.now() / 60000)}`;
  const count = Number((await env.GUSSLE.get(key)) || 0) + 1;
  await env.GUSSLE.put(key, String(count), { expirationTtl: 120 });
  return count > RATE_LIMIT;
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

/**
 * Recomputes the day's score from the submitted digits.
 *
 * The target is derived here rather than trusted, so the only thing taken on
 * faith is the digits themselves.
 */
function scoreSubmission(payload) {
  const { digits, rerollsLeft, day } = payload;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new Error('bad day');
  if (day !== dateKey()) throw new Error('submissions must be for the current UTC day');

  if (typeof digits !== 'string' || !new RegExp(`^\\d{${ROLL_LENGTH}}$`).test(digits)) {
    throw new Error(`digits must be ${ROLL_LENGTH} numeric characters`);
  }

  const left = Number(rerollsLeft);
  if (!Number.isInteger(left) || left < 0 || left > REROLLS_PER_DAY) {
    throw new Error('rerollsLeft out of range');
  }

  const target = dailyTarget(day);
  const result = scoreRound(target, [...digits].map(Number), { rerollsLeft: left });
  return {
    score: result.total,
    digits,
    bullseyes: result.bullseyes,
    totalDistance: result.totalDistance,
    rerollsLeft: left,
    day,
  };
}

/* ------------------------------------------------------------------ *
 * Announcements
 * ------------------------------------------------------------------ */

/**
 * Posts big rolls to a Discord channel. The webhook URL lives in a Worker
 * secret, never in the client, so nobody can spam the channel directly:
 *   npx wrangler secret put ANNOUNCE_WEBHOOK
 */
async function announce(entry, env) {
  if (!env.ANNOUNCE_WEBHOOK) return;

  const minIndex = RANKS.findIndex((r) => r.label === (env.ANNOUNCE_MIN_RANK || 'SS'));
  const rankIndex = RANKS.findIndex((r) => r.label === entry.rank);
  if (minIndex === -1 || rankIndex < minIndex) return;

  const rank = RANKS[rankIndex];
  const body = {
    embeds: [
      {
        title: `${entry.rank} — ${rank.name}`,
        description:
          `**${entry.name}** finished Gussle with **${entry.bullseyes}/9** exact\n` +
          `**${entry.score.toLocaleString()}** points · total distance ${entry.totalDistance}`,
        color: parseInt(rank.color.replace('#', ''), 16),
        thumbnail: { url: entry.avatar },
        footer: { text: entry.day },
        timestamp: new Date(entry.at).toISOString(),
      },
    ],
  };

  // Never let an announcement failure fail the score submission.
  try {
    await fetch(env.ANNOUNCE_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Board storage
 * ------------------------------------------------------------------ */

async function readBoard(env, key) {
  return (await env.GUSSLE.get(key, 'json')) || [];
}

async function writeBoard(env, key, entries, ttl) {
  const options = ttl ? { expirationTtl: ttl } : undefined;
  await env.GUSSLE.put(key, JSON.stringify(entries.slice(0, BOARD_SIZE)), options);
}

/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    /* ---- Read ---- */
    if (request.method === 'GET' && url.pathname === '/leaderboard') {
      const limit = Math.min(Number(url.searchParams.get('limit') || 100), BOARD_SIZE);
      const scope = url.searchParams.get('scope') === 'daily' ? 'daily' : 'all';
      const day = url.searchParams.get('day') || dateKey();

      if (scope === 'daily' && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        return json({ error: 'bad day' }, 400, env);
      }

      const key = scope === 'daily' ? dailyBoardKey(day) : BOARD_KEY;
      const entries = (await readBoard(env, key)).slice(0, limit);
      return json({ entries, scope, day: scope === 'daily' ? day : undefined }, 200, env, {
        'Cache-Control': 'public, max-age=10',
      });
    }

    /* ---- Write ---- */
    if (request.method === 'POST' && url.pathname === '/scores') {
      const header = request.headers.get('Authorization') || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) return json({ error: 'missing bearer token' }, 401, env);

      const user = await identify(token, env);
      if (!user) return json({ error: 'invalid Google token' }, 401, env);

      const identityKey = playerKey(user);
      if (await rateLimited(identityKey, env)) return json({ error: 'slow down' }, 429, env);

      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: 'bad JSON' }, 400, env);
      }

      let verified;
      try {
        verified = scoreSubmission(payload);
      } catch (err) {
        return json({ error: err.message }, 400, env);
      }

      const entry = {
        playerId: identityKey,
        name: user.name,
        avatar: avatarUrl(user),
        score: verified.score,
        digits: verified.digits,
        bullseyes: verified.bullseyes,
        totalDistance: verified.totalDistance,
        rerollsLeft: verified.rerollsLeft,
        rank: rankFor(percentileOf(verified.score)).label,
        day: verified.day,
        at: Date.now(),
      };

      // Today's board: one row per player, replaced on resubmission.
      const todayKey = dailyBoardKey(verified.day);
      const today = await readBoard(env, todayKey);
      const nextToday = today.filter((e) => e.playerId !== identityKey);
      nextToday.push(entry);
      nextToday.sort((a, b) => b.score - a.score);
      await writeBoard(env, todayKey, nextToday, DAILY_TTL);

      // All-time board: each player's single best day.
      const best = await readBoard(env, BOARD_KEY);
      const previous = best.find((e) => e.playerId === identityKey);
      let improved = true;
      if (previous && previous.score >= verified.score) {
        improved = false;
      } else {
        const nextBest = best.filter((e) => e.playerId !== identityKey);
        nextBest.push(entry);
        nextBest.sort((a, b) => b.score - a.score);
        await writeBoard(env, BOARD_KEY, nextBest, undefined);
      }

      // Fire-and-forget so the player isn't waiting on Discord.
      ctx.waitUntil(announce(entry, env));

      return json({ improved: true, score: entry.score, rank: entry.rank }, 200, env);
    }

    return json({ error: 'not found' }, 404, env);
  },
};
