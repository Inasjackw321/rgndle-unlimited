/**
 * A real-time 3D trophy, in plain WebGL — no libraries.
 *
 * The game has no dependencies and works offline after the first load, and a
 * 3D library would end both of those for one prop. A trophy also happens to be
 * close to ideal hand-built geometry: the cup, stem and foot are a single
 * surface of revolution, the handles are two tubes swept along a curve, and the
 * plinth is boxes.
 *
 * The gold is not a texture. Each pixel reflects a procedural "studio" around
 * it — a bright horizon, a key softbox, and cyan and violet rim lights pulled
 * from the site's own palette — and tints the reflection by gold's actual
 * reflectance. That is what makes it read as metal rather than yellow plastic,
 * and it is why the highlights slide across the surface as you turn it.
 */

/* ------------------------------------------------------------------ *
 * Minimal column-major mat4
 * ------------------------------------------------------------------ */

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function lookAt(eye, center, up) {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz);
  zx /= len;
  zy /= len;
  zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz);
  xx /= len;
  xy /= len;
  xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

/** Rotation about Y, then uniform scale. Returns the model and its normal matrix. */
function modelMatrix(yaw, scale) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    model: new Float32Array([
      c * scale, 0, -s * scale, 0,
      0, scale, 0, 0,
      s * scale, 0, c * scale, 0,
      0, 0, 0, 1,
    ]),
    // Rotation only — the shader renormalises, so the scale can be left out.
    normal: new Float32Array([c, 0, -s, 0, 1, 0, s, 0, c]),
  };
}

/* ------------------------------------------------------------------ *
 * Geometry. Every mesh is flat interleaved triangles:
 * position(3) normal(3) uv(2).
 * ------------------------------------------------------------------ */

const STRIDE = 8;

/**
 * A surface of revolution about the Y axis.
 *
 * `runs` is a list of profile polylines of [radius, height]. Normals are smooth
 * *within* a run and split *between* runs, so a run boundary is a crisp edge
 * (the rim lip, the foot) and everything inside one is polished curve.
 */
function lathe(runs, segments, y0 = 0) {
  const out = [];
  for (const run of runs) {
    // Profile normals: the 2D outward normal of the tangent, averaged per point.
    const normals = run.map((_, i) => {
      const a = run[Math.max(0, i - 1)];
      const b = run[Math.min(run.length - 1, i + 1)];
      const dr = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dr, dy) || 1;
      return [dy / len, -dr / len];
    });
    for (let i = 0; i < run.length - 1; i++) {
      for (let s = 0; s < segments; s++) {
        const t0 = (s / segments) * Math.PI * 2;
        const t1 = ((s + 1) / segments) * Math.PI * 2;
        const v = (k, t) => {
          const [r, y] = run[k];
          const [nr, ny] = normals[k];
          const c = Math.cos(t);
          const sn = Math.sin(t);
          return [r * c, y + y0, r * sn, nr * c, ny, nr * sn, t / (Math.PI * 2), k / run.length];
        };
        const a = v(i, t0);
        const b = v(i, t1);
        const c = v(i + 1, t1);
        const d = v(i + 1, t0);
        out.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    }
  }
  return new Float32Array(out);
}

/** A tube of radius `r` swept along a cubic Bézier lying in the XY plane. */
function tube(p0, p1, p2, p3, r, steps, sides, mirror = 1) {
  const at = (t) => {
    const u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return [
      w[0] * p0[0] + w[1] * p1[0] + w[2] * p2[0] + w[3] * p3[0],
      w[0] * p0[1] + w[1] * p1[1] + w[2] * p2[1] + w[3] * p3[1],
    ];
  };
  const ring = (t) => {
    const p = at(t);
    const q = at(Math.min(1, t + 0.001));
    const o = at(Math.max(0, t - 0.001));
    let tx = q[0] - o[0];
    let ty = q[1] - o[1];
    const len = Math.hypot(tx, ty);
    tx /= len;
    ty /= len;
    // The curve is planar, so the frame is just the in-plane normal and Z.
    const nx = -ty;
    const ny = tx;
    const pts = [];
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dx = nx * c;
      const dy = ny * c;
      const dz = s;
      pts.push([(p[0] + dx * r) * mirror, p[1] + dy * r, dz * r, dx * mirror, dy, dz, t, k / sides]);
    }
    return pts;
  };
  const out = [];
  let prev = ring(0);
  for (let i = 1; i <= steps; i++) {
    const next = ring(i / steps);
    for (let k = 0; k < sides; k++) {
      out.push(...prev[k], ...prev[k + 1], ...next[k + 1], ...prev[k], ...next[k + 1], ...next[k]);
    }
    prev = next;
  }
  return new Float32Array(out);
}

