/**
 * Rendering. Every function here takes data and writes DOM; none of them know
 * about the game loop.
 */


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

const DISCORD_LOGO =
  '<svg viewBox="0 0 24 18" aria-hidden="true" class="discord-logo"><path fill="currentColor" d="M20.3 1.6A19.8 19.8 0 0 0 15.4.1a14 14 0 0 0-.6 1.3 18.3 18.3 0 0 0-5.5 0A13.9 13.9 0 0 0 8.6.1a19.7 19.7 0 0 0-4.9 1.5C.6 6.2-.2 10.7.2 15.1a19.9 19.9 0 0 0 6 3 14.7 14.7 0 0 0 1.3-2.1 12.9 12.9 0 0 1-2-1c.2-.1.3-.2.5-.4a14.2 14.2 0 0 0 12.1 0l.5.4a12.9 12.9 0 0 1-2 1 14.5 14.5 0 0 0 1.2 2.1 19.8 19.8 0 0 0 6-3c.5-5.1-.8-9.6-3.5-13.5ZM8 12.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 7.6 8 7.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>';

/**
 * @param {object|null} session
 * @param {object} handlers
 * @param {Array}  handlers.providers   configured providers, e.g. [{id,label}]
 * @param {Function} handlers.mountProvider  (providerId, container) => void,
 *        used by providers that must render their own button (Google).
 */
export function renderAuth(
  session,
  { onLogin, onLogout, onReconnect, onSetup, mountProvider, providers = [], canReconnect, expiring },
) {
  const slot = el('auth-slot');
  slot.replaceChildren();

  if (session?.user) {
    const chip = document.createElement('div');
    chip.className = 'user-chip';
    chip.classList.toggle('is-expiring', Boolean(expiring));

    const img = document.createElement('img');
    img.src = session.user.avatar || PLACEHOLDER_AVATAR;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      img.src = PLACEHOLDER_AVATAR;
    });
    if (session.user.accent) img.style.borderColor = session.user.accent;

    const name = document.createElement('span');
    name.className = 'user-name';
    name.textContent = session.user.name;

    const badge = document.createElement('span');
    badge.className = 'provider-badge';
    badge.textContent = session.provider === 'google' ? 'G' : 'D';
    badge.title = `Signed in with ${session.provider === 'google' ? 'Google' : 'Discord'}`;

    const out = document.createElement('button');
    out.type = 'button';
    out.textContent = 'Sign out';
    out.addEventListener('click', onLogout);

    chip.append(img, name, badge, out);

    if (expiring) {
      const renew = document.createElement('button');
      renew.type = 'button';
      renew.textContent = 'Renew';
      renew.title = 'Your session expires soon';
      renew.style.color = 'var(--gold)';
      renew.addEventListener('click', onReconnect);
      chip.append(renew);
    }

    slot.append(chip);
    return;
  }

  // Nothing configured yet: offer the setup flow rather than a dead button.
  if (!providers.length) {
    const setup = document.createElement('button');
    setup.className = 'setup-btn';
    setup.type = 'button';
    setup.innerHTML = `${DISCORD_LOGO}<span>Set up sign-in</span>`;
    setup.addEventListener('click', onSetup);
    slot.append(setup);
    return;
  }

  // Signed out, but this browser has signed in before: offer a one-click
  // reconnect, which needs no consent screen.
  if (canReconnect) {
    const btn = document.createElement('button');
    btn.className = 'reconnect-btn';
    btn.type = 'button';
    btn.innerHTML = '<span aria-hidden="true">\u21bb</span><span>Reconnect</span>';
    btn.addEventListener('click', onReconnect);
    slot.append(btn);
  }

  const row = document.createElement('div');
  row.className = 'provider-row';

  for (const provider of providers) {
    if (provider.id === 'google') {
      // Google requires their own rendered button, so give it a host element
      // and let the provider fill it in.
      const host = document.createElement('div');
      host.className = 'google-host';
      row.append(host);
      mountProvider?.('google', host);
      continue;
    }

    const btn = document.createElement('button');
    btn.className = 'discord-btn';
    btn.type = 'button';
    btn.innerHTML = `${DISCORD_LOGO}<span>Sign in with Discord</span>`;
    btn.addEventListener('click', () => onLogin(provider.id));
    row.append(btn);
  }

  slot.append(row);
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

