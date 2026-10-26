/**
 * Звук Halloween-режима: злодейский смех при поджоге карточки и фоновая музыка.
 *
 * Браузер не даёт сайту играть звук, пока посетитель ни разу не кликнул или
 * не тапнул по странице, поэтому AudioContext создаётся только в обработчике
 * жеста (unlockAudio). Громкость — через GainNode: на iOS audio.volume не работает.
 * Пока файлов в public/sounds нет, всё молча ничего не делает.
 */

import { storageGet, storageSet } from '../../lib/safe-storage';

export const HW_SOUNDS = {
  laughs: [
    '/sounds/halloween-laugh-1.mp3',
    '/sounds/halloween-laugh-2.mp3',
    '/sounds/halloween-laugh-3.mp3',
  ],
  music: '/sounds/halloween-music.mp3',
};

const LAUGH_VOLUME = 0.4;
const MUSIC_VOLUME = 0.3;
const MUSIC_FADE_IN_S = 2;
const MUSIC_FADE_OUT_S = 0.6;
const LAUGH_GAP_MS = 10_000;
const LAUGHS_PER_VISIT = 3;
const MUSIC_PREF_KEY = 'hw-music';
const LAUGH_COUNT_KEY = 'hw-laughs';

let ctx: AudioContext | null = null;
let unlocked = false;
let laughBuffers: Promise<(AudioBuffer | null)[]> | null = null;
let decodedLaughs: (AudioBuffer | null)[] = [];
let nextLaugh = 0;
let lastLaughAt = 0;

let musicEl: HTMLAudioElement | null = null;
let musicGain: GainNode | null = null;
let musicPauseTimer: ReturnType<typeof setTimeout> | null = null;
let musicWanted = storageGet(MUSIC_PREF_KEY) === 'on';
let musicZone = false;
let musicAvailable: Promise<boolean> | null = null;

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeSound(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function isMusicWanted() {
  return musicWanted;
}

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const AC: typeof AudioContext | undefined =
    typeof window === 'undefined' ? undefined : window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

// Старый Safari знает только колбэчную форму decodeAudioData.
function decode(c: AudioContext, data: ArrayBuffer): Promise<AudioBuffer | null> {
  return new Promise((resolve) => {
    try {
      const p = c.decodeAudioData(data, (b) => resolve(b), () => resolve(null));
      if (p && typeof p.catch === 'function') p.catch(() => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

function loadLaughs(c: AudioContext) {
  if (laughBuffers) return laughBuffers;
  laughBuffers = Promise.all(
    HW_SOUNDS.laughs.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return decode(c, await res.arrayBuffer());
      } catch {
        return null;
      }
    })
  ).then((list) => {
    decodedLaughs = list;
    return list;
  });
  return laughBuffers;
}

/**
 * Вызывать только из обработчика клика/тапа/клавиши. Возвращает, ожил ли
 * AudioContext: Safari засчитывает не каждый жест, тогда ждём следующего.
 */
export function unlockAudio(): Promise<boolean> {
  const c = audioContext();
  if (!c) return Promise.resolve(false);
  const ready = c.state === 'running' ? Promise.resolve() : c.resume().catch(() => {});
  if (!unlocked) {
    unlocked = true;
    loadLaughs(c);
  }
  return Promise.resolve(ready).then(() => {
    const running = c.state === 'running';
    if (running && musicWanted && musicZone && !document.hidden) startMusic();
    return running;
  });
}

export function isAudioUnlocked() {
  return unlocked;
}

function laughCount() {
  return Number(storageGet(LAUGH_COUNT_KEY, 'session')) || 0;
}

/**
 * Смех при поджоге: не чаще раза в 10 с и не больше 3 раз за визит.
 * force — смех при включении музыки, его посетитель вызвал сам.
 */
export function playLaugh({ force = false }: { force?: boolean } = {}) {
  if (!unlocked || !ctx || ctx.state !== 'running') return;
  const now = Date.now();
  if (!force) {
    if (now - lastLaughAt < LAUGH_GAP_MS) return;
    if (laughCount() >= LAUGHS_PER_VISIT) return;
  }
  const available = decodedLaughs.filter((b): b is AudioBuffer => !!b);
  if (!available.length) return;
  const buffer = available[nextLaugh % available.length];
  nextLaugh += 1;
  lastLaughAt = now;
  if (!force) storageSet(LAUGH_COUNT_KEY, String(laughCount() + 1), 'session');
  try {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = LAUGH_VOLUME;
    source.buffer = buffer;
    source.connect(gain).connect(ctx.destination);
    source.start();
  } catch {
    // звук — украшение, сбой не должен мешать заказу
  }
}

function ensureMusic(c: AudioContext) {
  if (musicEl && musicGain) return true;
  try {
    musicEl = new Audio(HW_SOUNDS.music);
    musicEl.loop = true;
    musicEl.preload = 'auto';
    musicGain = c.createGain();
    musicGain.gain.value = 0;
    c.createMediaElementSource(musicEl).connect(musicGain).connect(c.destination);
    return true;
  } catch {
    musicEl = null;
    musicGain = null;
    return false;
  }
}

function startMusic() {
  const c = ctx;
  if (!unlocked || !c || !ensureMusic(c) || !musicEl || !musicGain) return;
  if (musicPauseTimer) {
    clearTimeout(musicPauseTimer);
    musicPauseTimer = null;
  }
  const t = c.currentTime;
  musicGain.gain.cancelScheduledValues(t);
  musicGain.gain.setValueAtTime(musicGain.gain.value, t);
  musicGain.gain.linearRampToValueAtTime(MUSIC_VOLUME, t + MUSIC_FADE_IN_S);
  musicEl.play().catch(() => {});
}

function stopMusic() {
  const c = ctx;
  if (!c || !musicEl || !musicGain) return;
  const t = c.currentTime;
  musicGain.gain.cancelScheduledValues(t);
  musicGain.gain.setValueAtTime(musicGain.gain.value, t);
  musicGain.gain.linearRampToValueAtTime(0, t + MUSIC_FADE_OUT_S);
  if (musicPauseTimer) clearTimeout(musicPauseTimer);
  musicPauseTimer = setTimeout(() => {
    musicEl?.pause();
    musicPauseTimer = null;
  }, MUSIC_FADE_OUT_S * 1000 + 50);
}

/** Кнопка в шапке (это клик — заодно разблокирует звук). */
export function setMusicWanted(on: boolean) {
  musicWanted = on;
  storageSet(MUSIC_PREF_KEY, on ? 'on' : 'off');
  if (on) {
    unlockAudio();
    if (musicZone) startMusic();
    if (ctx) loadLaughs(ctx).then(() => playLaugh({ force: true }));
  } else {
    stopMusic();
  }
  notify();
}

/** Музыка звучит только на витрине: в чекауте и прочих разделах затихает. */
export function setMusicZone(active: boolean) {
  musicZone = active;
  if (active && musicWanted && unlocked && !document.hidden) startMusic();
  if (!active) stopMusic();
}

/** Свёрнутая вкладка — пауза, вернулись — продолжаем. */
export function handleVisibility() {
  if (document.hidden) {
    musicEl?.pause();
    return;
  }
  if (musicWanted && musicZone && unlocked) startMusic();
}

/** Кнопку музыки показываем, только когда файл реально лежит в public/sounds. */
export function isMusicAvailable() {
  if (!musicAvailable) {
    musicAvailable = fetch(HW_SOUNDS.music, { method: 'HEAD' })
      .then((res) => res.ok)
      .catch(() => false);
  }
  return musicAvailable;
}
