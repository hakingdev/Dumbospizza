'use client';

/** Главная — сводка дня (канвы D1 / 01). */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  ACTIVE_STATUSES,
  AdminOrder,
  nextOrderAction,
  updateOrderStatus,
  useAdminStats,
  useOrdersFeed,
  useProducts,
  useStoreSettings,
} from '../../components/admin-v2/hooks';
import { euro, ruWeekdayDeDate, timeHHmm } from '../../components/admin-v2/format';
import { useNewOrderAlert } from '../../components/admin-v2/sound';
import {
  Card,
  DemoTag,
  ErrorBanner,
  Icon,
  KpiCard,
  LoadError,
  Loading,
  StatusBadge,
  btnGhost,
  btnOutline,
  btnSoft,
  btnSuccess,
  btnPrimary,
} from '../../components/admin-v2/ui';
import { ADMIN_V2_BASE } from '../../components/admin-v2/nav';

/** «17» / «17:00» → «17:00»; мусор → null. */
function normalizeHour(value: unknown): string | null {
  const str = String(value ?? '').trim();
  if (/^\d{1,2}$/.test(str)) return `${str.padStart(2, '0')}:00`;
  if (/^\d{1,2}:\d{2}$/.test(str)) {
    const [h, m] = str.split(':');
    return `${h.padStart(2, '0')}:${m}`;
  }
  return null;
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function isToday(iso: string): boolean {
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

/** Краткое имя «Anna Vogel» → «A. Vogel» (как в канве). */
function shortName(full: string): string {
  const parts = (full || '').trim().split(/\s+/);
  if (parts.length < 2) return full || '—';
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

function orderPlaceLine(order: AdminOrder): string {
  if (order.deliveryType === 'pickup') {
    const count = order.items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;
    return `Самовывоз · ${count} поз.`;
  }
  const zone = order.deliveryZone?.name;
  const street = [order.deliveryAddress?.street, order.deliveryAddress?.houseNumber]
    .filter(Boolean)
    .join(' ');
  return ['Доставка', zone, street].filter(Boolean).join(' · ');
}

/* ---- Карточка активного заказа (мобильный вид, 01) ---- */

function MobileOrderCard({
  order,
  onAction,
  busy,
}: {
  order: AdminOrder;
  onAction: (order: AdminOrder, next: string) => void;
  busy: boolean;
}) {
  const action = nextOrderAction(order.status);
  const router = useRouter();
  const href = `${ADMIN_V2_BASE}/orders/${order._id}`;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={order.status} />
        <span className="text-sm leading-5 text-gray-400 tabular-nums">
          {timeHHmm(order.createdAt)} · {minutesSince(order.createdAt)} мин
        </span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-bold leading-6 text-gray-900">
            #{order.orderNumber} · {shortName(order.customerName)}
          </div>
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-5 text-gray-600">
            {orderPlaceLine(order)}
          </div>
        </div>
        <div className="whitespace-nowrap text-lg font-bold leading-6 text-gray-900 tabular-nums">
          {euro(order.total)}
        </div>
      </div>
      <div className="flex gap-2">
        {action ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(order, action.next)}
            className={`${
              action.tone === 'success' ? btnSuccess : action.tone === 'soft' ? btnSoft : btnPrimary
            } h-8 flex-1 px-3 text-sm leading-5`}
          >
            {action.label}
          </button>
        ) : (
          <Link
            href={href}
            className={`${btnGhost} h-8 flex-1 px-3 text-sm leading-5 no-underline`}
          >
            Детали
          </Link>
        )}
        <button
          type="button"
          aria-label="Открыть заказ"
          title="Открыть заказ"
          onClick={() => router.push(href)}
          className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full border-none bg-[#FAF7F2] text-[#9A7A56]"
        >
          <Icon d="m9 18 6-6-6-6" size={20} />
        </button>
      </div>
    </Card>
  );
}

/* ---- Строка активного заказа (десктоп, D1) ---- */

function DesktopOrderRow({
  order,
  onAction,
  busy,
  last,
}: {
  order: AdminOrder;
  onAction: (order: AdminOrder, next: string) => void;
  busy: boolean;
  last: boolean;
}) {
  const action = nextOrderAction(order.status);
  return (
    <div
      className={`flex items-center gap-4 px-6 py-4 transition hover:bg-[#FAF7F2] ${
        last ? '' : 'border-b border-gray-200'
      }`}
    >
      <span className="w-[100px] flex-none overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold leading-6 text-gray-900 tabular-nums">
        #{order.orderNumber}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-base leading-6 text-gray-900">
        {shortName(order.customerName)} · {orderPlaceLine(order).replace(/^Доставка · /, '')}
      </span>
      <div className="flex w-[132px] flex-none items-center">
        <StatusBadge status={order.status} />
      </div>
      <span className="w-[110px] flex-none text-right text-base font-bold leading-6 text-gray-900 tabular-nums">
        {euro(order.total)}
      </span>
      <div className="flex w-[200px] flex-none items-center justify-end">
        {action ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(order, action.next)}
            className={`${
              action.tone === 'success' ? btnSuccess : action.tone === 'soft' ? btnSoft : btnPrimary
            } h-8 min-w-[96px] px-3 text-sm leading-5`}
          >
            {action.label}
          </button>
        ) : (
          <Link
            href={`${ADMIN_V2_BASE}/orders?id=${order._id}`}
            className={`${btnGhost} h-8 min-w-[96px] px-3 text-sm leading-5 no-underline`}
          >
            Детали
          </Link>
        )}
      </div>
    </div>
  );
}

