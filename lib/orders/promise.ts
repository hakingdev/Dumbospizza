/**
 * Когда заказ обещан гостю.
 *
 * Отдельный лист-модуль, потому что ответ на этот вопрос нужен трём разным
 * потребителям — ленте прибора, чеку кухни и уведомлениям, — а модули друг
 * друга уже импортируют по кругу (board → print-job → kitchen-receipt).
 * Разложить правило по копиям означало бы, что однажды карточка на экране и
 * бумага из принтера назовут разное время одного заказа.
 */

/**
 * Обещанное время готовности, epoch ms. null — обещания ещё нет.
 *
 * Считается от `etaSetAt`, а не от создания заказа: продление сдвигает именно
 * эту пару полей, и все, кто показывает срок, обязаны видеть сдвинутый.
 */
export function orderDueMs(order: {
  etaMinutes?: number | null;
  etaSetAt?: Date | string | null;
  createdAt?: Date | string | null;
}): number | null {
  const minutes = Number(order.etaMinutes);
  if (!Number.isFinite(minutes)) return null;
  const base = order.etaSetAt ?? order.createdAt;
  const baseMs = base ? new Date(base).getTime() : NaN;
  if (Number.isNaN(baseMs)) return null;
  return baseMs + minutes * 60_000;
}
