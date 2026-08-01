/**
 * Tiny WebAudio kit — no sample files, everything is synthesised, so the whole
 * game stays a handful of static text files.
 *
 * The AudioContext is created lazily on the first user gesture, which is what
 * browser autoplay policies require.
 */

const PREF_KEY = 'rngdle_sound';

let ctx = null;
let master = null;
let enabled = true;

try {
  enabled = localStorage.getItem(PREF_KEY) !== 'off';
} catch {
  /* storage blocked — default to on */
}

function ensureContext() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.32;
  master.connect(ctx.destination);
  return ctx;
}

export function unlock() {
  const c = ensureContext();
  if (c && c.state === 'suspended') c.resume();
}

export function isEnabled() {
  return enabled;
}

export function setEnabled(next) {
  enabled = next;
  try {
    localStorage.setItem(PREF_KEY, next ? 'on' : 'off');
  } catch {
    /* ignore */
  }
  if (next) unlock();
}

function tone({ freq, type = 'sine', duration = 0.12, gain = 0.5, delay = 0, sweepTo = null }) {
  if (!enabled) return;
  const c = ensureContext();
  if (!c) return;

  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + duration);

  // Short attack, exponential decay — reads as "percussive" rather than "beep".
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Reel click — pitch rises slightly with each reel that lands. */
export function tick(index = 0) {
  tone({ freq: 240 + index * 26, type: 'square', duration: 0.06, gain: 0.22 });
  tone({ freq: 90, type: 'sine', duration: 0.09, gain: 0.3 });
}

export function whoosh() {
  tone({ freq: 900, type: 'sawtooth', duration: 0.42, gain: 0.1, sweepTo: 180 });
}

export function cosmicHit(multiplier) {
  const big = multiplier >= 3;
  tone({ freq: big ? 660 : 440, type: 'triangle', duration: 0.2, gain: 0.3, sweepTo: big ? 1320 : 660 });
  if (big) tone({ freq: 990, type: 'sine', duration: 0.4, gain: 0.24, delay: 0.1 });
}

/** Rising arpeggio while the score counts up. */
export function counting(steps = 6) {
  for (let i = 0; i < steps; i++) {
    tone({ freq: 330 * Math.pow(2, i / 12), type: 'sine', duration: 0.07, gain: 0.12, delay: i * 0.09 });
  }
}

/** Rank reveal. Bigger ranks get a fuller chord. */
export function fanfare(rankIndex) {
  const root = 196 * Math.pow(2, Math.min(rankIndex, 9) / 12);
  const chord = rankIndex >= 6 ? [1, 1.25, 1.5, 2, 2.5] : rankIndex >= 3 ? [1, 1.25, 1.5] : [1, 1.5];
  chord.forEach((ratio, i) => {
    tone({ freq: root * ratio, type: 'triangle', duration: 0.9, gain: 0.2, delay: i * 0.05 });
  });
  if (rankIndex >= 5) {
    tone({ freq: root * 4, type: 'sine', duration: 1.4, gain: 0.14, delay: 0.22 });
  }
}

export function thud() {
  tone({ freq: 140, type: 'sine', duration: 0.3, gain: 0.5, sweepTo: 46 });
}
