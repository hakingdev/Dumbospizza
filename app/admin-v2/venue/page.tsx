'use client';

/** Заведение: приём заказов, часы, зоны, инфо (канвы D4 / 05). */

import { useEffect, useMemo, useState } from 'react';
import {
  AdminZone,
  patchStoreSettings,
  saveDeliveryZone,
  useDeliveryZones,
  useStoreSettings,
} from '../../../components/admin-v2/hooks';
import { euro, timeHHmm } from '../../../components/admin-v2/format';
import {
  Card,
  LoadError,
  Loading,
  SectionLabel,
  Toggle,
  btnGhost,
  btnOutline,
  btnPrimary,
} from '../../../components/admin-v2/ui';
import { WeeklyScheduleEditor } from '../../../components/admin-v2/weekly-schedule-editor';
import { getNowMinutesInTimeZone } from '../../../lib/order-acceptance-hours';
import {
  WEEKDAY_KEYS,
  type OrderHoursState,
  formatNextOpeningDay,
  getOrderHoursState,
  rangeEndMinutes,
  resolveWeeklySchedule,
  scheduleBounds,
  validateWeeklySchedule,
  weekdayLabel,
  weeklySchedulesEqual,
} from '../../../lib/opening-schedule';

const ZONE_COLORS = ['#B8956B', '#C9AC82', '#DCC9A9', '#EBE0CE', '#9A7A56', '#7C6145'];

/** «2 ч 48 мин» / «15 мин». */
function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}

/** Строка статуса под баннером приёма: где мы сейчас в графике дня. */
function describeHoursState(state: OrderHoursState, timeZone: string, now: Date): string {
  if (state.open && state.current) {
    const left = rangeEndMinutes(state.current) - getNowMinutesInTimeZone(timeZone, now);
    const later = state.todayRanges.find((r) => r.start > state.current!.start);
    return (
      `Закрытие через ${formatDuration(Math.max(left, 0))} · сегодня до ${state.current.end}` +
      (later ? ` · затем ${later.start}–${later.end}` : '')
    );
  }
  const next = state.nextOpening;
  if (!next) return 'В графике нет рабочих дней — заказы не принимаются';
  if (next.daysAhead === 0) {
    const hadShift = state.todayRanges.some((r) => r.start < next.time);
    return hadShift ? `Перерыв · откроемся в ${next.time}` : `Сегодня откроемся в ${next.time}`;
  }
  const today = state.todayRanges.length ? 'Сегодня приём окончен' : 'Сегодня выходной';
  return `${today} · откроемся ${formatNextOpeningDay(next, 'ru')} в ${next.time}`;
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-bold leading-5 text-gray-900">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 rounded-xl border border-gray-300 bg-white px-4 text-base leading-6 text-gray-900 outline-none transition focus:border-[#8A6C4C]"
      />
    </label>
  );
}

