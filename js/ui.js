/**
 * Rendering. Every function here takes data and writes DOM; none of them know
 * about the game loop.
 */

import { RANKS, describeRarity, DISTRIBUTION, SAMPLE_SIZE } from './ranks.js';

export const el = (id) => document.getElementById(id);

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
    `target <b>${result.targetDisplay}</b>`,
    `you <b>${result.display}</b>`,
    `<b>${result.bullseyes}</b> bullseye${result.bullseyes === 1 ? '' : 's'}`,
    `distance <b>${result.totalDistance}</b>`,
  ];
  el('verdict-meta').innerHTML = parts.join(' · ');
}

/**
 * Card emphasis is absolute, not relative: a 4,200-point factor is a modest
 * factor even when it is the only one on a low-scoring day.
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

  const cards = result.factors
    .slice()
    .sort((a, b) => b.points - a.points)
    .map((f) => ({
      kind: 'factor',
      name: f.name,
      detail: f.detail,
      value: `+${f.points.toLocaleString()}`,
      tier: tierFor(f.points),
    }));

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

/* ------------------------------------------------------------------ *
 * The record panels
 * ------------------------------------------------------------------ */

function emptyState(text) {
  const li = document.createElement('li');
  li.className = 'empty-state';
  li.textContent = text;
  return li;
}

export function renderHistory(entries) {
  const list = el('history');
  list.replaceChildren();

  if (!entries.length) {
    list.append(emptyState('Your past days will show up here.'));
    return;
  }

  entries.forEach((entry, i) => {
    const li = document.createElement('li');
    li.style.animationDelay = `${Math.min(i, 12) * 22}ms`;

    const main = document.createElement('div');
    main.className = 'digits';
    main.textContent = entry.digits;
    const sub = document.createElement('small');
    sub.textContent = `${entry.day} · ${entry.bullseyes}◎ · dist ${entry.totalDistance}`;
    main.append(sub);

    const rank = RANKS.find((r) => r.label === entry.rank);
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = entry.rank;
    badge.style.color = rank?.color || 'var(--muted)';

    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = entry.score.toLocaleString();
    pts.style.color = rank?.color || 'var(--text)';

    li.append(main, badge, pts);
    list.append(li);
  });
}

