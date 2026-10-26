/**
 * Реалистичное пламя вокруг карточки (Halloween): WebGL-шейдер с турбулентным
 * шумом. На компьютере холст лежит ПОД страницей (z-index: -1): карточка
 * непрозрачна и закрывает середину — видно то, что вырывается из-за её краёв.
 * На телефоне карточки во всю ширину и «за» ними огня не видно, поэтому холст
 * поверх страницы (front), а саму карточку шейдер вырезает из пламени.
 *
 * Холстов максимум два: один горит, второй догорает и дымит, пока мышь уже
 * на соседней карточке. Без WebGL — тихо ничего не делаем.
 */

import { animate } from 'motion';

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Точность (highp/mediump) дописывается перед компиляцией — см. createFire.
const FRAG = `
uniform vec2 u_res;
uniform vec4 u_rect;
uniform float u_radius;
uniform float u_scale;
uniform float u_time;
uniform float u_amt;
uniform float u_smoke;
uniform float u_front;
uniform float u_oct;
uniform sampler2D u_noise;

// Случайные числа — из текстуры 64×64 (NEAREST, REPEAT). Формула fract(sin(…)*43758)
// на 16-битных видеокартах Android даёт одни нули: шум плоский, языков пламени нет.
float hash(vec2 p) { return texture2D(u_noise, (floor(p) + 0.5) / 64.0).r; }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// u_oct слоёв шума: 5 на компьютере, 3 на телефоне (нормируем, чтобы длина языков не менялась).
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  float sum = 0.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= u_oct) break;
    v += a * noise(p);
    sum += a;
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v / sum * 0.97;
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

  // Дорогой шум не считаем там, где огня быть не может: под самой карточкой
  // (её всё равно не видно — она непрозрачна или вырезана) и вдали от неё.
  float reachMax = (u_front > 0.5 ? 95.0 : 120.0) * 1.5 * u_amt + 40.0 + (u_smoke > 0.001 ? 170.0 : 0.0);
  if (d0 < -3.0 || d0 > reachMax) {
    gl_FragColor = vec4(0.0);
    return;
  }

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

  float L = (u_front > 0.5 ? 95.0 : 120.0) * u_amt;
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

  // Поверх страницы (телефон): сама карточка остаётся чистой.
  float keep = u_front > 0.5 ? smoothstep(-0.5, 1.5, d0) : 1.0;
  gl_FragColor = vec4(col * keep, clamp(alpha, 0.0, 1.0) * keep);
}
`;

// Сколько места вокруг карточки занимает огонь (CSS px).
const PAD = { top: 170, side: 80, bottom: 36 };
const IGNITE_S = 0.45;
const EXTINGUISH_S = 0.55;
const SMOKE_S = 1.6;
// Телефон: 30 кадров/с вместо 60 и меньше пикселей — на маленьком экране разницы не видно.
const LITE_FRAME_MS = 32;
const NOISE_SIZE = 64;
// Время для шейдера держим маленьким: в 16 битах (mediump) после пары минут
// секунды идут ступеньками, а через полчаса время стоит. Скачок раз в период незаметен.
const TIME_WRAP_HIGHP_S = 600;
const TIME_WRAP_MEDIUMP_S = 30;
// Положение карточки перечитываем не каждый кадр, а раз в 300 мс.
const RECT_TTL_MS = 300;

type Uniforms = Record<
  'res' | 'rect' | 'radius' | 'scale' | 'time' | 'amt' | 'smoke' | 'front' | 'oct' | 'noise',
  WebGLUniformLocation | null
>;

