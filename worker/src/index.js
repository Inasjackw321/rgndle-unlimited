/**
 * Optional shared-leaderboard backend for RNGDLE Unlimited.
 *
 * Cloudflare Worker + KV. Deploy it only if you want a global leaderboard —
 * the game runs perfectly well on GitHub Pages without it, falling back to an
 * on-device board.
 *
 * Routes:
 *   GET  /leaderboard?limit=100   public, cached
 *   POST /scores                  requires a Discord bearer token
 *
 * Trust model — please read before deploying:
 * The roll happens in the browser, so a determined user can submit a roll they
 * did not honestly generate. What this Worker *does* enforce is that a
 * submitted score is arithmetically consistent with its digits: it recomputes
 * the base score from the digits with the same engine the client uses, and
 * bounds the multipliers. That stops "score: 99999999" outright; it cannot stop
 * someone from claiming they rolled 123456789. Truly cheat-proof scoring would
 * require generating rolls server-side, which is out of scope for a static
 * front end.
 */

import { scoreRoll, COSMIC_TABLE, ROLL_LENGTH } from '../../js/scoring.js';
import { percentileOf, rankFor } from '../../js/ranks.js';

const BOARD_KEY = 'board:v1';
const BOARD_SIZE = 100;
const MAX_EXTRA_MULTIPLIER = 4; // streak (<=2) x time (<=2)
const RATE_LIMIT = 40; // submissions per minute per user

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

/** Resolves a Discord bearer token to a user, with a short cache. */
async function identify(token, env) {
  const cacheKey = `token:${await sha256(token)}`;
  const cached = await env.RNGDLE.get(cacheKey, 'json');
  if (cached) return cached;

  const res = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const user = await res.json();
  const slim = {
    id: user.id,
    name: user.global_name || user.username,
    avatar: user.avatar,
    discriminator: user.discriminator,
  };
  await env.RNGDLE.put(cacheKey, JSON.stringify(slim), { expirationTtl: 300 });
  return slim;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function avatarUrl(user) {
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

/** Recomputes the score from the submitted roll. Throws on anything invalid. */
function validate(payload) {
  const { digits, cosmic, multipliers } = payload;

  if (typeof digits !== 'string' || !new RegExp(`^\\d{${ROLL_LENGTH}}$`).test(digits)) {
    throw new Error(`digits must be ${ROLL_LENGTH} numeric characters`);
  }
  const cosmicEntry = COSMIC_TABLE.find((c) => c.value === cosmic);
  if (!cosmicEntry) throw new Error('unknown cosmic multiplier');

  const total = Number(multipliers);
  if (!Number.isFinite(total) || total < cosmicEntry.value) throw new Error('invalid multiplier');

  const extra = total / cosmicEntry.value;
  if (extra > MAX_EXTRA_MULTIPLIER + 1e-9) throw new Error('multiplier out of range');

  const result = scoreRoll([...digits].map(Number), cosmicEntry);
  return { score: Math.round(result.base * total), base: result.base, digits, multiplier: total };
}

async function readBoard(env) {
  return (await env.RNGDLE.get(BOARD_KEY, 'json')) || [];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (request.method === 'GET' && url.pathname === '/leaderboard') {
      const limit = Math.min(Number(url.searchParams.get('limit') || 100), BOARD_SIZE);
      const entries = (await readBoard(env)).slice(0, limit);
      return json({ entries }, 200, env, { 'Cache-Control': 'public, max-age=10' });
    }

    if (request.method === 'POST' && url.pathname === '/scores') {
      const header = request.headers.get('Authorization') || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) return json({ error: 'missing bearer token' }, 401, env);

      const user = await identify(token, env);
      if (!user) return json({ error: 'invalid Discord token' }, 401, env);

      if (await rateLimited(user.id, env)) {
        return json({ error: 'slow down' }, 429, env);
      }

      let verified;
      try {
        verified = validate(await request.json());
      } catch (err) {
        return json({ error: err.message }, 400, env);
      }

      const board = await readBoard(env);
      const existing = board.find((e) => e.playerId === user.id);
      if (existing && existing.score >= verified.score) {
        return json({ improved: false, best: existing.score }, 200, env);
      }

      const entry = {
        playerId: user.id,
        name: user.name,
        avatar: avatarUrl(user),
        score: verified.score,
        digits: verified.digits,
        multipliers: verified.multiplier,
        rank: rankFor(percentileOf(verified.score)).label,
        at: Date.now(),
      };

      const next = board.filter((e) => e.playerId !== user.id);
      next.push(entry);
      next.sort((a, b) => b.score - a.score);
      await env.RNGDLE.put(BOARD_KEY, JSON.stringify(next.slice(0, BOARD_SIZE)));

      return json({ improved: true, score: verified.score }, 200, env);
    }

    return json({ error: 'not found' }, 404, env);
  },
};
