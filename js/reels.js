/**
 * Slot-machine reels.
 *
 * Each reel is a viewport over a tall strip of digit cells. Spinning is a
 * single long CSS transition across many cycles with a hard-deceleration
 * easing curve, which gives the "fast blur, slow settle" feel for free.
 * Reels are staggered so they land left-to-right.
 */

import { ROLL_LENGTH } from './scoring.js';

const CYCLES_BASE = 9;
const DURATION_BASE = 1100;
const DURATION_STAGGER = 140;
const EASING = 'cubic-bezier(0.16, 0.84, 0.24, 1)';

let container = null;
const reels = [];

function cellHeight() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--reel-h');
  return parseFloat(raw) || 84;
}

export function mountReels(el) {
  container = el;
  container.replaceChildren();
  reels.length = 0;

  const maxCycles = CYCLES_BASE + ROLL_LENGTH - 1;
  const totalCells = (maxCycles + 2) * 10;

  for (let i = 0; i < ROLL_LENGTH; i++) {
    const reel = document.createElement('div');
    reel.className = 'reel';

    const strip = document.createElement('div');
    strip.className = 'reel-strip';
    for (let c = 0; c < totalCells; c++) {
      const cell = document.createElement('div');
      cell.className = 'reel-cell';
      cell.textContent = String(c % 10);
      strip.append(cell);
    }

    reel.append(strip);
    container.append(reel);
    reels.push({ reel, strip, digit: 0 });
  }

  setDigits(Array.from({ length: ROLL_LENGTH }, () => Math.floor(Math.random() * 10)));
  window.addEventListener('resize', () => setDigits(reels.map((r) => r.digit)));
}

/** Snap to digits with no animation (initial paint, resize, reduced motion). */
export function setDigits(digits) {
  const h = cellHeight();
  digits.forEach((digit, i) => {
    const r = reels[i];
    if (!r) return;
    r.digit = digit;
    r.strip.style.transition = 'none';
    r.strip.style.transform = `translateY(${-digit * h}px)`;
  });
  updateLabel(digits);
}

function updateLabel(digits) {
  if (container) container.setAttribute('aria-label', `Roll result: ${digits.join(' ')}`);
}

export function clearHighlights() {
  for (const { reel } of reels) reel.classList.remove('is-hot');
}

/** Highlight the reel positions that contributed to a scoring pattern. */
export function highlight(indices) {
  clearHighlights();
  for (const i of indices) reels[i]?.reel.classList.add('is-hot');
}

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Spins to `digits`. Resolves once the final reel has settled.
 * `onLand(index, digit)` fires as each reel stops.
 */
export function spin(digits, onLand = () => {}) {
  clearHighlights();

  if (prefersReducedMotion()) {
    setDigits(digits);
    digits.forEach((d, i) => onLand(i, d));
    return Promise.resolve();
  }

  const h = cellHeight();

  const spins = digits.map((digit, i) => {
    const r = reels[i];
    const duration = DURATION_BASE + i * DURATION_STAGGER;
    const cycles = CYCLES_BASE + i;

    // Rewind to the equivalent position in the first cycle so the strip never
    // runs out of cells, then force a reflow so the reset isn't animated away.
    r.strip.style.transition = 'none';
    r.strip.style.transform = `translateY(${-r.digit * h}px)`;
    void r.strip.offsetHeight;

    r.strip.classList.add('is-blurred');
    r.strip.style.transition = `transform ${duration}ms ${EASING}`;
    r.strip.style.transform = `translateY(${-(cycles * 10 + digit) * h}px)`;
    r.digit = digit;

    // Pull focus back just before the reel settles.
    const unblur = setTimeout(() => r.strip.classList.remove('is-blurred'), Math.max(0, duration - 420));

    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(unblur);
        r.strip.classList.remove('is-blurred');
        r.reel.classList.remove('is-landing');
        void r.reel.offsetWidth;
        r.reel.classList.add('is-landing');
        onLand(i, digit);
        resolve();
      };
      // transitionend can be missed if the tab is backgrounded — always have
      // a timer as the backstop.
      const timer = setTimeout(done, duration + 30);
      r.strip.addEventListener(
        'transitionend',
        () => {
          clearTimeout(timer);
          done();
        },
        { once: true },
      );
    });
  });

  return Promise.all(spins).then(() => updateLabel(digits));
}
