'use client';

import Link from 'next/link';
import { PosIcon } from './primitives';
import type { PosMenuCategory, PosMenuItem } from './data';

/**
 * Компоненты меню и стоп-листа (Figma: Category Row 7:53, Menu Item Row 7:22,
 * Switch 3:6).
 *
 * Смысл экрана: погасить позицию прямо на приборе, когда что-то кончилось.
 * Поэтому переключатели крупные и стоят справа, под большой палец, а не
 * прячутся в подменю.
 */

/** Ein/Aus для доступности позиции. Область касания 48 dp, как в макете. */
export function PosSwitch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange?: (next: boolean) => void;
  label: string;
}) {
  return (
    <span className="flex h-[48px] w-[60px] shrink-0 items-center justify-center">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange?.(!on)}
        className={`relative h-[32px] w-[52px] rounded-full transition-colors ${
          on ? 'bg-[var(--pos-accent)]' : 'bg-[var(--pos-border-strong)]'
        }`}
      >
        <span
          className="absolute top-[4px] size-[24px] rounded-full bg-[var(--pos-control-knob)] transition-[left]"
          style={{ left: on ? 24 : 4 }}
        />
      </button>
    </span>
  );
}

/**
 * Категория меню. Подпись под названием говорит не «сколько всего», а «что
 * сейчас не так»: количество в стоп-листе важнее общего числа позиций.
 */
export function PosCategoryRow({ category }: { category: PosMenuCategory }) {
  const stopped = category.stoppedCount > 0;
  return (
    <Link
      href={`/pos/menu/${category.id}`}
      className="flex h-[72px] w-full items-center gap-[12px] rounded-[14px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)] py-[12px] pl-[14px] pr-[12px]"
    >
      <span className="pos-title-m flex size-[44px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--pos-bg-surface-2)] text-[var(--pos-text-secondary)]">
        {category.name.charAt(0)}
      </span>
      <span className="flex min-w-px flex-1 flex-col gap-[3px]">
        <span className="pos-title-s w-full text-[var(--pos-text-primary)]">{category.name}</span>
        <span className="flex w-full items-center gap-[6px]">
          <span
            className="size-[7px] shrink-0 rounded-full"
            style={{
              background: stopped
                ? 'var(--pos-status-preparing)'
                : 'var(--pos-status-delivered)',
            }}
            aria-hidden="true"
          />
          <span
            className="pos-body-s min-w-px flex-1"
            style={{
              color: stopped ? 'var(--pos-status-preparing)' : 'var(--pos-text-muted)',
            }}
          >
            {category.itemCount} Artikel
            {stopped ? ` · ${category.stoppedCount} in Stop-Liste` : ''}
          </span>
        </span>
      </span>
      <PosIcon name="chevron" className="text-[var(--pos-text-muted)]" />
    </Link>
  );
}

export function PosMenuItemRow({
  item,
  onToggle,
}: {
  item: PosMenuItem;
  onToggle?: (next: boolean) => void;
}) {
  return (
    <div className="flex h-[72px] w-full items-center gap-[12px] rounded-[14px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)] px-[14px] py-[12px]">
      <span className="flex min-w-px flex-1 flex-col gap-[3px]">
        {/* Выключенная позиция гасится текстом, а не только переключателем:
            в ленте из четырнадцати строк одного тумблера мало. */}
        <span
          className={`pos-title-s w-full ${
            item.available
              ? 'text-[var(--pos-text-primary)]'
              : 'text-[var(--pos-text-muted)] line-through'
          }`}
        >
          {item.name}
        </span>
        <span className="pos-body-s w-full text-[var(--pos-text-muted)]">{item.sub}</span>
      </span>
      <PosSwitch on={item.available} onChange={onToggle} label={`${item.name} verfügbar`} />
    </div>
  );
}

/** Фильтр ленты позиций: всё / активные / в стоп-листе. */
export function PosFilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`pos-body-s flex h-[34px] shrink-0 items-center rounded-full px-[14px] ${
        active
          ? 'bg-[var(--pos-accent)] text-[var(--pos-text-on-accent)]'
          : 'border border-[var(--pos-border)] bg-[var(--pos-bg-surface-2)] text-[var(--pos-text-secondary)]'
      }`}
    >
      {label}
    </button>
  );
}

/** Выбор одного варианта в шторке. */
export function PosRadioOption({
  title,
  sub,
  selected,
  onSelect,
}: {
  title: string;
  sub: string;
  selected: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="flex w-full items-center gap-[12px] rounded-[14px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)] p-[14px] text-left"
    >
      <span
        className={`flex size-[24px] shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? 'border-[var(--pos-accent)]' : 'border-[var(--pos-border-strong)]'
        }`}
      >
        {selected && <span className="size-[9px] rounded-full bg-[var(--pos-accent)]" />}
      </span>
      <span className="flex min-w-px flex-1 flex-col gap-[2px]">
        <span className="pos-title-s text-[var(--pos-text-primary)]">{title}</span>
        <span className="pos-body-s text-[var(--pos-text-muted)]">{sub}</span>
      </span>
    </button>
  );
}
