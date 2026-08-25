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

/**
 * Rank reveal. The chord widens and the root climbs with the tier, so the
 * fifteen ranks are audibly distinguishable rather than three sounds reused.
 */
export function fanfare(rankIndex) {
  const root = 175 * Math.pow(2, Math.min(rankIndex, 14) / 14);
  const chord =
    rankIndex >= 11
      ? [1, 1.25, 1.5, 2, 2.5, 3, 4]
      : rankIndex >= 9
        ? [1, 1.25, 1.5, 2, 2.5]
        : rankIndex >= 6
          ? [1, 1.25, 1.5, 2]
          : rankIndex >= 3
            ? [1, 1.25, 1.5]
            : [1, 1.5];

  chord.forEach((ratio, i) => {
    tone({ freq: root * ratio, type: 'triangle', duration: 0.9, gain: 0.2, delay: i * 0.05 });
  });
  if (rankIndex >= 8) {
    tone({ freq: root * 4, type: 'sine', duration: 1.6, gain: 0.14, delay: 0.22 });
  }
  if (rankIndex >= 12) {
    // A slow shimmer on top for the very rarest tiers.
    tone({ freq: root * 6, type: 'sine', duration: 2.2, gain: 0.1, delay: 0.4 });
  }
}

/**
 * The press itself. A click transient over a pitched-down body, so the button
 * feels mechanical rather than beepy — this fires the instant the pointer goes
 * down, before anything else in the roll sequence.
 */
export function press() {
  tone({ freq: 1800, type: 'square', duration: 0.025, gain: 0.16 });
  tone({ freq: 320, type: 'triangle', duration: 0.13, gain: 0.42, sweepTo: 90 });
  tone({ freq: 70, type: 'sine', duration: 0.2, gain: 0.5 });
}

/** Springy release, so letting go is its own small event. */
export function release() {
  tone({ freq: 520, type: 'sine', duration: 0.07, gain: 0.14, sweepTo: 780 });
}

export function thud() {
  tone({ freq: 140, type: 'sine', duration: 0.3, gain: 0.5, sweepTo: 46 });
}
