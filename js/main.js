/**
 * Game loop and wiring.
 */

import { rollDigits, rollCosmic, scoreRoll, timeBonus, highlightIndices } from './scoring.js';
import { percentileOf, rankFor, RANKS, SAMPLE_SIZE } from './ranks.js';
import { mountReels, spin, setDigits, highlight, clearHighlights } from './reels.js';
import { startStarfield, initParticles, burst, countUp, shake, wait } from './fx.js';
import * as audio from './audio.js';
import * as auth from './discord.js';
import * as board from './leaderboard.js';
import { resolved, redirectUri } from './config.js';
import * as ui from './ui.js';

const HISTORY_KEY = 'rngdle_history';

const state = {
  rolling: false,
  history: [],
  streak: 0,
  lastTotal: null,
};

/* ------------------------------------------------------------------ *
 * Randomness — crypto-backed, so rolls aren't Math.random()'s problem.
 * ------------------------------------------------------------------ */

const pool = new Uint32Array(64);
let poolIndex = pool.length;

function random() {
  if (poolIndex >= pool.length) {
    crypto.getRandomValues(pool);
    poolIndex = 0;
  }
  return pool[poolIndex++] / 4294967296;
}

/* ------------------------------------------------------------------ *
 * History persistence
 * ------------------------------------------------------------------ */

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    state.history = raw ? JSON.parse(raw) : [];
  } catch {
    state.history = [];
  }
}

function saveHistory(entry) {
  state.history.unshift(entry);
  state.history = state.history.slice(0, resolved().historyLimit);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Leaderboard
 * ------------------------------------------------------------------ */

async function refreshBoard() {
  const session = auth.currentSession();
  const meId = session?.user?.id || 'guest';
  try {
    const entries = await board.listTop();
    ui.renderBoard(entries, meId, { shared: board.isShared() });
  } catch (err) {
    ui.renderBoard([], meId, { shared: board.isShared(), error: err.message });
  }
}

/* ------------------------------------------------------------------ *
 * The roll
 * ------------------------------------------------------------------ */

async function roll() {
  if (state.rolling) return;
  state.rolling = true;

  const button = ui.el('roll-btn');
  const machine = document.querySelector('.machine');
  button.disabled = true;
  audio.unlock();

  ui.clearVerdict();
  ui.resetCosmic();
  clearHighlights();
  machine.classList.remove('is-lit');

  const digits = rollDigits(random);
  const cosmic = rollCosmic(random);
  const streak =
    state.streak > 0
      ? { value: 1 + Math.min(state.streak, 10) * 0.1, label: `Hot Streak ×${state.streak}` }
      : null;
  const time = timeBonus();

  audio.whoosh();
  await spin(digits, (i) => audio.tick(i));

  const result = { ...scoreRoll(digits, cosmic, { streak, time }), cosmic };
  const percentile = percentileOf(result.total);
  const rank = rankFor(percentile);
  const rankIndex = RANKS.indexOf(rank);

  await wait(160);
  ui.setCosmic(cosmic);
  audio.cosmicHit(cosmic.value);

  await wait(340);

  ui.setRankColor(rank);
  machine.classList.add('is-lit');
  ui.showVerdict();
  ui.renderMeta(result);
  highlight(highlightIndices(digits));

  const countDuration = 900 + Math.min(rankIndex, 8) * 90;
  audio.counting(6 + rankIndex);
  ui.renderFactors(result);
  await countUp(ui.el('verdict-score'), result.total, countDuration);

  ui.renderRank(rank);
  ui.renderRarity(percentile, rank);
  audio.fanfare(rankIndex);

  if (rankIndex >= 7) {
    audio.thud();
    shake(document.body, true);
    burst(ui.el('verdict-rank'), { count: 220, colors: [rank.color, '#fff', '#ffc857'], power: 1.5 });
    setTimeout(() => burst(machine, { count: 160, colors: [rank.color, '#fff'], power: 1.3 }), 260);
  } else if (rankIndex >= 5) {
    shake(document.body, false);
    burst(ui.el('verdict-rank'), { count: 130, colors: [rank.color, '#ffc857'], power: 1.15 });
  } else if (rankIndex >= 4) {
    burst(ui.el('verdict-rank'), { count: 70, colors: [rank.color] });
  }

  // Streak is judged against the previous roll only.
  state.streak = state.lastTotal !== null && result.total > state.lastTotal ? state.streak + 1 : 0;
  state.lastTotal = result.total;

  const entry = board.entryFor(result, percentile, rank);
  saveHistory(entry);
  ui.renderHistory(state.history);
  ui.renderStats(state.history);

  try {
    await board.submitScore(entry);
    ui.notice(null);
  } catch (err) {
    ui.notice(`Could not submit score: ${err.message}`);
  }
  await refreshBoard();

  button.disabled = false;
  state.rolling = false;
}

/* ------------------------------------------------------------------ *
 * Setup
 * ------------------------------------------------------------------ */

function setupHelp() {
  const dialog = ui.el('help-dialog');
  ui.el('help-btn').addEventListener('click', () => dialog.showModal());
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  ui.el('help-calibration').textContent =
    `Ranks are not arbitrary thresholds. The scoring engine was run over ${SAMPLE_SIZE.toLocaleString()} ` +
    'simulated rolls, and your rank is your position in that distribution. "Top 0.01%" means exactly that.';

  const cfg = resolved();
  const setup = ui.el('help-setup');
  if (cfg.discordClientId) {
    setup.innerHTML = `Sign-in is enabled. The leaderboard is ${
      board.isShared() ? 'shared across all players.' : 'stored on this device only.'
    }`;
  } else {
    setup.innerHTML = `Discord sign-in is not configured yet. Add your application's client ID to <code>js/config.js</code> and register this redirect URI in the Discord developer portal: <code>${redirectUri()}</code>`;
  }
}

function setupSound() {
  const btn = ui.el('sound-toggle');
  const paint = () => {
    const on = audio.isEnabled();
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('[data-sound-on]').hidden = !on;
    btn.querySelector('[data-sound-off]').hidden = on;
  };
  btn.addEventListener('click', () => {
    audio.setEnabled(!audio.isEnabled());
    paint();
  });
  paint();
}

function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (ui.el('help-dialog').open) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      roll();
    }
  });
}

async function init() {
  startStarfield(ui.el('starfield'));
  initParticles(ui.el('particles'));
  mountReels(ui.el('reels'));
  ui.initTabs();
  setupHelp();
  setupSound();
  setupKeyboard();

  loadHistory();
  ui.renderHistory(state.history);
  ui.renderStats(state.history);
  if (state.history.length) setDigits([...state.history[0].digits].map(Number));

  ui.el('roll-btn').addEventListener('click', roll);

  auth.onAuthChange((session) => {
    ui.renderAuth(session, {
      configured: auth.isConfigured(),
      onLogin: () => auth.login(),
      onLogout: () => {
        auth.logout();
        refreshBoard();
      },
    });
  });

  const authError = await auth.initAuth();
  if (authError) ui.notice(authError);

  await refreshBoard();
}

init();
