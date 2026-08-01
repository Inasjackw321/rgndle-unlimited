/**
 * Sharing a roll: a rendered PNG card, and a Discord-flavoured text block for
 * pasting straight into a channel.
 */

import { describeRarity } from './ranks.js';

/** Text version — Discord renders the ``` block as a monospace card. */
export function shareText(result, rank, percentile, { mode = 'endless', day = null } = {}) {
  const rarity = describeRarity(percentile);
  const spaced = result.display.split('').join(' ');
  const header = mode === 'daily' ? `RNGDLE Daily ${day}` : 'RNGDLE Unlimited';

  const lines = [
    `**${header}** — rank **${rank.label}**`,
    '```',
    spaced,
    '',
    `Score    ${result.total.toLocaleString()}`,
    `Rank     ${rank.label} (${rank.name})`,
    `Rarity   ${rarity.text}`,
    '```',
  ];

  const top = result.factors
    .slice()
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((f) => `${f.name} +${f.points.toLocaleString()}`);
  if (top.length) lines.push(top.join(' · '));

  return lines.join('\n');
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
export function renderCard(result, rank, percentile, { mode = 'endless', day = null, player = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0d0d1c');
  bg.addColorStop(1, '#07070f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Rank-coloured glow
  const glow = ctx.createRadialGradient(W / 2, 210, 20, W / 2, 210, 460);
  glow.addColorStop(0, `${rank.color}44`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const mono = 'ui-monospace, Menlo, Consolas, monospace';

  // Title
  ctx.fillStyle = '#8b90a8';
  ctx.font = `600 22px ${sans}`;
  ctx.textAlign = 'left';
  ctx.letterSpacing = '4px';
  ctx.fillText(mode === 'daily' ? `RNGDLE DAILY · ${day}` : 'RNGDLE UNLIMITED', 60, 74);
  ctx.letterSpacing = '0px';

  if (player) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#6b7085';
    ctx.font = `500 20px ${sans}`;
    ctx.fillText(player, W - 60, 74);
    ctx.textAlign = 'left';
  }

  // Digit tiles
  const digits = result.display.split('');
  const tileW = 106;
  const tileH = 132;
  const gap = 12;
  const totalW = digits.length * tileW + (digits.length - 1) * gap;
  let x = (W - totalW) / 2;
  const y = 120;

  for (const digit of digits) {
    ctx.fillStyle = '#14142a';
    roundRect(ctx, x, y, tileW, tileH, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#f4f6ff';
    ctx.font = `700 76px ${mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(digit, x + tileW / 2, y + tileH / 2 + 3);
    x += tileW + gap;
  }
  ctx.textBaseline = 'alphabetic';

  // Rank badge
  const badge = 150;
  const bx = 60;
  const by = 320;
  ctx.strokeStyle = rank.color;
  ctx.lineWidth = 4;
  roundRect(ctx, bx, by, badge, badge, 26);
  ctx.stroke();
  ctx.fillStyle = `${rank.color}22`;
  ctx.fill();

  ctx.fillStyle = rank.color;
  ctx.textAlign = 'center';
  const labelSize = rank.label.length >= 5 ? 40 : rank.label.length === 2 ? 62 : 76;
  ctx.font = `900 ${labelSize}px ${sans}`;
  ctx.fillText(rank.label, bx + badge / 2, by + badge / 2 + labelSize / 3);

  // Score and rarity
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  const scoreX = bx + badge + 44;
  const scoreText = fitText(ctx, result.total.toLocaleString(), W - scoreX - 130, {
    weight: 800,
    sizes: [96, 84, 72, 62],
    family: mono,
  });
  ctx.fillText(scoreText, scoreX, by + 84);

  ctx.fillStyle = rank.color;
  const rarityX = bx + badge + 46;
  const rarityText = fitText(ctx, `${rank.name} — ${describeRarity(percentile).text}`, W - rarityX - 60, {
    weight: 700,
    sizes: [30, 27, 24, 21],
    family: sans,
  });
  ctx.fillText(rarityText, rarityX, by + 130);

  // Top factors — drop the least valuable ones until the line fits the card.
  const ranked = result.factors.slice().sort((a, b) => b.points - a.points);
  const factorsX = bx + 2;
  const factorsMax = W - factorsX - 60;
  ctx.fillStyle = '#8b90a8';

  let line = '';
  for (let count = Math.min(3, ranked.length); count >= 1; count--) {
    const candidate = ranked
      .slice(0, count)
      .map((f) => `${f.name} +${f.points.toLocaleString()}`)
      .join('   ·   ');
    ctx.font = `500 24px ${sans}`;
    if (ctx.measureText(candidate).width <= factorsMax || count === 1) {
      line = fitText(ctx, candidate, factorsMax, { weight: 500, sizes: [24, 22, 20], family: sans });
      break;
    }
  }
  if (line) ctx.fillText(line, factorsX, by + badge + 62);

  // Multiplier chip
  if (result.multiplier > 1) {
    ctx.fillStyle = '#c084fc';
    ctx.font = `700 26px ${mono}`;
    ctx.textAlign = 'right';
    ctx.fillText(`×${result.multiplier}`, W - 60, by + 84);
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
export async function shareCard(canvas, filename = 'rngdle.png') {
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
