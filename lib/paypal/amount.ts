import { stripPromoLabels } from '../orders/gift-label';
import { PAYPAL_CURRENCY } from './config';

/**
 * Серверный расчёт суммы PayPal-заказа В МИНОРНЫХ ЕДИНИЦАХ (центах) из позиций
 * заказа в БД. Значения из тела клиентского запроса сюда НЕ попадают никогда.
 *
 * Дизайн breakdown: PayPal требует, чтобы item_total + shipping − discount
 * сходились с amount.value до цента, иначе create-order отклоняется. Поэтому
 * discount вычисляется КАК ОСТАТОК (item_total + shipping − total): он
 * автоматически включает купон, скидки акций, баллы лояльности и центовые
 * артефакты float-округления — breakdown сходится по построению, а клиент
 * платит ровно order.total.
 */

/** Позиция заказа (подмножество jsonb-поля orders.items). */
export interface AmountOrderItem {
  name: string;
  quantity: number;
  price: number;
  totalPrice: number;
}

export interface AmountOrderLike {
  items: AmountOrderItem[];
  deliveryFee: number | null;
  total: number;
}

export interface PayPalItem {
  /** Имя для чека PayPal (без служебных префиксов [GRATIS]/[AKTION], ≤127). */
  name: string;
  quantity: number;
  unitAmountMinor: number;
}

export interface PayPalAmountBreakdown {
  currency: string;
  totalMinor: number;
  itemTotalMinor: number;
  shippingMinor: number;
  discountMinor: number;
  items: PayPalItem[];
}

/**
 * Евро → центы, устойчиво к float-шуму (4.475*100 === 447.49999999999994).
 * toFixed(3) съедает двоичный мусор (~1e-13), полуцентовые границы (.5)
 * округляются вверх детерминированно.
 */
export function toMinorUnits(amountEuro: number): number {
  return Math.round(Number(((Number(amountEuro) || 0) * 100).toFixed(3)));
}

/** Центы → строка "12.34" для PayPal amount.value. */
export function minorToValue(minor: number): string {
  return (minor / 100).toFixed(2);
}

const MAX_ITEM_NAME = 127; // лимит PayPal на items[].name

function itemName(raw: string, quantityPrefix?: number): string {
  const clean = stripPromoLabels(String(raw || 'Artikel')).trim() || 'Artikel';
  const prefixed = quantityPrefix && quantityPrefix > 1 ? `${quantityPrefix}× ${clean}` : clean;
  return prefixed.slice(0, MAX_ITEM_NAME);
}

/**
 * Считает breakdown заказа в центах. Бросает, если позиции не покрывают сумму
 * заказа (residual < 0) или сумма не положительна — это рассинхрон данных,
 * платить по такому заказу нельзя.
 */
export function buildAmountBreakdown(order: AmountOrderLike): PayPalAmountBreakdown {
  const items: PayPalItem[] = [];
  let itemTotalMinor = 0;

  for (const line of order.items || []) {
    const quantity = Math.max(1, Math.round(Number(line.quantity) || 1));
    const lineMinor = toMinorUnits(line.totalPrice);
    if (lineMinor < 0) {
      throw new Error(`PayPal: negative Position "${line.name}" (${line.totalPrice})`);
    }
    // Gratis-позиции (0,00 €) в items[] не отправляем: некоторые проверки PayPal
    // отклоняют нулевые позиции, а на item_total они всё равно не влияют.
    if (lineMinor === 0) continue;

    itemTotalMinor += lineMinor;

    const unitMinor = toMinorUnits(line.price);
    if (unitMinor > 0 && unitMinor * quantity === lineMinor) {
      // Цена делится на количество без остатка → честные quantity/unit_amount.
      items.push({ name: itemName(line.name), quantity, unitAmountMinor: unitMinor });
    } else {
      // Иначе — одна строка на всю позицию (защита от центового дрейфа деления).
      items.push({ name: itemName(line.name, quantity), quantity: 1, unitAmountMinor: lineMinor });
    }
  }

  const shippingMinor = toMinorUnits(order.deliveryFee || 0);
  const totalMinor = toMinorUnits(order.total);

  if (totalMinor <= 0) {
    throw new Error(`PayPal: Bestellsumme muss positiv sein (total=${order.total})`);
  }

  const discountMinor = itemTotalMinor + shippingMinor - totalMinor;
  if (discountMinor < 0) {
    // Позиции + доставка меньше суммы заказа — данные заказа рассинхронизированы.
    throw new Error(
      `PayPal: Positionen decken die Bestellsumme nicht (items=${itemTotalMinor}, shipping=${shippingMinor}, total=${totalMinor})`
    );
  }

  return {
    currency: PAYPAL_CURRENCY,
    totalMinor,
    itemTotalMinor,
    shippingMinor,
    discountMinor,
    items,
  };
}

/**
 * purchase_units[0] для POST /v2/checkout/orders.
 * reference_id/custom_id = внутренний order id (маппинг вебхуков на заказ),
 * invoice_id НЕ задаём (повторный create после сбоя не должен падать на
 * DUPLICATE_INVOICE_ID).
 */
export function buildPurchaseUnit(orderId: string, breakdown: PayPalAmountBreakdown) {
  const { currency } = breakdown;
  const money = (minor: number) => ({
    currency_code: currency,
    value: minorToValue(minor),
  });

  return {
    reference_id: orderId,
    custom_id: orderId,
    amount: {
      ...money(breakdown.totalMinor),
      breakdown: {
        item_total: money(breakdown.itemTotalMinor),
        shipping: money(breakdown.shippingMinor),
        ...(breakdown.discountMinor > 0 ? { discount: money(breakdown.discountMinor) } : {}),
      },
    },
    items: breakdown.items.map((it) => ({
      name: it.name,
      quantity: String(it.quantity),
      unit_amount: money(it.unitAmountMinor),
    })),
  };
}
