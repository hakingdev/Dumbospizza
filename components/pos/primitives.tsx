/**
 * Примитивы терминала Sunmi V2s.
 *
 * Соответствие Figma «Sunmi V2s · Bestellannahme»: Button (4:10), Status Bar (8:12),
 * App Bar, Card, Row. Размеры не округлял — 56 dp у кнопки это заявленное в макете
 * касание для рук в перчатках, а не произвольная величина.
 */
import type { ReactNode } from 'react';

/**
 * Иконка из `public/pos/icons`. Рисуется МАСКОЙ, цвет берётся из currentColor:
 * экспорт из Figma приходит с зашитым цветом, а маска даёт одну форму и для
 * активного состояния, и для неактивного. Своими руками SVG не рисуем — форма
 * должна остаться ровно дизайнерской.
 */
export function PosIcon({
  name,
  size = 24,
  className = '',
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`pos-icon shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url(/pos/icons/${name}.svg)`,
        maskImage: `url(/pos/icons/${name}.svg)`,
      }}
    />
  );
}

/** Кнопка панели действий. 56 dp — размер касания для POS. */
export function PosButton({
  label,
  variant = 'primary',
  onClick,
  disabled,
}: {
  label: string;
  /** danger — «стоп кухни» (Figma Button/Danger 4:6). */
  variant?: 'primary' | 'ghost' | 'danger';
  onClick?: () => void;
  disabled?: boolean;
}) {
  const base =
    'pos-label-l flex h-[56px] flex-1 items-center justify-center rounded-[14px] px-[20px] disabled:opacity-50';
  const skin = {
    primary: 'bg-[var(--pos-accent)] text-[var(--pos-text-on-accent)]',
    ghost:
      'border border-[var(--pos-border)] bg-[var(--pos-bg-base)] text-[var(--pos-text-secondary)]',
    danger: 'bg-[var(--pos-danger)] text-[var(--pos-text-on-accent)]',
  }[variant];
  return (
    <button type="button" className={`${base} ${skin}`} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

/**
 * Строка состояния Android. В макете она нарисована, но на приборе её рисует
 * система — поэтому здесь только заглушка для предпросмотра в браузере, а на
 * устройстве в киоске она скрыта.
 */
export function PosStatusBar({ time }: { time: string }) {
  return (
    <div className="flex h-[26px] w-full shrink-0 items-center gap-[8px] bg-[var(--pos-bg-base)] pl-[14px] pr-[12px] pos-preview-only">
      <span className="pos-label-xs pos-num text-[var(--pos-text-secondary)]">{time}</span>
      <span className="h-px flex-1" />
    </div>
  );
}

/** Верхняя панель с заголовком, возвратом и необязательным действием справа. */
export function PosAppBar({
  title,
  overline,
  onBack,
  action,
}: {
  title: string;
  /**
   * Надпись над заголовком («DUMBO SLICE PIZZA & SUSHI») — вариант панели
   * «Default» из макета: он стоит на корневых экранах, где кнопки возврата нет.
   */
  overline?: string;
  onBack?: () => void;
  /**
   * Правое действие. Икона задаётся именем, а не отдельным пропом на каждый
   * случай: в макете у этой панели два варианта — колокольчик уведомлений и
   * печать бона («Back+Druck», Figma 40:12), и будут ещё.
   */
  action?: { icon: 'bell' | 'printer'; label: string; onClick?: () => void };
}) {
  return (
    <div
      className={`flex h-[56px] w-full shrink-0 items-center gap-[8px] bg-[var(--pos-bg-base)] ${
        onBack ? 'px-[4px]' : 'py-[6px] pl-[16px] pr-[4px]'
      }`}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Zurück"
          className="flex size-[48px] shrink-0 items-center justify-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pos/icons/back.svg" alt="" width={24} height={24} className="size-[24px]" />
        </button>
      )}
      <span className="flex min-w-px flex-col">
        {overline && <span className="pos-label-xs text-[var(--pos-accent)]">{overline}</span>}
        <span className="pos-title-m truncate text-[var(--pos-text-primary)]">{title}</span>
      </span>
      <span className="h-px min-w-px flex-1" />
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          aria-label={action.label}
          className="flex size-[48px] shrink-0 items-center justify-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/pos/icons/${action.icon}.svg`}
            alt=""
            width={24}
            height={24}
            className="size-[24px]"
          />
        </button>
      )}
    </div>
  );
}

