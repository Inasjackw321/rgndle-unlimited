/**
 * Game loop and wiring.
 */

import {
  ROLL_LENGTH,
  REROLLS_PER_DAY,
  DIGIT_POINTS,
  AVERAGE_DIGIT_POINTS,
  rollDigit,
  distance,
  bankedPoints,
} from './scoring.js';
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
import * as daily from './daily.js';
import * as game from './game.js';
import { expectedScore } from './strategy.js';
import * as achievements from './achievements.js';
import * as share from './share.js';
import * as profile from './profile.js';
import * as backup from './backup.js';
import * as ui from './ui.js';

const state = {
  busy: false,
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

/** "press space" is a lie on a phone. Ask the device which one it is. */
const rollHint = () =>
  window.matchMedia('(hover: none)').matches ? 'tap to roll' : 'press space';

/* ------------------------------------------------------------------ *
 * Stored results
 * ------------------------------------------------------------------ */

function loadHistory() {
  state.history = profile.read(profile.STORES.history, []);
}

/** The finished day's row, as history and the share card want it. */
function entryFor(result, percentile, rank) {
  return {
    score: result.total,
    day: daily.dateKey(),
    digits: result.display,
    target: result.targetDisplay,
    bullseyes: result.bullseyes,
    totalDistance: result.totalDistance,
    rerollsLeft: result.rerollsLeft,
    rank: rank.label,
    percentile,
    at: Date.now(),
  };
}

function saveResult(entry) {
  state.history = profile.mergeHistory(state.history, [entry]);
  profile.write(profile.STORES.history, state.history);
}

function readStreak() {
  return profile.read(profile.STORES.dailyStreak, { count: 0, last: null });
}

/** Increments when today follows yesterday, resets after any gap. */
function bumpStreak(today = daily.dateKey()) {
  const record = readStreak();
  if (record.last === today) return record.count;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const count = record.last === yesterday ? record.count + 1 : 1;
  profile.write(profile.STORES.dailyStreak, { count, last: today });
  return count;
}

/* ------------------------------------------------------------------ *
 * Painting the game
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

/** Best score this player has ever posted, for the "are we ahead?" glow. */
function personalBest() {
  return state.history.reduce((best, h) => Math.max(best, h.score || 0), 0);
}

function paintLive() {
  const snap = game.snapshot();
  const done = snap.phase === 'done';

  // Mid-run only the per-digit points are banked; the combo and control bonuses
  // can't be settled until every digit is in. Once it is, show the real total —
  // otherwise the bar disagrees with the verdict right underneath it.
  const score = done ? game.result().total : bankedPoints(snap.target, snap.rolled);

  // The solver's expected final score from here, plus what's already banked.
  const pace = done
    ? null
    : score +
      expectedScore({
        digitsLeft: snap.digitsLeft,
        rerollsLeft: snap.rerollsLeft,
        bullseyes: snap.bullseyes,
        total: snap.total,
        worst: snap.worst,
      });

  ui.setLive({ score, pace, bullseyes: snap.bullseyes, best: personalBest(), done });
}

/** Redraws lanes, pips and controls from the persisted game state. */
function paintGame({ animateLast = false } = {}) {
  const snap = game.snapshot();

  setTarget(snap.target);
  ui.renderRerolls(snap.rerollsLeft, REROLLS_PER_DAY);
  ui.setPuzzleNumber(daily.puzzleNumber(snap.day));
  paintLive();

  // The rulebook line earns its space until you've rolled once, and never
  // again — the lanes are labelled and "How to play" is one button away.
  ui.el('tagline').hidden = state.history.length > 0 || snap.rolled.length > 0;

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
    const off = distance(snap.target[snap.index], snap.pending);
    ui.showDecision(true);
    ui.setDecision({
      distance: off,
      points: DIGIT_POINTS[off],
      average: AVERAGE_DIGIT_POINTS,
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
      sub: rollHint(),
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

/** The cabinet takes the weight of a landing reel. */
function thunk() {
  const machine = document.querySelector('.machine');
  machine.classList.remove('is-thunk');
  void machine.offsetWidth;
  machine.classList.add('is-thunk');
}

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
  thunk();

  const next = game.settle(digit);
  const d = distance(snap.target[i], digit);

  setDigit(i, digit, { silent: true });
  setDelta(i, d);
  markSettled(i, true);

  if (d === 0) {
    flashBullseye(i);
    audio.cosmicHit(5);
    buzz([12, 40, 18]);
    burst(laneElement(i), { count: 70, colors: ['#4ade80', '#a7f3d0', '#ffffff'], power: 1 });
    ui.flashLive('hit');
  } else if (d === 1) {
    // One away is the most interesting outcome in the game; say so.
    ui.flashLive('near');
    burst(laneElement(i), { count: 22, colors: ['#a7f3d0'], power: 0.6 });
  }
  paintLive();

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
  const entry = entryFor(result, percentile, rank);
  saveResult(entry);
  loadHistory();
  ui.renderHistory(state.history);
  ui.renderStats(state.history, streak);

  state.lastResult = { result, rank, percentile };
  ui.showShare(true);

  const unlocked = achievements.evaluate({
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
    ui.renderAwards(achievements.ACHIEVEMENTS, achievements.progress().unlocked);
  }
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
}

/**
 * Saving your record to a file, and reading one back.
 *
 * Everything lives in this browser, so this is the only thing standing between
 * a cleared browser and a lost record.
 */
function setupBackup() {
  const saveBtn = ui.el('save-data');
  const restoreBtn = ui.el('restore-data');
  const input = ui.el('restore-input');

  saveBtn.addEventListener('click', () => {
    const save = backup.collect();
    const { days, awards } = backup.describe(save);
    backup.download(save, `guessle-save-${daily.dateKey()}.json`);
    ui.flashButton(saveBtn, 'Saved!');
    ui.toast({
      icon: '💾',
      label: 'SAVED',
      name: `${days} day${days === 1 ? '' : 's'} written to a file`,
      desc: `${awards} achievement${awards === 1 ? '' : 's'} too. Keep it somewhere safe.`,
    });
  });

  restoreBtn.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    // Clear it either way, or picking the same file twice fires nothing.
    input.value = '';
    if (!file) return;

    // Clear any previous failure so a retry doesn't look like it failed again.
    ui.notice(null);

    try {
      const save = backup.parse(await file.text());
      const { restored, failed } = backup.restore(save);
      if (failed.length) throw new backup.RestoreError('This browser is blocking storage.');

      reloadProfile();
      ui.flashButton(restoreBtn, 'Restored!');
      const { days } = backup.describe(save);
      ui.toast({
        icon: '📥',
        label: 'RESTORED',
        name: `Merged ${restored.length} record${restored.length === 1 ? '' : 's'}`,
        desc: `${days} day${days === 1 ? '' : 's'} from the file, best of each kept.`,
      });
    } catch (err) {
      ui.flashButton(restoreBtn, 'Failed');
      ui.notice(
        err instanceof backup.RestoreError
          ? `Could not restore: ${err.message}`
          : `Could not read that file: ${err.message}`,
      );
    }
  });
}

/**
 * The drawer holding your history, stats and awards.
 *
 * Reference material, not part of playing, so it stays shut until asked for.
 */
function setupDrawer() {
  const drawer = ui.el('drawer');
  ui.el('drawer-btn').addEventListener('click', () => {
    audio.press();
    drawer.showModal();
  });
  drawer.querySelector('.drawer-close').addEventListener('click', () => drawer.close());
  // The dialog element fills its own backdrop area, so a click lands on the
  // dialog itself only when it is outside the sheet.
  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) drawer.close();
  });
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
 * Wires a button's press feedback and its action.
 *
 * The feedback fires on pointerdown rather than click: the gap between pressing
 * and releasing is exactly where a button feels dead. Every control in the game
 * gets the same treatment, so a press feels the same wherever you are — the
 * shockwave is reserved for the big one.
 */