type Fire = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  u: Uniforms;
  card: HTMLElement | null;
  /** Холст поверх страницы и облегчённый огонь (телефон) или под ней (компьютер). */
  front: boolean;
  /** Видеокарта считает фрагменты в highp; иначе время заворачиваем чаще. */
  highp: boolean;
  /** Положение карточки в координатах документа и когда его снимали. */
  rect: { x: number; y: number; w: number; h: number; at: number } | null;
  /** Последний записанный transform холста — не трогаем стили, если он не изменился. */
  transform: string;
  radius: number;
  lastDraw: number;
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
  // Исходник GLSL — только ASCII: строгие драйверы (старые Android) не компилируют
  // шейдер с кириллицей даже в комментариях, поэтому комментарии вырезаем.
  gl.shaderSource(sh, src.replace(/\/\/[^\n]*/g, ''));
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
  // highp, где он есть: на многих Android mediump — честные 16 бит.
  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const highp = !!hp && hp.precision > 0;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, `precision ${highp ? 'highp' : 'mediump'} float;\n${FRAG}`);
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

  const noise = new Uint8Array(NOISE_SIZE * NOISE_SIZE);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, NOISE_SIZE, NOISE_SIZE, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, noise);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.uniform1i(u('u_noise'), 0);

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
      front: u('u_front'),
      oct: u('u_oct'),
      noise: u('u_noise'),
    },
    card: null,
    front: false,
    highp,
    rect: null,
    transform: '',
    radius: 16,
    lastDraw: 0,
    burning: false,
    amt: 0,
    smoke: 0,
    stops: [],
    raf: 0,
    lastUsed: 0,
  };
}

function renderScale(lite: boolean) {
  // Пламя размыто по природе: хватает ~1.2 пикселя на CSS-пиксель даже на retina, телефону — 0.8.
  return Math.min(window.devicePixelRatio || 1, 2) * (lite ? 0.4 : 0.6);
}

function measure(fire: Fire, card: HTMLElement) {
  const r = card.getBoundingClientRect();
  fire.rect = { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height, at: performance.now() };
}

function draw(fire: Fire) {
  const { canvas, gl, u, card } = fire;
  if (!card || !card.isConnected) return false;
  // Холст в координатах документа сам едет со страницей при прокрутке —
  // перемерять карточку (это пересчёт раскладки) нужно лишь изредка.
  if (!fire.rect || performance.now() - fire.rect.at > RECT_TTL_MS) measure(fire, card);
  const r = fire.rect!;
  const w = r.w + PAD.side * 2;
  const h = r.h + PAD.top + PAD.bottom;
  const scale = renderScale(fire.front);
  const bw = Math.round(w * scale);
  const bh = Math.round(h * scale);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const transform = `translate(${r.x - PAD.side}px, ${r.y - PAD.top}px)`;
  if (transform !== fire.transform) {
    fire.transform = transform;
    canvas.style.transform = transform;
  }

  gl.viewport(0, 0, bw, bh);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(u.res, bw, bh);
  // В шейдере ось Y смотрит вверх: прямоугольник карточки от нижнего края холста.
  gl.uniform4f(u.rect, PAD.side, PAD.bottom, r.w, r.h);
  gl.uniform1f(u.radius, fire.radius);
  gl.uniform1f(u.scale, scale);
  gl.uniform1f(u.time, (performance.now() / 1000) % (fire.highp ? TIME_WRAP_HIGHP_S : TIME_WRAP_MEDIUMP_S));
  gl.uniform1f(u.amt, fire.amt);
  gl.uniform1f(u.smoke, fire.smoke);
  gl.uniform1f(u.front, fire.front ? 1 : 0);
  gl.uniform1f(u.oct, fire.front ? 3 : 5);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return true;
}

