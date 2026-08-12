'use client';

/**
 * Общие блоки заказа: состав с итогами, клиент, прогресс статуса,
 * модалка отмены (канвы D2 / 03 / 12).
 */

import { useState } from 'react';
import { stripPromoLabels } from '../../lib/orders/gift-label';
import { AdminOrder } from './hooks';
import { euro, timeHHmm } from './format';
import { Icon, SectionLabel, StatusBadge } from './ui';

/* ------------------------------------------------------------ helpers */

export function shortName(full: string): string {
  const parts = (full || '').trim().split(/\s+/);
  if (parts.length < 2) return full || '—';
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

export function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export function isToday(iso: string): boolean {
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

/** «обещано к 19:20»: заявленное время или created + ETA из Telegram. */
export function promisedTimeLabel(order: AdminOrder): string | null {
  if (order.etaMinutes) {
    return timeHHmm(new Date(new Date(order.createdAt).getTime() + order.etaMinutes * 60000));
  }
  if (order.desiredDeliveryTime && /^\d{1,2}:\d{2}$/.test(order.desiredDeliveryTime)) {
    return order.desiredDeliveryTime;
  }
  return null;
}

export function itemDisplayName(item: AdminOrder['items'][number]): string {
  const base = stripPromoLabels(item.name);
  const size = (item as any).size?.name || (item as any).size?.size;
  return size && !base.includes(String(size)) ? `${base} · ${size}` : base;
}

export function itemExtrasLine(item: AdminOrder['items'][number]): string | null {
  const extras = (item as any).extras || {};
  const names: string[] = [];
  for (const key of ['toppings', 'sauces', 'sides']) {
    for (const extra of extras[key] || []) {
      if (extra?.name) names.push(extra.name);
    }
  }
  if ((item as any).toppings?.length) {
    for (const extra of (item as any).toppings) if (extra?.name) names.push(extra.name);
  }
  return names.length ? `+ ${names.join(', ')}` : null;
}

export function lineTotal(item: AdminOrder['items'][number]): number {
  return (Number(item.price) || 0) * (Number(item.quantity) || 0);
}

export function fullAddress(order: AdminOrder): string | null {
  const address = order.deliveryAddress;
  if (!address) return null;
  const line = [
    [address.street, address.houseNumber].filter(Boolean).join(' '),
    [address.postalCode, address.city].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  return line || null;
}

export const PAYMENT_LABELS: Record<string, string> = {
  cash: 'наличные',
  card: 'карта при получении',
  online: 'оплачен онлайн',
};

/* ------------------------------------------------- состав + итоги */

export function OrderComposition({ order, title }: { order: AdminOrder; title?: string }) {
  const couponAmount = Number(order.discount?.amount) || 0;
  const promoAmount = Number(order.promotionDiscount) || 0;
  const residual =
    (Number(order.subtotal) || 0) +
    (Number(order.deliveryFee) || 0) -
    couponAmount -
    promoAmount -
    (Number(order.total) || 0);

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {title ? (
        <h3 className="m-0 text-lg font-bold leading-6 text-gray-900">{title}</h3>
      ) : (
        <SectionLabel>Состав</SectionLabel>
      )}
      <div className="flex flex-col gap-3">
        {order.items?.map((item, i) => (
          <div key={i} className="flex gap-3">
            <span className="w-7 flex-none text-base font-bold leading-6 text-[#7C6145] tabular-nums">
              {item.quantity}×
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-base leading-6 text-gray-900">{itemDisplayName(item)}</div>
              {itemExtrasLine(item) && (
                <div className="text-sm leading-5 text-gray-600">{itemExtrasLine(item)}</div>
              )}
            </div>
            <span className="text-base font-bold leading-6 text-gray-900 tabular-nums">
              {euro(lineTotal(item))}
            </span>
          </div>
        ))}
      </div>
      <div className="h-px bg-gray-200" />
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-sm leading-5 text-gray-600">
          <span>Позиции</span>
          <span className="tabular-nums">{euro(order.subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm leading-5 text-gray-600">
          <span>
            Доставка{order.deliveryZone?.name ? ` ${order.deliveryZone.name}` : ''}
            {order.deliveryType === 'pickup' ? ' (самовывоз)' : ''}
          </span>
          <span className="tabular-nums">{euro(order.deliveryFee)}</span>
        </div>
        {couponAmount > 0 && (
          <div className="flex justify-between text-sm font-bold leading-5 text-[#D42A47]">
            <span>Промокод {order.discount?.code || ''}</span>
            <span className="tabular-nums">−{euro(couponAmount).replace('-', '')}</span>
          </div>
        )}
        {promoAmount > 0 && (
          <div className="flex justify-between text-sm font-bold leading-5 text-[#D42A47]">
            <span>Акция{order.promotionPromoCode ? ` ${order.promotionPromoCode}` : ''}</span>
            <span className="tabular-nums">−{euro(promoAmount)}</span>
          </div>
        )}
        {residual > 0.009 && (
          <div className="flex justify-between text-sm font-bold leading-5 text-[#D42A47]">
            <span>Другие скидки (баллы)</span>
            <span className="tabular-nums">−{euro(residual)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <span className="text-base font-bold leading-6 text-gray-900">К оплате</span>
          <span className="text-lg font-bold leading-6 text-gray-900 tabular-nums">
            {euro(order.total)}
          </span>
        </div>
        <div className="text-sm leading-5 text-gray-500">
          Оплата: {PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}
          {order.paymentMethod === 'online' && order.paymentStatus !== 'completed'
            ? ' · не подтверждена'
            : ''}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- клиент */

export function CustomerBlock({ order, title }: { order: AdminOrder; title?: string }) {
  const address = fullAddress(order);
  return (
    <div className="flex flex-col gap-3">
      {title ? (
        <h3 className="m-0 text-lg font-bold leading-6 text-gray-900">{title}</h3>
      ) : (
        <SectionLabel>Клиент</SectionLabel>
      )}
      <div className="flex items-center gap-3">
        <Icon d="M20 21a8 8 0 1 0-16 0 M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" size={20} stroke="#9A7A56" className="flex-none" />
        <span className="text-base leading-6 text-gray-900">{order.customerName || '—'}</span>
      </div>
      {order.deliveryType === 'delivery' && address && (
        <div className="flex items-center gap-3">
          <Icon
            d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z M14.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"
            size={20}
            stroke="#9A7A56"
            className="flex-none"
          />
          <span className="text-base leading-6 text-gray-900">{address}</span>
        </div>
      )}
      {order.deliveryType === 'pickup' && (
        <div className="flex items-center gap-3">
          <Icon d="M3 9.5 5 3h14l2 6.5 M4 9.5V21h16V9.5 M9 21v-6h6v6" size={20} stroke="#9A7A56" className="flex-none" />
          <span className="text-base leading-6 text-gray-900">Самовывоз из ресторана</span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <Icon
          d="M15.5 21A12.5 12.5 0 0 1 3 8.5 2.5 2.5 0 0 1 5.5 6h2L9 9.5l-2 1.5a10 10 0 0 0 4.5 4.5l1.5-2 3.5 1.5v2A2.5 2.5 0 0 1 15.5 21Z"
          size={20}
          stroke="#9A7A56"
          className="flex-none"
        />
        <a
          href={`tel:${order.phoneNumber}`}
          className="text-base leading-6 text-gray-900 tabular-nums no-underline hover:underline"
        >
          {order.phoneNumber || '—'}
        </a>
      </div>
    </div>
  );
}

export function CustomerNote({ order, compact = false }: { order: AdminOrder; compact?: boolean }) {
  if (!order.notes) return null;
  if (compact) {
    return (
      <div className="rounded-xl bg-[#FEF9C3] p-3 text-sm leading-5 text-[#713F12]">
        «{order.notes}»
      </div>
    );
  }
  return (
    <div className="flex gap-3 rounded-2xl bg-[#FEF9C3] p-4">
      <Icon
        d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z M12 8v4 M12 16h.01"
        size={20}
        stroke="#713F12"
        className="flex-none"
      />
      <span className="text-sm leading-5 text-[#713F12]">
        Комментарий клиента: «{order.notes}»
      </span>
    </div>
  );
}

/* --------------------------------------------------- прогресс статуса */

const PROGRESS_STEPS_DELIVERY = ['Принят', 'Готовится', 'Готов', 'Доставлен'];
const PROGRESS_STEPS_PICKUP = ['Принят', 'Готовится', 'Готов', 'Выдан'];

function progressIndex(status: string): number {
  switch (status) {
    case 'new':
      return 0;
    case 'preparing':
      return 1;
    case 'ready_for_delivery':
      return 2;
    case 'delivering':
      return 3;
    case 'completed':
      return 4;
    default:
      return -1;
  }
}

export function StatusProgress({ order }: { order: AdminOrder }) {
  const steps = order.deliveryType === 'pickup' ? PROGRESS_STEPS_PICKUP : PROGRESS_STEPS_DELIVERY;
  const idx = progressIndex(order.status);
  if (idx < 0) return null; // отменённые — без прогресса
  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Статус</SectionLabel>
      <div className="flex items-center gap-1">
        {steps.map((_, i) => (
          <span
            key={i}
            className="h-1 flex-1 rounded"
            style={{
              background: i <= idx ? '#8A6C4C' : i === idx + 1 ? '#DCC9A9' : '#E5E7EB',
            }}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs font-bold leading-4">
        {steps.map((step, i) => (
          <span key={step} style={{ color: i <= idx ? '#4B5563' : '#9CA3AF' }}>
            {step}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------- модалка отмены */

const CANCEL_REASONS = [
  'Нет продуктов',
  'Клиент попросил отменить',
  'Не дозвонились до клиента',
  'Кухня перегружена',
  'Ошибка в заказе',
  'Другое',
];

export function CancelOrderModal({
  order,
  onClose,
  onCancelled,
}: {
  order: AdminOrder | null;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [busy, setBusy] = useState(false);
  if (!order) return null;

  const paidOnline = order.paymentMethod === 'online' && order.paymentStatus === 'completed';

  const confirm = async () => {
    setBusy(true);
    const notes = `${order.notes ? `${order.notes} | ` : ''}Отмена: ${reason}`;
    const { updateOrderStatus } = await import('./hooks');
    const ok = await updateOrderStatus(order._id, 'cancelled', { notes });
    setBusy(false);
    if (!ok) {
      alert('Не удалось отменить заказ');
      return;
    }
    onCancelled();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Закрыть"
        className="absolute inset-0 cursor-default border-none bg-black/50"
        onClick={onClose}
      />
      <div className="relative flex w-[360px] max-w-full flex-col gap-4 rounded-2xl bg-white p-6 shadow-[0_24px_48px_rgba(17,24,39,.24)]">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FDE6E7]">
          <Icon
            d="m21.7 16.5-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 19.5h16a2 2 0 0 0 1.7-3Z M12 9v4 M12 17h.01"
            size={24}
            stroke="#D42A47"
          />
        </div>
        <h2 className="m-0 text-2xl font-extrabold leading-[30px] tracking-[-.01em] text-gray-900">
          Отменить заказ #{order.orderNumber}?
        </h2>
        <p className="m-0 text-base leading-6 text-gray-600">
          {paidOnline
            ? `Заказ оплачен онлайн (${euro(order.total)}) — возврат оформите вручную в разделе «Финансы → Платежи».`
            : 'Заказ будет помечен как отменённый, вернуть его в работу нельзя.'}
        </p>
        <div className="flex flex-col gap-2">
          <SectionLabel>Причина</SectionLabel>
          <div className="relative">
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-12 w-full cursor-pointer appearance-none rounded-xl border border-gray-300 bg-white px-4 pr-10 text-base leading-6 text-gray-900 outline-none focus:border-[#8A6C4C]"
            >
              {CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
              <Icon d="m6 9 6 6 6-6" size={20} stroke="#9CA3AF" />
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={confirm}
            className="h-12 w-full cursor-pointer rounded-xl border-none bg-[#D42A47] px-6 text-lg font-bold leading-5 text-white transition hover:bg-[#B31F39] disabled:opacity-50"
          >
            {busy ? 'Отменяем…' : 'Отменить заказ'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-12 w-full cursor-pointer rounded-xl border-none bg-transparent px-6 text-lg font-bold leading-5 text-gray-900 transition hover:bg-[#FAF7F2]"
          >
            Вернуться к заказу
          </button>
        </div>
      </div>
    </div>
  );
}
