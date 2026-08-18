'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  PosAppBar,
  PosButton,
  PosSheet,
  PosStatusBar,
} from '../../../../components/pos/primitives';
import { PosBottomNav } from '../../../../components/pos/order-list';
import {
  PosFilterChip,
  PosMenuItemRow,
  PosRadioOption,
  PosSwitch,
} from '../../../../components/pos/menu';
import { PosScreenState } from '../../../../components/pos/screen-state';
import {
  posClock,
  posSetAvailability,
  usePosMenuCategory,
  usePosNow,
  type PosMenuItem,
} from '../../../../components/pos/data';

/**
 * 10 · Speisekarte · Artikel и 11 · Sheet · Artikel in Stop-Liste
 * (Figma 15:588, 16:644).
 *
 * Выключение позиции — действие с последствиями: она мгновенно исчезает из
 * сайта, приложения и приёма заказов. Поэтому выключение проходит через шторку
 * с выбором объёма, а включение обратно — сразу, одним касанием: вернуть
 * доступность безопасно, убрать — нет.
 *
 * Гасится то же поле `available` (и `sizes[].active`), которым управляет
 * админка, — своего стоп-листа у кухни нет, иначе он разошёлся бы с витриной.
 */

type Filter = 'all' | 'active' | 'stopped';

/** Что именно гасим: всё блюдо или один его размер. */
const WHOLE_ITEM = 'all';

export default function MenuCategoryPage() {
  const router = useRouter();
  const params = useParams<{ category: string }>();
  const { state, refresh, skewRef } = usePosMenuCategory(params.category);
  const nowMs = usePosNow(skewRef, 30_000);

  const [filter, setFilter] = useState<Filter>('all');
  const [pending, setPending] = useState<PosMenuItem | null>(null);
  const [scope, setScope] = useState<string>(WHOLE_ITEM);
  const [busy, setBusy] = useState(false);

  const data = state.status === 'ready' ? state.data : null;
  const items = data?.items ?? [];

  const counts = useMemo(
    () => ({
      all: items.length,
      active: items.filter((i) => i.available).length,
      stopped: items.filter((i) => !i.available).length,
    }),
    [items]
  );

  const visible = items.filter((i) =>
    filter === 'all' ? true : filter === 'active' ? i.available : !i.available
  );

  const apply = async (body: Parameters<typeof posSetAvailability>[0]) => {
    if (busy) return;
    setBusy(true);
    await posSetAvailability(body);
    await refresh();
    setBusy(false);
    setPending(null);
  };

  const handleToggle = (item: PosMenuItem, next: boolean) => {
    // Включение — сразу. Выключение спрашивает объём: у пиццы гасят размер,
    // а не всё блюдо, и ошибиться здесь дороже, чем лишний раз нажать.
    if (next) apply({ productId: item.id, available: true });
    else {
      setScope(WHOLE_ITEM);
      setPending(item);
    }
  };

  const confirmStop = () => {
    if (!pending) return;
    if (scope === WHOLE_ITEM) apply({ productId: pending.id, available: false });
    else apply({ productId: pending.id, sizeId: scope, active: false });
  };

  const toggleWholeCategory = (next: boolean) =>
    // Категорию переключаем по одной позиции: массового маршрута нет намеренно,
    // а полтора десятка запросов на редкое действие дешевле лишнего эндпойнта.
    Promise.all(items.map((item) => posSetAvailability({ productId: item.id, available: next })))
      .then(refresh);

  return (
    <>
      <PosStatusBar time={posClock(nowMs)} />
      <PosAppBar title={data?.name ?? 'Artikel'} onBack={() => router.push('/pos/menu')} />

      <div className="pos-scroll flex min-h-px w-full flex-1 flex-col gap-[12px] px-[16px] pb-[14px] pt-[6px]">
        <PosScreenState state={state} onRetry={refresh} />

        <div className="flex w-full gap-[8px]">
          <PosFilterChip
            label={`Alle ${counts.all}`}
            active={filter === 'all'}
            onClick={() => setFilter('all')}
          />
          <PosFilterChip
            label={`Aktiv ${counts.active}`}
            active={filter === 'active'}
            onClick={() => setFilter('active')}
          />
          <PosFilterChip
            label={`Stop-Liste ${counts.stopped}`}
            active={filter === 'stopped'}
            onClick={() => setFilter('stopped')}
          />
        </div>

        <div className="flex w-full items-center gap-[12px] rounded-[14px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)] p-[14px]">
          <span className="flex min-w-px flex-1 flex-col gap-[2px]">
            <span className="pos-title-s text-[var(--pos-text-primary)]">Ganze Kategorie</span>
            <span className="pos-body-s text-[var(--pos-text-muted)]">
              Schaltet alle {counts.all} Artikel auf einmal
            </span>
          </span>
          <PosSwitch
            on={counts.active > 0}
            label="Ganze Kategorie verfügbar"
            onChange={toggleWholeCategory}
          />
        </div>

        {visible.map((item) => (
          <PosMenuItemRow
            key={item.id}
            item={item}
            onToggle={(next) => handleToggle(item, next)}
          />
        ))}

        {data && visible.length === 0 && (
          <p className="pos-body-m w-full pt-[24px] text-center text-[var(--pos-text-muted)]">
            Keine Artikel in dieser Auswahl.
          </p>
        )}
      </div>

      <PosSheet
        open={pending !== null}
        title={`${pending?.name ?? ''} in die Stop-Liste?`}
        subtitle="Verschwindet sofort aus Web, App und Bestellannahme."
        onClose={() => setPending(null)}
        actions={
          <>
            <PosButton label="Abbrechen" variant="ghost" onClick={() => setPending(null)} />
            <PosButton label="In Stop-Liste" disabled={busy} onClick={confirmStop} />
          </>
        }
      >
        <span className="pos-overline text-[var(--pos-text-muted)]">WAS AUSSCHALTEN?</span>
        <div role="radiogroup" className="flex w-full flex-col gap-[8px]">
          <PosRadioOption
            title="Ganzer Artikel"
            sub="Alle Größen und Varianten"
            selected={scope === WHOLE_ITEM}
            onSelect={() => setScope(WHOLE_ITEM)}
          />
          {(pending?.sizes ?? []).map((size) => (
            <PosRadioOption
              key={size.id}
              title={`Nur ${size.name}`}
              sub={`${size.price} · andere Größen bleiben bestellbar`}
              selected={scope === size.id}
              onSelect={() => setScope(size.id)}
            />
          ))}
        </div>
        <p className="pos-body-s w-full rounded-[12px] bg-[var(--pos-bg-surface-2)] p-[12px] text-[var(--pos-text-muted)]">
          Keine automatische Rückkehr: der Artikel bleibt aus, bis Sie ihn wieder aktivieren.
        </p>
      </PosSheet>

      <PosBottomNav active="menu" />
    </>
  );
}
