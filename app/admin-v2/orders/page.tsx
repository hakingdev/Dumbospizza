'use client';

/** Заказы: десктоп — таблица + панель деталей (D2), мобилка — карточки + фильтры (02/11). */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  ACTIVE_STATUSES,
  AdminOrder,
  nextOrderAction,
  reprintOrder,
  updateOrderStatus,
  useOrdersFeed,
} from '../../../components/admin-v2/hooks';
import {
  CancelOrderModal,
  CustomerBlock,
  CustomerNote,
  OrderComposition,
  PAYMENT_LABELS,
  isToday,
  promisedTimeLabel,
  shortName,
} from '../../../components/admin-v2/order-shared';
import { useNewOrderAlert } from '../../../components/admin-v2/sound';
import { euro, timeHHmm } from '../../../components/admin-v2/format';
import {
  Card,
  ErrorBanner,
  FilterChip,
  Icon,
  LoadError,
  Loading,
  SectionLabel,
  StatusBadge,
  btnGhost,
  btnGhostDanger,
  btnOutline,
  btnPrimary,
  btnSoft,
  btnSuccess,
  RoundIconBtn,
} from '../../../components/admin-v2/ui';
import { ADMIN_V2_BASE } from '../../../components/admin-v2/nav';

type TabKey = 'active' | 'history' | 'archive' | 'cancelled';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'active', label: 'Активные' },
  { key: 'history', label: 'История' },
  { key: 'archive', label: 'Архив' },
  { key: 'cancelled', label: 'Отменённые' },
];

const PRINT_ICON =
  'M6 9V3h12v6 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v7H6Z';

function matchesTab(order: AdminOrder, tab: TabKey): boolean {
  switch (tab) {
    case 'active':
      return ACTIVE_STATUSES.includes(order.status);
    case 'history':
      return order.status === 'completed' && isToday(order.createdAt);
    case 'archive':
      // Только прошлые дни: сегодняшние завершённые живут в «Истории»,
      // сегодняшние отмены — в «Отменённых»; раньше архив показывал всё
      // подряд и дублировал обе вкладки
      return !isToday(order.createdAt);
    case 'cancelled':
      return order.status === 'cancelled';
  }
}

function matchesSearch(order: AdminOrder, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return (
    String(order.orderNumber || '').toLowerCase().includes(q) ||
    (order.customerName || '').toLowerCase().includes(q) ||
    (order.phoneNumber || '').replace(/\s+/g, '').includes(q.replace(/\s+/g, ''))
  );
}

function actionButtonClass(tone: 'primary' | 'success' | 'soft'): string {
  return tone === 'success' ? btnSuccess : tone === 'soft' ? btnSoft : btnPrimary;
}

/** На десктопе «парное» действие (Передать курьеру) — secondary/outline, как в D2. */
function desktopActionClass(tone: 'primary' | 'success' | 'soft'): string {
  return tone === 'success' ? btnSuccess : tone === 'soft' ? btnOutline : btnPrimary;
}

function itemsCount(order: AdminOrder): number {
  return order.items?.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || 0;
}