/** An axis-aligned box centred on (cx, cy, cz). */
function box(cx, cy, cz, w, h, d) {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  const faces = [
    // normal, four corners counter-clockwise from outside
    [[0, 0, 1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[0, 0, -1], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    [[1, 0, 0], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
    [[-1, 0, 0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    [[0, 1, 0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
    [[0, -1, 0], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
  ];
  const out = [];
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const [n, ...c] of faces) {
    const v = (i) => [...c[i], ...n, ...uv[i]];
    out.push(...v(0), ...v(1), ...v(2), ...v(0), ...v(2), ...v(3));
  }
  return new Float32Array(out);
}

/** A flat quad facing +Z, for the engraved plate. */
function quad(cx, cy, z, w, h) {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  const v = (x, y, u, t) => [x, y, z, 0, 0, 1, u, t];
  return new Float32Array([
    ...v(x0, y0, 0, 1), ...v(x1, y0, 1, 1), ...v(x1, y1, 1, 0),
    ...v(x0, y0, 0, 1), ...v(x1, y1, 1, 0), ...v(x0, y1, 0, 0),
  ]);
}

/** A flat disc on the floor, for the contact shadow. */
function floorDisc(radius, y) {
  const out = [];
  const n = 48;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a, r) => [Math.cos(a) * r, y, Math.sin(a) * r, 0, 1, 0, 0.5 + Math.cos(a) * r / (radius * 2), 0.5 + Math.sin(a) * r / (radius * 2)];
    out.push(...p(0, 0), ...p(a1, radius), ...p(a0, radius));
  }
  return new Float32Array(out);
}

/* --- The trophy itself ------------------------------------------- */

/** Height at which the gold starts — the top of the plinth. */
const PLINTH_TOP = 0.6;

function buildTrophy() {
  const gold = [];

  // Foot, stem with a knot, then the bowl: outer wall up, a rolled lip, and
  // the inner wall back down into the cup.
  gold.push(
    lathe(
      [
        [[0, 0], [0.36, 0]],
        [[0.36, 0], [0.36, 0.05]],
        [[0.36, 0.05], [0.34, 0.085], [0.27, 0.125], [0.17, 0.165], [0.1, 0.22], [0.078, 0.3], [0.072, 0.38]],
        [[0.072, 0.38], [0.1, 0.42], [0.13, 0.47], [0.1, 0.52], [0.072, 0.56]],
        [[0.072, 0.56], [0.076, 0.64], [0.1, 0.7], [0.13, 0.73]],
        [
          [0.13, 0.73], [0.21, 0.77], [0.3, 0.83], [0.39, 0.92], [0.46, 1.04],
          [0.505, 1.18], [0.528, 1.32], [0.545, 1.43],
        ],
        [[0.545, 1.43], [0.575, 1.455], [0.59, 1.485], [0.575, 1.51], [0.545, 1.515]],
        [
          [0.545, 1.515], [0.52, 1.48], [0.5, 1.34], [0.475, 1.18], [0.425, 1.04],
          [0.345, 0.94], [0.22, 0.885], [0.0, 0.865],
        ],
      ],
      72,
      PLINTH_TOP,
    ),
    // A raised band around the bowl.
    lathe([[[0.452, 1.0], [0.476, 1.02], [0.484, 1.045], [0.476, 1.07], [0.458, 1.09]]], 72, PLINTH_TOP),
  );

  // Handles: a loop from high on the bowl, out, and back in lower down.
  const y = PLINTH_TOP;
  for (const side of [1, -1]) {
    gold.push(tube([0.52, y + 1.3], [1.0, y + 1.36], [0.92, y + 0.82], [0.38, y + 0.92], 0.042, 48, 14, side));
  }

  // Plinth: two lacquered tiers with a gold trim between them.
  const lacquer = [box(0, 0.15, 0, 1.34, 0.3, 1.34), box(0, 0.47, 0, 1.0, 0.26, 1.0)];
  gold.push(box(0, 0.32, 0, 1.08, 0.04, 1.08));

  // The engraved plate on the front of the lower tier.
  const plateBody = box(0, 0.15, 0.674, 0.92, 0.19, 0.012);
  gold.push(plateBody);
  const plateFace = quad(0, 0.15, 0.681, 0.88, 0.16);

  return {
    gold: concat(gold),
    lacquer: concat(lacquer),
    plate: plateFace,
    shadow: floorDisc(1.25, -0.002),
  };
}

function concat(parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Shaders
 * ------------------------------------------------------------------ */

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform mat4 uProj, uView, uModel;
uniform mat3 uNormalMat;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = uNormalMat * aNormal;
  vUv = aUv;
  gl_Position = uProj * uView * w;
}`;

const FRAG = `
precision highp float;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
uniform vec3 uCam;
uniform int uMode;      // 0 gold, 1 lacquer, 2 shadow, 3 engraved plate
uniform sampler2D uTex;
uniform float uFlash;   // brief over-exposure during the reveal

// A procedural photo studio for the metal to reflect.
vec3 env(vec3 d) {
  float y = d.y;
  vec3 floorC = vec3(0.03, 0.026, 0.04);
  vec3 horizon = vec3(1.45, 1.25, 1.0);
  vec3 sky = vec3(0.09, 0.1, 0.19);
  vec3 above = mix(horizon, sky, smoothstep(0.02, 0.6, y));
  vec3 below = mix(horizon * 0.3, floorC, smoothstep(0.0, -0.3, y));
  vec3 c = mix(below, above, step(0.0, y));
  // Key softbox, up and to the right.
  c += vec3(3.2, 2.9, 2.5) * smoothstep(0.9, 0.985, dot(d, normalize(vec3(0.55, 0.6, 0.6))));
  // Cyan and violet rim lights — the site's own accents.
  c += vec3(0.2, 1.0, 1.5) * smoothstep(0.84, 0.97, dot(d, normalize(vec3(-0.85, 0.3, -0.4))));
  c += vec3(1.1, 0.55, 1.6) * 0.7 * smoothstep(0.82, 0.97, dot(d, normalize(vec3(-0.45, 0.75, 0.55))));
  return c;
}

void main() {
  if (uMode == 2) {
    float r = length(vUv * 2.0 - 1.0);
    float a = (1.0 - smoothstep(0.1, 1.0, r)) * 0.6;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
    return;
  }

  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  if (dot(N, V) < 0.0) N = -N;   // inside of the bowl
  vec3 R = reflect(-V, N);
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  vec3 L = normalize(vec3(0.5, 0.85, 0.6));
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 160.0);

  vec3 col;
  if (uMode == 1) {
    // Black lacquer: almost no diffuse, a dielectric's thin reflection.
    float fres = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
    vec3 diff = vec3(0.02, 0.018, 0.026) * (0.35 + 0.65 * max(dot(N, L), 0.0));
    col = diff + env(R) * fres * 0.85 + vec3(spec) * 1.2;
  } else {
    // Gold's reflectance, tinting what it reflects. Fresnel brightens the
    // grazing edges toward white, which is what sells the metal.
    vec3 base = vec3(1.0, 0.71, 0.29);
    if (uMode == 3) base = pow(texture2D(uTex, vUv).rgb, vec3(2.2));
    vec3 F = base + (1.0 - base) * pow(1.0 - NdV, 5.0);
    col = env(R) * F + spec * base * 3.5 + base * 0.035;
  }

  col += uFlash;
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);   // ACES
  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) || 'shader failed');
  }
  return sh;
}