export default function AdminV2HomePage() {
  const router = useRouter();
  const settingsState = useStoreSettings();
  const { settings } = settingsState;
  const statsState = useAdminStats(30_000);
  const { stats } = statsState;
  const feed = useOrdersFeed({ limit: 100 }, 15_000);
  const productsState = useProducts();
  const { products } = productsState;
  const [busyId, setBusyId] = useState<string | null>(null);

  /* Ошибки: error && !data — блока данных нет вовсе; error && data — данные устарели. */
  const settingsFailed = !!settingsState.error && !settings;
  const statsFailed = !!statsState.error && !stats;
  const feedFailed = !!feed.error && !feed.data;
  const productsFailed = !!productsState.error && !productsState.data;
  const feedStale = !!feed.error && !!feed.data;

  const failedBlocks = [
    statsFailed && 'сводка дня',
    feedFailed && 'заказы',
    productsFailed && 'stop-list',
    settingsFailed && 'настройки смены',
  ].filter(Boolean) as string[];

  const retryFailed = () => {
    if (statsState.error) statsState.reload();
    if (feed.error) feed.reload();
    if (productsState.error) productsState.reload();
    if (settingsState.error) settingsState.reload();
  };

  const activeOrders = useMemo(
    () => feed.orders.filter((order) => ACTIVE_STATUSES.includes(order.status)),
    [feed.orders]
  );

  /* Дефолт часов — только для ЗАГРУЖЕННЫХ настроек без полей; без данных — прочерк. */
  const startHour = settings ? normalizeHour(settings.ordersStartHour) || '11:00' : null;
  const endHour = settings ? normalizeHour(settings.ordersEndHour) || '21:30' : null;
  const shiftLabel =
    startHour && endHour ? `${startHour}–${endHour}` : settingsFailed ? 'нет данных' : '…';

  const blockedUntil = settings?.ordersBlockedUntil ? new Date(settings.ordersBlockedUntil) : null;
  const isBlocked = !!blockedUntil && blockedUntil.getTime() > Date.now();

  const newOrders = activeOrders.filter((order) => order.status === 'new');

  // Звук при появлении нового заказа (настройка — в «Настройках»)
  useNewOrderAlert(newOrders.length, !feed.loading || feed.orders.length > 0);
  const cancelledToday = feed.orders.filter(
    (order) => order.status === 'cancelled' && isToday(order.createdAt)
  ).length;
  const stopList = useMemo(() => products.filter((product) => product.available === false), [products]);

  const stopTitle = productsFailed
    ? 'Stop-list не загрузился'
    : stopList.length
      ? `${stopList.length} ${plural(stopList.length, 'позиция', 'позиции', 'позиций')} в stop-list`
      : productsState.data
        ? 'Stop-list пуст'
        : 'Загрузка stop-list…';
  const stopSub = productsFailed
    ? 'Не удалось получить данные меню — откройте раздел'
    : stopList.length
      ? stopList.slice(0, 2).map((product) => product.name).join(', ') +
        (stopList.length > 2 ? '…' : '')
      : productsState.data
        ? 'Все товары доступны к заказу'
        : '…';

  /** Среднее время принятия (new → preparing) по сегодняшним заказам из выборки. */
  const avgAcceptSeconds = useMemo(() => {
    const deltas: number[] = [];
    for (const order of feed.orders) {
      if (!isToday(order.createdAt) || !order.statusUpdates) continue;
      const created = new Date(order.createdAt).getTime();
      const accepted = order.statusUpdates.find((update) => update.status === 'preparing');
      if (accepted) deltas.push((new Date(accepted.timestamp).getTime() - created) / 1000);
    }
    if (!deltas.length) return null;
    return Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
  }, [feed.orders]);

  const heroLabel = settingsFailed
    ? 'СТАТУС СМЕНЫ НЕИЗВЕСТЕН — НАСТРОЙКИ НЕ ЗАГРУЗИЛИСЬ'
    : !settings
      ? 'ЗАГРУЗКА…'
      : isBlocked
        ? `ПРИЁМ ПРИОСТАНОВЛЕН ДО ${timeHHmm(blockedUntil!)}`
        : `СМЕНА ${shiftLabel} · ПРИЁМ ЗАКАЗОВ ВКЛЮЧЁН`;

  const heroTitle = feedFailed
    ? 'Не удалось загрузить заказы'
    : newOrders.length
      ? `${newOrders.length} ${plural(newOrders.length, 'заказ ждёт', 'заказа ждут', 'заказов ждут')} подтверждения`
      : !feed.data
        ? '…'
        : 'Новых заказов нет — всё принято';

  const avgCheck = stats && stats.todayOrders > 0 ? stats.todaySales / stats.todayOrders : 0;

  const handleAction = async (order: AdminOrder, next: string) => {
    setBusyId(order._id);
    const ok = await updateOrderStatus(order._id, next);
    if (!ok) alert('Не удалось обновить статус заказа');
    feed.reload();
    setBusyId(null);
  };

  const shown = activeOrders.slice(0, 4);

  return (
    <div className="flex flex-col gap-6 p-4 pt-6 lg:p-0">
      {/* Заголовок */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[32px] font-extrabold leading-[38px] tracking-[-.02em] text-gray-900">
            Главная
          </h1>
          <p className="m-0 text-base leading-6 text-gray-600">
            {ruWeekdayDeDate(new Date())} · смена {shiftLabel}
          </p>
        </div>
        <div className="hidden items-center gap-3 lg:flex">
          <Link
            href={`${ADMIN_V2_BASE}/analytics`}
            className={`${btnPrimary} h-12 min-w-[96px] px-6 text-lg no-underline`}
          >
            Отчёт смены
          </Link>
        </div>
      </div>

      {/* Ошибки загрузки: явный баннер вместо тихих нулей */}
      {failedBlocks.length > 0 && (
        <ErrorBanner
          text={`Не загрузилось: ${failedBlocks.join(', ')}. Прочерки ниже — отсутствие данных, а не нули.`}
          onRetry={retryFailed}
        />
      )}
      {feedStale && failedBlocks.length === 0 && feed.updatedAt && (
        <ErrorBanner
          text={`Заказы не обновляются — показаны данные на ${timeHHmm(feed.updatedAt)}`}
          onRetry={feed.reload}
        />
      )}

      {/* Статус смены: мобилка — градиентный hero (01), десктоп — светлый баннер (D1) */}
      <div
        className="flex flex-col gap-4 rounded-2xl p-6 lg:hidden"
        style={{
          background:
            'radial-gradient(120% 140% at 85% 10%, rgba(212,42,71,.55) 0%, rgba(212,42,71,0) 55%), linear-gradient(135deg, #B8956B 0%, #7C6145 60%, #4A3826 100%)',
        }}
      >
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase leading-4 tracking-[.04em] text-white/70">
            {heroLabel}
          </span>
          <span className="text-2xl font-extrabold leading-[30px] text-white">{heroTitle}</span>
        </div>
        <button
          type="button"
          onClick={() => router.push(`${ADMIN_V2_BASE}/orders`)}
          className="flex h-14 w-full flex-none cursor-pointer items-center justify-center gap-2 rounded-xl border-none bg-[#F5F0E8] px-8 text-xl font-bold leading-5 text-[#7C6145] transition hover:bg-[#EBE0CE]"
        >
          <Icon d="M20 6 9 17l-5-5" size={20} />
          {newOrders.length ? 'Принять заказы' : 'Открыть заказы'}
        </button>
      </div>
      <div className="hidden items-center gap-6 rounded-2xl border border-[#EBE0CE] bg-[#F5F0E8] p-6 lg:flex">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs font-bold uppercase leading-4 tracking-[.04em] text-[#8A6C4C]">
            {heroLabel}
          </span>
          <span className="text-xl font-extrabold leading-6 tracking-[-.01em] text-gray-900">
            {heroTitle}
          </span>
          {avgAcceptSeconds !== null && (
            <span className="text-sm leading-5 text-gray-600">
              Среднее время принятия сегодня — {Math.floor(avgAcceptSeconds / 60)} мин{' '}
              {avgAcceptSeconds % 60} с
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => router.push(`${ADMIN_V2_BASE}/orders`)}
          className={`${btnPrimary} h-12 min-w-[96px] flex-none px-6 text-lg`}
        >
          {newOrders.length ? 'Принять заказы' : 'Открыть заказы'}
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-6">
        <KpiCard
          label="Выручка за смену"
          value={stats ? euro(stats.todaySales) : statsFailed ? '—' : '…'}
          trend={statsFailed ? 'нет данных' : 'с начала дня'}
          trendTone={statsFailed ? 'down' : 'neutral'}
        />
        <KpiCard
          label="Заказов"
          value={stats ? stats.todayOrders : statsFailed ? '—' : '…'}
          trend={feedFailed ? 'нет данных' : `${activeOrders.length} активных`}
          trendTone={feedFailed ? 'down' : activeOrders.length > 0 ? 'up' : 'neutral'}
        />
        <KpiCard
          label="Средний чек"
          value={stats ? (stats.todayOrders > 0 ? euro(avgCheck) : '—') : statsFailed ? '—' : '…'}
          trend={statsFailed ? 'нет данных' : 'за сегодня'}
          trendTone={statsFailed ? 'down' : 'neutral'}
        />
        <div className="lg:hidden">
          <KpiCard
            label="Отмены"
            value={feed.data ? cancelledToday : feedFailed ? '—' : '…'}
            trend={
              feedFailed ? 'нет данных' : !feed.data ? '' : cancelledToday > 0 ? 'за сегодня' : 'нет отмен'
            }
            trendTone={feedFailed || cancelledToday > 0 ? 'down' : 'neutral'}
          />
        </div>
      </div>

      {/* Активные заказы + правая колонка */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-1">
          <div className="flex items-baseline justify-between gap-3 lg:hidden">
            <h2 className="m-0 text-2xl font-extrabold leading-[30px] tracking-[-.01em] text-gray-900">
              Активные заказы
            </h2>
            <Link
              href={`${ADMIN_V2_BASE}/orders`}
              className="text-sm font-bold leading-5 text-gray-900 underline"
            >
              Все {activeOrders.length}
            </Link>
          </div>

          {/* Мобильные карточки */}
          <div className="flex flex-col gap-3 lg:hidden">
            {feed.loading && !feed.data ? (
              <Loading />
            ) : feedFailed ? (
              <LoadError title="Заказы не загрузились" detail={feed.error} onRetry={feed.reload} />
            ) : shown.length ? (
              shown.map((order) => (
                <MobileOrderCard
                  key={order._id}
                  order={order}
                  onAction={handleAction}
                  busy={busyId === order._id}
                />
              ))
            ) : (
              <Card className="p-6 text-center text-gray-500">Активных заказов нет</Card>
            )}
          </div>

          {/* Десктопная таблица-карточка */}
          <Card className="hidden lg:block">
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-6 py-5">
              <h2 className="m-0 text-2xl font-extrabold leading-[30px] tracking-[-.01em] text-gray-900">
                Активные заказы
              </h2>
              <Link
                href={`${ADMIN_V2_BASE}/orders`}
                className={`${btnGhost} h-8 min-w-[96px] flex-none px-3 text-sm leading-5 no-underline`}
              >
                Все заказы
              </Link>
            </div>
            {feed.loading && !feed.data ? (
              <Loading />
            ) : feedFailed ? (
              <LoadError framed={false} title="Заказы не загрузились" detail={feed.error} onRetry={feed.reload} />
            ) : shown.length ? (
              shown.map((order, i) => (
                <DesktopOrderRow
                  key={order._id}
                  order={order}
                  onAction={handleAction}
                  busy={busyId === order._id}
                  last={i === shown.length - 1}
                />
              ))
            ) : (
              <div className="p-6 text-center text-gray-500">Активных заказов нет</div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6 lg:w-[340px] lg:flex-none">
          {/* Требует внимания (мобилка, 01) */}
          <div className="flex flex-col gap-4 rounded-2xl border border-[#EBE0CE] bg-[#F5F0E8] p-4 lg:hidden">
            <h3 className="m-0 text-lg font-bold leading-6 text-gray-900">Требует внимания</h3>
            <Link
              href={`${ADMIN_V2_BASE}/menu?tab=stoplist`}
              className="flex items-center gap-3 border-b border-[#EBE0CE] pb-3 no-underline"
            >
              <Icon
                d="m21.7 16.5-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 19.5h16a2 2 0 0 0 1.7-3Z M12 9v4 M12 17h.01"
                size={20}
                stroke="#9A7A56"
                className="flex-none"
              />
              <div className="min-w-0 flex-1">
                <div className="text-base font-bold leading-6 text-gray-900">{stopTitle}</div>
                <div className="overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-5 text-gray-600">
                  {stopSub}
                </div>
              </div>
              <Icon d="m9 18 6-6-6-6" size={20} stroke="#9CA3AF" className="flex-none" />
            </Link>
            <div className="flex items-center gap-3">
              <Icon
                d="M11.5 3.5 14 9l6 .8-4.3 4.2 1 6-5.2-2.8L6 20l1-6L2.7 9.8 8.8 9Z"
                size={20}
                stroke="#9A7A56"
                className="flex-none"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-base font-bold leading-6 text-gray-900">
                  Отзыв 2★ без ответа <DemoTag />
                </div>
                <div className="text-sm leading-5 text-gray-600">«Pizza kalt angekommen»</div>
              </div>
              <Icon d="m9 18 6-6-6-6" size={20} stroke="#9CA3AF" className="flex-none" />
            </div>
          </div>

          {/* Требует внимания (десктоп, D1): белая карточка с иконко-плитками и сводкой */}
          <Card className="hidden flex-col gap-4 p-6 lg:flex">
            <h2 className="m-0 text-2xl font-extrabold leading-[30px] tracking-[-.01em] text-gray-900">
              Требует внимания
            </h2>
            <Link
              href={`${ADMIN_V2_BASE}/menu?tab=stoplist`}
              className="flex items-center gap-3 no-underline"
            >
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-[#FDE6E7]">
                <Icon
                  d="m21.7 16.5-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 19.5h16a2 2 0 0 0 1.7-3Z M12 9v4 M12 17h.01"
                  size={20}
                  stroke="#D42A47"
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-base font-bold leading-6 text-gray-900">{stopTitle}</span>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-5 text-gray-600">
                  {stopSub}
                </span>
              </span>
            </Link>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-[#FEF9C3]">
                <Icon
                  d="M11.5 3.5 14 9l6 .8-4.3 4.2 1 6-5.2-2.8L6 20l1-6L2.7 9.8 8.8 9Z"
                  size={20}
                  stroke="#713F12"
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2 text-base font-bold leading-6 text-gray-900">
                  Отзыв 2★ без ответа <DemoTag />
                </span>
                <span className="text-sm leading-5 text-gray-600">«Pizza kalt angekommen»</span>
              </span>
            </div>
            <div className="h-px bg-gray-200" />
            <div className="flex items-center gap-3 text-base leading-6">
              <span className="min-w-0 flex-1 text-gray-600">Отмены за смену</span>
              <span className="font-bold text-gray-900 tabular-nums">
                {feed.data ? cancelledToday : feedFailed ? '—' : '…'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-base leading-6">
              <span className="flex min-w-0 flex-1 items-center gap-2 text-gray-600">
                Средняя доставка <DemoTag />
              </span>
              <span className="font-bold text-gray-900 tabular-nums">47 мин</span>
            </div>
            <div className="flex items-center gap-3 text-base leading-6">
              <span className="flex min-w-0 flex-1 items-center gap-2 text-gray-600">
                Чаевые <DemoTag />
              </span>
              <span className="font-bold text-gray-900 tabular-nums">38,00 €</span>
            </div>
          </Card>
        </div>
      </div>

      {/* Нижние действия (мобилка) */}
      <div className="flex flex-col gap-3 lg:hidden">
        <a href="/admin/products/new" className={`${btnOutline} h-10 px-4 text-base no-underline`}>
          <Icon d="M5 12h14 M12 5v14" size={20} />
          Добавить товар
        </a>
        <Link href={`${ADMIN_V2_BASE}/analytics`} className={`${btnGhost} h-10 px-4 text-base no-underline`}>
          Открыть отчёт смены
          <Icon d="M5 12h14 M12 5l7 7-7 7" size={20} />
        </Link>
      </div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
