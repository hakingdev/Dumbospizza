/**
 * Чистое правило перехода на следующий шаг при доставке. Используется и в UI
 * (disabled-кнопка Weiter), и в тестах. Для pickup проверка не применяется.
 */

export type DeliveryGateReason =
  | 'ok'
  | 'address_not_checked'
  | 'outside_zone'
  | 'below_min_order';

export interface DeliveryGateInput {
  deliveryType: 'delivery' | 'pickup';
  /** Адрес проверен через check-zone (и адрес не менялся после проверки). */
  addressChecked: boolean;
  /** Результат check-zone: адрес попадает в зону. */
  canDeliver: boolean;
  subtotal: number;
  /** Мин. сумма найденной зоны (null, если зоны нет). */
  zoneMinOrderAmount: number | null;
}

export interface DeliveryGateResult {
  allowed: boolean;
  reason: DeliveryGateReason;
  /** Сколько не хватает до min-order (только для below_min_order). */
  shortfall?: number;
}

export function evaluateDeliveryGate(input: DeliveryGateInput): DeliveryGateResult {
  // Самовывоз: проверка зоны не нужна.
  if (input.deliveryType === 'pickup') {
    return { allowed: true, reason: 'ok' };
  }
  if (!input.addressChecked || !input.canDeliver) {
    // Не проверен адрес ИЛИ адрес вне зоны.
    return { allowed: false, reason: input.addressChecked ? 'outside_zone' : 'address_not_checked' };
  }
  if (
    input.zoneMinOrderAmount != null &&
    input.zoneMinOrderAmount > 0 &&
    input.subtotal < input.zoneMinOrderAmount
  ) {
    return {
      allowed: false,
      reason: 'below_min_order',
      shortfall: Math.round((input.zoneMinOrderAmount - input.subtotal) * 100) / 100,
    };
  }
  return { allowed: true, reason: 'ok' };
}
