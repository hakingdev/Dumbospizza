/**
 * Импорт заказов Lieferando из фото чека.
 *
 * Пайплайн (вызывается из Telegram-бота-диспетчера, lib/telegram-plan.ts):
 *   фото чека → parseLieferandoReceipt() — Claude Vision со structured output →
 *   importLieferandoReceipt() — создаёт обычный заказ в БД с source='lieferando'
 *   и номером "L-<код чека>", затем считает ETA/гео (estimateAndApplyOrderEta),
 *   чтобы AI-план кухни мог маршрутизировать его наравне с заказами сайта.
 *
 * Такой заказ НЕ уходит на печать (kitchenPrintStatus='completed' — бумажный чек
 * уже вышел из принтера Lieferando) и не шлёт гостю WhatsApp при создании
 * (гостя уведомляет сам Lieferando). WhatsApp используется только для
 * «заказ опаздывает на +N мин» (lib/orders/delay.ts) — и только если на чеке
 * распознан телефон.
 *
 * Ключ ANTHROPIC_API_KEY живёт только на сервере.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Order } from '../models/order.model';
import { estimateAndApplyOrderEta } from '../eta/order-eta';

export type ReceiptImageMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  /** PDF из портала Lieferando (receipt-XXXX.pdf) — уходит в Claude document-блоком. */
  | 'application/pdf';

export interface ReceiptImage {
  base64: string;
  mediaType: ReceiptImageMediaType;
}

/** Распознанный чек Lieferando (structured output Claude Vision). */
export interface LieferandoReceipt {
  isReceipt: boolean;
  orderCode: string | null;
  customerName: string | null;
  phone: string | null;
  deliveryType: 'delivery' | 'pickup';
  address: {
    street: string;
    houseNumber: string;
    postalCode: string;
    city: string;
  } | null;
  /** Wunschzeit HH:mm, если на чеке указано время доставки/самовывоза. */
  desiredTime: string | null;
  items: {
    quantity: number;
    name: string;
    /** Опции/допы позиции («+ extra Käse», размер и т.п.). */
    details: string | null;
    /** Сумма строки в евро, как напечатано. */
    totalPrice: number | null;
  }[];
  total: number | null;
  /** true — оплачен онлайн («bezahlt»), false — наличные курьеру («Barzahlung»), null — не видно. */
  paid: boolean | null;
  /** Комментарий клиента с чека. */
  customerNote: string | null;
}

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    isReceipt: {
      type: 'boolean',
      description:
        'true ONLY if the image is a Lieferando/Takeaway.com order receipt (Bestellbon). false for anything else.',
    },
    orderCode: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Lieferando order code/number exactly as printed (e.g. "5X7ABC"); null if not visible',
    },
    customerName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    phone: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Customer phone number as printed, digits may contain spaces; null if absent',
    },
    deliveryType: {
      type: 'string',
      enum: ['delivery', 'pickup'],
      description: '"pickup" for Abholung/Selbstabholung, otherwise "delivery"',
    },
    address: {
      anyOf: [
        {
          type: 'object',
          properties: {
            street: { type: 'string' },
            houseNumber: { type: 'string' },
            postalCode: { type: 'string' },
            city: { type: 'string' },
          },
          required: ['street', 'houseNumber', 'postalCode', 'city'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
      description: 'Delivery address from the receipt; null for pickup or when unreadable',
    },
    desiredTime: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Requested delivery/pickup time as HH:mm (24h) if the receipt shows one; null for ASAP',
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quantity: { type: 'integer' },
          name: { type: 'string' },
          details: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Options/extras/size of the line ("+ extra Käse, 30cm"); null if none',
          },
          totalPrice: {
            anyOf: [{ type: 'number' }, { type: 'null' }],
            description: 'Line total in EUR as printed; null if unreadable',
          },
        },
        required: ['quantity', 'name', 'details', 'totalPrice'],
        additionalProperties: false,
      },
    },
    total: {
      anyOf: [{ type: 'number' }, { type: 'null' }],
      description: 'Grand total (Gesamt) in EUR; null if unreadable',
    },
    paid: {
      anyOf: [{ type: 'boolean' }, { type: 'null' }],
      description:
        'true when the receipt says paid online ("bezahlt"/"online bezahlt"), false for cash ("Barzahlung"), null if not stated',
    },
    customerNote: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Customer comment/Anmerkung from the receipt; null if none',
    },
  },
  required: [
    'isReceipt',
    'orderCode',
    'customerName',
    'phone',
    'deliveryType',
    'address',
    'desiredTime',
    'items',
    'total',
    'paid',
    'customerNote',
  ],
  additionalProperties: false,
} as const;

