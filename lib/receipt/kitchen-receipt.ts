/**
 * Раскладка кухонного чека (Lieferando-стиль): позиции сгруппированы ПО КАТЕГОРИЯМ.
 * Категория — жирный заголовок, под ней её товары. Внизу — тип оплаты.
 *
 * Модуль чистый (без зависимостей и принтера): возвращает список «операций» (ops),
 * которые рендерятся либо в команды термопринтера (lib/printing.ts, print-agent.js),
 * либо в текст для предпросмотра/тестов (renderOpsToText).
 */

export interface ReceiptItem {
  name: string;
  quantity: number;
  price?: number;
  /** Имя категории товара (для группировки). Пусто → «Sonstiges». */
  category?: string;
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

function formatDateTime(value?: Date | string): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

/** Строит ops кухонного чека (Lieferando-стиль, по категориям). */
export function buildKitchenReceiptOps(order: ReceiptOrder): ReceiptOp[] {
  const ops: ReceiptOp[] = [];

  // Шапка
  ops.push({ type: 'align', value: 'center' });
  ops.push({ type: 'text', text: 'DUMBO SLICE PIZZA', bold: true });
  ops.push({ type: 'text', text: 'Kurhausstr. 11A - Bad Kissingen' });
  ops.push({ type: 'text', text: 'Tel: +49 163 2165979' });
  ops.push({ type: 'line' });

  // Номер заказа + дата
  ops.push({ type: 'align', value: 'left' });
  ops.push({ type: 'lr', left: `#${order.orderId}`, right: formatDateTime(order.createdAt), bold: true });

  // Тип заказа
  ops.push({
    type: 'text',
    text: order.deliveryType === 'pickup' ? 'ABHOLUNG' : 'LIEFERUNG',
    bold: true,
  });
  if (order.desiredDeliveryTime) {
    ops.push({ type: 'text', text: `Zeit: ${order.desiredDeliveryTime}` });
  }
  if (order.customerName) ops.push({ type: 'text', text: `Kunde: ${order.customerName}` });
  if (order.phoneNumber) ops.push({ type: 'text', text: `Tel: ${order.phoneNumber}` });
  if (order.deliveryType === 'delivery' && order.address) {
    ops.push({ type: 'text', text: order.address });
  }
  ops.push({ type: 'line' });

  // Позиции по категориям
  for (const group of groupItemsByCategory(order.items)) {
    ops.push({ type: 'text', text: group.category, bold: true }); // КАТЕГОРИЯ — жирная
    for (const item of group.items) {
      const lineTotal = (item.price ?? 0) * item.quantity;
      ops.push({
        type: 'lr',
        left: `${item.quantity}x ${item.name}`,
        right: item.price != null ? formatEuro(lineTotal) : '',
      });
      for (const c of item.customizations || []) {
        ops.push({ type: 'text', text: `   - ${c}` });
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

  // Комментарий
  if (order.notes && order.notes.trim()) {
    ops.push({ type: 'line' });
    ops.push({ type: 'text', text: 'HINWEIS:', bold: true });
    ops.push({ type: 'text', text: order.notes.trim() });
  }

  // Подвал
  ops.push({ type: 'line' });
  ops.push({ type: 'align', value: 'center' });
  ops.push({ type: 'text', text: 'Kein Kassenbon' });
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
