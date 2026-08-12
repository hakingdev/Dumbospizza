'use client';

/**
 * UI-примитивы нового портала. Палитра и метрики — из дизайн-канвы
 * (UI-kit, D12): тёплые нейтралы #FAF7F2/#EBE0CE, действие #8A6C4C,
 * радиусы 12/16, бейджи статусов.
 */

import { ReactNode } from 'react';

/* ---- Статусы заказов: цвета бейджей из канвы D2 ---- */

export type OrderStatus =
  | 'new'
  | 'preparing'
  | 'ready_for_delivery'
  | 'delivering'
  | 'completed'
  | 'cancelled';

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; bg: string; text: string; dot?: string }
> = {
  new: { label: 'Новый', bg: '#DBEAFE', text: '#1D4ED8' },
  preparing: { label: 'Готовится', bg: '#FEF9C3', text: '#713F12', dot: '#FACC15' },
  ready_for_delivery: { label: 'Готов', bg: '#DCFCE7', text: '#15803D' },
  delivering: { label: 'В доставке', bg: '#F5F0E8', text: '#7C6145' },
  completed: { label: 'Завершён', bg: '#DCFCE7', text: '#15803D' },
  cancelled: { label: 'Отменён', bg: '#FDE6E7', text: '#B31F39' },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = ORDER_STATUS_META[status as OrderStatus] || {
    label: status,
    bg: '#F3F4F6',
    text: '#4B5563',
  };
  return (
    <span
      className="inline-flex h-6 flex-none items-center gap-1.5 rounded-full px-2.5 text-xs font-bold leading-4"
      style={{ background: meta.bg, color: meta.text }}
    >
      {meta.dot && (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} />
      )}
      {meta.label}
    </span>
  );
}

/* ---- Иконка по d-пути (иконки дизайн-системы, stroke 2, round) ---- */

export function Icon({
  d,
  size = 20,
  stroke = 'currentColor',
  className,
}: {
  d: string;
  size?: number;
  stroke?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

/* ---- Карточка-поверхность ---- */

export function Card({
  children,
  className = '',
  padded = false,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_1px_2px_rgba(17,24,39,.04),0_2px_8px_rgba(17,24,39,.06)] ${
        padded ? 'p-4 lg:p-6' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* ---- Кнопки: классы из UI-кита (primary #8A6C4C, outline 2px, ghost) ---- */

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl border-none bg-[#8A6C4C] font-bold text-white shadow-[0_1px_2px_rgba(95,73,52,.24)] transition hover:bg-[#7C6145] hover:shadow-[0_4px_12px_rgba(95,73,52,.28)] active:scale-[.98] active:bg-[#5F4934] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer';

export const btnOutline =
  'inline-flex items-center justify-center gap-2 rounded-xl border-2 border-gray-900 bg-transparent font-bold text-gray-900 transition hover:bg-[#F5F0E8] active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer';

export const btnGhost =
  'inline-flex items-center justify-center gap-2 rounded-xl border-none bg-transparent font-bold text-gray-900 transition hover:bg-[#FAF7F2] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer';

export const btnGhostDanger =
  'inline-flex items-center justify-center gap-2 rounded-xl border-none bg-transparent font-bold text-[#D42A47] transition hover:bg-[#FDE6E7] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer';

export const btnSuccess =
  'inline-flex items-center justify-center gap-2 rounded-xl border-none bg-[#15803D] font-bold text-white transition hover:bg-[#116632] active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer';

export const btnSoft =
  'inline-flex items-center justify-center gap-2 rounded-xl border-none bg-[#F5F0E8] font-bold text-[#7C6145] transition hover:bg-[#EBE0CE] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer';

/** Круглая иконко-кнопка 32/40px (печать, отмена и т.п.). */
export function RoundIconBtn({
  label,
  d,
  color = '#9A7A56',
  hoverBg = '#FAF7F2',
  size = 32,
  onClick,
  disabled,
}: {
  label: string;
  d: string;
  color?: string;
  hoverBg?: string;
  size?: number;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex flex-none cursor-pointer items-center justify-center rounded-full border border-gray-200 bg-white transition disabled:cursor-not-allowed disabled:opacity-50 [&:hover]:bg-[var(--hover-bg)]"
      style={{ width: size, height: size, color, ['--hover-bg' as any]: hoverBg }}
    >
      <Icon d={d} size={20} />
    </button>
  );
}

/* ---- Заголовок страницы (H1 + подзаголовок + действия справа) ---- */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-extrabold leading-8 tracking-[-.02em] text-gray-900 lg:text-[32px] lg:leading-[38px]">
          {title}
        </h1>
        {subtitle && (
          <p className="m-0 text-sm leading-5 text-gray-600 lg:text-base lg:leading-6">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

/* ---- Чипы-фильтры (пилюли табов из D2) ---- */

export function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'inline-flex h-10 flex-none cursor-pointer items-center gap-1.5 rounded-full border-none bg-[#8A6C4C] px-4 text-base font-bold leading-5 text-white'
          : 'inline-flex h-10 flex-none cursor-pointer items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 text-base font-bold leading-5 text-gray-900 transition hover:bg-[#FAF7F2]'
      }
    >
      {label}
      {typeof count === 'number' && <span className="tabular-nums">· {count}</span>}
    </button>
  );
}

/* ---- KPI-карточка (Главная, D1) ---- */

export function KpiCard({
  label,
  value,
  trend,
  trendTone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  trend?: ReactNode;
  trendTone?: 'up' | 'down' | 'neutral';
}) {
  const toneColor =
    trendTone === 'up' ? '#15803D' : trendTone === 'down' ? '#D42A47' : '#4B5563';
  return (
    <Card className="flex flex-col gap-2 p-4 transition hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(17,24,39,.10)] lg:gap-1 lg:p-6">
      <span className="text-xs font-bold uppercase leading-4 tracking-[.04em] text-gray-500">
        {label}
      </span>
      <span className="text-[28px] font-extrabold leading-8 tracking-[-.02em] text-gray-900 tabular-nums lg:text-[32px] lg:leading-[38px]">
        {value}
      </span>
      {trend && (
        <span className="text-sm font-bold leading-5" style={{ color: toneColor }}>
          {trend}
        </span>
      )}
    </Card>
  );
}

/* ---- Вкладка-пилюля без рамки (Tab item из кита: Меню / Pizza / Stop-list) ---- */

export function TabPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'inline-flex h-10 flex-none cursor-pointer items-center justify-center rounded-full border-none bg-[#8A6C4C] px-4 text-base font-bold leading-5 text-white'
          : 'inline-flex h-10 flex-none cursor-pointer items-center justify-center rounded-full border-none bg-transparent px-4 text-base font-bold leading-5 text-gray-600 transition hover:bg-[#FAF7F2] hover:text-gray-900'
      }
    >
      {label}
    </button>
  );
}

/* ---- Пустое состояние списка (Empty state из кита: пунктир, иконка, действие) ---- */

const BOOK_ICON =
  'M12 7v14 M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z';

export function EmptyState({
  icon = BOOK_ICON,
  title,
  note,
  action,
}: {
  icon?: string;
  title: string;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-12">
      <span className="flex h-10 w-10 items-center justify-center">
        <Icon d={icon} size={28} stroke="#6B7280" />
      </span>
      <span className="text-center text-lg font-bold leading-6 text-gray-900">{title}</span>
      {note && <span className="max-w-md text-center text-sm leading-5 text-gray-600">{note}</span>}
      {action}
    </div>
  );
}

/* ---- Микро-надпись секции («СОСТАВ», «КЛИЕНТ») ---- */

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-bold uppercase leading-4 tracking-[.04em] text-gray-500">
      {children}
    </span>
  );
}