/** Карточка-контейнер: белая плашка со скруглением 16 и рамкой. */
export function PosCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`w-full rounded-[16px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)] p-[14px] ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Строка «подпись … значение» с направляющей между ними.
 *
 * Разделитель — растянутый пустой элемент, а не точки: на 360 dp многоточие
 * съедает место, которое нужно значению.
 */
export function PosRow({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  /** 'warning' — то, что меняет решение кухни (например, заказ на время). */
  tone?: 'default' | 'paid' | 'warning';
}) {
  const valueColor =
    tone === 'paid'
      ? 'text-[var(--pos-status-delivered)]'
      : tone === 'warning'
        ? 'text-[var(--pos-status-preparing)]'
        : 'text-[var(--pos-text-primary)]';
  return (
    <div className="flex w-full items-center gap-[8px]">
      <span className="pos-body-m shrink-0 text-[var(--pos-text-secondary)]">{label}</span>
      <span className="h-px min-w-px flex-1" />
      <span className={`pos-label-l pos-num shrink-0 ${valueColor}`}>{value}</span>
    </div>
  );
}

export function PosDivider() {
  return <div className="h-px w-full bg-[var(--pos-border)]" />;
}

/** Панель действий внизу экрана. Всегда на месте, лента скроллится под ней. */
export function PosActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="pos-elevation-sheet flex w-full shrink-0 items-start gap-[12px] border-t border-[var(--pos-border)] bg-[var(--pos-bg-surface)] px-[16px] pb-[14px] pt-[12px]">
      {children}
    </div>
  );
}

/** Быстрый выбор времени. 56 dp — тот же размер касания, что у кнопок. */
export function PosTimeChip({
  label,
  selected = false,
  onClick,
}: {
  label: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const skin = selected
    ? 'bg-[var(--pos-accent)] text-[var(--pos-text-on-accent)]'
    : 'border border-[var(--pos-border)] bg-[var(--pos-bg-surface-2)] text-[var(--pos-text-primary)]';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`pos-label-l flex h-[56px] min-w-px flex-1 items-center justify-center rounded-[12px] ${skin}`}
    >
      {label}
    </button>
  );
}

/** Шаг ±5 минут. Квадрат 64 dp — крупнее чипа, потому что нажимают его часто. */
export function PosStepButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="pos-title-l flex size-[64px] shrink-0 items-center justify-center rounded-[16px] border border-[var(--pos-border-strong)] bg-[var(--pos-bg-surface-2)] text-[var(--pos-text-primary)] disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/**
 * Нижняя шторка. Общая для стоп-листа (11), продления времени (08) и повтора
 * печати (15): затемнение, ручка, заголовок, содержимое, две кнопки — во всех
 * трёх кадрах одно и то же, отличается только наполнение.
 *
 * Живёт в примитивах, а не рядом с меню, потому что ей пользуются три разных
 * экрана.
 */
export function PosSheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  actions,
  align = 'start',
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose?: () => void;
  children?: ReactNode;
  actions?: ReactNode;
  /** 'center' — как в 08: короткий заголовок и крупная величина по центру. */
  align?: 'start' | 'center';
}) {
  if (!open) return null;
  const centered = align === 'center';
  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-end">
      {/* Затемнение закрывает шторку по нажатию: на приборе это привычнее,
          чем искать крестик жирным пальцем. */}
      <button
        type="button"
        aria-label="Schließen"
        onClick={onClose}
        className="absolute inset-0 bg-black/55"
      />
      <div
        className={`pos-elevation-sheet relative flex max-h-[85%] w-full flex-col gap-[12px] rounded-t-[20px] bg-[var(--pos-bg-base)] px-[16px] pb-[16px] pt-[10px] ${
          centered ? 'items-center text-center' : ''
        }`}
      >
        <span className="mx-auto h-[4px] w-[40px] shrink-0 rounded-full bg-[var(--pos-border-strong)]" />
        <span className="pos-title-l text-[var(--pos-text-primary)]">{title}</span>
        {subtitle && (
          <span className="pos-body-m text-[var(--pos-text-secondary)]">{subtitle}</span>
        )}
        <div
          className={`pos-scroll flex min-h-px w-full flex-1 flex-col gap-[12px] ${
            centered ? 'items-center' : ''
          }`}
        >
          {children}
        </div>
        {actions && <div className="flex w-full shrink-0 gap-[12px]">{actions}</div>}
      </div>
    </div>
  );
}
