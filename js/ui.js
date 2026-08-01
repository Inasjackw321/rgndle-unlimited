/**
 * Rendering. Every function here takes data and writes DOM; none of them know
 * about the game loop.
 */

import { avatarUrl, displayName } from './discord.js';
import { RANKS, describeRarity, DISTRIBUTION, SAMPLE_SIZE } from './ranks.js';

export const el = (id) => document.getElementById(id);

/** Local stand-in so guest rows don't fetch anything from Discord's CDN. */
const PLACEHOLDER_AVATAR =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<rect width="32" height="32" rx="16" fill="#2a2a45"/>' +
      '<text x="16" y="22" font-size="16" text-anchor="middle" fill="#8b90a8">?</text></svg>',
  );

/* ------------------------------------------------------------------ *
 * Auth chip
 * ------------------------------------------------------------------ */

export function renderAuth(session, { onLogin, onLogout, configured }) {
  const slot = el('auth-slot');
  slot.replaceChildren();

  if (session?.user) {
    const chip = document.createElement('div');
    chip.className = 'user-chip';

    const img = document.createElement('img');
    img.src = avatarUrl(session.user, 64);
    img.alt = '';
    img.loading = 'lazy';

    const name = document.createElement('span');
    name.className = 'user-name';
    name.textContent = displayName(session.user);

    const out = document.createElement('button');
    out.type = 'button';
    out.textContent = 'Sign out';
    out.addEventListener('click', onLogout);

    chip.append(img, name, out);
    slot.append(chip);
    return;
  }

  const btn = document.createElement('button');
  btn.className = 'discord-btn';
  btn.type = 'button';
  btn.innerHTML =
    '<svg viewBox="0 0 24 18" aria-hidden="true" class="discord-logo"><path fill="currentColor" d="M20.3 1.6A19.8 19.8 0 0 0 15.4.1a14 14 0 0 0-.6 1.3 18.3 18.3 0 0 0-5.5 0A13.9 13.9 0 0 0 8.6.1a19.7 19.7 0 0 0-4.9 1.5C.6 6.2-.2 10.7.2 15.1a19.9 19.9 0 0 0 6 3 14.7 14.7 0 0 0 1.3-2.1 12.9 12.9 0 0 1-2-1c.2-.1.3-.2.5-.4a14.2 14.2 0 0 0 12.1 0l.5.4a12.9 12.9 0 0 1-2 1 14.5 14.5 0 0 0 1.2 2.1 19.8 19.8 0 0 0 6-3c.5-5.1-.8-9.6-3.5-13.5ZM8 12.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 7.6 8 7.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg><span>Sign in with Discord</span>';

  if (!configured) {
    btn.disabled = true;
    btn.title = 'Set your Discord client ID in js/config.js to enable sign-in';
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
  } else {
    btn.addEventListener('click', onLogin);
  }

  slot.append(btn);
}

/* ------------------------------------------------------------------ *
 * Notices
 * ------------------------------------------------------------------ */

export function notice(message) {
  const box = el('notice');
  if (!message) {
    box.hidden = true;
    return;
  }
  box.textContent = message;
  box.hidden = false;
}

/* ------------------------------------------------------------------ *
 * Verdict + factor cards
 * ------------------------------------------------------------------ */

export function setRankColor(rank) {
  document.documentElement.style.setProperty('--rank', rank.color);
}

export function renderRank(rank) {
  const box = el('verdict-rank');
  box.textContent = rank.label;
  box.dataset.len = String(rank.label.length);
  box.classList.remove('is-stamping');
  void box.offsetWidth;
  box.classList.add('is-stamping');
}

export function renderRarity(percentile, rank) {
  el('verdict-rarity').textContent = `${rank.name} — ${describeRarity(percentile).text}`;
}

export function renderMeta(result) {
  const parts = [
    `<b>${result.display}</b>`,
    `base <b>${result.base.toLocaleString()}</b>`,
    `×<b>${result.multiplier}</b>`,
    `${result.factors.length} factor${result.factors.length === 1 ? '' : 's'}`,
  ];
  el('verdict-meta').innerHTML = parts.join(' · ');
}

/**
 * Card emphasis is absolute, not relative: a 4,200-point factor is a modest
 * factor even when it is the only one on a low-scoring roll.
 */
function tierFor(points) {
  if (points >= 50000) return 'huge';
  if (points >= 8000) return 'big';
  return 'normal';
}

/** Flips the factor cards in one at a time. Resolves when all are shown. */
export function renderFactors(result, { stagger = 70 } = {}) {
  const box = el('factors');
  box.replaceChildren();

  const cards = [
    ...result.factors
      .slice()
      .sort((a, b) => b.points - a.points)
      .map((f) => ({
        kind: 'factor',
        name: f.name,
        detail: f.detail,
        value: `+${f.points.toLocaleString()}`,
        tier: tierFor(f.points),
      })),
    ...result.multipliers
      .filter((m) => m.value !== 1)
      .map((m) => ({
        kind: 'multiplier',
        name: m.name,
        detail: 'multiplier',
        value: `×${m.value}`,
        tier: 'normal',
      })),
  ];

  cards.forEach((card, i) => {
    const node = document.createElement('div');
    node.className = 'factor';
    node.dataset.tier = card.tier;
    node.dataset.kind = card.kind;
    node.style.animationDelay = `${i * stagger}ms`;

    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'factor-name';
    name.textContent = card.name;
    const detail = document.createElement('div');
    detail.className = 'factor-detail';
    detail.textContent = card.detail;
    left.append(name, detail);

    const pts = document.createElement('div');
    pts.className = 'factor-points';
    pts.textContent = card.value;

    node.append(left, pts);
    box.append(node);
  });

  return cards.length * stagger + 500;
}

