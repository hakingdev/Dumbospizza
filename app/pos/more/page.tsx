'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PosStatusBar } from '../../../components/pos/primitives';
import { PosBottomNav } from '../../../components/pos/order-list';
import { PosSwitch } from '../../../components/pos/menu';
import { PosScreenState } from '../../../components/pos/screen-state';
import { posClock, posFetch, usePosNow, usePosResource } from '../../../components/pos/data';
import { POS_ALERT_SOUND_EVENT, posBridge } from '../../../components/pos/bridge';
import { playPosChime, stopPosChime } from '../../../components/pos/sound';
import type { PosPrintSettings } from '../../../lib/pos/settings';

/**
 * «Mehr» — настройки прибора.
 *
 * Вкладка была в макете, но вела в никуда. Содержимое выбрано по тому, за чем
 * сюда реально придут: остановить кухню и починить печать. Настройки печати
 * правит тот, кто стоит у принтера и видит бумагу, — поэтому они здесь, а не
 * только в админке.
 */

/**
 * Мост, который киоск подставляет в страницу, описан в components/pos/bridge.
 * В обычном браузере его нет — и карточек прибора тоже не будет: нажимать
 * мёртвую кнопку хуже, чем не видеть её вовсе. Проверяем не «мост вообще», а
 * каждый нужный метод: на приборе может стоять сборка apk постарше.
 */

