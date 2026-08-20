/**
 * Действия экрана «Bestelldetails»: какие кнопки стоят внизу в каждом статусе
 * и что каждая из них делает.
 *
 * Модуль ЧИСТЫЙ и живёт отдельно от страницы, потому что здесь принимается
 * решение «касание кнопки → уведомлённый гость», и оно должно быть проверяемо
 * тестом без рендера страницы. Инцидент #260820002: заказ ушёл в «Unterwegs»
 * через 8 секунд после приёма — касание при выходе с экрана попало в кнопку.
 */

import type { PosBoardStatus } from './board';

/** Кнопка панели действий: подпись, вид и то, во что она переводит заказ. */
export interface PosAction {
  label: string;
  variant?: 'primary' | 'ghost';
  /** Куда переводим заказ. Пусто — действие не про статус. */
  next?: PosBoardStatus;
  /**
   * Действие спрашивает подтверждение. Обязательно для всего, что немедленно
   * уведомляет гостя: подтверждение — единственное, что отличает нажатую
   * кнопку от касания, которым выходили с экрана.
   */
  confirm?: boolean;
}

const CANCEL: PosAction = { label: 'Stornieren', variant: 'ghost', next: 'cancelled', confirm: true };
const BACK: PosAction = { label: 'Zurück zur Liste', variant: 'ghost' };

export const POS_DETAIL_VIEW: Record<
  PosBoardStatus,
  { step?: 1 | 2 | 3 | 4; canExtend: boolean; actions: PosAction[] }
> = {
  new: {
    step: 1,
    canExtend: false,
    // Принять заказ = назначить время. Отдельной кнопки «принять без времени»
    // нет: гость всё равно спросит, когда, а кухня уже забыла.
    actions: [CANCEL, { label: 'Annehmen' }],
  },
  preparing: {
    step: 2,
    canExtend: true,
    // Сразу в «Unterwegs», минуя «Bereit zur Lieferung». Для ресторана это один
    // шаг: заказ снимают с кухни и отдают курьеру, промежуточного состояния
    // «стоит готовый на полке» в реальной смене нет — а лишняя кнопка означала
    // лишнее касание и заказ, забытый в статусе, которого никто не ведёт.
    //
    // ПОДТВЕРЖДЕНИЕ обязательно (заказ #260820002). Кнопка стоит в той же точке
    // экрана, что «Annehmen» и «Bestellung annehmen» на двух предыдущих шагах,
    // и в зоне, где киоск прячет всплывшую панель навигации, — случайное
    // касание при выходе отправляло гостю «unterwegs» одним тапом.
    actions: [CANCEL, { label: 'Ist unterwegs', next: 'delivering', confirm: true }],
  },
  // Готовый САМОВЫВОЗ: доставку с этим статусом экран показывает как
  // 'delivering' (см. posDisplayStatus), сюда доходит только заказ, который
  // ждёт гостя у стойки. Ему нужен один жест — «забрал», а не «уехал».
  ready: {
    step: 3,
    canExtend: false,
    actions: [CANCEL, { label: 'Abgeholt', next: 'delivered' }],
  },
  delivering: {
    step: 3,
    canExtend: false,
    actions: [{ label: 'Zurück', variant: 'ghost' }, { label: 'Zugestellt', next: 'delivered' }],
  },
  delivered: { step: 4, canExtend: false, actions: [BACK] },
  // Отменённый заказ прогресс не показывает: ему некуда двигаться.
  cancelled: { canExtend: false, actions: [BACK] },
};

/**
 * Тексты подтверждений — по целевому статусу. Действие с `confirm` без текста
 * здесь — ошибка сборки экрана, тест это ловит: молча пропустить подтверждение
 * значило бы вернуть инцидент.
 */
export const POS_CONFIRM_SHEET: Partial<
  Record<PosBoardStatus, { title: string; subtitle: string; confirmLabel: string; danger?: boolean }>
> = {
  cancelled: {
    title: 'Bestellung stornieren?',
    subtitle: 'Der Gast bekommt eine Nachricht. Das lässt sich nicht zurücknehmen.',
    confirmLabel: 'Stornieren',
    danger: true,
  },
  delivering: {
    title: 'Ist die Bestellung unterwegs?',
    subtitle: 'Der Gast bekommt sofort die Nachricht, dass die Lieferung unterwegs ist.',
    confirmLabel: 'Ist unterwegs',
  },
};

/** Что экран обязан сделать по нажатию. Разбор отделён от страницы для теста. */
export type PosActionIntent =
  | { kind: 'confirm'; next: PosBoardStatus }
  | { kind: 'status'; next: PosBoardStatus }
  /** «Annehmen»: приём идёт через экран выбора времени, а не прямым статусом. */
  | { kind: 'accept-flow' }
  /** Навигация назад в ленту. Единственный исход без статуса и без сети. */
  | { kind: 'exit' };

export function posActionIntent(action: PosAction): PosActionIntent {
  if (action.confirm && action.next) return { kind: 'confirm', next: action.next };
  if (action.next) return { kind: 'status', next: action.next };
  if (action.label === 'Annehmen') return { kind: 'accept-flow' };
  return { kind: 'exit' };
}
