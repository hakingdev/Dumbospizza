/**
 * Раскладка кухонного чека (Lieferando-стиль): позиции сгруппированы ПО КАТЕГОРИЯМ.
 * Категория — жирный заголовок, под ней её товары. Внизу — тип оплаты.
 *
 * Модуль чистый (без зависимостей и принтера): возвращает список «операций» (ops),
 * которые рендерятся либо в команды термопринтера (lib/printing.ts, print-agent.js),
 * либо в текст для предпросмотра/тестов (renderOpsToText).
 */

import { stripPromoLabels } from '../orders/gift-label';

export interface ReceiptItem {
  name: string;
  quantity: number;
  price?: number;
  /** Имя категории товара (для группировки). Пусто → «Sonstiges». */
  category?: string;
  /** Имя подкатегории (метки) — подзаголовок внутри категории. */
  subcategory?: string;
  /** Размер/топпинги/соусы — печатаются под товаром. */
  customizations?: string[];
}

export interface ReceiptOrder {
  orderId: string | number;
  createdAt?: Date | string;
  deliveryType: 'delivery' | 'pickup';
  customerName?: string;
  phoneNumber?: string;
  address?: string;
  desiredDeliveryTime?: string;
  /**
   * Обещанное время готовности, epoch ms (lib/orders/promise.ts). null — заказ
   * ещё не принят и обещания нет.
   */
  promisedMs?: number | null;
  notes?: string;
  items: ReceiptItem[];
  deliveryFee?: number;
  totalAmount: number;
  paymentMethod?: string;
}

export type ReceiptOp =
  | { type: 'align'; value: 'center' | 'left' }
  | { type: 'line' }
  | { type: 'blank' }
  | { type: 'text'; text: string; bold?: boolean; double?: boolean }
  | { type: 'lr'; left: string; right: string; bold?: boolean }
  | { type: 'cut' };

const FALLBACK_CATEGORY = 'Sonstiges';

/** Тип оплаты для кухни: BAR / KARTE / ONLINE. */
export function formatPaymentMethod(method?: string): string {
  switch ((method || '').toLowerCase()) {
    case 'cash':
      return 'BAR';
    case 'card':
      return 'KARTE';
    case 'online':
      return 'ONLINE (bezahlt)';
    default:
      return (method || '-').toUpperCase();
  }
}

/** Цена в формате чека: 7.9 → "EUR 7,90" (как в Lieferando-референсе). */
export function formatEuro(value: number): string {
  return `EUR ${(Number(value) || 0).toFixed(2).replace('.', ',')}`;
}

/**
 * Группировка позиций по категории с сохранением порядка ПЕРВОГО появления
 * категории в заказе. Товары без категории → «Sonstiges».
 */
export function groupItemsByCategory(
  items: ReceiptItem[]
): Array<{ category: string; items: ReceiptItem[] }> {
  const order: string[] = [];
  const map = new Map<string, ReceiptItem[]>();
  for (const item of items) {
    const cat = (item.category && item.category.trim()) || FALLBACK_CATEGORY;
    if (!map.has(cat)) {
      map.set(cat, []);
      order.push(cat);
    }
    map.get(cat)!.push(item);
  }
  return order.map((category) => ({ category, items: map.get(category)! }));
}

/**
 * Группировка позиций категории по подкатегориям: сначала позиции БЕЗ метки
 * (сразу под заголовком категории), затем группы подкатегорий в порядке
 * первого появления. Для сборки заказа (суши по видам и т.п.).
 */
export function groupItemsBySubcategory(
  items: ReceiptItem[]
): Array<{ subcategory: string | null; items: ReceiptItem[] }> {
  const order: (string | null)[] = [];
  const map = new Map<string | null, ReceiptItem[]>();
  for (const item of items) {
    const sub = (item.subcategory && item.subcategory.trim()) || null;
    if (!map.has(sub)) {
      map.set(sub, []);
      order.push(sub);
    }
    map.get(sub)!.push(item);
  }
  order.sort((a, b) => (a === null ? -1 : b === null ? 1 : 0));
  return order.map((subcategory) => ({ subcategory, items: map.get(subcategory)! }));
}

/**
 * Часовой пояс заведения. Считать по часам сервера нельзя: на Vercel он живёт
 * в UTC, и чек уезжал на два часа назад — кухня читала «19:03» на заказе,
 * принятом в 21:03.
 */
const RECEIPT_TZ = 'Europe/Berlin';