/** Сколько звучит проверка. Полминуты рингтона на кухне никому не нужны. */
const ALERT_TEST_MS = 5_000;

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
  /** Умеет ли прибор открыть настройки сети. Проверяем после монтирования: на сервере моста нет. */
  const [hasWifi, setHasWifi] = useState(false);
  /** Умеет ли прибор выбирать и проигрывать штатный звук Android. */
  const [hasAlert, setHasAlert] = useState(false);
  /** Имя выбранного звука. `null` — прибор ещё ничего не сказал или звучать нечему. */
  const [alertName, setAlertName] = useState<string | null>(null);
  /** Таймер, который обрывает проверочный звук. */
  const testTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Уход со страницы во время проверки не должен оставить висящий таймер:
  // он оборвал бы уже настоящий сигнал.
  useEffect(() => {
    return () => {
      if (testTimer.current) clearTimeout(testTimer.current);
    };
  }, []);

  /** Спросить прибор об имени звука. Вызов синхронный, ответ — просто строка. */
  const readAlertName = useCallback(() => {
    const bridge = posBridge();
    if (typeof bridge?.alertSoundName !== 'function') return;
    try {
      const name = bridge.alertSoundName().trim();
      setAlertName(name.length > 0 ? name : null);
    } catch {
      // Мост есть, но ответить не смог — показываем «не выбран», а не старое имя:
      // соврать про звук хуже, чем признать, что не знаем.
      setAlertName(null);
    }
  }, []);

  useEffect(() => {
    const bridge = posBridge();
    setHasWifi(typeof bridge?.openWifiSettings === 'function');
    setHasAlert(typeof bridge?.pickAlertSound === 'function' && typeof bridge?.playAlert === 'function');
    readAlertName();
  }, [readAlertName]);

  /**
   * Узнать, что человек вернулся с системного выбора звука.
   *
   * Пикер — чужая Activity поверх киоска: страница не размонтируется, WebView всё
   * это время жив, и никакого «смонтировались заново» не случится. Поэтому о
   * выборе сообщает само приложение — событием POS_ALERT_SOUND_EVENT, которое
   * оно шлёт в окно, когда результат пикера дошёл до onActivityResult.
   *
   * `visibilitychange` и `focus` — страховка, а не дубль: событие приложения
   * прилетает ровно один раз, и если страница в этот момент перезагружалась
   * (WebView перезапустил её, пока пикер был открыт), слушателя в ней ещё не
   * было и событие пропало бы. Тогда имя обновится на возврате в окно.
   * Лишнее чтение не жалко — это SharedPreferences, а не сеть.
   */
  useEffect(() => {
    if (!hasAlert) return;
    const again = () => readAlertName();
    window.addEventListener(POS_ALERT_SOUND_EVENT, again);
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    return () => {
      window.removeEventListener(POS_ALERT_SOUND_EVENT, again);
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('focus', again);
    };
  }, [hasAlert, readAlertName]);

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

  /** Открыть системный выбор звука. Новое имя придёт событием, ждать здесь нечего. */
  const pickAlert = () => posBridge()?.pickAlertSound?.();

  /**
   * Проверка звука.
   *
   * Зовём тот же playPosChime, что и лента заказов, а не мост напрямую: проверять
   * надо ровно то, что зазвучит в смену, вместе с запасным сигналом. Иначе
   * проверка пройдёт, а заказ придёт молча.
   *
   * И обрываем сами через несколько секунд: выбранный рингтон бывает длиной в
   * полминуты, а на проверке хватает начала — иначе повар стоит и ждёт тишины.
   * Если ровно в эти секунды придёт настоящий заказ, ему сигнал укоротится, но
   * он тут же зазвонит снова: лента повторяет звонок, пока заказ не приняли.
   */
  const testAlert = () => {
    if (testTimer.current) clearTimeout(testTimer.current);
    playPosChime();
    testTimer.current = setTimeout(stopPosChime, ALERT_TEST_MS);
  };

  return (
    <>
      <PosStatusBar time={posClock(nowMs)} />

      <header className="flex h-[56px] w-full shrink-0 items-center gap-[8px] bg-[var(--pos-bg-base)] py-[6px] pl-[16px] pr-[4px]">
        <span className="pos-title-m text-[var(--pos-text-primary)]">Mehr</span>
      </header>

      <div className="pos-scroll flex min-h-px w-full flex-1 flex-col gap-[12px] px-[16px] pb-[14px] pt-[6px]">
        <PosScreenState state={state} onRetry={refresh} />

        {hasWifi && (
          <Card title="GERÄT-NETZWERK">
            <button
              type="button"
              onClick={() => posBridge()?.openWifiSettings?.()}
              className="pos-label-m flex h-[48px] w-full items-center justify-center rounded-[12px] border border-[var(--pos-border-strong)] bg-[var(--pos-bg-surface-2)] text-[var(--pos-text-primary)]"
            >
              WLAN einrichten
            </button>
            <span className="pos-body-s text-[var(--pos-text-muted)]">
              Öffnet die Netzwerkauswahl des Geräts. Danach zurück mit der Zurück-Taste.
            </span>
          </Card>
        )}

        {hasAlert && (
          <Card title="SIGNAL">
            <div className="flex w-full flex-col gap-[2px]">
              <span className="pos-title-s text-[var(--pos-text-primary)]">Ton bei neuer Bestellung</span>
              {/* Пусто — на приборе не нашлось ни одного пригодного звука, и
                  зазвучит встроенный сигнал страницы. Пишем это прямо: «—»
                  человек прочитал бы как «звука не будет». */}
              <span className="pos-body-s text-[var(--pos-text-muted)]">{alertName ?? 'Internes Signal'}</span>
            </div>
            <button
              type="button"
              onClick={pickAlert}
              className="pos-label-m flex h-[48px] w-full items-center justify-center rounded-[12px] border border-[var(--pos-border-strong)] bg-[var(--pos-bg-surface-2)] text-[var(--pos-text-primary)]"
            >
              Ton auswählen
            </button>
            <button
              type="button"
              onClick={testAlert}
              className="pos-label-m flex h-[48px] w-full items-center justify-center rounded-[12px] border border-[var(--pos-border-strong)] bg-[var(--pos-bg-surface-2)] text-[var(--pos-text-primary)]"
            >
              Ton testen
            </button>
            <span className="pos-body-s text-[var(--pos-text-muted)]">
              Nach der Auswahl zurück mit der Zurück-Taste. Der Ton wiederholt sich alle 10 Sekunden, bis
              die Bestellung angenommen ist.
            </span>
          </Card>
        )}

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