/* ---- Заглушка раздела, которого ещё нет в бэкенде ---- */

export function ComingSoon({ note }: { note?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#DCC9A9] bg-[#FAF7F2] px-6 py-12 text-center">
      <span className="text-lg font-bold text-gray-900">Раздел в разработке</span>
      {note && <span className="max-w-md text-sm leading-5 text-gray-600">{note}</span>}
    </div>
  );
}

/** Плашка «данные демо» для блоков без реального бэкенда. */
export function DemoTag() {
  return (
    <span
      title="Показаны демонстрационные данные — бэкенд для этого блока ещё не подключён"
      className="inline-flex h-5 flex-none cursor-help items-center rounded-full bg-[#F3F4F6] px-2 text-[10px] font-bold uppercase tracking-[.06em] text-gray-500"
    >
      демо
    </span>
  );
}

/* ---- Ошибки загрузки данных ---- */

const WARN_ICON =
  'm21.7 16.5-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 19.5h16a2 2 0 0 0 1.7-3Z M12 9v4 M12 17h.01';

/**
 * Блок вместо контента, когда данные не загрузились вовсе (error && !data).
 * framed=false — для использования внутри готовой Card.
 */
export function LoadError({
  title = 'Не удалось загрузить данные',
  detail,
  onRetry,
  framed = true,
}: {
  title?: string;
  detail?: string | null;
  onRetry?: () => void;
  framed?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-3 px-6 py-10 text-center ${
        framed ? 'rounded-2xl border border-[#F3C6CD] bg-white' : ''
      }`}
    >
      <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-[#FDE6E7]">
        <Icon d={WARN_ICON} size={24} stroke="#D42A47" />
      </span>
      <span className="text-lg font-bold leading-6 text-gray-900">{title}</span>
      <span className="max-w-md text-sm leading-5 text-gray-600">
        {detail || 'Проверьте соединение и попробуйте ещё раз'}
      </span>
      {onRetry && (
        <button type="button" onClick={onRetry} className={`${btnOutline} mt-1 h-10 px-5 text-base`}>
          Повторить
        </button>
      )}
    </div>
  );
}

/** Узкий баннер: часть данных не загрузилась или перестала обновляться. */
export function ErrorBanner({
  text,
  onRetry,
  retryLabel = 'Повторить',
}: {
  text: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#F3C6CD] bg-[#FDE6E7] px-4 py-3">
      <Icon d={WARN_ICON} size={20} stroke="#D42A47" className="flex-none" />
      <span className="min-w-0 flex-1 text-sm font-bold leading-5 text-gray-900">{text}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="h-8 flex-none cursor-pointer whitespace-nowrap rounded-lg border-none bg-white px-3 text-sm font-bold leading-5 text-[#D42A47] transition hover:bg-[#FAF7F2]"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/* ---- Спиннер загрузки ---- */

export function Loading({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-gray-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-[#8A6C4C]" />
      {label}
    </div>
  );
}