export function renderStats(history, streak = 0) {
  const box = el('stats');
  box.replaceChildren();

  const scores = history.map((h) => h.score);
  const best = scores.length ? Math.max(...scores) : 0;
  const total = scores.reduce((a, b) => a + b, 0);
  const bestEntry = history.find((h) => h.score === best);
  const bullseyes = history.reduce((a, h) => a + (h.bullseyes || 0), 0);
  const perfectDigits = history.length * 9;

  const counts = new Map();
  for (const h of history) counts.set(h.rank, (counts.get(h.rank) || 0) + 1);

  const rows = [
    ['Days played', history.length.toLocaleString()],
    ['Current streak', String(streak)],
    ['Best score', best.toLocaleString()],
    ['Best day', bestEntry ? bestEntry.day : '—'],
    ['Best rank', bestEntry ? bestEntry.rank : '—'],
    ['Average', scores.length ? Math.round(total / scores.length).toLocaleString() : '—'],
    [
      'Bullseye rate',
      perfectDigits ? `${((bullseyes / perfectDigits) * 100).toFixed(1)}%` : '—',
    ],
    ['divider'],
    ['Global median', DISTRIBUTION.median.toLocaleString()],
    ['Global mean', Math.round(DISTRIBUTION.mean).toLocaleString()],
    ['99th percentile', DISTRIBUTION.p99.toLocaleString()],
    ['Days simulated', SAMPLE_SIZE.toLocaleString()],
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
 * Controls
 * ------------------------------------------------------------------ */

export function setRollButton({ label, sub, disabled }) {
  const btn = el('roll-btn');
  btn.querySelector('.roll-btn-label').textContent = label;
  btn.querySelector('.roll-btn-sub').textContent = sub;
  btn.disabled = disabled;
}

/** Swaps between the single ROLL button and the keep/re-roll pair. */
export function showDecision(visible) {
  el('roll-btn').hidden = visible;
  el('decision').hidden = !visible;
}

/**
 * The one real decision in the game, stated in the only unit that matters.
 *
 * "distance 2" alone asks the player to remember a scoring table; "Keep +150"
 * against "a re-roll averages +223" puts both sides of the trade on the buttons
 * themselves. It is not advice — an unspent re-roll is worth 250 at the end and
 * there are only three, so the arithmetic still doesn't decide for you.
 */
export function setDecision({ distance, points, average, rerollsLeft, isLast }) {
  el('reroll-sub').textContent =
    rerollsLeft > 0
      ? `${rerollsLeft} left · avg +${Math.round(average)}`
      : 'none left';
  el('reroll-btn').disabled = rerollsLeft <= 0;
  el('keep-title').textContent = `${isLast ? 'Finish' : 'Keep'} +${points.toLocaleString()}`;
  el('keep-sub').textContent = distance === 0 ? 'bullseye!' : `${distance} away`;
}

export function renderRerolls(left, total) {
  const host = el('reroll-pips');
  const existing = [...host.children];

  if (existing.length !== total) {
    host.replaceChildren();
    for (let i = 0; i < total; i++) {
      const pip = document.createElement('span');
      pip.className = 'pip';
      host.append(pip);
    }
  }

  [...host.children].forEach((pip, i) => {
    const spent = i >= left;
    // Animate only the pip that just went out, not every spent one.
    if (spent && !pip.classList.contains('is-spent')) {
      pip.classList.add('is-spending');
      setTimeout(() => pip.classList.remove('is-spending'), 520);
    }
    pip.classList.toggle('is-spent', spent);
  });
  host.setAttribute('aria-label', `${left} of ${total} re-rolls remaining`);
}

export function setStatus(html) {
  el('status').innerHTML = html || '';
}

export function setPuzzleNumber(n) {
  el('puzzle-no').textContent = `#${n}`;
}

/**
 * The live readout.
 *
 * Mid-run the middle cell is the solver's expected final score from the current
 * position, so it moves as the run goes well or badly — the number you end up
 * chasing. Once the run is over that number is meaningless, so the cell swaps
 * to the score it was chasing: your best. Either way the comparison is the
 * point, and the bar lights when you're winning it.
 */
export function setLive({ score, pace, bullseyes, best, done = false }) {
  const target = done ? best : pace;
  el('live-score').textContent = Math.round(score).toLocaleString();
  el('live-pace-label').textContent = done ? 'YOUR BEST' : 'ON PACE FOR';
  el('live-pace').textContent = target ? Math.round(target).toLocaleString() : '—';
  el('live-bulls').textContent = String(bullseyes);

  const ahead = done ? Boolean(best) && score >= best : Boolean(best) && pace !== null && pace > best;
  const bar = el('livebar');
  bar.classList.toggle('is-ahead', ahead);
  el('live-pace').title = best ? `Your best so far: ${best.toLocaleString()}` : '';
}

/** Brief emphasis when a digit lands well (or agonisingly close). */
export function flashLive(kind) {
  const bar = el('livebar');
  bar.classList.remove('is-hit', 'is-near');
  void bar.offsetWidth;
  if (kind) bar.classList.add(kind === 'hit' ? 'is-hit' : 'is-near');
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

/* ------------------------------------------------------------------ *
 * Trophy
 * ------------------------------------------------------------------ */

/**
 * The trophy line under the live readout.
 *
 * @param {object} g
 * @param {number} g.banked   points locked in so far (or the final score)
 * @param {number|null} g.pace  where the solver says the run ends up; null once done
 * @param {number} g.goal     the trophy score
 * @param {boolean} g.won     the finished day beat it
 */
export function setGoal({ banked, pace, goal, won }) {
  const pct = (n) => `${Math.max(0, Math.min(1, n / goal)) * 100}%`;
  el('goal-fill').style.width = pct(banked);
  el('goal-pace').style.width = pace === null ? '0%' : pct(pace);

  const onPace = pace !== null && pace > goal;
  const box = el('goal');
  box.classList.toggle('is-hot', onPace || won);
  box.classList.toggle('is-won', Boolean(won));

  const label = won ? 'WON' : onPace ? 'on pace!' : goal.toLocaleString();
  el('goal-label').innerHTML = `<span aria-hidden="true">🏆</span> ${label}`;
}

export function setTrophyCount(n) {
  const badge = el('trophy-count');
  badge.textContent = String(n);
  badge.hidden = n === 0;
}

/** The cabinet: every trophy won, oldest first so each keeps its number. */
export function renderCabinet(trophies, { puzzleOf, onOpen, onShow, oneIn }) {
  const list = el('cabinet');
  const note = el('cabinet-note');
  list.replaceChildren();

  if (!trophies.length) {
    note.textContent = '';
    const li = document.createElement('li');
    li.className = 'cabinet-empty';
    const text = document.createElement('p');
    text.textContent = `No trophies yet. Score more than 7,500 in a day to win a real one — about 1 day in ${oneIn} gets there.`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'share-btn';
    btn.textContent = 'See the trophy';
    btn.addEventListener('click', onShow);
    li.append(text, btn);
    list.append(li);
    return;
  }

  note.textContent = `${trophies.length} won. Open one to screenshot it for #guessle.`;
  trophies.forEach((t, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cabinet-item';
    btn.style.animationDelay = `${Math.min(i, 10) * 45}ms`;
    btn.setAttribute('aria-label', `Trophy ${i + 1}: ${t.score.toLocaleString()} on ${t.day}`);

    const icon = document.createElement('span');
    icon.className = 'cabinet-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '🏆';

    const score = document.createElement('span');
    score.className = 'cabinet-score';
    score.textContent = t.score.toLocaleString();

    const meta = document.createElement('span');
    meta.className = 'cabinet-meta';
    meta.textContent = `#${puzzleOf(t.day)} · ${t.day}`;

    btn.append(icon, score, meta);
    btn.addEventListener('click', () => onOpen(t, i + 1));
    li.append(btn);
    list.append(li);
  });
}

/** Twinkling motes around the trophy. Built once per stage. */
export function fillSparkles(stage, count = 18) {
  const host = stage.querySelector('.sparkles');
  if (!host || host.childElementCount) return;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.style.left = `${8 + Math.random() * 84}%`;
    s.style.top = `${10 + Math.random() * 78}%`;
    s.style.animationDelay = `${Math.random() * 3}s`;
    s.style.animationDuration = `${2.2 + Math.random() * 2.4}s`;
    s.style.setProperty('--size', `${2 + Math.random() * 4}px`);
    host.append(s);
  }
}

/**
 * Confetti inside a dialog. The page's particle canvas sits *under* the top
 * layer a modal dialog lives in, so a burst there would fire behind the
 * backdrop where nobody can see it. These are plain elements inside the dialog.
 */
export function throwConfetti(stage, count = 70) {
  const host = stage.querySelector('.confetti');
  if (!host) return;
  host.replaceChildren();
  const colours = ['#ffc857', '#ffe7a6', '#ff8f5d', '#6ee7ff', '#c084fc', '#ffffff'];
  for (let i = 0; i < count; i++) {
    const c = document.createElement('span');
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = colours[i % colours.length];
    c.style.animationDelay = `${Math.random() * 0.5}s`;
    c.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
    c.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
    c.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`);
    c.style.width = `${5 + Math.random() * 6}px`;
    c.style.height = `${8 + Math.random() * 8}px`;
    host.append(c);
  }
  setTimeout(() => host.replaceChildren(), 4200);
}
