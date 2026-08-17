/**
 * Тело сообщения о заказе (клиент, адрес, расчёт, состав) — общий рендер для
 * обычного сообщения бота и для карточки в теме форума.
 *
 * Вынесено из lib/telegram.ts, чтобы у обоих режимов был ОДИН источник текста:
 * иначе правка «показывать подкатегорию» или «убрать [GRATIS]» неизбежно
 * забывалась бы в одном из двух мест. lib/telegram.ts реэкспортирует всё
 * отсюда — существующие импорты не менялись.
 */
import type { OrderEtaAnalysis } from '../eta/types';
import { stripPromoLabels } from '../orders/gift-label';

export interface OrderNotification {
  orderId: string;
  customerName: string;
  phoneNumber: string;
  address?: string;
  notes?: string;
  items: Array<{
    name: string;
    quantity: number;
    price?: number;
    /** Имя категории — для группировки в кухонном чеке. */
    category?: string;
    /** Имя подкатегории — подзаголовок внутри категории на кухонном чеке. */
    subcategory?: string;
    customizations?: string[];
  }>;
  totalAmount: number;
  /** Сумма заказа без доставки и скидки */
  subtotal?: number;
  deliveryFee?: number;
  /** Скидка по промокоду: сумма и тип (процент или фикс) */
  discount?: { code?: string; amount: number; type: 'percentage' | 'fixed' };
  paymentMethod: string;
  deliveryType: 'delivery' | 'pickup';
  desiredDeliveryTime?: string;
  /** Объявленное клиенту время готовности, мин (AI или кнопка «⏱ Время готовности»). */
  etaMinutes?: number;
  /** AI-оценка: разбивка готовка/доставка, расстояние, загрузка, советы. */
  etaAnalysis?: OrderEtaAnalysis;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * Тело заказа БЕЗ заголовка и без строки статуса: адрес-ссылка, расчёт,
 * способ оплаты, состав. Заголовок дописывает вызывающий (обычное сообщение —
 * «НОВЫЙ ЗАКАЗ», карточка форума — номер/время/статус).
 */
export function buildOrderBodyText(order: OrderNotification): string {
  const itemsList = order.items
    .map((item) => {
      const customizationsText = item.customizations?.length
        ? ` (${item.customizations.join(', ')})`
        : '';
      // Aktions-/Gratis-Label ([GRATIS]/[AKTION]) entfernen: nur Produktname zeigen.
      const itemName = stripPromoLabels(item.name);
      return `${item.quantity}x ${itemName}${customizationsText}`;
    })
    .join('\n');

  const mapsUrl = order.address ? buildMapsUrl(order.address) : '';
  const addressInfo =
    order.deliveryType === 'delivery' && order.address
      ? `📍 <a href="${mapsUrl}">${escapeHtml(order.address)}</a>`
      : '🏬 Самовывоз';

  const subtotal = order.subtotal ?? order.totalAmount;
  let sumsBlock = `🛒 Заказ: ${subtotal.toFixed(2)} €`;
  if (order.deliveryFee != null && order.deliveryFee > 0) {
    sumsBlock += `\n🚚 Доставка: ${order.deliveryFee.toFixed(2)} €`;
  }
  if (order.discount && order.discount.amount > 0) {
    const discountText =
      order.discount.type === 'percentage'
        ? `Промокод: -${order.discount.amount}%`
        : `Промокод: -${order.discount.amount.toFixed(2)} €`;
    const codePart = order.discount.code ? ` (${order.discount.code})` : '';
    sumsBlock += `\n🏷️ ${discountText}${codePart}`;
  }
  sumsBlock += `\n💰 <b>Итого: ${order.totalAmount.toFixed(2)} €</b>`;

  const desiredTimeLine = order.desiredDeliveryTime
    ? `\n🕐 Желаемое время: ${escapeHtml(order.desiredDeliveryTime)}`
    : '';

  // Клиенту уже сказали время — держим его в сообщении, иначе после ухода
  // всплывашки оператор не вспомнит, что и когда пообещали.
  const etaLine = order.etaMinutes ? `\n⏱ Клиенту сообщено: ~${order.etaMinutes} мин` : '';

  // Разбивка AI-оценки: готовка/доставка/км + короткая инструкция по маршруту.
  // advisory (совет по загрузке) в Telegram НЕ показываем — по просьбе
  // ресторана: длинные советы мешают; они остаются в панели AI-плана кухни.
  let etaDetails = '';
  const analysis = order.etaAnalysis;
  if (analysis) {
    const parts = [`готовка ~${analysis.prepMinutes} мин`];
    if (order.deliveryType === 'delivery' && analysis.deliveryMinutes > 0) {
      const km = analysis.distanceKm != null ? `, ${analysis.distanceKm} км` : '';
      parts.push(`доставка ~${analysis.deliveryMinutes} мин${km}`);
    }
    const sourceMark = analysis.source === 'ai' ? '🤖 AI' : '🤖 Оценка (без AI)';
    etaDetails = `\n${sourceMark}: ${parts.join(', ')}`;
    if (analysis.routeHint) etaDetails += `\n🗺 ${escapeHtml(analysis.routeHint)}`;
  }

  return `
👤 Клиент: ${escapeHtml(order.customerName)}
📱 Телефон: ${escapeHtml(order.phoneNumber)}
${addressInfo}${desiredTimeLine}${etaLine}${etaDetails}
${sumsBlock}
💳 Способ оплаты: ${escapeHtml(order.paymentMethod)}

📋 <b>Состав заказа:</b>
${itemsList
  .split('\n')
  .map((line) => escapeHtml(line))
  .join('\n')}
`.trim();
}

/** Обычное сообщение бота (не форум): заголовок «НОВЫЙ ЗАКАЗ» + тело. */
export function buildOrderMessageText(order: OrderNotification): string {
  return `🔔 <b>НОВЫЙ ЗАКАЗ #${order.orderId}</b>\n\n${buildOrderBodyText(order)}`;
}
