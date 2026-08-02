/**
 * Optional shared-leaderboard backend for RNGDLE Unlimited.
 *
 * Cloudflare Worker + KV. Deploy it only if you want a global leaderboard —
 * the game runs perfectly well on GitHub Pages without it, falling back to an
 * on-device board.
 *
 * Routes:
 *   GET  /leaderboard?scope=all|daily&day=YYYY-MM-DD&limit=100   public, cached
 *   POST /scores                                                 Discord bearer token
 *
 * Trust model — please read before deploying:
 *
 *   Daily mode is fully verified. The roll is a pure function of (UTC date,
 *   Discord user ID), so the Worker recomputes it and ignores whatever digits
 *   the client sent. A daily submission cannot claim a roll the player didn't
 *   get, and cannot be rerolled.
 *
 *   Both providers are verified server-side. Discord access tokens are checked
 *   against the Discord API; Google ID tokens have their RS256 signature
 *   verified against Google's published keys, with issuer, audience and expiry
 *   all enforced. Set GOOGLE_CLIENT_ID or Google sign-ins are rejected.
 *
 *   Endless mode is not, and cannot be on a static front end. The roll happens
 *   in the browser. What the Worker enforces is that a submitted score is
 *   arithmetically consistent with its digits: it recomputes the base score
 *   with the same engine the client uses, checks the cosmic multiplier against
 *   the real weight table, and bounds the rest. That stops "score: 99999999"
 *   outright; it cannot stop someone claiming they rolled 123456789. If that
 *   matters to you, prefer the Daily board — or move roll generation here.
 */

import { scoreRoll, COSMIC_TABLE, ROLL_LENGTH } from '../../js/scoring.js';
import { percentileOf, rankFor, RANKS } from '../../js/ranks.js';
import { dailyRoll, dateKey } from '../../js/daily.js';

const BOARD_KEY = 'board:v1';
const BOARD_SIZE = 100;
const MAX_EXTRA_MULTIPLIER = 4; // streak (<=2) x time (<=2)
const RATE_LIMIT = 40; // submissions per minute per user
const DAILY_TTL = 60 * 60 * 24 * 40; // keep daily boards for ~40 days

const dailyBoardKey = (day) => `board:daily:${day}`;

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Auth-Provider',
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
 * Discord identity
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
  const cached = await env.RNGDLE.get('jwks:google', 'json');
  if (cached) return cached;

  const res = await fetch(GOOGLE_JWKS);
  if (!res.ok) throw new Error('could not fetch Google signing keys');
  const jwks = await res.json();
  // Google rotates these; an hour is well inside their cache headers.
  await env.RNGDLE.put('jwks:google', JSON.stringify(jwks), { expirationTtl: 3600 });
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

async function verifyDiscordToken(token, env) {
  const res = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const user = await res.json();
  return {
    provider: 'discord',
    id: user.id,
    name: user.global_name || user.username,
    avatar: user.avatar,
    discriminator: user.discriminator,
  };
}

/**
 * Resolves a bearer token to a user for whichever provider sent it.
 * Cached briefly, keyed by the token itself.
 */
async function identify(token, provider, env) {
  const cacheKey = `token:${await sha256(token)}`;
  const cached = await env.RNGDLE.get(cacheKey, 'json');
  if (cached) return cached;

  const user =
    provider === 'google' ? await verifyGoogleToken(token, env) : await verifyDiscordToken(token, env);
  if (!user) return null;

  // Never cache past the token's own lifetime.
  await env.RNGDLE.put(cacheKey, JSON.stringify(user), { expirationTtl: 300 });
  return user;
}

/** Stable cross-provider identity; must match the client's playerKey(). */
const playerKey = (user) => `${user.provider}:${user.id}`;

