/**
 * Game loop and wiring.
 */

import { ROLL_LENGTH, REROLLS_PER_DAY, rollDigit, distance } from './scoring.js';
import { percentileOf, rankFor, celebration, RANKS, SAMPLE_SIZE } from './ranks.js';
import {
  mountLanes,
  setTarget,
  setDigit,
  setDelta,
  setLaneState,
  markSettled,
  spinOne,
  flashBullseye,
  laneElement,
} from './reels.js';
import { startStarfield, initParticles, burst, countUp, shake, pressRipple, buzz } from './fx.js';
import * as audio from './audio.js';
import * as auth from './auth.js';
import * as board from './leaderboard.js';
import * as daily from './daily.js';
import * as game from './game.js';
import * as achievements from './achievements.js';
import * as share from './share.js';
import * as profile from './profile.js';
import { resolved, overrides, saveOverrides, clearOverrides, isValidGoogleClientId, jsOrigin } from './config.js';
import * as ui from './ui.js';

const state = {
  busy: false,
  scope: 'daily',
  history: [],
  countdownTimer: null,
  lastResult: null,
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

const playerId = () => auth.playerKey() || daily.guestId();

/* ------------------------------------------------------------------ *
 * Stored results
 * ------------------------------------------------------------------ */

function loadHistory() {
  state.history = profile.read(profile.STORES.history, playerId(), []);
}

function saveResult(entry) {
  // One row per day: replaying the same day should update, never duplicate.
  state.history = [entry, ...state.history.filter((h) => h.day !== entry.day)].slice(
    0,
    resolved().historyLimit,
  );
  profile.write(profile.STORES.history, playerId(), state.history);
}

function readStreak() {
  return profile.read(profile.STORES.dailyStreak, playerId(), { count: 0, last: null });
}

/** Increments when today follows yesterday, resets after any gap. */
function bumpStreak(today = daily.dateKey()) {
  const record = readStreak();
  if (record.last === today) return record.count;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const count = record.last === yesterday ? record.count + 1 : 1;
  profile.write(profile.STORES.dailyStreak, playerId(), { count, last: today });
  return count;
}

/* ------------------------------------------------------------------ *
 * Leaderboard
 * ------------------------------------------------------------------ */

async function refreshBoard() {
  const meId = playerId();
  try {
    const entries = await board.listTop(state.scope);
    ui.renderBoard(entries, meId, {
      shared: board.isShared(),
      scope: state.scope,
      onConnect: () => openSetup({ focus: 'endpoint' }),
    });
  } catch (err) {
    ui.renderBoard([], meId, {
      shared: board.isShared(),
      scope: state.scope,
      error: err.message,
      onConnect: () => openSetup({ focus: 'endpoint' }),
    });
  }
}

/* ------------------------------------------------------------------ *
 * Painting the board state
 * ------------------------------------------------------------------ */

function stopCountdown() {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
}

function startCountdown() {
  stopCountdown();
  const paint = () => {
    ui.setStatus(
      `Next target in <b>${daily.formatCountdown(daily.msUntilNextDaily())}</b> · streak <b>${
        readStreak().count
      }</b>`,
    );
  };
  paint();
  state.countdownTimer = setInterval(paint, 1000);
}

/** Redraws lanes, pips and controls from the persisted game state. */
function paintGame({ animateLast = false } = {}) {
  const snap = game.snapshot();

  setTarget(snap.target);
  ui.renderRerolls(snap.rerollsLeft, REROLLS_PER_DAY);

  for (let i = 0; i < ROLL_LENGTH; i++) {
    if (i < snap.rolled.length) {
      if (!animateLast || i < snap.rolled.length - 1) setDigit(i, snap.rolled[i], { silent: true });
      markSettled(i, true);
      setDelta(i, snap.distances[i]);
      setLaneState(i, 'settled');
    } else if (i === snap.index && snap.phase !== 'done') {
      markSettled(i, snap.phase === 'deciding');
      setDelta(i, snap.phase === 'deciding' ? distance(snap.target[i], snap.pending) : null);
      setLaneState(i, snap.phase === 'deciding' ? 'pending' : 'active');
      if (snap.phase === 'deciding') setDigit(i, snap.pending, { silent: true });
    } else {
      markSettled(i, false);
      setDelta(i, null);
      setLaneState(i, 'waiting');
    }
  }

  if (snap.phase === 'done') {
    ui.showDecision(false);
    ui.setRollButton({ label: 'DONE FOR TODAY', sub: 'come back tomorrow', disabled: true });
    startCountdown();
    return;
  }

  stopCountdown();

  if (snap.phase === 'deciding') {
    ui.showDecision(true);
    ui.setDecision({
      distance: distance(snap.target[snap.index], snap.pending),
      rerollsLeft: snap.rerollsLeft,
      isLast: snap.index === ROLL_LENGTH - 1,
    });
    ui.setStatus(
      `Digit <b>${snap.index + 1}</b> of ${ROLL_LENGTH} · aiming for <b>${snap.target[snap.index]}</b>`,
    );
  } else {
    ui.showDecision(false);
    ui.setRollButton({
      label: `ROLL DIGIT ${snap.index + 1}`,
      sub: 'press space',
      disabled: state.busy,
    });
    ui.setStatus(
      `Digit <b>${snap.index + 1}</b> of ${ROLL_LENGTH} · aiming for <b>${snap.target[snap.index]}</b>`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

async function roll() {
  const snap = game.snapshot();
  if (state.busy || snap.phase !== 'ready') return;

  state.busy = true;
  ui.setRollButton({ label: `ROLL DIGIT ${snap.index + 1}`, sub: 'rolling…', disabled: true });
  audio.unlock();

  const i = snap.index;
  setLaneState(i, 'active');
  audio.whoosh();

  const digit = rollDigit(random);
  await spinOne(i, digit);
  audio.tick(i);

  const next = game.settle(digit);
  const d = distance(snap.target[i], digit);

  setDigit(i, digit, { silent: true });
  setDelta(i, d);
  markSettled(i, true);

  if (d === 0) {
    flashBullseye(i);
    audio.cosmicHit(5);
    burst(laneElement(i), { count: 60, colors: ['#4ade80', '#ffffff'], power: 0.9 });
  }

  state.busy = false;

  // settle() auto-keeps when no re-rolls remain, so the phase tells us whether
  // a decision was actually offered.
  if (next.phase === 'done') return finish();
  paintGame();
}

function keep() {
  if (state.busy) return;
  audio.release();
  const next = game.keep();
  if (next.phase === 'done') return finish();
  paintGame();
}

function doReroll() {
  if (state.busy) return;
  const snap = game.snapshot();
  if (snap.rerollsLeft <= 0) return;

  audio.thud();
  buzz(18);
  const i = snap.index;
  setDelta(i, null);
  markSettled(i, false);
  game.reroll();
  paintGame();
}

/* ------------------------------------------------------------------ *
 * Finishing the day
 * ------------------------------------------------------------------ */

async function finish() {
  const result = game.result();
  if (!result) return;

  const percentile = percentileOf(result.total);
  const rank = rankFor(percentile);
  const rankIndex = RANKS.indexOf(rank);
  const machine = document.querySelector('.machine');

  paintGame();
  ui.setRankColor(rank);
  machine.classList.add('is-lit');
  ui.showVerdict();
  ui.renderMeta(result);

  audio.counting(6 + rankIndex);
  ui.renderFactors(result);
  await countUp(ui.el('verdict-score'), result.total, 900 + Math.min(rankIndex, 12) * 70);

  ui.renderRank(rank);
  ui.renderRarity(percentile, rank);
  audio.fanfare(rankIndex);

  const party = celebration(rankIndex);
  if (party >= 3) {
    audio.thud();
    shake(document.body, true);
    burst(ui.el('verdict-rank'), { count: 260, colors: [rank.color, '#fff', '#ffc857'], power: 1.6 });
    setTimeout(() => burst(machine, { count: 180, colors: [rank.color, '#fff'], power: 1.35 }), 260);
  } else if (party >= 2) {
    audio.thud();
    shake(document.body, true);
    burst(ui.el('verdict-rank'), { count: 180, colors: [rank.color, '#fff', '#ffc857'], power: 1.35 });
  } else if (party >= 1) {
    shake(document.body, false);
    burst(ui.el('verdict-rank'), { count: 120, colors: [rank.color, '#ffc857'], power: 1.15 });
  } else if (party > 0) {
    burst(ui.el('verdict-rank'), { count: 70, colors: [rank.color] });
  }

  const streak = bumpStreak(result.day || daily.dateKey());
  const entry = board.entryFor(result, percentile, rank);
  saveResult(entry);
  loadHistory();
  ui.renderHistory(state.history);
  ui.renderStats(state.history, streak);

  state.lastResult = { result, rank, percentile };
  ui.showShare(true);

  const unlocked = achievements.evaluate({
    playerId: playerId(),
    result,
    rank,
    rankIndex,
    percentile,
    totals: { days: state.history.length, streak },
  });
  unlocked.forEach((award, i) => {
    setTimeout(() => {
      ui.toast({ icon: award.icon, name: award.name, desc: award.desc });
      audio.fanfare(3);
    }, 500 + i * 700);
  });
  if (unlocked.length) {
    ui.renderAwards(achievements.ACHIEVEMENTS, achievements.progress(playerId()).unlocked);
  }

  try {
    await board.submitScore(entry, 'daily');
    ui.notice(null);
  } catch (err) {
    ui.notice(`Could not submit score: ${err.message}`);
  }
  await refreshBoard();
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
    `Your rank is your position among ${SAMPLE_SIZE.toLocaleString()} simulated days played by a ` +
    'solver that always makes the best re-roll decision. Beating the percentile means you got luckier ' +
    'than perfect play, not that you out-thought it.';

  setupHelpText();
}

function setupHelpText() {
  const setup = ui.el('help-setup');
  setup.textContent = resolved().googleClientId
    ? `Google sign-in is enabled. The leaderboard is ${
        board.isShared() ? 'shared across all players.' : 'stored on this device only.'
      }`
    : 'Google sign-in is not configured yet. It takes about a minute and needs no server — a client ID is public.';
}

function setupSetupDialog() {
  const dialog = ui.el('setup-dialog');
  const form = ui.el('setup-form');
  const googleIdInput = ui.el('setup-google-id');
  const endpointInput = ui.el('setup-endpoint');
  const error = ui.el('setup-error');

  ui.el('setup-origin').textContent = jsOrigin();

  const open = ({ focus = 'client' } = {}) => {
    const current = overrides();
    const active = resolved();
    googleIdInput.value = current.googleClientId || active.googleClientId || '';
    endpointInput.value = current.leaderboardEndpoint || active.leaderboardEndpoint || '';
    error.hidden = true;
    dialog.showModal();

    if (focus === 'endpoint') {
      // Arrived from "Play against everyone" — start where that answer lives.
      ui.el('shared-board-heading').scrollIntoView({ block: 'start' });
      endpointInput.focus();
    } else {
      googleIdInput.focus();
    }
  };

  ui.el('open-setup').addEventListener('click', () => {
    ui.el('help-dialog').close();
    open();
  });

  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  const copyBtn = ui.el('copy-origin');
  copyBtn.addEventListener('click', async () => {
    const ok = await share.copyText(jsOrigin());
    ui.flashButton(copyBtn, ok ? 'Copied!' : 'Select it');
  });

  ui.el('setup-clear').addEventListener('click', () => {
    clearOverrides();
    auth.logout();
    googleIdInput.value = '';
    endpointInput.value = '';
    error.hidden = true;
    dialog.close();
    setupHelpText();
    paintAuth(auth.currentSession());
    refreshBoard();
  });

  const fail = (message, input) => {
    error.textContent = message;
    error.hidden = false;
    input?.focus();
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const googleId = googleIdInput.value.trim();
    const endpoint = endpointInput.value.trim();

    if (!googleId && !endpoint) {
      return fail('Paste a Google client ID, a leaderboard endpoint, or both.', googleIdInput);
    }
    if (googleId && !isValidGoogleClientId(googleId)) {
      return fail(
        'That does not look like a Google client ID. It ends in .apps.googleusercontent.com — copy the Client ID, not the client secret.',
        googleIdInput,
      );
    }
    if (endpoint && !/^https?:\/\//.test(endpoint)) {
      return fail('The leaderboard endpoint must start with https://', endpointInput);
    }
    if (!saveOverrides({ googleClientId: googleId, leaderboardEndpoint: endpoint })) {
      return fail('This browser is blocking storage, so settings cannot be saved here.');
    }

    dialog.close();
    setupHelpText();
    paintAuth(auth.currentSession());
    refreshBoard();
  });

  return { open };
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

/**
 * Press feedback fires on pointerdown rather than click: the gap between
 * pressing and releasing is exactly where a button feels dead.
 */
function setupRollButton() {
  const btn = ui.el('roll-btn');
  const down = (event) => {
    if (btn.disabled) return;
    btn.classList.add('is-pressed');
    audio.unlock();
    audio.press();
    buzz(12);
    pressRipple(btn, event);
  };
  const up = () => btn.classList.remove('is-pressed');

  btn.addEventListener('pointerdown', down);
  for (const evt of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(evt, up);
  btn.addEventListener('click', roll);

  window.addEventListener('rngdle:press', () => {
    if (btn.disabled) return;
    down();
    setTimeout(up, 110);
  });

  ui.el('keep-btn').addEventListener('click', keep);
  ui.el('reroll-btn').addEventListener('click', doReroll);
}

function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (ui.el('help-dialog').open || ui.el('setup-dialog').open) return;

    const phase = game.snapshot().phase;

    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (phase === 'deciding') keep();
      else {
        window.dispatchEvent(new Event('rngdle:press'));
        roll();
      }
      return;
    }
    // R is only meaningful while a digit is awaiting a decision.
    if ((e.code === 'KeyR' || e.code === 'Backspace') && phase === 'deciding') {
      e.preventDefault();
      doReroll();
    }
  });
}

function setupShare() {
  const cardBtn = ui.el('share-card');
  const textBtn = ui.el('share-text');

  cardBtn.addEventListener('click', async () => {
    if (!state.lastResult) return;
    const { result, rank, percentile } = state.lastResult;
    const user = auth.currentUser();
    const canvas = share.renderCard(result, rank, percentile, {
      day: daily.dateKey(),
      puzzle: daily.puzzleNumber(),
      player: user ? user.name : null,
    });
    try {
      const outcome = await share.shareCard(canvas, `gussle-${daily.dateKey()}.png`);
      ui.flashButton(cardBtn, outcome === 'copied' ? 'Copied!' : 'Downloaded');
    } catch {
      ui.flashButton(cardBtn, 'Failed');
    }
  });

  textBtn.addEventListener('click', async () => {
    if (!state.lastResult) return;
    const { result, rank, percentile } = state.lastResult;
    const ok = await share.copyText(
      share.shareText(result, rank, percentile, { puzzle: daily.puzzleNumber() }),
    );
    ui.flashButton(textBtn, ok ? 'Copied!' : 'Press Ctrl+C');
  });
}

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

function reloadProfile() {
  loadHistory();
  game.load(playerId());
  ui.renderHistory(state.history);
  ui.renderStats(state.history, readStreak().count);
  ui.renderAwards(achievements.ACHIEVEMENTS, achievements.progress(playerId()).unlocked);

  ui.clearVerdict();
  ui.showShare(false);
  document.querySelector('.machine').classList.remove('is-lit');
  paintGame();

  if (game.isFinished()) {
    // Re-display a day already played rather than pretending it's unplayed.
    const result = game.result();
    const percentile = percentileOf(result.total);
    const rank = rankFor(percentile);
    ui.setRankColor(rank);
    document.querySelector('.machine').classList.add('is-lit');
    ui.showVerdict();
    ui.el('verdict-score').textContent = result.total.toLocaleString();
    ui.renderRank(rank);
    ui.renderRarity(percentile, rank);
    ui.renderMeta(result);
    ui.renderFactors(result);
    state.lastResult = { result, rank, percentile };
    ui.showShare(true);
  }
}

let openSetup = () => {};
let welcomedPlayer = null;

function paintAuth(session) {
  ui.renderAuth(session, {
    configured: auth.isConfigured(),
    onSetup: () => openSetup(),
    mountButton: (host) => {
      auth.mountButton(host).catch((err) => {
        // Keep the top bar compact; the detail goes in the tooltip.
        host.textContent = 'Sign-in unavailable';
        host.title = err.message;
        host.className = 'google-host is-failed';
      });
    },
    onLogout: () => {
      auth.logout();
      welcomedPlayer = null;
      reloadProfile();
      refreshBoard();
    },
  });
}

async function afterSignIn(session) {
  const key = auth.playerKey(session);
  const isNew = key !== welcomedPlayer;
  welcomedPlayer = key;

  if (isNew) {
    const movedScores = board.migrateGuestScores(session);
    const movedStores = profile.adoptGuestData(daily.guestId(), key);
    ui.toast({
      icon: movedScores || movedStores.length ? '📦' : '👋',
      label: 'SIGNED IN',
      name: `Welcome, ${auth.displayName(session.user)}`,
      desc:
        movedScores || movedStores.length
          ? 'Your guest progress moved across.'
          : 'Your progress is saved to this account.',
    });
  }

  ui.notice(null);
  reloadProfile();
  await refreshBoard();
}

async function init() {
  startStarfield(ui.el('starfield'));
  initParticles(ui.el('particles'));

  const day = daily.dateKey();
  ui.setPuzzleNumber(daily.puzzleNumber(day));
  mountLanes(ui.el('lanes'), daily.dailyTarget(day));

  ui.initTabs();
  ui.initScopeSwitch((scope) => {
    state.scope = scope;
    refreshBoard();
  });
  setupHelp();
  setupSound();
  setupKeyboard();
  setupShare();
  setupRollButton();
  openSetup = setupSetupDialog().open;

  profile.migrateLegacy(daily.guestId());
  reloadProfile();

  auth.onSession((session) => {
    auth.adoptSession(session);
    afterSignIn(session);
  });
  auth.onAuthChange(paintAuth);

  const authError = await auth.initAuth();
  if (authError) ui.notice(authError);
  if (auth.currentSession()) {
    welcomedPlayer = auth.playerKey();
    reloadProfile();
  }

  await refreshBoard();
}

init();
