/**
 * Единственный источник правды о способах ОНЛАЙН-оплаты в чекауте.
 *
 * Плоский список на шаге 2 собирается из этих групп; клик «Bezahlen» монтирует
 * РОВНО ОДИН виджет выбранной группы:
 *  - provider 'sumup'  → SumUp-виджет с whitelist `sumupIds` (onPaymentMethodsLoad);
 *  - provider 'paypal' → standalone PayPal-кнопка нужного funding-источника
 *    (жёлтая PayPal или SEPA-Lastschrift; сервер один — Orders v2 create/capture).
 * Повторного выбора между группами внутри виджета нет.
 *
 * Видимость sumup-групп гейтится merchant-level allowlist'ом SumUp
 * (GET /v0.1/merchants/{merchant_code}/payment-methods, у нас — прокси
 * /api/payments/sumup/payment-methods): группа без единого доступного id
 * не рендерится совсем. PayPal-группы от SumUp-ответа не зависят.
 *
 * SEPA: у SumUp метода нет (снимок allowlist от 2026-07-09: card, apple_pay,
 * google_pay, paypal) — SEPA-Lastschrift идёт как funding-источник PayPal.
 */

/** Онлайн-методы чекаута (значения radio на шаге 2 помимо cash/card). */
export type OnlineMethodId = 'online' | 'paypal' | 'sepa';

export type CheckoutPaymentMethod = 'cash' | 'card' | OnlineMethodId;

export interface MethodGroup {
  id: OnlineMethodId;
  provider: 'sumup' | 'paypal';
  /** Методы SumUp-виджета, которые рендерит эта группа (только provider 'sumup'). */
  sumupIds: string[];
  /** Funding-источник standalone PayPal-кнопки (только provider 'paypal'). */
  paypalFundingSource?: 'paypal' | 'sepa';
}

export const METHOD_GROUPS: readonly MethodGroup[] = [
  { id: 'online', provider: 'sumup', sumupIds: ['card', 'apple_pay', 'google_pay'] },
  { id: 'paypal', provider: 'paypal', sumupIds: [], paypalFundingSource: 'paypal' },
  { id: 'sepa', provider: 'paypal', sumupIds: [], paypalFundingSource: 'sepa' },
];

export interface VisibleMethodGroup extends MethodGroup {
  /** Пересечение sumupIds с allowlist — ровно это отдаём SumUp-виджету как whitelist. */
  effectiveSumupIds: string[];
}

/**
 * Группы, которые показывает чекаут.
 *
 * @param available allowlist от прокси /api/payments/sumup/payment-methods;
 *   `null` — allowlist недоступен (сбой сети/SumUp): карточную группу оставляем
 *   с её полным whitelist (оплату не выключаем из-за сбоя вспомогательного
 *   запроса — виджет всё равно отфильтрует по своим данным), остальные
 *   sumup-группы прячем.
 * @param opts.paypalConfigured NEXT_PUBLIC_PAYPAL_CLIENT_ID задан — без него
 *   PayPal-кнопкам (обеим группам) нечего монтировать, пункты не показываем.
 */
export function resolveVisibleGroups(
  available: string[] | null,
  opts: { paypalConfigured?: boolean } = {}
): VisibleMethodGroup[] {
  const paypalConfigured = opts.paypalConfigured ?? true;
  const result: VisibleMethodGroup[] = [];

  for (const group of METHOD_GROUPS) {
    if (group.provider === 'paypal') {
      if (paypalConfigured) result.push({ ...group, effectiveSumupIds: [] });
      continue;
    }

    const effective =
      available === null
        ? group.id === 'online'
          ? [...group.sumupIds]
          : []
        : group.sumupIds.filter((id) => available.includes(id));

    if (effective.length === 0) continue;

    result.push({ ...group, effectiveSumupIds: effective });
  }

  return result;
}

/** true для методов, которые оплачиваются онлайн (в БД заказ идёт как 'online'). */
export function isOnlineCheckoutMethod(method: string | undefined): method is OnlineMethodId {
  return method === 'online' || method === 'paypal' || method === 'sepa';
}
