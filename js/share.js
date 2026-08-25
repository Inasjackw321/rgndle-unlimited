/**
 * Sharing a roll: a rendered PNG card, and a Discord-flavoured text block for
 * pasting straight into a channel.
 */

import { describeRarity } from './ranks.js';

/** Emoji square per distance, so the grid reads at a glance. */
const DISTANCE_SQUARES = ['🟩', '🟨', '🟨', '🟧', '🟥', '⬛'];

/**
 * Text version. Deliberately shows *distances*, never the digits — posting your
 * result must not hand anyone else the answers for a target they're still
 * playing.
 */
export function shareText(result, rank, percentile, { puzzle = null } = {}) {
  const rarity = describeRarity(percentile);
  const grid = result.distances.map((d) => DISTANCE_SQUARES[d]).join('');
  const header = puzzle ? `Gussle #${puzzle}` : 'Gussle';

  return [
    `${header} — ${rank.label}`,
    grid,
    `${result.bullseyes}/9 exact · distance ${result.totalDistance} · ${result.total.toLocaleString()} pts`,
    rarity.text,
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * PNG card
 * ------------------------------------------------------------------ */

const W = 1200;
const H = 630;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}


/**
 * Shrinks the font until `text` fits `maxWidth`, then ellipsises if even the
 * smallest size is too wide. Returns the text actually drawn.
 */
function fitText(ctx, text, maxWidth, { weight, sizes, family }) {
  for (const size of sizes) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return text;
  }
  // Still too wide at the smallest size — trim with an ellipsis.
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

/**
 * Draws a share card. Returns a canvas so callers can choose PNG or blob.
 */
export function renderCard(result, rank, percentile, { day = null, puzzle = null, player = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0d0d1c');
  bg.addColorStop(1, '#07070f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W / 2, 250, 20, W / 2, 250, 480);
  glow.addColorStop(0, `${rank.color}44`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const mono = 'ui-monospace, Menlo, Consolas, monospace';

  ctx.fillStyle = '#8b90a8';
  ctx.font = `600 22px ${sans}`;
  ctx.textAlign = 'left';
  ctx.letterSpacing = '4px';
  ctx.fillText(puzzle ? `GUSSLE #${puzzle}` : 'GUSSLE', 60, 66);
  ctx.letterSpacing = '0px';

  if (player) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#6b7085';
    ctx.font = `500 20px ${sans}`;
    ctx.fillText(player, W - 60, 66);
    ctx.textAlign = 'left';
  }

  /* Target row, then your row, then the distance chips — the same vertical
     story the game itself tells. */
  const digits = result.rolled;
  const tileW = 96;
  const gap = 11;
  const totalW = digits.length * tileW + (digits.length - 1) * gap;
  const x0 = (W - totalW) / 2;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#8b90a8';
  ctx.font = `700 15px ${sans}`;
  ctx.letterSpacing = '3px';
  ctx.fillText('TARGET', x0 + 34, 108);
  ctx.letterSpacing = '0px';

  ctx.textBaseline = 'middle';
  for (let i = 0; i < digits.length; i++) {
    const x = x0 + i * (tileW + gap);

    ctx.fillStyle = '#ffc857';
    ctx.globalAlpha = 0.85;
    ctx.font = `750 40px ${mono}`;
    ctx.fillText(String(result.target[i]), x + tileW / 2, 140);
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#14142a';
    roundRect(ctx, x, 170, tileW, 118, 14);
    ctx.fill();
    ctx.strokeStyle = result.distances[i] === 0 ? '#4ade80' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = result.distances[i] === 0 ? 3 : 2;
    ctx.stroke();

    ctx.fillStyle = '#f4f6ff';
    ctx.font = `700 66px ${mono}`;
    ctx.fillText(String(digits[i]), x + tileW / 2, 231);

    const d = result.distances[i];
    const chip = ['#4ade80', '#a7f3d0', '#fde68a', '#fdba74', '#fca5a5', '#fda4af'][d];
    ctx.fillStyle = chip;
    ctx.font = `750 20px ${mono}`;
    ctx.fillText(d === 0 ? '✓' : `+${d}`, x + tileW / 2, 316);
  }
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const badge = 138;
  const bx = 60;
  const by = 366;
  ctx.strokeStyle = rank.color;
  ctx.lineWidth = 4;
  roundRect(ctx, bx, by, badge, badge, 24);
  ctx.stroke();
  ctx.fillStyle = `${rank.color}22`;
  ctx.fill();

  ctx.fillStyle = rank.color;
  ctx.textAlign = 'center';
  const labelSize = rank.label.length >= 6 ? 30 : rank.label.length >= 5 ? 36 : rank.label.length === 2 ? 56 : 70;
  ctx.font = `900 ${labelSize}px ${sans}`;
  ctx.fillText(rank.label, bx + badge / 2, by + badge / 2 + labelSize / 3);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  const scoreX = bx + badge + 40;
  const scoreText = fitText(ctx, result.total.toLocaleString(), W - scoreX - 60, {
    weight: 800,
    sizes: [84, 74, 64, 56],
    family: mono,
  });
  ctx.fillText(scoreText, scoreX, by + 74);

  ctx.fillStyle = rank.color;
  const rarityText = fitText(ctx, `${rank.name} — ${describeRarity(percentile).text}`, W - scoreX - 60, {
    weight: 700,
    sizes: [27, 24, 21],
    family: sans,
  });
  ctx.fillText(rarityText, scoreX + 2, by + 112);

  ctx.fillStyle = '#8b90a8';
  ctx.font = `500 22px ${sans}`;
  const spent = result.rerollsLeft;
  ctx.fillText(
    `${result.bullseyes}/9 exact   ·   total distance ${result.totalDistance}   ·   ` +
      `${spent} re-roll${spent === 1 ? '' : 's'} unspent`,
    bx + 2,
    by + badge + 44,
  );

  if (day) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#4b4f63';
    ctx.font = `500 18px ${sans}`;
    ctx.fillText(day, W - 60, by + badge + 44);
  }

  return canvas;
}

export function cardBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Copies the card image to the clipboard, falling back to a download when the
 * browser won't allow image clipboard writes (Firefox, Safari in some modes).
 * @returns {Promise<'copied'|'downloaded'>}
 */
export async function shareCard(canvas, filename = 'gussle.png') {
  const blob = await cardBlob(canvas);

  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copied';
    } catch {
      /* fall through to download */
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