const RECEIPT_SYSTEM_PROMPT = `You read photographed order receipts (Bestellbons) of the Lieferando / Takeaway.com marketplace for the restaurant "Dumbos Pizza" in Bad Kissingen, Germany.
Receipts are printed in German. Extract ONLY what is actually printed — never invent or guess missing data; use null instead.
Quantities appear like "2x Pizza Salami". Item options/extras/size go into "details" of that line.
"Abholung"/"Selbstabholung" means pickup. "Barzahlung" means cash payment on delivery; "bezahlt" means already paid online.
If the image is not a Lieferando/Takeaway order receipt (a menu, a random photo, another document), return isReceipt=false and nulls.`;

/** Распознаёт фото чека Lieferando через Claude Vision (structured output). */
export async function parseLieferandoReceipt(image: ReceiptImage): Promise<LieferandoReceipt> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  // Вебхук Telegram ждёт синхронно (maxDuration 60с) → таймаут, без ретраев.
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 0 });

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 3000,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: RECEIPT_SCHEMA as any },
    },
    system: RECEIPT_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          image.mediaType === 'application/pdf'
            ? {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: image.base64 },
              }
            : {
                type: 'image',
                source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
              },
          { type: 'text', text: 'Extract this Lieferando receipt.' },
        ],
      },
    ],
  } as any);

  if (response.stop_reason === 'refusal') throw new Error('Claude declined the request');
  const textBlock = response.content.find((block: any) => block.type === 'text') as
    | { type: 'text'; text: string }
    | undefined;
  if (!textBlock?.text) throw new Error('Empty response from Claude');

  return JSON.parse(textBlock.text) as LieferandoReceipt;
}

// ---------------------------------------------------------------------------
// Создание заказа из распознанного чека
// ---------------------------------------------------------------------------

export interface ReceiptImportResult {
  ok: boolean;
  reason?: 'not_receipt' | 'no_items' | 'duplicate' | 'error';
  orderId?: string;
  orderNumber?: string;
  /** Данные для ответа персоналу в Telegram. */
  order?: {
    customerName: string;
    deliveryType: 'delivery' | 'pickup';
    city?: string;
    address?: string;
    itemsCount: number;
    total: number;
    etaMinutes?: number | null;
    hasPhone: boolean;
  };
}

