/**
 * Реалистичное пламя вокруг карточки (Halloween): WebGL-шейдер с турбулентным
 * шумом, рисуется на холсте ПОД страницей (z-index: -1). Карточка непрозрачна
 * и закрывает середину — видно только то, что вырывается из-за её краёв.
 *
 * Холстов максимум два: один горит, второй догорает и дымит, пока мышь уже
 * на соседней карточке. Без WebGL — тихо ничего не делаем.
 */

import { animate } from 'motion';

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform vec4 u_rect;
uniform float u_radius;
uniform float u_scale;
uniform float u_time;
uniform float u_amt;
uniform float u_smoke;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 px = gl_FragCoord.xy / u_scale;
  vec2 size = u_res / u_scale;
  vec2 c = u_rect.xy + u_rect.zw * 0.5;
  vec2 hs = u_rect.zw * 0.5;
  float t = u_time;
  float d0 = sdRound(px - c, hs, u_radius);

  // Шум, вытянутый по вертикали и бегущий вверх, — из него языки пламени.
  float n1 = fbm(vec2(px.x * 0.022, px.y * 0.011 - t * 1.35));
  float n2 = fbm(vec2(px.x * 0.06 + 5.2, px.y * 0.035 - t * 2.6));
  vec2 warp = vec2((n2 - 0.5) * 26.0, (n1 - 0.5) * 10.0) * u_amt;
  float d = sdRound(px + warp - c, hs, u_radius);

  // Над карточкой пламя высокое, по бокам — языками вдоль края, снизу почти нет.
  float up = clamp((px.y - (c.y + hs.y - u_radius)) / (u_radius + 24.0), 0.0, 1.0);
  float down = clamp(((c.y - hs.y + u_radius) - px.y) / (u_radius + 24.0), 0.0, 1.0);
  float dirMul = mix(0.34, 1.2, up) * mix(1.0, 0.3, down);

  // Края холста гаснут плавно, без видимой рамки.
  float edge = min(min(px.x, size.x - px.x), min(px.y, size.y - px.y));
  float fade = smoothstep(0.0, 36.0, edge);

  vec3 col = vec3(0.0);
  float alpha = 0.0;

  // Дым: серые клубы над верхним краем, пока карточка догорает.
  if (u_smoke > 0.001) {
    float ns = fbm(vec2(px.x * 0.012 + 9.0, px.y * 0.008 - t * 0.6));
    float reachS = 150.0 * mix(0.25, 1.0, up) * (0.3 + ns);
    float sm = (1.0 - smoothstep(0.0, reachS, max(d, 0.0))) * smoothstep(0.0, 18.0, d0);
    float sa = sm * smoothstep(0.3, 0.7, ns) * 0.55 * u_smoke * fade;
    col = vec3(0.5, 0.47, 0.53) * sa;
    alpha = sa;
  }

  float L = 120.0 * u_amt;
  if (L > 0.5) {
    float reach = L * dirMul * (0.18 + 1.25 * pow(n1, 1.6));
    float v = 1.0 - smoothstep(0.0, max(reach, 1.0), max(d, 0.0));
    v *= 0.82 + 0.18 * sin(t * 13.0 + n2 * 9.0);
    v = clamp(v, 0.0, 1.0);

    vec3 fire = mix(vec3(0.0), vec3(0.62, 0.05, 0.0), smoothstep(0.0, 0.25, v));
    fire = mix(fire, vec3(1.0, 0.34, 0.03), smoothstep(0.22, 0.55, v));
    fire = mix(fire, vec3(1.0, 0.7, 0.2), smoothstep(0.55, 0.82, v));
    fire = mix(fire, vec3(1.0, 0.93, 0.7), smoothstep(0.86, 1.0, v));
    float fa = smoothstep(0.04, 0.5, v) * fade;

    // Отсвет огня на всём вокруг.
    float glow = exp(-max(d0, 0.0) / 28.0) * 0.28 * u_amt * fade;

    // Искры: редкие точки, улетающие вверх.
    vec2 sp = px * 0.07;
    sp.y -= t * 5.0;
    sp.x += sin(sp.y * 0.7 + t) * 0.35;
    vec2 id = floor(sp);
    vec2 f = fract(sp) - 0.5;
    float h = hash(id);
    float spark = step(0.97, h) * smoothstep(0.14, 0.0, length(f));
    spark *= smoothstep(L * 1.4, 0.0, max(d0, 0.0)) * u_amt * fade * (0.55 + 0.45 * sin(t * 18.0 + h * 60.0));

    col = col * (1.0 - fa) + fire * fa;
    alpha = alpha * (1.0 - fa) + fa;
    col += vec3(1.0, 0.35, 0.05) * glow * (1.0 - alpha);
    alpha += glow * (1.0 - alpha);
    col += vec3(1.0, 0.78, 0.35) * spark;
    alpha = max(alpha, spark);
  }

  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

// Сколько места вокруг карточки занимает огонь (CSS px).
const PAD = { top: 170, side: 80, bottom: 36 };
const IGNITE_S = 0.45;
const EXTINGUISH_S = 0.55;
const SMOKE_S = 1.6;