export function clearVerdict() {
  el('verdict').dataset.state = 'empty';
  el('factors').replaceChildren();
}

export function showVerdict() {
  el('verdict').dataset.state = 'shown';
}

export function setCosmic(cosmic) {
  const box = el('cosmic');
  el('cosmic-value').textContent = `×${cosmic.value}`;
  el('cosmic-name').textContent = cosmic.label;
  box.classList.toggle('is-big', cosmic.value >= 3);
  if (cosmic.value > 1) {
    box.classList.remove('is-big');
    void box.offsetWidth;
    box.classList.toggle('is-big', cosmic.value >= 3);
  }
}

export function resetCosmic() {
  el('cosmic-value').textContent = '—';
  el('cosmic-name').textContent = 'rolling…';
  el('cosmic').classList.remove('is-big');
}

/* ------------------------------------------------------------------ *
 * Sidebar
 * ------------------------------------------------------------------ */

function emptyState(text) {
  const li = document.createElement('li');
  li.className = 'empty-state';
  li.textContent = text;
  return li;
}

export function renderBoard(entries, meId, { shared, error }) {
  const list = el('board');
  const note = el('board-note');
  list.replaceChildren();

  note.textContent = shared
    ? 'Global leaderboard — one entry per player, personal best.'
    : 'On-device leaderboard. Configure a leaderboard endpoint to play against everyone else.';

  if (error) {
    list.append(emptyState(error));
    return;
  }
  if (!entries.length) {
    list.append(emptyState('No scores yet.\nRoll something worth bragging about.'));
    return;
  }

  entries.forEach((entry, i) => {
    const li = document.createElement('li');
    li.style.animationDelay = `${Math.min(i, 12) * 22}ms`;
    if (entry.playerId && entry.playerId === meId) li.classList.add('is-you');

    const place = document.createElement('span');
    place.className = 'place';
    place.textContent = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}`;

    const img = document.createElement('img');
    img.src = entry.avatar || PLACEHOLDER_AVATAR;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      img.src = PLACEHOLDER_AVATAR;
    });

    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = entry.name || 'Anonymous';
    const sub = document.createElement('small');
    sub.textContent = entry.digits || '';
    who.append(sub);

    const rank = RANKS.find((r) => r.label === entry.rank);
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = entry.rank || '?';
    badge.style.color = rank?.color || 'var(--muted)';

    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = Number(entry.score).toLocaleString();
    pts.style.color = rank?.color || 'var(--text)';

    li.append(place, img, who, badge, pts);
    list.append(li);
  });
}

export function renderHistory(entries) {
  const list = el('history');
  list.replaceChildren();

  if (!entries.length) {
    list.append(emptyState('Your rolls will show up here.'));
    return;
  }

  entries.forEach((entry, i) => {
    const li = document.createElement('li');
    li.style.animationDelay = `${Math.min(i, 12) * 22}ms`;

    const digits = document.createElement('div');
    digits.className = 'digits';
    digits.textContent = entry.digits;
    const sub = document.createElement('small');
    sub.textContent = `×${entry.multipliers} · ${new Date(entry.at).toLocaleTimeString()}`;
    digits.append(sub);

    const rank = RANKS.find((r) => r.label === entry.rank);
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = entry.rank;
    badge.style.color = rank?.color || 'var(--muted)';

    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = entry.score.toLocaleString();
    pts.style.color = rank?.color || 'var(--text)';

    li.append(digits, badge, pts);
    list.append(li);
  });
}

export function renderStats(history) {
  const box = el('stats');
  box.replaceChildren();

  const scores = history.map((h) => h.score);
  const best = scores.length ? Math.max(...scores) : 0;
  const total = scores.reduce((a, b) => a + b, 0);
  const bestEntry = history.find((h) => h.score === best);

  const counts = new Map();
  for (const h of history) counts.set(h.rank, (counts.get(h.rank) || 0) + 1);

  const rows = [
    ['Rolls', scores.length.toLocaleString()],
    ['Best score', best.toLocaleString()],
    ['Best roll', bestEntry ? bestEntry.digits : '—'],
    ['Best rank', bestEntry ? bestEntry.rank : '—'],
    ['Average', scores.length ? Math.round(total / scores.length).toLocaleString() : '—'],
    ['divider'],
    ['Global median', DISTRIBUTION.median.toLocaleString()],
    ['Global mean', Math.round(DISTRIBUTION.mean).toLocaleString()],
    ['99th percentile', DISTRIBUTION.p99.toLocaleString()],
    ['Simulated rolls', SAMPLE_SIZE.toLocaleString()],
  ];

  for (const [label, value] of rows) {
    if (label === 'divider') {
      const hr = document.createElement('div');
      hr.className = 'stats-divider';
      box.append(hr);
      continue;
    }
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    box.append(dt, dd);
  }

  if (counts.size) {
    const hr = document.createElement('div');
    hr.className = 'stats-divider';
    box.append(hr);
    for (const r of RANKS) {
      if (!counts.has(r.label)) continue;
      const dt = document.createElement('dt');
      dt.textContent = `${r.label} — ${r.name}`;
      dt.style.color = r.color;
      const dd = document.createElement('dd');
      dd.textContent = String(counts.get(r.label));
      box.append(dt, dd);
    }
  }
}

export function initTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  const panels = [...document.querySelectorAll('.panel')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const t of tabs) {
        const active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      }
      for (const p of panels) p.classList.toggle('is-active', p.dataset.panel === tab.dataset.panel);
    });
  }
}