/* ------------------------------------------------------------------ *
 * The engraved plate, drawn on a 2D canvas and used as a texture
 * ------------------------------------------------------------------ */

function plateCanvas(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#ffe7a6');
  g.addColorStop(0.45, '#f2c45c');
  g.addColorStop(1, '#c48a2a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 256);

  // Brushed-metal streaks.
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = i % 2 ? '#fff' : '#6b4a12';
    ctx.fillRect(0, Math.random() * 256, 1024, 1);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = 'rgba(90,60,10,0.6)';
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, 996, 228);

  // Engraving: a dark cut with a light edge below it, as if lit from above.
  const engrave = (text, y, size, spacing) => {
    ctx.font = `800 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = spacing;
    ctx.fillStyle = 'rgba(255,248,220,0.7)';
    ctx.fillText(text, 512, y + 3);
    ctx.fillStyle = '#5a3a08';
    ctx.fillText(text, 512, y);
  };
  engrave(top, 84, 54, '14px');
  engrave(bottom, 174, 84, '6px');
  return c;
}

/* ------------------------------------------------------------------ *
 * Viewer
 * ------------------------------------------------------------------ */

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Mounts a trophy into `canvas`.
 *
 * @param {object}  options
 * @param {string}  options.top      first line on the plate
 * @param {string}  options.bottom   second line on the plate
 * @param {boolean} options.reveal   arrive with a spin and a flash
 * @returns {{destroy: Function, spin: Function} | null}  null when WebGL is unavailable
 */
export function mountTrophy(canvas, { top = 'GUESSLE', bottom = '7,500+', reveal = false } = {}) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) return null;

  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link failed');
  } catch {
    return null;
  }
  gl.useProgram(program);

  const loc = {
    pos: gl.getAttribLocation(program, 'aPos'),
    normal: gl.getAttribLocation(program, 'aNormal'),
    uv: gl.getAttribLocation(program, 'aUv'),
  };
  const u = Object.fromEntries(
    ['uProj', 'uView', 'uModel', 'uNormalMat', 'uCam', 'uMode', 'uTex', 'uFlash'].map((n) => [
      n,
      gl.getUniformLocation(program, n),
    ]),
  );

  const geometry = buildTrophy();
  const meshes = {};
  for (const [name, data] of Object.entries(geometry)) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    meshes[name] = { buf, count: data.length / STRIDE };
  }

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, plateCanvas(top, bottom));
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  /* --- Motion ------------------------------------------------------ */

  const still = reducedMotion();
  const FLASH = 1.2;
  const IDLE_SPIN = still ? 0 : 0.55; // rad/s
  const REST_PITCH = 0.2;

  const view = {
    yaw: -0.5,
    pitch: REST_PITCH,
    yawVel: reveal && !still ? 16 : IDLE_SPIN,
    pitchVel: 0,
    // Framed so the rim and the plinth's nearest corner sit at the same
    // distance from the edge (~78% of the half-field of view). Aimed at the
    // trophy's middle, the near corner of the base landed at 95% and clipped
    // on short stages, taking the engraved plate out of the winner screenshot.
    dist: 5.6,
    scale: reveal && !still ? 0.001 : 1,
    flash: reveal && !still ? FLASH : 0,
    dragging: false,
    // Never touched counts as idle. 0 would mean "touched at page load", and
    // on a fresh page that's under the idle threshold — the showroom turn
    // would brake to a crawl and then wind back up for no visible reason.
    lastInput: -Infinity,
  };

  /* --- Input: drag to spin, with inertia ---------------------------- */

  let last = null;
  const onDown = (e) => {
    view.dragging = true;
    last = { x: e.clientX, y: e.clientY, t: performance.now() };
    view.yawVel = 0;
    view.pitchVel = 0;
    canvas.setPointerCapture?.(e.pointerId);
    canvas.classList.add('is-grabbing');
  };
  const onMove = (e) => {
    if (!view.dragging || !last) return;
    const now = performance.now();
    const dt = Math.max(1, now - last.t) / 1000;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    view.yaw += dx * 0.011;
    view.pitch = Math.min(0.85, Math.max(-0.3, view.pitch + dy * 0.007));
    // Smoothed, so the flick you let go on is the one that carries on.
    view.yawVel = view.yawVel * 0.6 + ((dx * 0.011) / dt) * 0.4;
    view.pitchVel = view.pitchVel * 0.6 + ((dy * 0.007) / dt) * 0.4;
    last = { x: e.clientX, y: e.clientY, t: now };
    view.lastInput = now;
  };
  const onUp = (e) => {
    view.dragging = false;
    last = null;
    canvas.releasePointerCapture?.(e.pointerId);
    canvas.classList.remove('is-grabbing');
    view.lastInput = performance.now();
  };
  const onWheel = (e) => {
    e.preventDefault();
    view.dist = Math.min(7, Math.max(3.4, view.dist + e.deltaY * 0.004));
  };
  const onKey = (e) => {
    const step = { ArrowLeft: [-0.35, 0], ArrowRight: [0.35, 0], ArrowUp: [0, -0.15], ArrowDown: [0, 0.15] }[e.key];
    if (!step) return;
    e.preventDefault();
    view.yawVel += step[0] * 6;
    view.pitch = Math.min(0.85, Math.max(-0.3, view.pitch + step[1]));
    view.lastInput = performance.now();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);

  /* --- Frame -------------------------------------------------------- */

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
  };

  const bind = (mesh) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
    const bytes = STRIDE * 4;
    gl.enableVertexAttribArray(loc.pos);
    gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, bytes, 0);
    if (loc.normal >= 0) {
      gl.enableVertexAttribArray(loc.normal);
      gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, bytes, 12);
    }
    if (loc.uv >= 0) {
      gl.enableVertexAttribArray(loc.uv);
      gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, bytes, 24);
    }
  };

  let raf = 0;
  let prev = null;
  let born = null;
  const frame = (now) => {
    // Everything runs on the rAF clock, starting from the first frame. That
    // timestamp is the *start* of the frame, so it can be earlier than a
    // performance.now() taken during it — on a busy page load, by a lot. A
    // negative dt runs every decay below backwards: the reveal flash grows
    // instead of fading, and the trophy rendered blown-out white for seconds.
    if (prev === null) prev = born = now;
    const dt = Math.min(0.05, Math.max(0, (now - prev) / 1000));
    prev = now;

    // Reveal: grow from nothing with an overshoot while the spin bleeds off.
    const age = (now - born) / 1000;
    if (view.scale < 1) {
      const t = Math.min(1, age / 0.9);
      const back = 1.70158 * 1.3;
      view.scale = Math.max(0.001, 1 + (back + 1) * Math.pow(t - 1, 3) + back * Math.pow(t - 1, 2));
      if (t >= 1) view.scale = 1;
    }
    // The flash fades on wall-clock age, like the scale, not by stepping dt.
    // dt is capped per frame to stop a jump after a backgrounded tab, and on a
    // slow device that cap turns a 0.65s fade into one lasting several seconds.
    if (view.flash > 0) view.flash = FLASH * Math.max(0, 1 - age / 0.65);

    if (!view.dragging) {
      view.yaw += view.yawVel * dt;
      view.pitch = Math.min(0.85, Math.max(-0.3, view.pitch + view.pitchVel * dt));
      const friction = Math.exp(-dt * 2.2);
      view.pitchVel *= friction;
      // Ease back toward a slow showroom turn once the player lets go.
      const idle = performance.now() - view.lastInput > 1400;
      view.yawVel = idle ? view.yawVel + (IDLE_SPIN - view.yawVel) * (1 - Math.exp(-dt * 1.2)) : view.yawVel * friction;
      if (idle) view.pitch += (REST_PITCH - view.pitch) * (1 - Math.exp(-dt * 1.5));
    }

    resize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = canvas.width / canvas.height;
    const target = [0, 0.92, 0];
    const eye = [0, target[1] + Math.sin(view.pitch) * view.dist, Math.cos(view.pitch) * view.dist];
    const { model, normal } = modelMatrix(view.yaw, view.scale);

    gl.uniformMatrix4fv(u.uProj, false, perspective(0.56, aspect, 0.1, 50));
    gl.uniformMatrix4fv(u.uView, false, lookAt(eye, target, [0, 1, 0]));
    gl.uniformMatrix4fv(u.uModel, false, model);
    gl.uniformMatrix3fv(u.uNormalMat, false, normal);
    gl.uniform3fv(u.uCam, eye);
    gl.uniform1f(u.uFlash, view.flash);
    gl.uniform1i(u.uTex, 0);

    // Shadow first, without writing depth, so nothing can z-fight it.
    gl.depthMask(false);
    gl.uniform1i(u.uMode, 2);
    bind(meshes.shadow);
    gl.drawArrays(gl.TRIANGLES, 0, meshes.shadow.count);
    gl.depthMask(true);

    gl.uniform1i(u.uMode, 1);
    bind(meshes.lacquer);
    gl.drawArrays(gl.TRIANGLES, 0, meshes.lacquer.count);

    gl.uniform1i(u.uMode, 0);
    bind(meshes.gold);
    gl.drawArrays(gl.TRIANGLES, 0, meshes.gold.count);

    gl.uniform1i(u.uMode, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    bind(meshes.plate);
    gl.drawArrays(gl.TRIANGLES, 0, meshes.plate.count);

    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    /** A celebratory flick, for when something good happens. */
    spin(speed = 12) {
      if (!still) view.yawVel = speed;
    },
    /** Exposed for tests and debugging: where the trophy is pointing. */
    get yaw() {
      return view.yaw;
    },
    destroy() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
      // Browsers cap live WebGL contexts at a handful; hand this one back now
      // rather than waiting for garbage collection to notice.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
