/**
 * Выбор времени готовности на экране «Zeit festlegen» — чистая арифметика.
 *
 * Живёт отдельно от экрана, потому что ошибиться здесь дороже всего: числом из
 * этого модуля кухня отвечает гостю, и проверить его хочется тестом, а не
 * касанием прибора.
 *
 * Выбор существует в ДВУХ видах, и это не удобство, а разница смысла:
 *   • `in`  — «через N минут»: заказ на сейчас, час готовности едет за часами;
 *   • `at`  — «к 20:30»: заказ на время, час назвал гость и он неподвижен.
 *
 * Держать одни минуты нельзя: они отсчитываются от «сейчас», и пока кухня
 * читает состав, «20:30» само превратилось бы в «20:45».
 */

/**
 * Границы обещания — те же 5…180, что принимает сервер
 * (ETA_MIN_MINUTES/ETA_MAX_MINUTES в lib/orders/delay.ts). Скопированы, а не
 * импортированы: тот модуль тянет модель заказа и Twilio, а этот открывается
 * в браузере прибора.
 */
export const POS_ETA_MIN_MINUTES = 5;
export const POS_ETA_MAX_MINUTES = 180;
export const POS_ETA_STEP = 5;
export const POS_ETA_DEFAULT_MINUTES = 30;

/** Пресеты «aus der Küche» — те же значения, которыми оперирует стоп-бот. */
export const POS_ETA_PRESETS = [30, 45, 60, 90, 120] as const;

export type PosEtaChoice = { mode: 'in'; minutes: number } | { mode: 'at'; ms: number };

export const POS_ETA_INITIAL: PosEtaChoice = { mode: 'in', minutes: POS_ETA_DEFAULT_MINUTES };

export function clampEtaMinutes(value: number): number {
  return Math.min(POS_ETA_MAX_MINUTES, Math.max(POS_ETA_MIN_MINUTES, Math.round(value)));
}

export interface PosEtaView {
  /** Столько минут уедет в `etaMinutes`. */
  minutes: number;
  /** Что показать крупно, epoch ms. null — часы прибора ещё не сверены. */
  targetMs: number | null;
  /**
   * Желаемый час дальше предела и обещание пришлось урезать. Экран обязан
   * сказать об этом словами: молча пообещать не тот час — худший исход.
   */
  clamped: boolean;
}

/**
 * Выбор → что показать и что отправить.
 *
 * В неурезанном виде `at` крупным показывается РОВНО названный час, а не
 * «сейчас + округлённые минуты»: округление до минуты сдвигало бы подпись на
 * 20:29 при обещании на 20:30.
 */
export function posEtaView(choice: PosEtaChoice, nowMs: number | null): PosEtaView {
  const raw =
    choice.mode === 'in'
      ? choice.minutes
      : nowMs == null
        ? null
        : Math.round((choice.ms - nowMs) / 60_000);
  const minutes = clampEtaMinutes(raw ?? POS_ETA_DEFAULT_MINUTES);
  const clamped = raw != null && raw !== minutes;
  const targetMs =
    choice.mode === 'at' && !clamped
      ? choice.ms
      : nowMs == null
        ? null
        : nowMs + minutes * 60_000;
  return { minutes, targetMs, clamped };
}

/**
 * ±5. В виде «к 20:30» двигается САМ ЧАС — иначе шаг считался бы от «сейчас» и
 * первое же касание сбрасывало бы желаемое время.
 */
export function posShiftEta(
  choice: PosEtaChoice,
  deltaMinutes: number,
  nowMs: number | null
): PosEtaChoice {
  if (choice.mode === 'in') {
    return { mode: 'in', minutes: clampEtaMinutes(choice.minutes + deltaMinutes) };
  }
  const next = choice.ms + deltaMinutes * 60_000;
  if (nowMs == null) return { mode: 'at', ms: next };
  const low = nowMs + POS_ETA_MIN_MINUTES * 60_000;
  const high = nowMs + POS_ETA_MAX_MINUTES * 60_000;
  return { mode: 'at', ms: Math.min(high, Math.max(low, next)) };
}

/**
 * Wunschzeit → начальный выбор экрана. null — подставлять нечего.
 *
 * Прошедший час не подставляем: обещать гостю время, которое уже наступило,
 * нечестно, и кухня должна назвать реальный срок сама.
 */
export function posDesiredChoice(
  desiredMs: number | null | undefined,
  nowMs: number | null
): PosEtaChoice | null {
  if (desiredMs == null) return null;
  if (nowMs != null && desiredMs - nowMs < POS_ETA_MIN_MINUTES * 60_000) return null;
  return { mode: 'at', ms: desiredMs };
}