type Uniforms = Record<'res' | 'rect' | 'radius' | 'scale' | 'time' | 'amt' | 'smoke', WebGLUniformLocation | null>;

type Fire = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  u: Uniforms;
  card: HTMLElement | null;
  /** Курсор на карточке: рисуем, даже пока amt ещё не успел подрасти. */
  burning: boolean;
  amt: number;
  smoke: number;
  stops: (() => void)[];
  raf: number;
  lastUsed: number;
};

const pool: Fire[] = [];
let unsupported = false;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
}

function createFire(): Fire | null {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    zIndex: '-1',
    pointerEvents: 'none',
    display: 'none',
  });
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string) => gl.getUniformLocation(prog, name);
  document.body.appendChild(canvas);
  return {
    canvas,
    gl,
    u: {
      res: u('u_res'),
      rect: u('u_rect'),
      radius: u('u_radius'),
      scale: u('u_scale'),
      time: u('u_time'),
      amt: u('u_amt'),
      smoke: u('u_smoke'),
    },
    card: null,
    burning: false,
    amt: 0,
    smoke: 0,
    stops: [],
    raf: 0,
    lastUsed: 0,
  };
}

function renderScale() {
  // Пламя размыто по природе: хватает ~1.2 пикселя на CSS-пиксель даже на retina.
  return Math.min(window.devicePixelRatio || 1, 2) * 0.6;
}

function draw(fire: Fire) {
  const { canvas, gl, u, card } = fire;
  if (!card || !card.isConnected) return false;
  const r = card.getBoundingClientRect();
  const w = r.width + PAD.side * 2;
  const h = r.height + PAD.top + PAD.bottom;
  const scale = renderScale();
  const bw = Math.round(w * scale);
  const bh = Math.round(h * scale);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  canvas.style.transform = `translate(${r.left + window.scrollX - PAD.side}px, ${r.top + window.scrollY - PAD.top}px)`;
  const radius = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 16;

  gl.viewport(0, 0, bw, bh);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(u.res, bw, bh);
  // В шейдере ось Y смотрит вверх: прямоугольник карточки от нижнего края холста.
  gl.uniform4f(u.rect, PAD.side, PAD.bottom, r.width, r.height);
  gl.uniform1f(u.radius, radius);
  gl.uniform1f(u.scale, scale);
  gl.uniform1f(u.time, performance.now() / 1000);
  gl.uniform1f(u.amt, fire.amt);
  gl.uniform1f(u.smoke, fire.smoke);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return true;
}

function loop(fire: Fire) {
  if (fire.raf) return;
  fire.canvas.style.display = 'block';
  const tick = () => {
    const alive = (fire.burning || fire.amt > 0.001 || fire.smoke > 0.001) && draw(fire);
    if (!alive) {
      fire.raf = 0;
      fire.card = null;
      fire.canvas.style.display = 'none';
      return;
    }
    fire.raf = requestAnimationFrame(tick);
  };
  fire.raf = requestAnimationFrame(tick);
}

function stopTweens(fire: Fire) {
  fire.stops.forEach((stop) => stop());
  fire.stops = [];
}

function tween(fire: Fire, key: 'amt' | 'smoke', to: number, duration: number, delay = 0) {
  const controls = animate(fire[key], to, {
    duration,
    delay,
    ease: to > fire[key] ? 'easeOut' : 'easeIn',
    onUpdate: (v: number) => {
      fire[key] = v;
    },
  });
  fire.stops.push(() => controls.stop());
}

function acquire(card: HTMLElement): Fire | null {
  if (unsupported) return null;
  const own = pool.find((f) => f.card === card);
  if (own) return own;
  let fire = pool.find((f) => !f.card);
  if (!fire && pool.length < 2) {
    const created = createFire();
    if (!created) {
      unsupported = true;
      return null;
    }
    pool.push(created);
    fire = created;
  }
  // Оба холста заняты — забираем тот, что дольше всех догорает.
  if (!fire) fire = [...pool].sort((a, b) => a.lastUsed - b.lastUsed)[0];
  stopTweens(fire);
  fire.burning = false;
  fire.amt = 0;
  fire.smoke = 0;
  fire.card = card;
  return fire;
}

export function igniteCard(card: HTMLElement) {
  const fire = acquire(card);
  if (!fire) return;
  fire.lastUsed = performance.now();
  fire.burning = true;
  stopTweens(fire);
  tween(fire, 'smoke', 0, 0.2);
  tween(fire, 'amt', 1, IGNITE_S);
  loop(fire);
}

export function extinguishCard(card: HTMLElement) {
  const fire = pool.find((f) => f.card === card);
  if (!fire) return;
  fire.burning = false;
  stopTweens(fire);
  fire.smoke = Math.max(fire.smoke, fire.amt);
  tween(fire, 'amt', 0, EXTINGUISH_S);
  tween(fire, 'smoke', 0, SMOKE_S, 0.15);
  loop(fire);
}

/** Слой эффектов размонтирован (ушли с витрины) — гасим всё сразу. */
export function extinguishAll() {
  pool.forEach((fire) => {
    stopTweens(fire);
    fire.burning = false;
    fire.amt = 0;
    fire.smoke = 0;
  });
}