export function renderBoard(entries, meId, { shared, error, scope = 'all' }) {
  const list = el('board');
  const note = el('board-note');
  list.replaceChildren();

  if (scope === 'daily') {
    note.textContent = shared
      ? "Today's Daily Challenge. Every entry is recomputed server-side, so this board cannot be faked."
      : "Today's Daily Challenge, stored on this device.";
  } else {
    note.textContent = shared
      ? 'Global leaderboard — one entry per player, personal best.'
      : 'On-device leaderboard. Configure a leaderboard endpoint to play against everyone else.';
  }

  if (error) {
    list.append(emptyState(error));
    return;
  }
  if (!entries.length) {
    list.append(
      emptyState(
        scope === 'daily'
          ? 'Nobody has played today yet.'
          : 'No scores yet.\nRoll something worth bragging about.',
      ),
    );
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

/* ------------------------------------------------------------------ *
 * Achievements
 * ------------------------------------------------------------------ */

export function renderAwards(definitions, unlocked) {
  const list = el('awards');
  list.replaceChildren();

  const count = Object.keys(unlocked).length;
  el('awards-fill').style.width = `${(count / definitions.length) * 100}%`;
  el('awards-count').textContent = `${count} of ${definitions.length} unlocked`;

  // Unlocked first (most recent at the top), then the rest in definition order.
  const ordered = [
    ...definitions.filter((a) => unlocked[a.id]).sort((a, b) => unlocked[b.id] - unlocked[a.id]),
    ...definitions.filter((a) => !unlocked[a.id]),
  ];

  for (const award of ordered) {
    const isUnlocked = Boolean(unlocked[award.id]);
    const li = document.createElement('li');
    li.className = isUnlocked ? 'is-unlocked' : 'is-locked';

    const icon = document.createElement('span');
    icon.className = 'award-icon';
    // Secret achievements stay hidden until earned.
    icon.textContent = isUnlocked || !award.secret ? award.icon : '❔';

    const text = document.createElement('div');
    text.className = 'award-text';
    const name = document.createElement('div');
    name.className = 'award-name';
    name.textContent = isUnlocked || !award.secret ? award.name : 'Secret';
    const desc = document.createElement('div');
    desc.className = 'award-desc';
    desc.textContent = isUnlocked || !award.secret ? award.desc : 'Keep rolling.';
    text.append(name, desc);

    li.append(icon, text);
    list.append(li);
  }
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

export function toast({ icon = '🏆', label = 'ACHIEVEMENT', name, desc }, duration = 4600) {
  const host = el('toasts');
  const node = document.createElement('div');
  node.className = 'toast';

  const iconEl = document.createElement('span');
  iconEl.className = 'toast-icon';
  iconEl.textContent = icon;

  const body = document.createElement('div');
  const labelEl = document.createElement('div');
  labelEl.className = 'toast-label';
  labelEl.textContent = label;
  const nameEl = document.createElement('div');
  nameEl.className = 'toast-name';
  nameEl.textContent = name;
  body.append(labelEl, nameEl);

  if (desc) {
    const descEl = document.createElement('div');
    descEl.className = 'toast-desc';
    descEl.textContent = desc;
    body.append(descEl);
  }

  node.append(iconEl, body);
  host.append(node);

  setTimeout(() => {
    node.classList.add('is-leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  }, duration);
}

/* ------------------------------------------------------------------ *
 * Mode switch / daily status
 * ------------------------------------------------------------------ */

export function initModeSwitch(onChange) {
  const buttons = [...document.querySelectorAll('.mode')];
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      for (const b of buttons) {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', String(active));
      }
      onChange(btn.dataset.mode);
    });
  }
}

export function initScopeSwitch(onChange) {
  const buttons = [...document.querySelectorAll('.scope')];
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      for (const b of buttons) {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', String(active));
      }
      onChange(btn.dataset.scope);
    });
  }
}

export function setDailyAvailable(available) {
  el('daily-dot').hidden = !available;
}

export function setDailyStatus(html) {
  const box = el('daily-status');
  if (!html) {
    box.hidden = true;
    return;
  }
  box.innerHTML = html;
  box.hidden = false;
}

export function setRollButton({ label, sub, disabled }) {
  const btn = el('roll-btn');
  btn.querySelector('.roll-btn-label').textContent = label;
  btn.querySelector('.roll-btn-sub').textContent = sub;
  btn.disabled = disabled;
}

/* ------------------------------------------------------------------ *
 * Share
 * ------------------------------------------------------------------ */

export function showShare(visible) {
  el('share-row').hidden = !visible;
}

/** Momentary "Copied" confirmation on a share button. */
export function flashButton(button, text) {
  const original = button.textContent;
  button.textContent = text;
  button.classList.add('is-done');
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove('is-done');
  }, 1800);
}