function loop(fire: Fire) {
  if (fire.raf) return;
  fire.canvas.style.display = 'block';
  const tick = (now: number) => {
    const active = fire.burning || fire.amt > 0.001 || fire.smoke > 0.001;
    const skip = active && fire.front && now - fire.lastDraw < LITE_FRAME_MS;
    const alive = active && (skip || draw(fire));
    if (!skip) fire.lastDraw = now;
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
  fire.rect = null;
  fire.radius = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 16;
  return fire;
}

/**
 * Компиляция шейдера блокирует страницу на 0,15–0,25 с. Делаем её заранее,
 * пока витрина простаивает, — тогда первое возгорание не подвисает.
 */
export function prewarmFire() {
  if (unsupported || pool.length) return;
  for (let i = 0; i < 2; i++) {
    const fire = createFire();
    if (!fire) {
      unsupported = true;
      return;
    }
    // Один крошечный кадр — драйвер доделывает компиляцию на первой отрисовке.
    fire.canvas.width = 1;
    fire.canvas.height = 1;
    fire.gl.viewport(0, 0, 1, 1);
    fire.gl.drawArrays(fire.gl.TRIANGLE_STRIP, 0, 4);
    pool.push(fire);
  }
}

/** front — холст поверх страницы (телефон), иначе под ней (компьютер). */
export function igniteCard(card: HTMLElement, { front = false }: { front?: boolean } = {}) {
  const fire = acquire(card);
  if (!fire) return;
  fire.lastUsed = performance.now();
  fire.front = front;
  // Ниже шапки (z-50) и модалок, выше контента и липкой ленты категорий.
  fire.canvas.style.zIndex = front ? '41' : '-1';
  fire.burning = true;
  stopTweens(fire);
  tween(fire, 'smoke', 0, 0.2);
  tween(fire, 'amt', 1, IGNITE_S);
  loop(fire);
}

/**
 * instant — открылся товар: гасим сразу, без затухания и дыма, чтобы окно
 * товара открывалось на свободном телефоне. На телефоне дыма нет вообще.
 */
export function extinguishCard(card: HTMLElement, { instant = false }: { instant?: boolean } = {}) {
  const fire = pool.find((f) => f.card === card);
  if (!fire) return;
  fire.burning = false;
  stopTweens(fire);
  if (instant) {
    fire.amt = 0;
    fire.smoke = 0;
    return;
  }
  if (!fire.front) fire.smoke = Math.max(fire.smoke, fire.amt);
  tween(fire, 'amt', 0, EXTINGUISH_S);
  if (!fire.front) tween(fire, 'smoke', 0, SMOKE_S, 0.15);
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

export type FireDiagnosis = {
  webgl: boolean;
  renderer?: string;
  highp?: boolean;
  /** Доля строки над карточкой, где есть пламя. */
  coverage?: number;
  /** Разброс прозрачности по этой строке: у ровной полосы без языков ≈ 0. */
  variation?: number;
  /** Насколько кадр меняется за полсекунды: 0 — пламя застыло. */
  motion?: number;
};

function flameRow(fire: Fire, time: number, w: number, h: number) {
  const { gl, u } = fire;
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(u.res, w, h);
  gl.uniform4f(u.rect, 80, 40, 200, 120);
  gl.uniform1f(u.radius, 16);
  gl.uniform1f(u.scale, 1);
  gl.uniform1f(u.time, time);
  gl.uniform1f(u.amt, 1);
  gl.uniform1f(u.smoke, 0);
  gl.uniform1f(u.front, 1);
  gl.uniform1f(u.oct, 3);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  // Строка в 30 px над верхним краем «карточки» (ось Y снизу вверх), по её ширине.
  const row = new Uint8Array(200 * 4);
  gl.readPixels(80, 190, 200, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
  const alpha: number[] = [];
  for (let i = 3; i < row.length; i += 4) alpha.push(row[i] / 255);
  return alpha;
}

/**
 * Самопроверка огня на этом устройстве (?hwdebug=1): рисует тестовый кадр
 * тем же шейдером и смотрит, есть ли языки пламени и двигаются ли они.
 */
export function diagnoseFire(): FireDiagnosis {
  const fire = createFire();
  if (!fire) return { webgl: false };
  const { gl, canvas } = fire;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  canvas.width = 360;
  canvas.height = 360;
  const a = flameRow(fire, 12.34, 360, 360);
  const b = flameRow(fire, 12.84, 360, 360);
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  const variation = Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length);
  const motion = a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
  canvas.remove();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return {
    webgl: true,
    renderer,
    highp: fire.highp,
    coverage: a.filter((v) => v > 0.1).length / a.length,
    variation,
    motion,
  };
}