function formatDateTime(value?: Date | string): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: RECEIPT_TZ,
  })
    .format(d)
    .replace(',', '');
}

/**
 * «20:30» по часам заведения. Пусто — времени нет.
 *
 * Округляем до БЛИЖАЙШЕЙ минуты, а не отбрасываем секунды. Обещание считается
 * от `etaSetAt` с секундами: заказ, принятый в 21:22:37 на 68 минут, попадает
 * в 22:30:37 — и без округления печатался бы как «22:29», на минуту раньше
 * названного гостю часа, да ещё и с ложной строкой расхождения.
 */
function formatClock(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const rounded = Math.round(ms / 60_000) * 60_000;
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: RECEIPT_TZ,
  }).format(new Date(rounded));
}

/** Wunschzeit гостя в виде «HH:mm». Пусто — гость времени не называл. */
function normalizeDesired(value?: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

/**
 * Час, К КОТОРОМУ заказ нужен у гостя — крупной строкой.
 *
 * Раньше на чеке было только время ПРИЁМА в шапке да мелкая строка с
 * Wunschzeit. Времени, к которому заказ должен уехать, на бумаге не было
 * вовсе — у заказа «на сейчас» ни одного часа, кроме момента печати.
 *
 * Подпись зависит от типа заказа, и это не косметика: `etaMinutes` — обещание
 * ГОСТЮ, то есть для доставки это час у двери, а не готовность на кухне.
 * Назвать его «FERTIG» значило бы сдвинуть кухне ориентир на всё время дороги.
 *
 *   - доставка с обещанием  → LIEFERZEIT 22:30
 *   - самовывоз с обещанием → ABHOLZEIT 22:30
 *   - обещания ещё нет      → WUNSCHZEIT 22:30 (час, который назвал гость)
 *
 * Wunschzeit печатается второй строкой, только когда он разошёлся с обещанием
 * (кухня сдвинула ±5): расхождение обязано быть видно, иначе сборщик готовит
 * к одному часу, а гостю назвали другой. Совпал — второй строки нет, дублей
 * на бумаге не держим.
 */
function buildReadyTimeOps(order: ReceiptOrder): ReceiptOp[] {
  const promised = formatClock(order.promisedMs);
  const desired = normalizeDesired(order.desiredDeliveryTime);

  if (promised) {
    const label = order.deliveryType === 'pickup' ? 'ABHOLZEIT' : 'LIEFERZEIT';
    const ops: ReceiptOp[] = [
      { type: 'text', text: `${label} ${promised}`, bold: true, double: true },
    ];
    if (desired && desired !== promised) {
      ops.push({ type: 'text', text: `Wunsch: ${desired}` });
    }
    return ops;
  }
  if (desired) {
    return [{ type: 'text', text: `WUNSCHZEIT ${desired}`, bold: true, double: true }];
  }
  return [];
}

/**
 * Шапка и подвал чека. Приходят из настроек (lib/pos/settings.ts), чтобы их
 * можно было править в админке. Значения по умолчанию оставлены здесь, иначе
 * вызовы без настроек (тесты, предпросмотр, LAN-агент) пришлось бы менять все
 * разом.
 */
export interface ReceiptChrome {
  header?: { title?: string; address?: string; phone?: string };
  footer?: string;
}

const DEFAULT_CHROME: Required<ReceiptChrome> & {
  header: Required<NonNullable<ReceiptChrome['header']>>;
} = {
  header: {
    title: 'DUMBO SLICE PIZZA',
    address: 'Kurhausstr. 11A - Bad Kissingen',
    // Мобильный, а не стационарный 0971 72730: заказы идут через него, и тем же
    // номером чек печатал print-agent.js. Стационарный остаётся в Impressum.
    phone: 'Tel: +49 163 2165979',
  },
  footer: 'Kein Kassenbon',
};

/** Строит ops кухонного чека (Lieferando-стиль, по категориям). */
export function buildKitchenReceiptOps(
  order: ReceiptOrder,
  chrome: ReceiptChrome = {}
): ReceiptOp[] {
  const ops: ReceiptOp[] = [];
  const title = chrome.header?.title ?? DEFAULT_CHROME.header.title;
  const address = chrome.header?.address ?? DEFAULT_CHROME.header.address;
  const phone = chrome.header?.phone ?? DEFAULT_CHROME.header.phone;
  const footer = chrome.footer ?? DEFAULT_CHROME.footer;

  // Шапка
  ops.push({ type: 'align', value: 'center' });
  if (title) ops.push({ type: 'text', text: title, bold: true, double: true });
  if (address) ops.push({ type: 'text', text: address });
  if (phone) ops.push({ type: 'text', text: phone });
  ops.push({ type: 'line' });

  // Номер заказа + дата
  ops.push({ type: 'align', value: 'left' });
  ops.push({ type: 'lr', left: `#${order.orderId}`, right: formatDateTime(order.createdAt), bold: true });

  // Тип заказа
  // Крупно: это первое, что кухня должна увидеть, взяв чек в руки.
  ops.push({
    type: 'text',
    text: order.deliveryType === 'pickup' ? 'ABHOLUNG' : 'LIEFERUNG',
    bold: true,
    double: true,
  });
  for (const op of buildReadyTimeOps(order)) ops.push(op);
  if (order.customerName) ops.push({ type: 'text', text: `Kunde: ${order.customerName}` });
  if (order.phoneNumber) ops.push({ type: 'text', text: `Tel: ${order.phoneNumber}` });
  if (order.deliveryType === 'delivery' && order.address) {
    ops.push({ type: 'text', text: order.address });
  }
  ops.push({ type: 'line' });

  // Позиции по категориям, внутри категории — по подкатегориям (меткам)
  for (const group of groupItemsByCategory(order.items)) {
    // КАТЕГОРИЯ — жирная и крупная: по ней собирают заказ.
    ops.push({ type: 'text', text: group.category, bold: true, double: true });
    for (const sub of groupItemsBySubcategory(group.items)) {
      if (sub.subcategory) {
        ops.push({ type: 'text', text: `* ${sub.subcategory} *`, bold: true }); // подзаголовок
      }
      for (const item of sub.items) {
        // Aktions-/Gratis-Label ([GRATIS]/[AKTION]) entfernen: nur Produkt + Preis.
        const displayName = stripPromoLabels(item.name);
        const lineTotal = (item.price ?? 0) * item.quantity;
        ops.push({
          type: 'lr',
          left: `${item.quantity}x ${displayName}`,
          right: item.price != null ? formatEuro(lineTotal) : '',
        });
        for (const c of item.customizations || []) {
          ops.push({ type: 'text', text: `   - ${c}` });
        }
      }
    }
  }
  ops.push({ type: 'line' });

  // Итоги
  if (order.deliveryType === 'delivery' && (order.deliveryFee || 0) > 0) {
    ops.push({ type: 'lr', left: 'Lieferung:', right: formatEuro(order.deliveryFee || 0) });
  }
  ops.push({ type: 'lr', left: 'GESAMT:', right: formatEuro(order.totalAmount), bold: true });
  ops.push({ type: 'line' });

  // Оплата
  ops.push({ type: 'text', text: `ZAHLUNG: ${formatPaymentMethod(order.paymentMethod)}`, bold: true });

  // Комментарий клиента — самое пропускаемое место чека, поэтому крупно.
  if (order.notes && order.notes.trim()) {
    ops.push({ type: 'line' });
    ops.push({ type: 'text', text: 'HINWEIS:', bold: true, double: true });
    ops.push({ type: 'text', text: order.notes.trim(), double: true });
  }

  // Подвал
  ops.push({ type: 'line' });
  ops.push({ type: 'align', value: 'center' });
  if (footer) ops.push({ type: 'text', text: footer });
  ops.push({ type: 'cut' });

  return ops;
}

/** Рендер ops в строки текста (для предпросмотра и тестов). */
export function renderOpsToText(ops: ReceiptOp[], width = 42): string[] {
  const lines: string[] = [];
  let align: 'center' | 'left' = 'left';

  const center = (s: string) => {
    if (s.length >= width) return s;
    const pad = Math.floor((width - s.length) / 2);
    return ' '.repeat(pad) + s;
  };
  const lr = (l: string, r: string) => {
    if (!r) return l;
    const space = width - l.length - r.length;
    if (space < 1) return `${l} ${r}`;
    return l + ' '.repeat(space) + r;
  };

  for (const op of ops) {
    switch (op.type) {
      case 'align':
        align = op.value;
        break;
      case 'line':
        lines.push('-'.repeat(width));
        break;
      case 'blank':
        lines.push('');
        break;
      case 'text':
        lines.push(align === 'center' ? center(op.text) : op.text);
        break;
      case 'lr':
        lines.push(lr(op.left, op.right));
        break;
      case 'cut':
        break;
    }
  }
  return lines;
}
