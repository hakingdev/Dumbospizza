/**
 * Статусы платежа и правило «переходы только вперёд» (ТЗ §5): откат вроде
 * captured → created невозможен на уровне сервисного слоя — недопустимый
 * переход тихо превращается в no-op (важно для перепосылок вебхуков и гонок
 * capture ↔ webhook: устаревшее событие не затирает более позднее состояние).
 */

export type PaymentStatus =
  | 'created'
  | 'approved'
  | 'captured'
  | 'failed'
  | 'refunded'
  | 'partially_refunded'
  | 'cancelled'
  | 'reversed';

const FORWARD_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  created: ['approved', 'captured', 'failed', 'cancelled'],
  approved: ['captured', 'failed', 'cancelled'],
  captured: ['partially_refunded', 'refunded', 'reversed'],
  // повторный частичный возврат остаётся в partially_refunded (тот же статус
  // «переходом» не считается — см. canTransition)
  partially_refunded: ['refunded', 'reversed'],
  refunded: [],
  failed: [],
  cancelled: [],
  reversed: [],
};

/** true, если переход from→to разрешён. Одинаковые статусы — не переход (no-op). */
export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return false;
  return (FORWARD_TRANSITIONS[from] || []).includes(to);
}

/** Статус capture из ответа/вебхука PayPal → внутренний статус платежа. */
export function mapCaptureStatus(paypalCaptureStatus: string): PaymentStatus | null {
  switch (paypalCaptureStatus) {
    case 'COMPLETED':
      return 'captured';
    case 'PENDING':
      // Финальное решение придёт вебхуком (PAYMENT.CAPTURE.COMPLETED/DENIED).
      return 'approved';
    case 'DECLINED':
    case 'FAILED':
      return 'failed';
    case 'REFUNDED':
      return 'refunded';
    case 'PARTIALLY_REFUNDED':
      return 'partially_refunded';
    default:
      return null;
  }
}