function pressable(btn, onClick, { ring = false } = {}) {
  const down = (event) => {
    if (btn.disabled) return;
    btn.classList.add('is-pressed');
    audio.unlock();
    audio.press();
    buzz(12);
    if (ring) pressRipple(btn, event);
  };
  const up = () => btn.classList.remove('is-pressed');

  btn.addEventListener('pointerdown', down);
  for (const evt of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(evt, up);
  btn.addEventListener('click', onClick);
  return { down, up };
}

function setupRollButton() {
  const btn = ui.el('roll-btn');
  const { down, up } = pressable(btn, roll, { ring: true });

  // The keyboard path gets the same animation the finger does.
  window.addEventListener('guessle:press', () => {
    if (btn.disabled) return;
    down();
    setTimeout(up, 110);
  });

  pressable(ui.el('keep-btn'), keep);
  pressable(ui.el('reroll-btn'), doReroll);
}

function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (ui.el('help-dialog').open || ui.el('drawer').open) return;

    const ours = e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR' || e.code === 'Backspace';
    if (!ours) return;

    // Claim the key before deciding what to do with it. Space is the advertised
    // control, and holding it auto-repeats — bailing out on `e.repeat` first
    // handed those repeats back to the browser, whose default action for Space
    // is to page down. One held press threw you to the bottom of the page.
    e.preventDefault();
    if (e.repeat) return;

    const phase = game.snapshot().phase;

    if (e.code === 'Space' || e.code === 'Enter') {
      if (phase === 'deciding') keep();
      else if (phase !== 'done') {
        window.dispatchEvent(new Event('guessle:press'));
        roll();
      }
      return;
    }
    // R is only meaningful while a digit is awaiting a decision.
    if (phase === 'deciding') doReroll();
  });
}

function setupShare() {
  const cardBtn = ui.el('share-card');
  const textBtn = ui.el('share-text');

  cardBtn.addEventListener('click', async () => {
    if (!state.lastResult) return;
    const { result, rank, percentile } = state.lastResult;
    const canvas = share.renderCard(result, rank, percentile, {
      day: daily.dateKey(),
      puzzle: daily.puzzleNumber(),
    });
    try {
      const outcome = await share.shareCard(canvas, `guessle-${daily.dateKey()}.png`);
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
 * Repainting everything from storage
 * ------------------------------------------------------------------ */

function reloadProfile() {
  loadHistory();
  game.load();
  ui.renderHistory(state.history);
  ui.renderStats(state.history, readStreak().count);
  ui.renderAwards(achievements.ACHIEVEMENTS, achievements.progress().unlocked);

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

function init() {
  startStarfield(ui.el('starfield'));
  initParticles(ui.el('particles'));

  const day = daily.dateKey();
  ui.setPuzzleNumber(daily.puzzleNumber(day));
  mountLanes(ui.el('lanes'), daily.dailyTarget(day));

  ui.initTabs();
  setupHelp();
  setupDrawer();
  setupBackup();
  setupSound();
  setupKeyboard();
  setupShare();
  setupRollButton();

  // Bring older storage up to the current shape before reading any of it.
  profile.migrate();
  reloadProfile();
}

init();
