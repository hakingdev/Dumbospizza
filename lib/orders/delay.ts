/**
 * «Заказ опаздывает на +N минут»: сдвигает обещанное время (etaMinutes/etaSetAt)
 * и шлёт гостю WhatsApp на немецком через Twilio (sendOrderDelayNotification).
 *
 * Вызывается из двух мест с одинаковой логикой:
 *   - POST /api/orders/[id]/delay — кнопки в панели AI-плана кухни (админка);
 *   - callback plan_delay_* в Telegram-боте-диспетчере (lib/telegram-plan.ts).
 */

import { Order } from '../models/order.model';
import { sendOrderDelayNotification } from '../whatsapp';

/** Варианты кнопок «опаздывает на …» (панель и Telegram используют один список). */
export const ORDER_DELAY_CHOICES = [10, 15, 20, 30] as const;

/** Допустимая задержка: целые 5…60 минут (кнопки — подмножество). */
export function isValidDelayMinutes(value: unknown): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n >= 5 && n <= 60;
}

/**
 * Новое обещание после задержки, минут ОТ ТЕКУЩЕГО МОМЕНТА:
 * остаток старого обещания (если ещё не истёк) + задержка. Просроченный заказ
 * получает ровно delayMinutes от «сейчас» — это и уходит гостю в WhatsApp.
 */
export function computeDelayedEtaMinutes(
  etaMinutes: number | null | undefined,
  etaSetAt: Date | string | null | undefined,
  delayMinutes: number,
  now = Date.now()
): number {
  let remaining = 0;
  if (etaMinutes != null && Number.isFinite(Number(etaMinutes))) {
    const setMs = etaSetAt ? new Date(etaSetAt).getTime() : now;
    remaining = Number(etaMinutes) - (now - setMs) / 60_000;
  }
  return Math.round(Math.max(remaining, 0) + delayMinutes);
}

export interface OrderDelayResult {
  ok: boolean;
  reason?: 'invalid_delay' | 'not_found' | 'error';
  orderId?: string;
  orderNumber?: string;
  /** Новое обещание (минут от момента задержки). */
  etaMinutes?: number;
  /** Ушло ли гостю WhatsApp-сообщение о задержке. */
  whatsappSent: boolean;
}

/** Сдвигает обещание заказа и уведомляет гостя. Не бросает. */
export async function applyOrderDelay(
  orderId: string,
  delayMinutes: number
): Promise<OrderDelayResult> {
  if (!isValidDelayMinutes(delayMinutes)) {
    return { ok: false, reason: 'invalid_delay', whatsappSent: false };
  }

  try {
    const order = await Order.findById(orderId);
    if (!order) return { ok: false, reason: 'not_found', whatsappSent: false };

    order.etaMinutes = computeDelayedEtaMinutes(order.etaMinutes, order.etaSetAt, delayMinutes);
    order.etaSetAt = new Date();
    await order.save();

    // Без телефона (чек Lieferando мог его не содержать) — просто двигаем время.
    const phone = String(order.phoneNumber ?? '').trim();
    const whatsappSent = phone
      ? await sendOrderDelayNotification(
          { phoneNumber: phone, orderNumber: order.orderNumber },
          delayMinutes
        )
      : false;

    console.log(
      `[delay] order=${order.orderNumber} +${delayMinutes}min → eta=${order.etaMinutes}min whatsapp=${whatsappSent}`
    );

    return {
      ok: true,
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      etaMinutes: order.etaMinutes,
      whatsappSent,
    };
  } catch (e) {
    console.error('[delay] failed:', (e as Error)?.message);
    return { ok: false, reason: 'error', whatsappSent: false };
  }
}
