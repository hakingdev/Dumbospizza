/**
 * Сборка задания печати для POS-прибора.
 *
 * Прибор — тонкий клиент: он получает готовый список операций и параметры
 * начертания, и ничего не знает ни о заказе, ни о раскладке чека. Всё решается
 * здесь, на сервере, в единственном экземпляре.
 *
 * Почему операции, а не байты ESC/POS. На Sunmi V2s немецкий текст сырым
 * потоком недостижим: ESC t прекращает печать, ESC R игнорируется, старшие
 * байты не дают ни одного символа — проверено на приборе. Через SDK умляуты
 * печатаются верно, поэтому прибор проигрывает операции вызовами SDK.
 * Для Epson по LAN те же самые операции превращаются в байты через
 * lib/receipt/escpos.ts — раскладка у обоих одна.
 */

import {
  buildKitchenReceiptOps,
  type ReceiptItem,
  type ReceiptOp,
  type ReceiptOrder,
} from '../receipt/kitchen-receipt';
import { classifyWorkshop } from '../kitchen/workshops';
import type { PosPrintSettings } from './settings';

type AnyRecord = Record<string, any>;

/** Как прибор должен печатать операции. Приходит из настроек в админке. */
export interface PosRenderHints {
  width: number;
  boldBody: boolean;
  bigAccents: boolean;
  feedLines: number;
}

export interface PosPrintJob {
  orderId: string;
  orderNumber: string;
  /** Номер задания печати: прибор возвращает его в подтверждении, чтобы
   *  подтверждение не затёрло Nachdruck, запрошенный во время печати. */
  printSeq: number;
  copies: number;
  render: PosRenderHints;
  ops: ReceiptOp[];
}

/**
 * Допы позиции одной строкой каждый. Зеркало buildCustomizations из
 * scripts/print-agent.js — при следующей правке агента эту логику надо будет
 * забрать сюда целиком, чтобы копия исчезла.
 */
function buildCustomizations(item: AnyRecord): string[] {
  const parts: string[] = [];
  if (item.size?.name) parts.push(String(item.size.name));
  for (const t of item.extras?.toppings ?? []) parts.push(`Topping: ${t.name}`);
  for (const s of item.extras?.sauces ?? []) parts.push(`Sauce: ${s.name}`);
  for (const s of item.extras?.sides ?? []) parts.push(`Side: ${s.name}`);
  for (const o of item.options ?? []) parts.push(o.group ? `${o.group}: ${o.name}` : o.name);
  return parts;
}

/** Адрес доставки одной строкой. Экспортирован: тот же адрес показывает лента. */
export function formatOrderAddress(order: AnyRecord): string | undefined {
  if (order.deliveryType !== 'delivery' || !order.deliveryAddress) return undefined;
  const a = order.deliveryAddress;
  const line = `${a.street || ''} ${a.houseNumber || ''}, ${a.postalCode || ''} ${a.city || ''}`;
  return line.replace(/\s+/g, ' ').trim().replace(/^,\s*|,\s*$/g, '') || undefined;
}

/** Заказ из БД → нейтральное описание чека. */
export function orderToReceiptOrder(order: AnyRecord): ReceiptOrder {
  return {
    orderId: order.orderNumber ?? order._id ?? order.id,
    createdAt: order.createdAt,
    deliveryType: order.deliveryType === 'pickup' ? 'pickup' : 'delivery',
    customerName: order.customerName,
    phoneNumber: order.phoneNumber,
    address: formatOrderAddress(order),
    desiredDeliveryTime: order.desiredDeliveryTime,
    notes: order.notes,
    deliveryFee: order.deliveryFee,
    totalAmount: order.total,
    paymentMethod: order.paymentMethod,
    items: (order.items ?? []).map(
      (item: AnyRecord): ReceiptItem => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        category: item.category,
        subcategory: item.subcategory,
        customizations: buildCustomizations(item),
      })
    ),
  };
}

/**
 * Оставить только позиции нужных цехов.
 *
 * Позиции, не принадлежащие ни одному цеху (напитки, десерты — их не готовят),
 * остаются всегда: иначе на суши-станции пропала бы кола из заказа, и сборщик
 * решил бы, что её забыли положить.
 */
export function filterItemsByWorkshops(
  items: ReceiptItem[],
  workshops: PosPrintSettings['workshops']
): ReceiptItem[] {
  if (!workshops || !workshops.length) return items;
  return items.filter((item) => {
    const station = classifyWorkshop(item);
    return station === null || workshops.includes(station);
  });
}

/**
 * Заказ + настройки → задание печати.
 *
 * @returns null, если после фильтра по цехам печатать нечего — такой заказ
 *   прибору выдавать не надо, иначе он напечатает пустой чек и подтвердит его.
 */
export function buildPrintJob(
  order: AnyRecord,
  settings: PosPrintSettings
): PosPrintJob | null {
  const receipt = orderToReceiptOrder(order);
  const items = filterItemsByWorkshops(receipt.items, settings.workshops);
  if (!items.length) return null;

  const ops = buildKitchenReceiptOps(
    { ...receipt, items },
    { header: settings.header, footer: settings.footer }
  );

  return {
    orderId: String(order._id ?? order.id),
    orderNumber: String(order.orderNumber ?? order._id ?? order.id),
    // В модели заказа поле называется kitchenPrintSeq. Раньше здесь читалось
    // несуществующее order.printSeq, то есть в задание ВСЕГДА уезжал ноль — и
    // повтор печати на приборе не работал вовсе: ключ идемпотентности
    // `orderId:printSeq` не менялся, прибор считал чек уже напечатанным и молча
    // пропускал его. Чек при этом выходил на Epson (LAN-агент смотрит на
    // kitchenPrintStatus), из-за чего поломка выглядела как «печатает не туда».
    printSeq: Number(order.kitchenPrintSeq) || 0,
    copies: settings.copies,
    render: {
      width: settings.width,
      boldBody: settings.boldBody,
      bigAccents: settings.bigAccents,
      feedLines: settings.feedLines,
    },
    ops,
  };
}
