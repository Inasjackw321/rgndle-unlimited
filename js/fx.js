/**
 * Canvas effects: drifting starfield, particle bursts, plus small DOM helpers
 * for counting numbers up and shaking the screen.
 */

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ *
 * Starfield
 * ------------------------------------------------------------------ */

export function startStarfield(canvas) {
  if (reduced()) return;
  const ctx = canvas.getContext('2d');
  let stars = [];
  let dpr = 1;
  let raf = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    const count = Math.round((innerWidth * innerHeight) / 14000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: (Math.random() * 1.3 + 0.25) * dpr,
      v: (Math.random() * 0.16 + 0.03) * dpr,
      a: Math.random() * Math.PI * 2,
      hue: Math.random() < 0.22 ? 280 : 190,
    }));
  }

  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of stars) {
      s.y -= s.v;
      s.a += 0.017;
      if (s.y < -4) {
        s.y = canvas.height + 4;
        s.x = Math.random() * canvas.width;
      }
      const twinkle = 0.42 + Math.sin(s.a) * 0.34;
      ctx.beginPath();
      ctx.fillStyle = `hsla(${s.hue}, 90%, 78%, ${twinkle})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  frame();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else frame();
  });
}

/* ------------------------------------------------------------------ *
 * Particle bursts
 * ------------------------------------------------------------------ */

let burstCtx = null;
let burstCanvas = null;
let particles = [];
let burstRaf = 0;

export function initParticles(canvas) {
  burstCanvas = canvas;
  burstCtx = canvas.getContext('2d');
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    burstCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);
}

function tickParticles() {
  if (!burstCtx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  burstCtx.clearRect(0, 0, burstCanvas.width / dpr, burstCanvas.height / dpr);

  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    p.vy += p.gravity;
    p.vx *= 0.99;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.spin;
    p.life -= 1;

    burstCtx.save();
    burstCtx.translate(p.x, p.y);
    burstCtx.rotate(p.rot);
    burstCtx.globalAlpha = Math.min(1, p.life / 40);
    burstCtx.fillStyle = p.color;
    burstCtx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    burstCtx.restore();
  }

  if (particles.length) burstRaf = requestAnimationFrame(tickParticles);
  else {
    cancelAnimationFrame(burstRaf);
    burstRaf = 0;
  }
}

/**
 * @param {HTMLElement} origin  element to burst from
 * @param {object} opts { count, colors, power }
 */
export function burst(origin, { count = 90, colors = ['#6ee7ff'], power = 1 } = {}) {
  if (reduced() || !burstCtx) return;
  const rect = origin.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (Math.random() * 7 + 3.5) * power;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3.5 * power,
      gravity: 0.24,
      size: Math.random() * 9 + 5,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.35,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: Math.round(70 + Math.random() * 70),
    });
  }

  // Keep the particle budget sane on repeated jackpots.
  if (particles.length > 900) particles = particles.slice(-900);
  if (!burstRaf) burstRaf = requestAnimationFrame(tickParticles);
}

/* ------------------------------------------------------------------ *
 * DOM helpers
 * ------------------------------------------------------------------ */

/** Counts an element's text from 0 to `target` with an ease-out curve. */
export function countUp(el, target, duration = 1200, format = (n) => n.toLocaleString()) {
  if (reduced() || duration <= 0) {
    el.textContent = format(target);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = format(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(step);
      else {
        el.textContent = format(target);
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

export function shake(el, big = false) {
  if (reduced()) return;
  const cls = big ? 'shake-lg' : 'shake-sm';
  el.classList.remove('shake-sm', 'shake-lg');
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), big ? 700 : 400);
}

/**
 * Material-style ripple from the exact point that was pressed, plus an
 * expanding ring that escapes the button's bounds. The ripple lives inside the
 * button (clipped by its overflow), the ring is a sibling so it can grow past
 * the edge.
 */
export function pressRipple(button, event) {
  if (reduced()) return;
  const rect = button.getBoundingClientRect();
  const x = (event?.clientX ?? rect.left + rect.width / 2) - rect.left;
  const y = (event?.clientY ?? rect.top + rect.height / 2) - rect.top;

  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const size = Math.max(rect.width, rect.height) * 2.2;
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${x - size / 2}px`;
  ripple.style.top = `${y - size / 2}px`;
  button.append(ripple);
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });

  const ring = document.createElement('span');
  ring.className = 'shockwave';
  button.parentElement?.append(ring);
  ring.style.left = `${button.offsetLeft + button.offsetWidth / 2}px`;
  ring.style.top = `${button.offsetTop + button.offsetHeight / 2}px`;
  ring.addEventListener('animationend', () => ring.remove(), { once: true });
}

/** Short haptic tap where the device supports it. Silently ignored elsewhere. */
export function buzz(pattern = 12) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported, or blocked by permissions policy */
  }
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