/** Номер заказа для чека Lieferando: "L-<код>" (не пересекается с YYMMDDNNN сайта). */
export function lieferandoOrderNumber(orderCode: string | null | undefined, now = new Date()): string {
  const code = String(orderCode ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
  if (code) return `L-${code}`;
  // Код не распознан — суррогат от даты/времени, чтобы номер оставался уникальным.
  const stamp =
    now.getFullYear().toString().slice(-2) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  return `L-${stamp}`;
}

/** Payload заказа из распознанного чека — чистая функция (тестируется отдельно). */
export function buildOrderPayloadFromReceipt(parsed: LieferandoReceipt, now = new Date()) {
  const items = (parsed.items || [])
    .filter((it) => it && String(it.name ?? '').trim())
    .map((it) => {
      const quantity = Math.max(1, Math.round(Number(it.quantity) || 1));
      const totalPrice = Number.isFinite(Number(it.totalPrice)) ? Number(it.totalPrice) : 0;
      return {
        product: 'lieferando',
        name: it.details ? `${it.name.trim()} (${it.details.trim()})` : it.name.trim(),
        quantity,
        price: totalPrice ? Math.round((totalPrice / quantity) * 100) / 100 : 0,
        totalPrice,
      };
    });

  const itemsTotal = items.reduce((sum, it) => sum + (it.totalPrice || 0), 0);
  const parsedTotal = Number(parsed.total);
  const total =
    Number.isFinite(parsedTotal) && parsedTotal > 0
      ? parsedTotal
      : Math.round(itemsTotal * 100) / 100;

  const isDelivery = parsed.deliveryType !== 'pickup';
  const address =
    isDelivery && parsed.address
      ? {
          street: String(parsed.address.street ?? '').trim(),
          houseNumber: String(parsed.address.houseNumber ?? '').trim(),
          postalCode: String(parsed.address.postalCode ?? '').trim(),
          city: String(parsed.address.city ?? '').trim(),
        }
      : undefined;

  const noteParts = [
    `Lieferando${parsed.orderCode ? ` #${parsed.orderCode}` : ''}`,
    parsed.paid === false ? 'Barzahlung beim Kunden' : parsed.paid === true ? 'online bezahlt' : null,
    parsed.customerNote?.trim() || null,
  ].filter(Boolean);

  return {
    orderNumber: lieferandoOrderNumber(parsed.orderCode, now),
    source: 'lieferando' as const,
    customerName: parsed.customerName?.trim() || 'Lieferando-Gast',
    phoneNumber: parsed.phone?.trim() || '',
    items,
    deliveryAddress: address,
    deliveryType: isDelivery ? ('delivery' as const) : ('pickup' as const),
    deliveryFee: 0,
    subtotal: total,
    tax: 0,
    total,
    // Деньги ходят через Lieferando: Barzahlung собирает курьер, онлайн уже оплачен.
    paymentMethod: parsed.paid === false ? ('cash' as const) : ('online' as const),
    paymentStatus: parsed.paid === false ? ('pending' as const) : ('completed' as const),
    status: 'new' as const,
    notes: noteParts.join(' · '),
    desiredDeliveryTime: parsed.desiredTime || undefined,
    // Бумажный чек уже напечатал принтер Lieferando — принт-агенту тут делать нечего.
    kitchenPrintStatus: 'completed' as const,
    customerPrintStatus: 'completed' as const,
  };
}

/**
 * Создаёт заказ из распознанного чека: дедуп по номеру, insert, оценка ETA/гео
 * (маршрутизация в плане). Не бросает — ошибки возвращаются результатом.
 */
export async function importLieferandoReceipt(parsed: LieferandoReceipt): Promise<ReceiptImportResult> {
  try {
    if (!parsed?.isReceipt) return { ok: false, reason: 'not_receipt' };

    const payload = buildOrderPayloadFromReceipt(parsed);
    if (payload.items.length === 0) return { ok: false, reason: 'no_items' };

    const existing = await Order.findOne({ orderNumber: payload.orderNumber });
    if (existing) {
      return { ok: false, reason: 'duplicate', orderNumber: payload.orderNumber, orderId: String(existing._id) };
    }

    const order = await Order.create(payload);

    // ETA + геокодирование адреса: даёт distanceKm/coordinates для рейсов в плане.
    // Никогда не бросает; для самовывоза считает только готовку.
    const analysis = await estimateAndApplyOrderEta(order);

    console.log(
      `[lieferando] imported order=${payload.orderNumber} items=${payload.items.length} ` +
        `total=${payload.total} eta=${analysis?.etaMinutes ?? '—'}min`
    );

    return {
      ok: true,
      orderId: String(order._id),
      orderNumber: payload.orderNumber,
      order: {
        customerName: payload.customerName,
        deliveryType: payload.deliveryType,
        city: payload.deliveryAddress?.city,
        address: payload.deliveryAddress
          ? `${payload.deliveryAddress.street} ${payload.deliveryAddress.houseNumber}, ${payload.deliveryAddress.postalCode} ${payload.deliveryAddress.city}`
          : undefined,
        itemsCount: payload.items.reduce((n, it) => n + it.quantity, 0),
        total: payload.total,
        etaMinutes: analysis?.etaMinutes ?? null,
        hasPhone: Boolean(payload.phoneNumber),
      },
    };
  } catch (e) {
    console.error('[lieferando] import failed:', (e as Error)?.message);
    return { ok: false, reason: 'error' };
  }
}
