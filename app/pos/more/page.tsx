'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PosStatusBar } from '../../../components/pos/primitives';
import { PosBottomNav } from '../../../components/pos/order-list';
import { PosSwitch } from '../../../components/pos/menu';
import { PosScreenState } from '../../../components/pos/screen-state';
import { posClock, posFetch, usePosNow, usePosResource } from '../../../components/pos/data';
import type { PosPrintSettings } from '../../../lib/pos/settings';

/**
 * «Mehr» — настройки прибора.
 *
 * Вкладка была в макете, но вела в никуда. Содержимое выбрано по тому, за чем
 * сюда реально придут: остановить кухню и починить печать. Настройки печати
 * правит тот, кто стоит у принтера и видит бумагу, — поэтому они здесь, а не
 * только в админке.
 */

interface PosSettingsView {
  settings: PosPrintSettings;
  signedInAs: string | null;
}

/** Строка с переключателем. */
function SettingRow({
  title,
  sub,
  on,
  disabled,
  onChange,
}: {
  title: string;
  sub: string;
  on: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex w-full items-center gap-[12px]">
      <span className="flex min-w-px flex-1 flex-col gap-[2px]">
        <span className="pos-title-s text-[var(--pos-text-primary)]">{title}</span>
        <span className="pos-body-s text-[var(--pos-text-muted)]">{sub}</span>
      </span>
      <span className={disabled ? 'opacity-50' : ''}>
        <PosSwitch on={on} label={title} onChange={disabled ? undefined : onChange} />
      </span>
    </div>
  );
}

/** Число с шагом ±1. Клавиатуры на кухне нет, а перчатки есть. */
function SettingStep({
  title,
  sub,
  value,
  min,
  max,
  suffix = '',
  disabled,
  onChange,
}: {
  title: string;
  sub: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const step = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));
  return (
    <div className="flex w-full items-center gap-[12px]">
      <span className="flex min-w-px flex-1 flex-col gap-[2px]">
        <span className="pos-title-s text-[var(--pos-text-primary)]">{title}</span>
        <span className="pos-body-s text-[var(--pos-text-muted)]">{sub}</span>
      </span>
      <span className="flex shrink-0 items-center gap-[8px]">
        <button
          type="button"
          disabled={disabled || value <= min}
          onClick={() => step(-1)}
          className="pos-title-m flex size-[44px] items-center justify-center rounded-[12px] border border-[var(--pos-border-strong)] bg-[var(--pos-bg-surface-2)] text-[var(--pos-text-primary)] disabled:opacity-40"
        >
          −
        </button>
        <span className="pos-label-l pos-num w-[46px] text-center text-[var(--pos-text-primary)]">
          {value}
          {suffix}
        </span>
        <button
          type="button"
          disabled={disabled || value >= max}
          onClick={() => step(1)}
          className="pos-title-m flex size-[44px] items-center justify-center rounded-[12px] border border-[var(--pos-border-strong)] bg-[var(--pos-bg-surface-2)] text-[var(--pos-text-primary)] disabled:opacity-40"
        >
          +
        </button>
      </span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-[12px] rounded-[16px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)] p-[14px]">
      <span className="pos-overline text-[var(--pos-text-muted)]">{title}</span>
      {children}
    </div>
  );
}

