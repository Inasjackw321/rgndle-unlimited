/**
 * Game loop and wiring.
 */

import { rollDigits, rollCosmic, scoreRoll, timeBonus, highlightIndices } from './scoring.js';
import { percentileOf, rankFor, RANKS, SAMPLE_SIZE } from './ranks.js';
import { mountReels, spin, setDigits, highlight, clearHighlights } from './reels.js';
import { startStarfield, initParticles, burst, countUp, shake, wait } from './fx.js';
import * as audio from './audio.js';
import * as auth from './auth.js';
import * as board from './leaderboard.js';
import * as daily from './daily.js';
import * as achievements from './achievements.js';
import * as share from './share.js';
import * as google from './google.js';
import * as profile from './profile.js';
import {
  resolved,
  redirectUri,
  overrides,
  saveOverrides,
  clearOverrides,
  isValidClientId,
  isValidGoogleClientId,
  jsOrigin,
} from './config.js';
import * as ui from './ui.js';

const state = {
  rolling: false,
  mode: 'endless',
  scope: 'all',
  history: [],
  streak: 0,
  lastTotal: null,
  lastResult: null,
  countdownTimer: null,
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
 * Identity
 * ------------------------------------------------------------------ */

function playerId() {
  return auth.playerKey() || daily.guestId();
}

/* ------------------------------------------------------------------ *
 * History persistence
 * ------------------------------------------------------------------ */

function loadHistory() {
  state.history = profile.read(profile.STORES.history, playerId(), []);
}

function saveHistory(entry) {
  state.history.unshift(entry);
  state.history = state.history.slice(0, resolved().historyLimit);
  profile.write(profile.STORES.history, playerId(), state.history);
}

/* ------------------------------------------------------------------ *
 * Daily streak
 * ------------------------------------------------------------------ */

function readDailyStreak() {
  return profile.read(profile.STORES.dailyStreak, playerId(), { count: 0, last: null });
}

/** Increments when today follows yesterday, resets after any gap. */
function bumpDailyStreak(today = daily.dateKey()) {
  const record = readDailyStreak();
  if (record.last === today) return record.count;

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const count = record.last === yesterday ? record.count + 1 : 1;
  profile.write(profile.STORES.dailyStreak, playerId(), { count, last: today });
  return count;
}

/**
 * Repaints everything that belongs to the current identity. Called on load and
 * whenever the signed-in account changes, so switching accounts swaps the whole
 * profile rather than leaving the previous player's data on screen.
 */
function reloadProfile() {
  loadHistory();
  ui.renderHistory(state.history);
  ui.renderStats(state.history);
  ui.renderAwards(achievements.ACHIEVEMENTS, achievements.progress(playerId()).unlocked);
  // The hot streak belongs to the player who built it, not to the browser tab.
  state.streak = 0;
  state.lastTotal = null;
}

/* ------------------------------------------------------------------ *
 * Leaderboard
 * ------------------------------------------------------------------ */

async function refreshBoard() {
  const meId = playerId();
  try {
    const entries = await board.listTop(state.scope);
    ui.renderBoard(entries, meId, { shared: board.isShared(), scope: state.scope });
  } catch (err) {
    ui.renderBoard([], meId, { shared: board.isShared(), scope: state.scope, error: err.message });
  }
}

/* ------------------------------------------------------------------ *
 * Daily mode presentation
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
    ui.setDailyStatus(
      `Next Daily in <b>${daily.formatCountdown(daily.msUntilNextDaily())}</b> · streak <b>${
        readDailyStreak().count
      }</b>`,
    );
  };
  paint();
  state.countdownTimer = setInterval(paint, 1000);
}

/** Reflects whether today's Daily is still available in the button and dot. */
function paintMode() {
  const played = daily.playedToday(playerId());
  ui.setDailyAvailable(state.mode !== 'daily' && !played);

  if (state.mode !== 'daily') {
    stopCountdown();
    ui.setDailyStatus(null);
    ui.setRollButton({ label: 'ROLL', sub: 'press space', disabled: state.rolling });
    return;
  }

  if (played) {
    startCountdown();
    ui.setRollButton({ label: 'PLAYED', sub: 'come back tomorrow', disabled: true });
  } else {
    stopCountdown();
    ui.setDailyStatus(`Daily Challenge for <b>${daily.dateKey()}</b> · one roll, no rerolls`);
    ui.setRollButton({ label: 'ROLL DAILY', sub: 'press space', disabled: state.rolling });
  }
}

/** Re-displays an already-played Daily without re-animating the reels. */
function showPlayedDaily() {
  const played = daily.playedToday(playerId());
  if (!played) return;

  const digits = [...played.digits].map(Number);
  setDigits(digits);
  highlight(highlightIndices(digits));

  const rank = RANKS.find((r) => r.label === played.rank) || RANKS[0];
  ui.setRankColor(rank);
  document.querySelector('.machine').classList.add('is-lit');
  ui.setCosmic({ value: played.cosmic, label: 'locked in' });
  ui.showVerdict();
  ui.el('verdict-score').textContent = played.score.toLocaleString();
  ui.renderRank(rank);
  ui.renderRarity(played.percentile, rank);
  ui.renderMeta(played.result || { display: played.digits, base: played.base ?? 0, multiplier: played.multipliers, factors: played.factors || [] });
  if (played.result) {
    ui.renderFactors(played.result);
    state.lastResult = { result: played.result, rank, percentile: played.percentile, mode: 'daily', day: played.day };
    ui.showShare(true);
  } else {
    ui.showShare(false);
  }
}

/* ------------------------------------------------------------------ *
 * The roll
 * ------------------------------------------------------------------ */

async function roll() {
  if (state.rolling) return;

  const isDaily = state.mode === 'daily';
  const me = playerId();
  if (isDaily && daily.playedToday(me)) return;

  state.rolling = true;
  const machine = document.querySelector('.machine');
  ui.setRollButton({
    label: isDaily ? 'ROLL DAILY' : 'ROLL',
    sub: 'rolling…',
    disabled: true,
  });
  audio.unlock();

  ui.clearVerdict();
  ui.showShare(false);
  ui.resetCosmic();
  ui.setDailyStatus(null);
  clearHighlights();
  machine.classList.remove('is-lit');

  const { digits, cosmic } = isDaily
    ? daily.dailyRoll(daily.dateKey(), me)
    : { digits: rollDigits(random), cosmic: rollCosmic(random) };

  // The Daily is a single fixed roll, so session multipliers would make the
  // board depend on how much you played beforehand. Keep it clean.
  const streak =
    !isDaily && state.streak > 0
      ? { value: 1 + Math.min(state.streak, 10) * 0.1, label: `Hot Streak ×${state.streak}` }
      : null;
  const time = isDaily ? null : timeBonus();

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

  // Streak is judged against the previous roll only, and only in endless mode.
  if (!isDaily) {
    state.streak = state.lastTotal !== null && result.total > state.lastTotal ? state.streak + 1 : 0;
    state.lastTotal = result.total;
  }

  const entry = board.entryFor(result, percentile, rank, { mode: state.mode });
  saveHistory(entry);
  ui.renderHistory(state.history);
  ui.renderStats(state.history);

  const dailyStreak = isDaily ? bumpDailyStreak() : readDailyStreak().count;
  if (isDaily) {
    daily.markPlayed(me, { ...entry, result, base: result.base, percentile });
  }

  state.lastResult = { result, rank, percentile, mode: state.mode, day: entry.day };
  ui.showShare(true);

  // Achievements
  const unlocked = achievements.evaluate({
    playerId: me,
    result,
    rank,
    rankIndex,
    percentile,
    mode: state.mode,
    totals: {
      rolls: state.history.length,
      streak: state.streak,
      dailyStreak,
    },
  });
  unlocked.forEach((award, i) => {
    setTimeout(() => {
      ui.toast({ icon: award.icon, name: award.name, desc: award.desc });
      audio.fanfare(3);
    }, 500 + i * 700);
  });
  if (unlocked.length) {
    ui.renderAwards(achievements.ACHIEVEMENTS, achievements.progress(me).unlocked);
  }

  try {
    await board.submitScore(entry, isDaily ? 'daily' : 'all');
    ui.notice(null);
  } catch (err) {
    ui.notice(`Could not submit score: ${err.message}`);
  }
  await refreshBoard();

  state.rolling = false;
  paintMode();
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

  setupHelpText();
}

function setupHelpText() {
  const setup = ui.el('help-setup');
  if (resolved().discordClientId) {
    setup.textContent = `Discord sign-in is enabled. The leaderboard is ${
      board.isShared() ? 'shared across all players.' : 'stored on this device only.'
    }`;
  } else {
    setup.textContent =
      'Discord sign-in is not configured yet. It takes about a minute and needs no server — a client ID is public.';
  }
}

function setupSetupDialog() {
  const dialog = ui.el('setup-dialog');
  const form = ui.el('setup-form');
  const clientIdInput = ui.el('setup-client-id');
  const googleIdInput = ui.el('setup-google-id');
  const endpointInput = ui.el('setup-endpoint');
  const error = ui.el('setup-error');

  ui.el('setup-redirect').textContent = redirectUri();
  ui.el('setup-origin').textContent = jsOrigin();

  const open = () => {
    const current = overrides();
    const active = resolved();
    clientIdInput.value = current.discordClientId || active.discordClientId || '';
    googleIdInput.value = current.googleClientId || active.googleClientId || '';
    endpointInput.value = current.leaderboardEndpoint || active.leaderboardEndpoint || '';
    error.hidden = true;
    dialog.showModal();
    (googleIdInput.value || !clientIdInput.value ? googleIdInput : clientIdInput).focus();
  };

  ui.el('open-setup').addEventListener('click', () => {
    ui.el('help-dialog').close();
    open();
  });

  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  for (const [btnId, value] of [
    ['copy-redirect', redirectUri],
    ['copy-origin', jsOrigin],
  ]) {
    const btn = ui.el(btnId);
    btn.addEventListener('click', async () => {
      const ok = await share.copyText(value());
      ui.flashButton(btn, ok ? 'Copied!' : 'Select it');
    });
  }

  ui.el('setup-clear').addEventListener('click', () => {
    clearOverrides();
    // Without a client ID the session could never be renewed, so ending it
    // here is clearer than leaving a chip that can't re-authenticate.
    auth.logout();
    reloadProfile();
    clientIdInput.value = '';
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
    const discordId = clientIdInput.value.trim();
    const googleId = googleIdInput.value.trim();
    const endpoint = endpointInput.value.trim();

    if (!discordId && !googleId) {
      return fail('Enter at least one client ID — Google, Discord, or both.', googleIdInput);
    }
    if (discordId && !isValidClientId(discordId)) {
      return fail(
        'That does not look like a Discord client ID. It is a number of 17 to 20 digits — copy it from the OAuth2 page, not the application name.',
        clientIdInput,
      );
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

    if (
      !saveOverrides({
        discordClientId: discordId,
        googleClientId: googleId,
        leaderboardEndpoint: endpoint,
      })
    ) {
      return fail('This browser is blocking storage, so settings cannot be saved here.');
    }

    dialog.close();
    paintAuth(auth.currentSession());
    setupHelpText();
    // Straight into sign-in — the click that submitted the form is a user
    // gesture, so a popup won't be blocked. Google renders its own button, so
    // only Discord can be launched directly from here.
    if (discordId) signIn({ provider: 'discord' });
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

function setupShare() {
  // Note: these handlers await, so they must capture the button up front —
  // event.currentTarget is null once dispatch has finished.
  const cardBtn = ui.el('share-card');
  const textBtn = ui.el('share-text');

  cardBtn.addEventListener('click', async () => {
    if (!state.lastResult) return;
    const { result, rank, percentile, mode, day } = state.lastResult;
    const user = auth.currentSession()?.user;
    const canvas = share.renderCard(result, rank, percentile, {
      mode,
      day,
      player: user ? auth.displayName(user) : null,
    });
    try {
      const outcome = await share.shareCard(canvas, `rngdle-${result.display}.png`);
      ui.flashButton(cardBtn, outcome === 'copied' ? 'Copied!' : 'Downloaded');
    } catch {
      ui.flashButton(cardBtn, 'Failed');
    }
  });

  textBtn.addEventListener('click', async () => {
    if (!state.lastResult) return;
    const { result, rank, percentile, mode, day } = state.lastResult;
    const ok = await share.copyText(share.shareText(result, rank, percentile, { mode, day }));
    ui.flashButton(textBtn, ok ? 'Copied!' : 'Press Ctrl+C');
  });
}

function setupModes() {
  ui.initModeSwitch((mode) => {
    state.mode = mode;
    ui.clearVerdict();
    ui.showShare(false);
    clearHighlights();
    document.querySelector('.machine').classList.remove('is-lit');
    if (mode === 'daily') showPlayedDaily();
    paintMode();
  });

  ui.initScopeSwitch((scope) => {
    state.scope = scope;
    refreshBoard();
  });
}

let openSetup = () => {};

function paintAuth(session) {
  ui.renderAuth(session, {
    providers: auth.availableProviders().map((p) => ({ id: p.id, label: p.label })),
    canReconnect: auth.hasSignedInBefore(),
    expiring: auth.needsRenewal(),
    onSetup: () => openSetup(),
    onLogin: (providerId) => signIn({ provider: providerId }),
    onReconnect: () => signIn({ provider: auth.lastProvider(), silent: true }),
    mountProvider: (providerId, host) => {
      if (providerId !== 'google') return;
      google.renderButton(host).catch((err) => {
        host.textContent = err.message;
        host.className = 'google-host is-failed';
      });
    },
    onLogout: () => {
      auth.logout();
      welcomedPlayer = null;
      reloadProfile();
      paintMode();
      refreshBoard();
    },
  });
}

/**
 * Post-sign-in work, shared by every provider.
 *
 * Guarded on identity because it can be reached more than once for the same
 * account: Google's rendered button fires its callback *and* resolves the
 * promise `login()` is awaiting, and silent token renewal produces a fresh
 * session for a player who is already signed in. Neither should re-run the
 * welcome or re-migrate anything.
 */
let welcomedPlayer = null;

async function afterSignIn(session) {
  const key = auth.playerKey(session);
  const isNewIdentity = key !== welcomedPlayer;
  welcomedPlayer = key;

  if (isNewIdentity) {
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
  paintMode();
  await refreshBoard();
}

async function signIn({ provider, silent = false }) {
  if (!provider) return;
  try {
    const session = await auth.login(provider, { silent });
    if (!session) return; // silent attempt declined; leave the UI as it was
    await afterSignIn(session);
  } catch (err) {
    if (err.code === 'cancelled') return;
    const name = auth.PROVIDERS[provider]?.label || provider;
    ui.notice(`${name} sign-in failed: ${err.message}`);
  }
}

async function init() {
  startStarfield(ui.el('starfield'));
  initParticles(ui.el('particles'));
  mountReels(ui.el('reels'));
  ui.initTabs();
  setupHelp();
  setupSound();
  setupKeyboard();
  setupShare();
  setupModes();
  openSetup = setupSetupDialog().open;

  // Upgrade any pre-namespacing data before the first read.
  profile.migrateLegacy(daily.guestId());

  reloadProfile();
  if (state.history.length) setDigits([...state.history[0].digits].map(Number));

  ui.el('roll-btn').addEventListener('click', roll);

  // Google delivers credentials through its own callback, so adopt whatever
  // its rendered button produces rather than waiting on a promise.
  google.onSession((session) => {
    auth.adoptSession(session);
    afterSignIn(session);
  });

  auth.onAuthChange(paintAuth);

  const authError = await auth.initAuth();
  if (authError) ui.notice(authError);

  // Auth resolves asynchronously, so the first paint above used the guest
  // profile. Repaint now that we know who is actually signed in — and treat a
  // restored session as already welcomed, so reloading isn't a fresh sign-in.
  if (auth.currentSession()) {
    welcomedPlayer = auth.playerKey();
    reloadProfile();
  }

  paintMode();
  await refreshBoard();
}

init();
