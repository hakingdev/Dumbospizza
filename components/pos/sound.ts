'use client';

/**
 * Сигнал о новом заказе.
 *
 * Звук берётся с прибора, если прибор его даёт: повар выбирает во вкладке «Mehr»
 * штатный звук Android, и он звучит громко, длинно и знакомо. Синтезированные
 * две ноты остаются запасным вариантом — они короткие, и в шуме вытяжки и печи
 * их слышно хуже, чем полноценный рингтон.
 *
 * Запасной вариант синтезируется, а не берётся файлом: звук на кухне должен
 * зазвучать даже тогда, когда Wi-Fi лёг и страница живёт из кэша, а лишний
 * запрос за mp3 — это лишняя точка отказа ровно в тот момент, когда всё и так
 * плохо.
 *
 * Две ноты вверх, а не один писк: короткий сигнал в шуме теряется, а движение
 * вверх слышно как «что-то пришло», и его не путают с щелчком принтера.
 */

import { posBridge } from './bridge';

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
 * первый заказ смены пришёл бы молча. Мост в этом не нуждается (звук играет
 * приложение, а не страница), но контекст всё равно готовим: он понадобится,
 * если мост подведёт.
 */
export function unlockPosSound(): void {
  const ctx = audioContext();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

/**
 * Проиграть сигнал. Молча ничего не делает, если звук недоступен совсем.
 *
 * Сначала мост, потом синтез — и порядок здесь не про красоту, а про слышимость:
 * выбранный поваром рингтон играет системный плеер прибора, на своей громкости
 * звонка, и его слышно через кухню. Синтез вступает в двух случаях: моста нет
 * (обычный браузер, отладка с ноутбука) или мост бросил исключение — например,
 * выбранный звук лежал на карте, а карту вынули. Тишина в такой момент означала
 * бы потерянный заказ, поэтому лучше короткий писк, чем ничего.
 */
export function playPosChime(): void {
  if (playViaBridge()) return;
  playSynthChime();
}

/**
 * Оборвать сигнал.
 *
 * Нужно в момент приёма заказа: выбранный рингтон бывает длиной в полминуты, и
 * без этого он звенит над уже принятым заказом — а звонок, который не замолкает
 * после действия, повар начинает игнорировать. Синтез обрывать нечего: две ноты
 * укладываются в полсекунды и кончаются сами.
 */
export function stopPosChime(): void {
  const bridge = posBridge();
  if (typeof bridge?.stopAlert !== 'function') return;
  try {
    bridge.stopAlert();
  } catch {
    // Не замолчал — переживём: звук всё равно конечный.
  }
}

/** Отдать звук приложению. `false` — приложение не взялось, играем сами. */
function playViaBridge(): boolean {
  const bridge = posBridge();
  if (typeof bridge?.playAlert !== 'function') return false;
  try {
    // Вызываем методом объекта, а не отвязанной ссылкой: мост — это Java-объект,
    // проброшенный в JS, и без получателя вызов не доходит.
    //
    // Явный `false` — это ответ «на приборе нет ни одного пригодного звука».
    // Старая сборка apk отвечала `undefined`, и это не отказ, а «сделал»:
    // считать её отказом значило бы звонить дважды.
    return bridge.playAlert() !== false;
  } catch {
    return false;
  }
}

/** Две ноты через Web Audio — сигнал для браузера и на случай отказа моста. */
function playSynthChime(): void {
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
