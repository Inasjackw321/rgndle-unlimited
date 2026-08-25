/**
 * The machine: nine lanes, each showing the target digit, a reel, and how far
 * off you landed.
 *
 * Stacking target directly above result is the whole tutorial — you can see at
 * a glance what you're aiming at and how close you got, without reading a word.
 *
 * Reels spin as a single long CSS transition across many cycles with a
 * hard-deceleration curve, which gives the "fast blur, slow settle" feel for
 * free. Only one lane spins at a time now: you roll the digits one by one.
 */

import { ROLL_LENGTH } from './scoring.js';

const CYCLES = 11;
const DURATION = 1250;
const EASING = 'cubic-bezier(0.16, 0.84, 0.24, 1)';

let container = null;
const lanes = [];

/**
 * The distance between one digit and the next, measured off a real strip.
 *
 * Deliberately not read from `--reel-h`: that is a calc() now, and
 * getPropertyValue hands back the unresolved expression, which parseFloat turns
 * into NaN — silently falling back to the desktop 84px and leaving every mobile
 * reel parked half a digit off. Measuring ten cells and dividing by ten also
 * averages out the subpixel rounding a single fractional cell would accumulate
 * over a long spin.
 */
function cellHeight() {
  const cells = lanes[0]?.strip?.children;
  if (cells && cells.length > 10) {
    const step = (cells[10].getBoundingClientRect().top - cells[0].getBoundingClientRect().top) / 10;
    if (step > 0) return step;
  }
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reel-h')) || 84;
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountLanes(el, target) {
  container = el;
  container.replaceChildren();
  lanes.length = 0;

  const totalCells = (CYCLES + 2) * 10;

  // A label column that is itself a lane, so it lines up with the three rows
  // automatically instead of being positioned by hand.
  const labels = document.createElement('div');
  labels.className = 'lane lane-labels';
  labels.setAttribute('aria-hidden', 'true');
  for (const [cls, text] of [
    ['lane-target', 'TARGET'],
    ['reel', 'YOU'],
    ['lane-delta', 'OFF BY'],
  ]) {
    const row = document.createElement('div');
    row.className = `${cls}-label`;
    row.textContent = text;
    labels.append(row);
  }
  container.append(labels);

  for (let i = 0; i < ROLL_LENGTH; i++) {
    const lane = document.createElement('div');
    lane.className = 'lane';

    const targetEl = document.createElement('div');
    targetEl.className = 'lane-target';
    targetEl.textContent = String(target[i]);
    targetEl.title = `Target digit ${i + 1}`;

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
    // Until a lane is rolled its strip is parked on some arbitrary digit, which
    // would read as "you rolled a 0". Cover it.
    const cover = document.createElement('div');
    cover.className = 'reel-cover';
    cover.textContent = '?';
    reel.append(strip, cover);

    const delta = document.createElement('div');
    delta.className = 'lane-delta';
    delta.textContent = '';

    lane.append(targetEl, reel, delta);
    container.append(lane);
    lanes.push({ lane, reel, strip, delta, digit: 0, settled: false });
  }

  // Park every reel on a blank-looking position until it is rolled.
  for (let i = 0; i < ROLL_LENGTH; i++) setDigit(i, 0, { silent: true });
  window.addEventListener('resize', () => {
    lanes.forEach((l, i) => setDigit(i, l.digit, { silent: true }));
  });
}

export function setTarget(target) {
  lanes.forEach((l, i) => {
    l.lane.querySelector('.lane-target').textContent = String(target[i]);
  });
}

/** Places a digit with no animation (restore, resize, reduced motion). */
export function setDigit(i, digit, { silent = false } = {}) {
  const lane = lanes[i];
  if (!lane) return;
  const h = cellHeight();
  lane.digit = digit;
  lane.strip.style.transition = 'none';
  lane.strip.style.transform = `translateY(${-digit * h}px)`;
  if (!silent) announce();
}

/** Marks a lane as awaiting its roll, already settled, or the live one. */
export function setLaneState(i, stateName) {
  const lane = lanes[i];
  if (!lane) return;
  lane.lane.classList.toggle('is-active', stateName === 'active');
  lane.lane.classList.toggle('is-settled', stateName === 'settled');
  lane.lane.classList.toggle('is-pending', stateName === 'pending');
  lane.lane.classList.toggle('is-waiting', stateName === 'waiting');
}

export function setDelta(i, value) {
  const lane = lanes[i];
  if (!lane) return;
  if (value === null || value === undefined) {
    lane.delta.textContent = '';
    lane.delta.removeAttribute('data-d');
    return;
  }
  // Plain number, not "+3": under a row labelled OFF BY a leading plus reads as
  // a bonus, and this row is the one place in the game that isn't points.
  lane.delta.textContent = value === 0 ? '✓' : String(value);
  lane.delta.dataset.d = String(value);
}

function announce() {
  if (!container) return;
  const shown = lanes.map((l) => (l.settled ? l.digit : '?')).join(' ');
  container.setAttribute('aria-label', `Your digits so far: ${shown}`);
}

export function markSettled(i, settled = true) {
  const lane = lanes[i];
  if (!lane) return;
  lane.settled = settled;
  // A re-rolled lane goes back to being unknown, so the cover comes back too.
  if (!settled) lane.lane.classList.remove('is-rolling');
  announce();
}

/** Spins one lane to `digit`. Resolves when it settles. */
export function spinOne(i, digit) {
  const lane = lanes[i];
  if (!lane) return Promise.resolve();

  if (prefersReducedMotion()) {
    lane.lane.classList.add('is-rolling');
    setDigit(i, digit);
    return Promise.resolve();
  }

  const h = cellHeight();

  // Rewind to the equivalent position in the first cycle so the strip never
  // runs out of cells, then force a reflow so the reset isn't animated away.
  lane.strip.style.transition = 'none';
  lane.strip.style.transform = `translateY(${-lane.digit * h}px)`;
  void lane.strip.offsetHeight;

  lane.lane.classList.add('is-rolling');
  lane.strip.classList.add('is-blurred');
  lane.strip.style.transition = `transform ${DURATION}ms ${EASING}`;
  lane.strip.style.transform = `translateY(${-(CYCLES * 10 + digit) * h}px)`;
  lane.digit = digit;

  const unblur = setTimeout(() => lane.strip.classList.remove('is-blurred'), Math.max(0, DURATION - 420));

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(unblur);
      lane.strip.classList.remove('is-blurred');
      lane.reel.classList.remove('is-landing');
      void lane.reel.offsetWidth;
      lane.reel.classList.add('is-landing');
      resolve();
    };
    // transitionend can be missed if the tab is backgrounded — always have a
    // timer as the backstop.
    const timer = setTimeout(done, DURATION + 30);
    lane.strip.addEventListener(
      'transitionend',
      () => {
        clearTimeout(timer);
        done();
      },
      { once: true },
    );
  });
}

/** Celebratory pulse on a bullseye lane. */
export function flashBullseye(i) {
  const lane = lanes[i];
  if (!lane || prefersReducedMotion()) return;
  lane.lane.classList.remove('is-bullseye');
  void lane.lane.offsetWidth;
  lane.lane.classList.add('is-bullseye');
}

export function laneElement(i) {
  return lanes[i]?.lane || null;
}
