'use client';

/**
 * Сигнал о новом заказе.
 *
 * Тон синтезируется, а не берётся файлом: звук на кухне должен зазвучать даже
 * тогда, когда Wi-Fi лёг и страница живёт из кэша, а лишний запрос за mp3 —
 * это лишняя точка отказа ровно в тот момент, когда всё и так плохо.
 *
 * Две ноты вверх, а не один писк: короткий сигнал в шуме вытяжки и печи теряется,
 * а движение вверх слышно как «что-то пришло», и его не путают с щелчком принтера.
 */

/** Ноты сигнала: ля и ре следующей октавы, длительность каждой в секундах. */
const CHIME = [
  { hz: 880, at: 0, seconds: 0.16 },
  { hz: 1174.7, at: 0.15, seconds: 0.26 },
];

/** Громкость. Динамик прибора маленький, на единице он хрипит. */
const VOLUME = 0.28;

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  return context;
}

/**
 * Разбудить звук по касанию экрана.
 *
 * Браузер запрещает звук до первого действия человека, и на киоске это правило
 * тоже действует. Поэтому первое же касание где угодно снимает запрет — иначе
 * первый заказ смены пришёл бы молча.
 */
export function unlockPosSound(): void {
  const ctx = audioContext();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

/** Проиграть сигнал. Молча ничего не делает, если звук недоступен. */
export function playPosChime(): void {
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const start = ctx.currentTime;
  for (const note of CHIME) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    // Треугольная волна вместо синуса: слышнее на маленьком динамике, но без
    // резкости прямоугольной, от которой к концу смены болит голова.
    oscillator.type = 'triangle';
    oscillator.frequency.value = note.hz;

    const from = start + note.at;
    const to = from + note.seconds;
    // Огибающая: щелчок в начале и в конце убирается плавным нарастанием и
    // затуханием, иначе вместо ноты слышен удар.
    gain.gain.setValueAtTime(0, from);
    gain.gain.linearRampToValueAtTime(VOLUME, from + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, to);

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(from);
    oscillator.stop(to + 0.02);
  }
}