function exportCsv(orders: AdminOrder[]) {
  const header = ['Номер', 'Дата', 'Время', 'Клиент', 'Телефон', 'Способ', 'Позиций', 'Сумма', 'Оплата', 'Статус'];
  const rows = orders.map((order) => [
    `#${order.orderNumber}`,
    new Date(order.createdAt).toLocaleDateString('de-DE'),
    timeHHmm(order.createdAt),
    order.customerName || '',
    order.phoneNumber || '',
    order.deliveryType === 'pickup' ? 'Самовывоз' : 'Доставка',
    itemsCount(order),
    String(order.total).replace('.', ','),
    PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod,
    order.status,
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    .join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dumbos-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* --------------------------------------------- десктоп: таблица (D2) */

/** Колонки из канвы: номер 100 / клиент FILL / статус 132 / сумма 110 / действия 200. */
function DesktopTableHeader() {
  return (
    <div className="flex items-center gap-4 bg-gray-100 px-6 py-3 text-xs font-bold uppercase leading-4 tracking-[.04em] text-gray-600">
      <span className="w-[100px] flex-none">Номер</span>
      <span className="min-w-0 flex-1">Клиент</span>
      <span className="w-[132px] flex-none">Статус</span>
      <span className="w-[110px] flex-none text-right">Сумма</span>
      <span className="w-[200px] flex-none text-right">Действия</span>
    </div>
  );
}

/** Скелетон строки на время первой загрузки (state=skeleton из UI-кита). */
function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 border-b border-gray-200 px-6 py-4 last:border-b-0">
      <span className="h-4 w-[120px] flex-none rounded bg-gray-100" />
      <span className="h-4 min-w-0 flex-1 rounded bg-gray-100" />
      <span className="h-8 w-[160px] flex-none rounded bg-gray-100" />
      <span className="h-4 w-[140px] flex-none rounded bg-gray-100" />
      <span className="h-4 w-[200px] flex-none rounded bg-gray-100" />
    </div>
  );
}

function DesktopRow({
  order,
  selected,
  onSelect,
  onAction,
  onCancel,
  onReprint,
  busy,
}: {
  order: AdminOrder;
  selected: boolean;
  onSelect: () => void;
  onAction: (order: AdminOrder, next: string) => void;
  onCancel: (order: AdminOrder) => void;
  onReprint: (order: AdminOrder) => void;
  busy: boolean;
}) {
  const action = nextOrderAction(order.status);
  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer items-center gap-4 border-b border-l-[3px] border-gray-200 py-4 pl-[21px] pr-6 transition last:border-b-0 ${
        selected ? 'border-l-[#8A6C4C] bg-[#FAF7F2]' : 'border-l-transparent hover:bg-[#FAF7F2]'
      }`}
    >
      <span className="w-[100px] flex-none overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold leading-6 text-gray-900 tabular-nums">
        #{order.orderNumber}
      </span>
      <span
        className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-base leading-6 text-gray-900"
        title={order.customerName || undefined}
      >
        {order.customerName || '—'} · {order.deliveryType === 'pickup' ? 'Самовывоз' : 'Доставка'} ·{' '}
        {itemsCount(order)} поз.
      </span>
      <div className="flex w-[132px] flex-none items-center">
        <StatusBadge status={order.status} />
      </div>
      <span className="w-[110px] flex-none text-right text-base font-bold leading-6 text-gray-900 tabular-nums">
        {euro(order.total)}
      </span>
      <div
        className="flex w-[200px] flex-none items-center justify-end gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {action ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(order, action.next)}
            className={`${desktopActionClass(action.tone)} h-8 min-w-[96px] px-3 text-sm leading-5`}
          >
            {action.label}
          </button>
        ) : (
          <button
            type="button"
            onClick={onSelect}
            className={`${btnGhost} h-8 min-w-[96px] px-3 text-sm leading-5`}
          >
            Детали
          </button>
        )}
        {(order.status === 'new' || order.status === 'preparing') && (
          <RoundIconBtn label="Печать чека" d={PRINT_ICON} onClick={() => onReprint(order)} />
        )}
        {order.status === 'new' && (
          <RoundIconBtn
            label="Отменить заказ"
            d="M18 6 6 18 M6 6l12 12"
            color="#D42A47"
            hoverBg="#FDE6E7"
            onClick={() => onCancel(order)}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------- десктоп: панель деталей */

function DetailsPanel({
  order,
  onAction,
  onCancel,
  busy,
}: {
  order: AdminOrder | null;
  onAction: (order: AdminOrder, next: string) => void;
  onCancel: (order: AdminOrder) => void;
  busy: boolean;
}) {
  if (!order) {
    return (
      <Card className="flex items-center justify-center p-10 text-center text-gray-500">
        Выберите заказ в таблице — детали появятся здесь
      </Card>
    );
  }
  const action = nextOrderAction(order.status);
  const promised = promisedTimeLabel(order);
  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-2xl font-extrabold leading-[30px] tracking-[-.01em] text-gray-900 tabular-nums">
          #{order.orderNumber}
        </span>
        <StatusBadge status={order.status} />
      </div>
      <span className="text-sm leading-5 text-gray-600">
        Принят {timeHHmm(order.createdAt)}
        {promised ? ` · обещано к ${promised}` : ''}
      </span>
      <OrderComposition order={order} />
      <div className="h-px bg-gray-200" />
      <CustomerBlock order={order} />
      <CustomerNote order={order} compact />
      <div className="flex flex-col gap-3">
        {action && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(order, action.next)}
            className={`${desktopActionClass(action.tone)} h-12 w-full text-lg`}
          >
            {action.label}
          </button>
        )}
        <div className="flex gap-3">
          {!['cancelled', 'completed'].includes(order.status) && (
            <button
              type="button"
              onClick={() => onCancel(order)}
              className={`${btnGhostDanger} h-10 min-w-[96px] flex-1 text-base`}
            >
              Отменить
            </button>
          )}
          <a
            href={`tel:${order.phoneNumber}`}
            className={`${btnGhost} h-10 min-w-[96px] flex-1 text-base no-underline`}
          >
            Позвонить
          </a>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------ мобилка: карточка */

function MobileCard({
  order,
  onAction,
  busy,
}: {
  order: AdminOrder;
  onAction: (order: AdminOrder, next: string) => void;
  busy: boolean;
}) {
  const router = useRouter();
  const action = nextOrderAction(order.status);
  const cancelled = order.status === 'cancelled';
  const delivering = order.status === 'delivering';
  const subtitleParts =
    order.deliveryType === 'pickup'
      ? ['Самовывоз', `${itemsCount(order)} поз.`]
      : [
          'Доставка',
          order.deliveryZone?.name,
          [order.deliveryAddress?.street, order.deliveryAddress?.houseNumber].filter(Boolean).join(' '),
        ];
  return (
    <div
      onClick={() => router.push(`${ADMIN_V2_BASE}/orders/${order._id}`)}
      className={`flex cursor-pointer flex-col gap-3 rounded-2xl border p-4 transition ${
        delivering
          ? 'border-[#EBE0CE] bg-[#FAF7F2]'
          : 'border-gray-200 bg-white shadow-[0_1px_2px_rgba(17,24,39,.04),0_2px_8px_rgba(17,24,39,.06)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={order.status} />
        <span className="text-sm leading-5 text-gray-400 tabular-nums">{timeHHmm(order.createdAt)}</span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-bold leading-6 text-gray-900">
            #{order.orderNumber} · {shortName(order.customerName)}
          </div>
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-5 text-gray-600">
            {cancelled
              ? `Отменён · ${PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}`
              : subtitleParts.filter(Boolean).join(' · ')}
          </div>
        </div>
        <div
          className={`whitespace-nowrap text-lg font-bold leading-6 tabular-nums ${
            cancelled ? 'text-gray-400 line-through' : 'text-gray-900'
          }`}
        >
          {euro(order.total)}
        </div>
      </div>
      {action && (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(order, action.next)}
            className={`${actionButtonClass(action.tone)} h-8 flex-1 text-sm leading-5`}
          >
            {action.label}
          </button>
          <Link
            href={`${ADMIN_V2_BASE}/orders/${order._id}`}
            className={`${btnGhost} h-8 px-3 text-sm leading-5 no-underline`}
            onClick={(e) => e.stopPropagation()}
          >
            Детали
          </Link>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------- мобилка: шторка фильтров */

const SHEET_STATUSES: { key: string; label: string }[] = [
  { key: 'new', label: 'Новый' },
  { key: 'preparing', label: 'Готовится' },
  { key: 'ready_for_delivery', label: 'Готов' },
  { key: 'delivering', label: 'В доставке' },
  { key: 'completed', label: 'Завершён' },
];

function FiltersSheet({
  open,
  onClose,
  statusSet,
  setStatusSet,
  deliveryType,
  setDeliveryType,
  resultCount,
}: {
  open: boolean;
  onClose: () => void;
  statusSet: Set<string>;
  setStatusSet: (next: Set<string>) => void;
  deliveryType: string | null;
  setDeliveryType: (next: string | null) => void;
  resultCount: number;
}) {
  if (!open) return null;
  const toggle = (key: string) => {
    const next = new Set(statusSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setStatusSet(next);
  };
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Закрыть"
        className="absolute inset-0 cursor-default border-none bg-black/50"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-4 rounded-t-2xl bg-white px-4 pb-6 pt-2">
        <span className="h-1 w-9 self-center rounded bg-gray-300" />
        <h2 className="m-0 text-2xl font-extrabold leading-[30px] tracking-[-.01em] text-gray-900">
          Фильтры
        </h2>
        <div className="flex flex-col gap-2">
          <SectionLabel>Статус</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {SHEET_STATUSES.map((status) => {
              const active = statusSet.has(status.key);
              return (
                <button
                  key={status.key}
                  type="button"
                  onClick={() => toggle(status.key)}
                  className={
                    active
                      ? 'inline-flex h-8 cursor-pointer items-center rounded-full border-none bg-[#8A6C4C] px-3.5 text-sm font-bold leading-5 text-white'
                      : 'inline-flex h-8 cursor-pointer items-center rounded-full border border-gray-200 bg-white px-3.5 text-sm font-bold leading-5 text-gray-900'
                  }
                >
                  {status.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <SectionLabel>Способ</SectionLabel>
          <div className="flex flex-col gap-2">
            {[
              { key: 'delivery', label: 'Доставка' },
              { key: 'pickup', label: 'Самовывоз' },
            ].map((option) => {
              const active = deliveryType === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setDeliveryType(active ? null : option.key)}
                  className={`flex h-12 cursor-pointer items-center gap-3 rounded-xl px-4 text-left text-base leading-6 ${
                    active
                      ? 'border-2 border-[#8A6C4C] bg-[#FAF7F2] font-bold text-gray-900'
                      : 'border border-gray-300 bg-white text-gray-900'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 ${
                      active ? 'border-[#8A6C4C]' : 'border-gray-300'
                    }`}
                  >
                    {active && <span className="h-2.5 w-2.5 rounded-full bg-[#8A6C4C]" />}
                  </span>
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onClose}
            className={`${btnPrimary} h-12 w-full text-lg`}
          >
            Показать {resultCount}{' '}
            {plural(resultCount, 'заказ', 'заказа', 'заказов')}
          </button>
          <button
            type="button"
            onClick={() => {
              setStatusSet(new Set());
              setDeliveryType(null);
            }}
            className={`${btnGhost} h-12 w-full text-lg`}
          >
            Сбросить фильтры
          </button>
        </div>
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

/* ----------------------------------------------------------- страница */

function OrdersPageInner() {
  const searchParams = useSearchParams();
  const tabParam = (searchParams.get('tab') as TabKey) || 'active';
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? tabParam : 'active';
  const router = useRouter();

  /* Пагинация: стартуем со 100, «Показать ещё» наращивает выборку */
  const [limit, setLimit] = useState(100);
  const feed = useOrdersFeed({ limit }, 15_000);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'));
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelOrder, setCancelOrder] = useState<AdminOrder | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [statusSet, setStatusSet] = useState<Set<string>>(new Set());
  const [deliveryType, setDeliveryType] = useState<string | null>(null);

  // ?id= из URL (переход с Главной) — выбрать заказ при первой загрузке
  useEffect(() => {
    const id = searchParams.get('id');
    if (id) setSelectedId(id);
  }, [searchParams]);

  const counts = useMemo(() => {
    const map: Record<TabKey, number> = { active: 0, history: 0, archive: 0, cancelled: 0 };
    for (const order of feed.orders) {
      for (const t of TABS) if (matchesTab(order, t.key)) map[t.key] += 1;
    }
    return map;
  }, [feed.orders]);

  const tabOrders = useMemo(
    () =>
      feed.orders
        .filter((order) => matchesTab(order, tab))
        .filter((order) => matchesSearch(order, search)),
    [feed.orders, tab, search]
  );

  const mobileOrders = useMemo(
    () =>
      tabOrders
        .filter((order) => (statusSet.size ? statusSet.has(order.status) : true))
        .filter((order) => (deliveryType ? order.deliveryType === deliveryType : true)),
    [tabOrders, statusSet, deliveryType]
  );

  const selected = feed.orders.find((order) => order._id === selectedId) || null;
  const newOrders = feed.orders.filter((order) => order.status === 'new');
  const completedToday = counts.history;

  /* Лента не загрузилась вовсе / загружена, но перестала обновляться */
  const feedFailed = !!feed.error && !feed.data;
  const feedStale = !!feed.error && !!feed.data;

  // Звук при появлении нового заказа (настройка — в «Настройках»)
  useNewOrderAlert(newOrders.length, !feed.loading || feed.orders.length > 0);

  const handleAction = async (order: AdminOrder, next: string) => {
    setBusyId(order._id);
    const ok = await updateOrderStatus(order._id, next);
    if (!ok) alert('Не удалось обновить статус заказа');
    feed.reload();
    setBusyId(null);
  };

  const handleAcceptAll = async () => {
    if (!newOrders.length) return;
    setBusyId('__all__');
    for (const order of newOrders) {
      await updateOrderStatus(order._id, 'preparing');
    }
    feed.reload();
    setBusyId(null);
  };

  const handleReprint = async (order: AdminOrder) => {
    if (!confirm(`Напечатать чек заказа #${order.orderNumber} ещё раз?`)) return;
    const ok = await reprintOrder(order._id);
    if (!ok) alert('Не удалось поставить чек в очередь печати');
  };

  const setTab = (key: TabKey) => {
    router.replace(`${ADMIN_V2_BASE}/orders?tab=${key}`);
  };

  const filtersActive = statusSet.size > 0 || deliveryType !== null;

  /* «Показать ещё» — на вкладках прошлого; Активные всегда влезают в свежую сотню */
  const canLoadMore = tab !== 'active' && !!feed.data && feed.orders.length < feed.total;
  const loadMoreBtn = canLoadMore && (
    <button
      type="button"
      disabled={feed.loading}
      onClick={() => setLimit((prev) => prev + 200)}
      className={`${btnGhost} h-10 w-full px-4 text-base`}
    >
      {feed.loading
        ? 'Загружаем…'
        : `Показать ещё · загружено ${feed.orders.length} из ${feed.total}`}
    </button>
  );

  return (
    <div className="flex flex-col gap-4 p-4 pt-6 lg:gap-6 lg:p-0">
      {/* Заголовок */}
      <div className="flex items-start justify-between gap-3 lg:items-end lg:gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[32px] font-extrabold leading-[38px] tracking-[-.02em] text-gray-900">
            Заказы
          </h1>
          <p className="m-0 text-base leading-6 text-gray-600">
            {feed.data
              ? `${counts.active} активных · ${completedToday} завершённых сегодня`
              : feedFailed
                ? 'Не удалось загрузить заказы'
                : 'Загрузка…'}
          </p>
        </div>
        {/* Мобилка: кнопка фильтров */}
        <button
          type="button"
          aria-label="Фильтры и сортировка"
          title="Фильтры и сортировка"
          onClick={() => setSheetOpen(true)}
          className={`flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-full border bg-white transition lg:hidden ${
            filtersActive ? 'border-[#8A6C4C] text-[#8A6C4C]' : 'border-gray-200 text-[#9A7A56]'
          }`}
        >
          <Icon d="M4 6h16 M7 12h10 M10 18h4" size={20} />
        </button>
        {/* Десктоп: действия */}
        <div className="hidden items-center gap-3 lg:flex">
          <button
            type="button"
            onClick={() => exportCsv(tabOrders)}
            className={`${btnGhost} h-12 px-6 text-lg`}
          >
            <Icon d="M12 3v12 M7 12l5 5 5-5 M4 21h16" size={20} />
            Экспорт CSV
          </button>
          {newOrders.length > 0 && (
            <button
              type="button"
              disabled={busyId === '__all__'}
              onClick={handleAcceptAll}
              className={`${btnPrimary} h-12 px-6 text-lg`}
            >
              Принять {newOrders.length}{' '}
              {plural(newOrders.length, 'заказ', 'заказа', 'заказов')}
            </button>
          )}
        </div>
      </div>

      {/* Лента загружена, но фон-обновление падает — данные могут устареть */}
      {feedStale && feed.updatedAt && (
        <ErrorBanner
          text={`Список не обновляется — показаны данные на ${timeHHmm(feed.updatedAt)}`}
          onRetry={feed.reload}
        />
      )}

      {/* Табы + поиск */}
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:overflow-visible lg:px-0 lg:pb-0">
        {TABS.map((t) => (
          <FilterChip
            key={t.key}
            label={t.label}
            count={t.key === tab && feed.data ? counts[t.key] : undefined}
            active={t.key === tab}
            onClick={() => setTab(t.key)}
          />
        ))}
        <div className="hidden flex-1 lg:block" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Номер, имя, телефон"
          className="hidden h-12 w-[320px] flex-none rounded-xl border border-gray-300 bg-white px-4 text-base leading-6 text-gray-900 outline-none transition placeholder:text-gray-500 focus:border-[#8A6C4C] lg:block"
        />
      </div>

      {/* Десктоп: таблица + панель */}
      <div className="hidden items-start gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <DesktopTableHeader />
          {feed.loading && !feed.data ? (
            Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} />)
          ) : feedFailed ? (
            <LoadError framed={false} title="Заказы не загрузились" detail={feed.error} onRetry={feed.reload} />
          ) : tabOrders.length ? (
            tabOrders.map((order) => (
              <DesktopRow
                key={order._id}
                order={order}
                selected={order._id === selectedId}
                onSelect={() => setSelectedId(order._id)}
                onAction={handleAction}
                onCancel={setCancelOrder}
                onReprint={handleReprint}
                busy={busyId === order._id || busyId === '__all__'}
              />
            ))
          ) : (
            <div className="p-10 text-center text-gray-500">
              {search ? 'Ничего не найдено по запросу' : 'Заказов в этой вкладке нет'}
            </div>
          )}
          {canLoadMore && <div className="border-t border-gray-200 p-3">{loadMoreBtn}</div>}
        </Card>
        <DetailsPanel
          order={selected}
          onAction={handleAction}
          onCancel={setCancelOrder}
          busy={busyId === selectedId}
        />
      </div>

      {/* Мобилка: карточки */}
      <div className="flex flex-col gap-3 lg:hidden">
        {feed.loading && !feed.data ? (
          <Loading />
        ) : feedFailed ? (
          <LoadError title="Заказы не загрузились" detail={feed.error} onRetry={feed.reload} />
        ) : mobileOrders.length ? (
          mobileOrders.map((order) => (
            <MobileCard
              key={order._id}
              order={order}
              onAction={handleAction}
              busy={busyId === order._id || busyId === '__all__'}
            />
          ))
        ) : (
          <Card className="p-6 text-center text-gray-500">
            {filtersActive ? 'Под фильтры ничего не попало' : 'Заказов в этой вкладке нет'}
          </Card>
        )}
        {loadMoreBtn}
      </div>

      <FiltersSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        statusSet={statusSet}
        setStatusSet={setStatusSet}
        deliveryType={deliveryType}
        setDeliveryType={setDeliveryType}
        resultCount={mobileOrders.length}
      />

      <CancelOrderModal
        order={cancelOrder}
        onClose={() => setCancelOrder(null)}
        onCancelled={() => feed.reload()}
      />
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <OrdersPageInner />
    </Suspense>
  );
}