function avatarUrl(user) {
  if (user.provider === 'google') return user.picture || null;
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=64`;
  }
  const index =
    user.discriminator && user.discriminator !== '0'
      ? Number(user.discriminator) % 5
      : Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

async function rateLimited(userId, env) {
  const key = `rate:${userId}:${Math.floor(Date.now() / 60000)}`;
  const count = Number((await env.RNGDLE.get(key)) || 0) + 1;
  await env.RNGDLE.put(key, String(count), { expirationTtl: 120 });
  return count > RATE_LIMIT;
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

/**
 * Daily: the roll is recomputed here from (day, user id). Nothing the client
 * sent about the roll is trusted or even read.
 */
function scoreDaily(user, day) {
  if (day !== dateKey()) throw new Error('daily submissions must be for the current UTC day');
  const { digits, cosmic } = dailyRoll(day, playerKey(user));
  const result = scoreRoll(digits, cosmic);
  return {
    score: result.total,
    digits: result.display,
    multiplier: result.multiplier,
    cosmic: cosmic.value,
  };
}

/** Endless: recompute the base score from the submitted digits. */
function scoreEndless(payload) {
  const { digits, cosmic, multipliers } = payload;

  if (typeof digits !== 'string' || !new RegExp(`^\\d{${ROLL_LENGTH}}$`).test(digits)) {
    throw new Error(`digits must be ${ROLL_LENGTH} numeric characters`);
  }
  const cosmicEntry = COSMIC_TABLE.find((c) => c.value === cosmic);
  if (!cosmicEntry) throw new Error('unknown cosmic multiplier');

  const total = Number(multipliers);
  if (!Number.isFinite(total) || total < cosmicEntry.value) throw new Error('invalid multiplier');
  if (total / cosmicEntry.value > MAX_EXTRA_MULTIPLIER + 1e-9) throw new Error('multiplier out of range');

  const result = scoreRoll([...digits].map(Number), cosmicEntry);
  return {
    score: Math.round(result.base * total),
    digits,
    multiplier: total,
    cosmic: cosmicEntry.value,
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
          `**${entry.name}** rolled \`${entry.digits.split('').join(' ')}\`\n` +
          `**${entry.score.toLocaleString()}** points` +
          (entry.multipliers > 1 ? ` (×${entry.multipliers})` : ''),
        color: parseInt(rank.color.replace('#', ''), 16),
        thumbnail: { url: entry.avatar },
        footer: { text: entry.mode === 'daily' ? `Daily Challenge · ${entry.day}` : 'Endless' },
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
  return (await env.RNGDLE.get(key, 'json')) || [];
}

async function writeBoard(env, key, entries, ttl) {
  const options = ttl ? { expirationTtl: ttl } : undefined;
  await env.RNGDLE.put(key, JSON.stringify(entries.slice(0, BOARD_SIZE)), options);
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

      const provider = request.headers.get('X-Auth-Provider') === 'google' ? 'google' : 'discord';
      const user = await identify(token, provider, env);
      if (!user) return json({ error: `invalid ${provider} token` }, 401, env);

      const identityKey = playerKey(user);
      if (await rateLimited(identityKey, env)) return json({ error: 'slow down' }, 429, env);

      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: 'bad JSON' }, 400, env);
      }

      const isDaily = payload.mode === 'daily';
      const day = isDaily ? payload.day || dateKey() : undefined;

      let verified;
      try {
        verified = isDaily ? scoreDaily(user, day) : scoreEndless(payload);
      } catch (err) {
        return json({ error: err.message }, 400, env);
      }

      const key = isDaily ? dailyBoardKey(day) : BOARD_KEY;
      const board = await readBoard(env, key);
      const existing = board.find((e) => e.playerId === identityKey);

      // The daily is one roll per player: first submission wins, and since we
      // recompute it, a resubmission is identical anyway.
      if (existing && (isDaily || existing.score >= verified.score)) {
        return json({ improved: false, best: existing.score }, 200, env);
      }

      const entry = {
        playerId: identityKey,
        name: user.name,
        avatar: avatarUrl(user),
        score: verified.score,
        digits: verified.digits,
        cosmic: verified.cosmic,
        multipliers: verified.multiplier,
        rank: rankFor(percentileOf(verified.score)).label,
        mode: isDaily ? 'daily' : 'endless',
        day,
        at: Date.now(),
      };

      const next = board.filter((e) => e.playerId !== identityKey);
      next.push(entry);
      next.sort((a, b) => b.score - a.score);
      await writeBoard(env, key, next, isDaily ? DAILY_TTL : undefined);

      // Fire-and-forget so the player isn't waiting on Discord.
      ctx.waitUntil(announce(entry, env));

      return json({ improved: true, score: entry.score, rank: entry.rank }, 200, env);
    }

    return json({ error: 'not found' }, 404, env);
  },
};
