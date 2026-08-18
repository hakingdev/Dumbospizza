'use client';

import Link from 'next/link';
import { PosIcon } from './primitives';
import type { PosBoardStatus } from '../../lib/pos/board';

/**
 * Компоненты ленты заказов (Figma: Order Card 5:66, Status Badge 3:22,
 * Status Tabs 8:129, Bottom Nav 8:178).
 *
 * Статусы вынесены в один справочник: цвет полосы, заливка бейджа и подпись
 * должны меняться вместе, иначе карточка однажды окажется с жёлтой полосой и
 * зелёным бейджем.
 */

/**
 * Статусы карточки — ровно те же, что отдаёт сервер (lib/pos/board.ts).
 * Свой список означал бы, что однажды сервер пришлёт статус, которого у карточки
 * нет, и она молча отрисуется пустой.
 */
export type PosOrderStatus = PosBoardStatus;

export const POS_STATUS: Record<
  PosOrderStatus,
  { label: string; text: string; tint: string }
> = {
  // Непринятый заказ красится акцентом, а не статусным цветом: это не этап
  // приготовления, а требование решения — его видно и боковым зрением.
  new: {
    label: 'Neu',
    text: 'var(--pos-accent)',
    tint: 'var(--pos-accent-subtle)',
  },
  preparing: {
    label: 'In Zubereitung',
    text: 'var(--pos-status-preparing)',
    tint: 'var(--pos-tint-preparing)',
  },
  ready: {
    label: 'Bereit zur Lieferung',
    text: 'var(--pos-status-ready)',
    tint: 'var(--pos-tint-ready)',
  },
  delivering: {
    label: 'Unterwegs',
    text: 'var(--pos-status-delivering)',
    tint: 'var(--pos-tint-delivering)',
  },
  delivered: {
    label: 'Geliefert',
    text: 'var(--pos-status-delivered)',
    tint: 'var(--pos-tint-delivered)',
  },
  cancelled: {
    label: 'Storniert',
    text: 'var(--pos-status-cancelled)',
    tint: 'var(--pos-tint-cancelled)',
  },
};

export function PosStatusBadge({ status }: { status: PosOrderStatus }) {
  const s = POS_STATUS[status];
  return (
    <span
      className="pos-label-s flex shrink-0 items-center gap-[6px] rounded-full px-[10px] py-[5px]"
      style={{ background: s.tint, color: s.text }}
    >
      {/* Точка статуса — не иконка, а маркер: цвет наследуется от текста бейджа. */}
      <span className="size-[8px] shrink-0 rounded-full bg-current" aria-hidden="true" />
      {s.label}
    </span>
  );
}

export interface PosOrderSummary {
  id: string;
  number: string;
  status: PosOrderStatus;
  /** Способ получения, адрес, источник — одной строкой. */
  meta: string;
  /** Состав в одну строку: кухне на карточке нужен объём, а не подробности. */
  items: string;
  /** Левая нижняя строка: таймер, «ждёт курьера», «просрочен». */
  note: string;
  total: string;
  /** Просроченный заказ подсвечивается независимо от статуса. */
  overdue?: boolean;
}

export function PosOrderCard({ order }: { order: PosOrderSummary }) {
  const s = POS_STATUS[order.status];
  const noteColor = order.overdue ? 'var(--pos-status-cancelled)' : s.text;
  return (
    <Link
      href={`/pos/orders/${order.id}`}
      className="flex w-full overflow-hidden rounded-[16px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)]"
    >
      {/* Цветная полоса слева: статус читается боковым зрением, до чтения текста. */}
      <span className="w-[4px] shrink-0 self-stretch" style={{ background: s.text }} />
      <span className="flex min-w-px flex-1 flex-col gap-[8px] p-[14px]">
        <span className="flex w-full items-center gap-[8px]">
          <span className="pos-title-m pos-num text-[var(--pos-text-primary)]">
            #{order.number}
          </span>
          <span className="h-px min-w-px flex-1" />
          <PosStatusBadge status={order.status} />
        </span>
        <span className="pos-body-s w-full text-[var(--pos-text-secondary)]">{order.meta}</span>
        <span className="pos-body-s w-full text-[var(--pos-text-muted)]">{order.items}</span>
        <span className="h-px w-full bg-[var(--pos-border)]" />
        <span className="flex w-full items-center gap-[8px]">
          <span className="pos-label-m pos-num" style={{ color: noteColor }}>
            {order.note}
          </span>
          <span className="h-px min-w-px flex-1" />
          <span className="pos-title-m pos-num text-[var(--pos-text-primary)]">{order.total}</span>
        </span>
      </span>
    </Link>
  );
}

export interface PosTab {
  key: string;
  label: string;
  count: number;
}

/** Четыре статуса с количеством. Число крупнее подписи: его читают первым. */
export function PosStatusTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: PosTab[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex h-[62px] w-full shrink-0 items-start bg-[var(--pos-bg-base)]">
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            aria-pressed={on}
            className="flex h-full min-w-px flex-1 flex-col items-center gap-[2px] px-[2px] pt-[8px]"
          >
            <span
              className={`pos-number-m pos-num ${on ? 'text-[var(--pos-accent)]' : 'text-[var(--pos-text-primary)]'}`}
            >
              {tab.count}
            </span>
            <span
              className={`pos-label-xs ${on ? 'text-[var(--pos-accent)]' : 'text-[var(--pos-text-muted)]'}`}
            >
              {tab.label}
            </span>
            <span className="min-h-px w-full flex-1" />
            <span
              className={`h-[3px] w-full rounded-t-[3px] ${on ? 'bg-[var(--pos-accent)]' : ''}`}
            />
          </button>
        );
      })}
    </div>
  );
}

const NAV = [
  { href: '/pos/orders', icon: 'orders', label: 'Bestellungen' },
  { href: '/pos/menu', icon: 'menu', label: 'Speisekarte' },
  { href: '/pos/more', icon: 'more', label: 'Mehr' },
] as const;

/** Главная навигация, 60 dp. */
export function PosBottomNav({ active }: { active: 'orders' | 'menu' | 'more' }) {
  return (
    <nav className="flex h-[60px] w-full shrink-0 items-stretch border-t border-[var(--pos-border)] bg-[var(--pos-bg-surface)]">
      {NAV.map((item) => {
        const on = item.icon === active;
        return (
          <Link
            key={item.icon}
            href={item.href}
            className={`flex min-w-px flex-1 flex-col items-center justify-center gap-[3px] py-[8px] ${
              on ? 'text-[var(--pos-accent)]' : 'text-[var(--pos-text-muted)]'
            }`}
          >
            <PosIcon name={item.icon} />
            <span className="pos-label-xs">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