export default function VenuePage() {
  const store = useStoreSettings();
  const zonesState = useDeliveryZones();
  const [busyZone, setBusyZone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [halloweenBusy, setHalloweenBusy] = useState(false);
  /* Режимы «Изменить» карточек (D4): в покое — тихие списки значений */
  const [editHours, setEditHours] = useState(false);
  const [editInfo, setEditInfo] = useState(false);

  /** Редактируемые поля — инициализация от настроек. */
  const [form, setForm] = useState({
    schedule: resolveWeeklySchedule(null),
    phone: '',
    email: '',
    deliveryTime: '',
    freeDeliveryThreshold: '',
  });
  const [initialized, setInitialized] = useState(false);

  const formFromSettings = (settings: NonNullable<typeof store.settings>) => ({
    schedule: resolveWeeklySchedule(settings),
    phone: settings.phone || '',
    email: settings.email || settings.contactEmail || '',
    deliveryTime: settings.deliveryTime || '',
    freeDeliveryThreshold: String(settings.freeDeliveryThreshold ?? ''),
  });

  useEffect(() => {
    if (store.settings && !initialized) {
      setForm(formFromSettings(store.settings));
      setInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.settings, initialized]);

  const dirty = useMemo(() => {
    if (!store.settings || !initialized) return false;
    return (
      !weeklySchedulesEqual(form.schedule, resolveWeeklySchedule(store.settings)) ||
      form.phone !== (store.settings.phone || '') ||
      form.email !== (store.settings.email || store.settings.contactEmail || '') ||
      form.deliveryTime !== (store.settings.deliveryTime || '') ||
      form.freeDeliveryThreshold !== String(store.settings.freeDeliveryThreshold ?? '')
    );
  }, [form, store.settings, initialized]);

  const blockedUntil = store.settings?.ordersBlockedUntil
    ? new Date(store.settings.ordersBlockedUntil)
    : null;
  const isBlocked = !!blockedUntil && blockedUntil.getTime() > Date.now();
  const blockMinutes = Number(store.settings?.ordersBlockMinutes) || 30;

  /* Статус по СОХРАНЁННОМУ графику (не по черновику формы); тикает раз в минуту. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const timeZone = store.settings?.ordersTimeZone || 'Europe/Berlin';
  const hoursState = useMemo(
    () => getOrderHoursState(resolveWeeklySchedule(store.settings), timeZone, now),
    [store.settings, timeZone, now]
  );
  const hoursLine = describeHoursState(hoursState, timeZone, now);
  const scheduleErrors = useMemo(() => validateWeeklySchedule(form.schedule).errors, [form.schedule]);

  const handleSave = async () => {
    const { schedule, errors } = validateWeeklySchedule(form.schedule);
    if (!schedule || errors.length) {
      setEditHours(true);
      alert('В графике работы есть ошибки — исправьте отмеченные интервалы');
      return;
    }
    // Старые поля держим как «самое раннее / самое позднее» — фолбэк без графика.
    const bounds = scheduleBounds(schedule);
    setSaving(true);
    const ok = await patchStoreSettings({
      ordersWeeklySchedule: schedule,
      ...(bounds ? { ordersStartHour: bounds.start, ordersEndHour: bounds.end } : {}),
      phone: form.phone,
      email: form.email,
      deliveryTime: form.deliveryTime,
      freeDeliveryThreshold: form.freeDeliveryThreshold
        ? Number(form.freeDeliveryThreshold.replace(',', '.'))
        : null,
    });
    setSaving(false);
    if (!ok) {
      alert('Не удалось сохранить (нужны права администратора)');
      return;
    }
    store.reload();
  };

  const handlePauseToggle = async () => {
    setPauseBusy(true);
    let ok: boolean;
    if (isBlocked) {
      ok = await patchStoreSettings({ ordersBlockedUntil: null, ordersBlockedReason: null });
    } else {
      if (!confirm(`Приостановить приём заказов на ${blockMinutes} минут?`)) {
        setPauseBusy(false);
        return;
      }
      const until = new Date(Date.now() + blockMinutes * 60000).toISOString();
      ok = await patchStoreSettings({
        ordersBlockedUntil: until,
        ordersBlockedReason: 'Приостановлено из портала',
      });
    }
    setPauseBusy(false);
    if (!ok) {
      alert('Не удалось изменить приём заказов (нужны права администратора)');
      return;
    }
    store.reload();
  };

  const handleHalloweenToggle = async (next: boolean) => {
    setHalloweenBusy(true);
    const ok = await patchStoreSettings({ halloweenMode: next });
    setHalloweenBusy(false);
    if (!ok) {
      alert('Не удалось переключить Halloween-режим (нужны права администратора)');
      return;
    }
    store.reload();
  };

  const toggleZone = async (zone: AdminZone, next: boolean) => {
    setBusyZone(zone._id);
    const ok = await saveDeliveryZone({ ...zone, active: next });
    if (!ok) alert('Не удалось обновить зону (нужны права администратора)');
    zonesState.reload();
    setBusyZone(null);
  };

  const subtitle = [store.settings?.storeName || 'Dumbos Pizza', store.settings?.address]
    .filter(Boolean)
    .join(' · ');

  /* Радиус зоны как диапазон «0–3 км»: нижняя граница — max предыдущей зоны */
  const zoneRows = useMemo(() => {
    const sorted = [...zonesState.zones].sort(
      (a, b) => (Number(a.maxDistance) || Infinity) - (Number(b.maxDistance) || Infinity)
    );
    let prev = 0;
    return sorted.map((zone) => {
      const max = Number(zone.maxDistance) || 0;
      const range = max ? `${prev}–${max} км` : '—';
      if (max) prev = max;
      return { zone, range };
    });
  }, [zonesState.zones]);

  /*
   * Вся страница управляет настройками магазина — без них рендерить формы
   * с пустыми/дефолтными значениями опасно (ложный статус приёма, «смена –»).
   */
  if (!store.settings) {
    return (
      <div className="flex flex-col gap-4 p-4 pt-6 lg:gap-6 lg:p-0">
        <h1 className="m-0 text-[32px] font-extrabold leading-[38px] tracking-[-.02em] text-gray-900">
          Заведение
        </h1>
        {store.loading ? (
          <Loading />
        ) : (
          <LoadError
            title="Настройки заведения не загрузились"
            detail={store.error}
            onRetry={store.reload}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 pt-6 lg:gap-6 lg:p-0">
      {/* Заголовок */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[32px] font-extrabold leading-[38px] tracking-[-.02em] text-gray-900">
            Заведение
          </h1>
          <p className="m-0 text-base leading-6 text-gray-600">{subtitle}</p>
        </div>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={handleSave}
          className={`${btnPrimary} hidden h-12 px-6 text-lg lg:inline-flex`}
        >
          {saving ? 'Сохраняем…' : 'Сохранить изменения'}
        </button>
      </div>

      {/* Приём заказов: мобилка — карточка с тумблером, десктоп — статус-баннер (D4) */}
      <Card className="flex items-center gap-3 p-4 lg:hidden">
        <span
          className="h-2 w-2 flex-none rounded-full"
          style={{ background: isBlocked ? '#D42A47' : '#15803D' }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold leading-6 text-gray-900">
            {isBlocked
              ? `Приём приостановлен до ${timeHHmm(blockedUntil!)}`
              : 'Приём заказов включён'}
          </div>
          <div className="text-sm leading-5 text-gray-600">
            {isBlocked
              ? store.settings?.ordersBlockedReason || 'Пауза, включится автоматически'
              : hoursLine}
          </div>
        </div>
        <Toggle
          on={!isBlocked}
          busy={pauseBusy}
          label={isBlocked ? 'Возобновить приём' : 'Приостановить приём'}
          onChange={handlePauseToggle}
        />
      </Card>
      <div
        className={`hidden items-center gap-6 rounded-2xl border px-6 py-5 lg:flex ${
          isBlocked ? 'border-[#D42A47] bg-[#FDE6E7]' : 'border-[#15803D] bg-[#DCFCE7]'
        }`}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-lg font-bold leading-6 text-gray-900">
            {isBlocked
              ? `Приём приостановлен до ${timeHHmm(blockedUntil!)}`
              : 'Приём заказов включён'}
          </span>
          <span className="text-sm leading-5 text-gray-600">
            {isBlocked
              ? store.settings?.ordersBlockedReason || 'Пауза, включится автоматически'
              : hoursLine}
          </span>
        </div>
        <button
          type="button"
          disabled={pauseBusy}
          onClick={handlePauseToggle}
          className={`${btnOutline} h-10 min-w-[96px] flex-none px-4 text-base`}
        >
          {isBlocked ? 'Возобновить приём' : 'Приостановить приём'}
        </button>
      </div>

      {/* Halloween-оформление витрины: переключается сразу, без кнопки «Сохранить» */}
      <Card className="flex items-center gap-3 p-4 lg:px-6 lg:py-5">
        <span className="flex-none text-2xl leading-none" aria-hidden="true">🎃</span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold leading-6 text-gray-900 lg:text-lg">Halloween-режим</div>
          <div className="text-sm leading-5 text-gray-600">
            {store.settings?.halloweenMode
              ? 'Включён: ночная витрина, мыши, огонь на карточках, звук'
              : 'Выключен: обычный дизайн витрины'}
          </div>
        </div>
        <Toggle
          on={!!store.settings?.halloweenMode}
          busy={halloweenBusy}
          label={store.settings?.halloweenMode ? 'Выключить Halloween-режим' : 'Включить Halloween-режим'}
          onChange={handleHalloweenToggle}
        />
      </Card>

      <div className="flex flex-col items-start gap-4 lg:gap-6 xl:flex-row">
        {/* Часы работы */}
        <Card className="flex w-full flex-col gap-3 p-4 lg:p-6 xl:w-[400px] xl:flex-none">
          <div className="flex items-center gap-3">
            <h2 className="m-0 min-w-0 flex-1 text-xl font-extrabold leading-7 tracking-[-.01em] text-gray-900 lg:text-2xl lg:leading-[30px]">
              Часы работы
            </h2>
            <button
              type="button"
              onClick={() => setEditHours((v) => !v)}
              className={`${btnGhost} h-8 min-w-[96px] flex-none px-3 text-sm leading-5`}
            >
              {editHours ? 'Готово' : 'Изменить'}
            </button>
          </div>
          {editHours ? (
            <WeeklyScheduleEditor
              value={form.schedule}
              onChange={(schedule) => setForm({ ...form, schedule })}
              errors={scheduleErrors}
              today={hoursState.today}
            />
          ) : (
            WEEKDAY_KEYS.map((day) => {
              const ranges = form.schedule[day];
              const isToday = day === hoursState.today;
              return (
                <div key={day} className="flex min-h-11 items-center gap-3 py-1">
                  <span
                    className={`min-w-0 flex-1 text-base leading-6 ${
                      isToday ? 'font-bold text-[#7C6145]' : 'text-gray-900'
                    }`}
                  >
                    {weekdayLabel(day, 'ru')}
                  </span>
                  {ranges.length ? (
                    <span className="flex flex-none flex-col items-end text-base font-bold leading-6 text-gray-900 tabular-nums">
                      {ranges.map((r) => (
                        <span key={`${r.start}-${r.end}`}>
                          {r.start} – {r.end}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="flex-none text-base leading-6 text-gray-500">Выходной</span>
                  )}
                </div>
              );
            })
          )}
        </Card>

        <div className="flex w-full min-w-0 flex-col gap-4 lg:gap-6 xl:flex-1">
          {/* Зоны доставки */}
          <Card className="flex flex-col gap-3 p-4 lg:p-6">
            <div className="flex items-center gap-3">
              <h2 className="m-0 min-w-0 flex-1 text-xl font-extrabold leading-7 tracking-[-.01em] text-gray-900 lg:text-2xl lg:leading-[30px]">
                Зоны доставки
              </h2>
              <a
                href="/admin/delivery-zones"
                className={`${btnGhost} h-8 min-w-[96px] flex-none px-3 text-sm leading-5 no-underline`}
              >
                Добавить зону
              </a>
            </div>

            {/* Десктоп: таблица */}
            <div className="hidden flex-col lg:flex">
              <div className="flex items-center gap-3 pb-2 text-xs font-bold uppercase leading-4 tracking-[.04em] text-gray-600">
                <span className="min-w-0 flex-1">Зона</span>
                <span className="w-[100px] flex-none">Радиус</span>
                <span className="w-[110px] flex-none text-right">Доставка</span>
                <span className="w-[120px] flex-none text-right">Мин. заказ</span>
                <span className="w-[60px] flex-none text-right">Вкл.</span>
              </div>
              {zonesState.loading && !zonesState.data ? (
                <Loading />
              ) : zonesState.error && !zonesState.data ? (
                <LoadError
                  framed={false}
                  title="Зоны доставки не загрузились"
                  detail={zonesState.error}
                  onRetry={zonesState.reload}
                />
              ) : (
                zoneRows.map(({ zone, range }) => (
                  <div
                    key={zone._id}
                    className="flex items-center gap-3 border-t border-gray-200 py-2"
                  >
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold leading-6 text-gray-900">
                      {zone.name}
                    </span>
                    <span className="w-[100px] flex-none text-base leading-6 text-gray-600 tabular-nums">
                      {range}
                    </span>
                    <span className="w-[110px] flex-none text-right text-base font-bold leading-6 text-gray-900 tabular-nums">
                      {euro(zone.deliveryFee)}
                    </span>
                    <span className="w-[120px] flex-none text-right text-base leading-6 text-gray-600 tabular-nums">
                      {euro(zone.minOrderAmount)}
                    </span>
                    <span className="flex w-[60px] flex-none justify-end">
                      <Toggle
                        on={zone.active}
                        busy={busyZone === zone._id}
                        label={zone.active ? 'Выключить зону' : 'Включить зону'}
                        onChange={(next) => toggleZone(zone, next)}
                      />
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Мобилка: карточки зон */}
            <div className="flex flex-col gap-3 lg:hidden">
              {zonesState.loading && !zonesState.data ? (
                <Loading />
              ) : zonesState.error && !zonesState.data ? (
                <LoadError
                  framed={false}
                  title="Зоны доставки не загрузились"
                  detail={zonesState.error}
                  onRetry={zonesState.reload}
                />
              ) : (
                zonesState.zones.map((zone, i) => (
                  <div
                    key={zone._id}
                    className="flex flex-col gap-3 rounded-2xl border border-gray-200 p-4"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 flex-none rounded"
                        style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }}
                      />
                      <span className="min-w-0 flex-1 text-lg font-bold leading-6 text-gray-900">
                        {zone.name}
                      </span>
                      <Toggle
                        on={zone.active}
                        busy={busyZone === zone._id}
                        label={zone.active ? 'Выключить зону' : 'Включить зону'}
                        onChange={(next) => toggleZone(zone, next)}
                      />
                    </div>
                    <div className="flex gap-6">
                      <div>
                        <SectionLabel>Радиус</SectionLabel>
                        <div className="text-base font-bold leading-6 text-gray-900 tabular-nums">
                          {zone.maxDistance ? `до ${zone.maxDistance} км` : '—'}
                        </div>
                      </div>
                      <div>
                        <SectionLabel>Доставка</SectionLabel>
                        <div className="text-base font-bold leading-6 text-gray-900 tabular-nums">
                          {euro(zone.deliveryFee)}
                        </div>
                      </div>
                      <div>
                        <SectionLabel>Мин. заказ</SectionLabel>
                        <div className="text-base font-bold leading-6 text-gray-900 tabular-nums">
                          {euro(zone.minOrderAmount)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Инфо */}
          <Card className="flex flex-col gap-3 p-4 lg:p-6">
            <div className="flex items-center gap-3">
              <h2 className="m-0 min-w-0 flex-1 text-xl font-extrabold leading-7 tracking-[-.01em] text-gray-900 lg:text-2xl lg:leading-[30px]">
                Инфо
              </h2>
              <button
                type="button"
                onClick={() => setEditInfo((v) => !v)}
                className={`${btnGhost} h-8 min-w-[96px] flex-none px-3 text-sm leading-5`}
              >
                {editInfo ? 'Готово' : 'Изменить'}
              </button>
            </div>
            {editInfo ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Field
                  label="Телефон"
                  value={form.phone}
                  onChange={(phone) => setForm({ ...form, phone })}
                  placeholder="+49 971 …"
                />
                <Field
                  label="E-Mail"
                  value={form.email}
                  onChange={(email) => setForm({ ...form, email })}
                  placeholder="info@dumbospizza.de"
                />
                <Field
                  label="Среднее время доставки"
                  value={form.deliveryTime}
                  onChange={(deliveryTime) => setForm({ ...form, deliveryTime })}
                  placeholder="30–60 Minuten"
                />
                <Field
                  label="Бесплатная доставка от, €"
                  value={form.freeDeliveryThreshold}
                  onChange={(freeDeliveryThreshold) => setForm({ ...form, freeDeliveryThreshold })}
                  placeholder="30"
                />
              </div>
            ) : (
              <>
                {[
                  { label: 'Телефон', value: form.phone || '—' },
                  { label: 'E-Mail', value: form.email || '—' },
                  { label: 'Среднее время доставки', value: form.deliveryTime || '—' },
                  {
                    label: 'Бесплатная доставка от',
                    value: form.freeDeliveryThreshold
                      ? euro(Number(form.freeDeliveryThreshold.replace(',', '.')))
                      : '—',
                  },
                ].map((row) => (
                  <div key={row.label} className="flex h-11 items-center gap-3 text-base leading-6">
                    <span className="min-w-0 flex-1 text-gray-600">{row.label}</span>
                    <span className="flex-none font-bold text-gray-900 tabular-nums">
                      {row.value}
                    </span>
                  </div>
                ))}
              </>
            )}
          </Card>
        </div>
      </div>

      {/*
       * Мобилка: фикс-бар сохранения над таб-баром (72px) — как в «Настройках».
       * НЕ sticky: bottom-sticky на телефонах (Safari + overflow-x на html/body)
       * не прилипает к вьюпорту, и кнопку было не найти — баг-репорт №2.
       */}
      {dirty && (
        <div className="fixed inset-x-0 bottom-[72px] z-40 flex items-center gap-3 bg-white px-4 py-3 shadow-[0_-2px_12px_rgba(17,24,39,.08)] lg:hidden">
          <button
            type="button"
            onClick={() => store.settings && setForm(formFromSettings(store.settings))}
            className="h-12 cursor-pointer whitespace-nowrap rounded-xl border-none bg-transparent px-4 text-base font-bold leading-5 text-gray-900 transition hover:bg-[#FAF7F2]"
          >
            Отменить
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className={`${btnPrimary} h-12 flex-1 text-lg`}
          >
            {saving ? 'Сохраняем…' : 'Сохранить изменения'}
          </button>
        </div>
      )}
    </div>
  );
}
