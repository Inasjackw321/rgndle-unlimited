/**
 * Turns a raw score into a percentile and a tier, using the Monte-Carlo table
 * in percentiles.js. Because tiers are defined by percentile rather than by
 * hard-coded score thresholds, retuning the scoring engine automatically
 * recalibrates them — you only need to regenerate the table.
 */

import { PROBS, QUANTILES, SAMPLE_SIZE, DISTRIBUTION } from './percentiles.js';

export { SAMPLE_SIZE, DISTRIBUTION };

/** Highest probability the grid resolves, and the rarity that corresponds to. */
const MAX_PERCENTILE = PROBS[PROBS.length - 1];
const RESOLUTION_LIMIT = Math.round(1 / (1 - MAX_PERCENTILE));

/**
 * Fraction of random rolls that score strictly below `score`, in [0, 1].
 */
export function percentileOf(score) {
  if (score <= QUANTILES[0]) return 0;
  if (score >= QUANTILES[QUANTILES.length - 1]) return PROBS[PROBS.length - 1];

  // First index whose quantile is >= score.
  let lo = 0;
  let hi = QUANTILES.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (QUANTILES[mid] < score) lo = mid + 1;
    else hi = mid;
  }

  // Exact hit on a flat region: report the *first* probability holding this
  // score, which is the fraction genuinely below it.
  if (QUANTILES[lo] === score || lo === 0) return PROBS[lo];

  // Otherwise the score falls between two grid points — interpolate.
  const span = QUANTILES[lo] - QUANTILES[lo - 1];
  const t = span > 0 ? (score - QUANTILES[lo - 1]) / span : 0;
  return PROBS[lo - 1] + t * (PROBS[lo] - PROBS[lo - 1]);
}

export const RANKS = [
  { id: 'f', label: 'F', name: 'Statistical Noise', min: 0, color: '#6b7280' },
  { id: 'd', label: 'D', name: 'Unremarkable', min: 0.4, color: '#78716c' },
  { id: 'c', label: 'C', name: 'Passable', min: 0.65, color: '#4ade80' },
  { id: 'b', label: 'B', name: 'Respectable', min: 0.82, color: '#38bdf8' },
  { id: 'a', label: 'A', name: 'Excellent', min: 0.92, color: '#a78bfa' },
  { id: 's', label: 'S', name: 'Extraordinary', min: 0.97, color: '#fbbf24' },
  { id: 'ss', label: 'SS', name: 'Legendary', min: 0.992, color: '#fb7185' },
  { id: 'sss', label: 'SSS', name: 'Mythic', min: 0.998, color: '#f472b6' },
  { id: 'ultra', label: 'ULTRA', name: 'Beyond Reason', min: 0.9995, color: '#22d3ee' },
  { id: 'omega', label: 'Ω', name: 'Reality Error', min: 0.99995, color: '#ffffff' },
];

export function rankFor(percentile) {
  let rank = RANKS[0];
  for (const r of RANKS) if (percentile >= r.min) rank = r;
  return rank;
}

/**
 * Human phrasing for a percentile, clamped to the resolution the sample
 * actually supports so we never invent precision we didn't simulate.
 *
 * Below the median "Top 75%" is technically true but reads as praise, so those
 * rolls are described by what they beat instead. "1 in N" is only worth saying
 * once N is large enough to be interesting.
 */
export function describeRarity(percentile) {
  const top = Math.max(1 - percentile, 1 - MAX_PERCENTILE);
  const oneIn = Math.round(1 / top);

  // Past the top of the probability grid we genuinely don't know how rare the
  // roll is — only that it is at least this rare. Say that rather than quoting
  // the grid's last rung as if it were measured.
  const capped = percentile >= MAX_PERCENTILE - 1e-12;
  if (capped) {
    return { top, oneIn, capped, text: `rarer than 1 in ${RESOLUTION_LIMIT.toLocaleString()}` };
  }
  if (percentile < 0.01) {
    return { top, oneIn, capped, text: 'about as low as it goes' };
  }
  if (percentile < 0.5) {
    return { top, oneIn, capped, text: `beats ${(percentile * 100).toFixed(1)}% of rolls` };
  }

  const pct =
    top >= 0.01 ? (top * 100).toFixed(1) : top >= 0.0001 ? (top * 100).toFixed(3) : (top * 100).toFixed(5);
  const text = oneIn >= 10 ? `top ${pct}% · 1 in ${oneIn.toLocaleString()}` : `top ${pct}%`;
  return { top, oneIn, capped, text };
}