export default function MorePage() {
  const { state, refresh, skewRef } = usePosResource<PosSettingsView, PosSettingsView>(
    '/api/pos/v1/settings',
    (raw) => raw,
    30_000
  );
  const nowMs = usePosNow(skewRef, 30_000);
  const [busy, setBusy] = useState(false);

  const view = state.status === 'ready' ? state.data : null;
  const s = view?.settings;

  /**
   * Сохраняем сразу, без кнопки «применить»: настроек мало, каждая — один
   * переключатель, а забытая кнопка означала бы, что человек ушёл, думая, что
   * поменял, а печать осталась прежней.
   */
  const save = async (patch: Partial<PosPrintSettings>) => {
    if (busy) return;
    setBusy(true);
    await posFetch('/api/pos/v1/settings', { method: 'PATCH', body: JSON.stringify(patch) });
    await refresh();
    setBusy(false);
  };

  return (
    <>
      <PosStatusBar time={posClock(nowMs)} />

      <header className="flex h-[56px] w-full shrink-0 items-center gap-[8px] bg-[var(--pos-bg-base)] py-[6px] pl-[16px] pr-[4px]">
        <span className="pos-title-m text-[var(--pos-text-primary)]">Mehr</span>
      </header>

      <div className="pos-scroll flex min-h-px w-full flex-1 flex-col gap-[12px] px-[16px] pb-[14px] pt-[6px]">
        <PosScreenState state={state} onRetry={refresh} />

        <Card title="KÜCHE">
          <Link
            href="/pos/kitchen"
            className="pos-label-m flex h-[48px] w-full items-center justify-center rounded-[12px] border border-[var(--pos-border-strong)] bg-[var(--pos-bg-surface-2)] text-[var(--pos-text-primary)]"
          >
            Küchen-Status
          </Link>
          <Link
            href="/pos/kitchen/stop"
            className="pos-label-m flex h-[48px] w-full items-center justify-center rounded-[12px] border border-[var(--pos-border-strong)] bg-[var(--pos-bg-surface-2)] text-[var(--pos-text-primary)]"
          >
            Küche stoppen
          </Link>
        </Card>

        {s && (
          <Card title="DRUCK">
            <SettingRow
              title="Automatisch drucken"
              sub="Neue Bestellungen gehen sofort auf den Bondrucker"
              on={s.enabled}
              disabled={busy}
              onChange={(enabled) => save({ enabled })}
            />
            <span className="h-px w-full bg-[var(--pos-border)]" />
            <SettingStep
              title="Kopien"
              sub="Wie oft jeder Bon gedruckt wird"
              value={s.copies}
              min={1}
              max={3}
              disabled={busy}
              onChange={(copies) => save({ copies })}
            />
            <span className="h-px w-full bg-[var(--pos-border)]" />
            <SettingStep
              title="Vorschub"
              sub="Leerzeilen am Ende — das Gerät hat kein Messer"
              value={s.feedLines}
              min={0}
              max={12}
              disabled={busy}
              onChange={(feedLines) => save({ feedLines })}
            />
            <span className="h-px w-full bg-[var(--pos-border)]" />
            <SettingRow
              title="Fett drucken"
              sub="Nur nötig, wenn der Druck zu blass ist"
              on={s.boldBody}
              disabled={busy}
              onChange={(boldBody) => save({ boldBody })}
            />
            <span className="h-px w-full bg-[var(--pos-border)]" />
            <SettingRow
              title="Große Überschriften"
              sub="Kategorien, Bestellart und HINWEIS doppelt hoch"
              on={s.bigAccents}
              disabled={busy}
              onChange={(bigAccents) => save({ bigAccents })}
            />
          </Card>
        )}

        {s && (
          <Card title="GERÄT">
            {/* Ширину не даём трогать с прибора: 32 колонки измерены печатью
                линейки, а не взяты из справочника, и промах здесь разъезжает
                весь чек. Меняется в админке, если однажды сменится принтер. */}
            <div className="flex w-full flex-col gap-[6px]">
              <span className="pos-body-m text-[var(--pos-text-secondary)]">
                Bonbreite: {s.width} Zeichen
              </span>
              <span className="pos-body-m text-[var(--pos-text-secondary)]">
                Abfrage alle {Math.round(s.pollMs / 1000)} s
              </span>
              <span className="pos-body-m text-[var(--pos-text-secondary)]">
                Angemeldet als {view?.signedInAs ?? '—'}
              </span>
            </div>
            <a
              href="/api/auth/signout?callbackUrl=/pos/orders"
              className="pos-label-m flex h-[48px] w-full items-center justify-center rounded-[12px] border border-[var(--pos-status-cancelled)] text-[var(--pos-status-cancelled)]"
            >
              Abmelden
            </a>
          </Card>
        )}
      </div>

      <PosBottomNav active="more" />
    </>
  );
}
