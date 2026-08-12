'use client';

/**
 * Аналитика (канва D7, узел 39:1635). Реальные данные: «Заказы по дням»
 * из /api/admin/stats?days=14 (текущая неделя против предыдущей), топ
 * товаров и среднее выполнение — по последним 100 заказам, «фото
 * товаров» — по каталогу. Score и клиентские метрики — демо.
 */

import { useMemo } from 'react';
import {
  useAdminStats,
  useOrdersFeed,
  useProducts,
} from '../../../components/admin-v2/hooks';
import { dateDDMMYYYY, euro } from '../../../components/admin-v2/format';
import { stripPromoLabels } from '../../../lib/orders/gift-label';
import { Card, DemoTag, KpiCard, LoadError, SectionLabel, btnGhost, btnPrimary } from '../../../components/admin-v2/ui';

const DAY_LABELS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
/** Ось недели всегда Mo→So, как в дизайн-канве (индексы getDay). */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
/** Максимальная высота бара в графике 200px (как в макете: бар ≤150). */
const BAR_MAX = 150;

/** Score заведения — демо, бэкенда для метрик пока нет (цвета из канвы). */
const SCORE_ROWS = [
  { label: 'Качество меню', value: 92, color: '#8A6C4C' },
  { label: 'Отзывы', value: 88, color: '#8A6C4C' },
  { label: 'Время доставки', value: 61, color: '#D42A47' },
  { label: 'Отмены', value: 74, color: '#8A6C4C' },
];

/** Локальный ключ даты YYYY-MM-DD — сверяется со строками getDailySales. */
function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

export default function AnalyticsPage() {
  // days=14: последние 7 дней + предыдущая неделя для сравнения
  const statsState = useAdminStats(undefined, 14);
  const { salesData } = statsState;
  const feed = useOrdersFeed({ limit: 100 });
  const productsState = useProducts();
  const { products } = productsState;

  const statsFailed = !!statsState.error && !statsState.data;
  const feedFailed = !!feed.error && !feed.data;
  const productsFailed = !!productsState.error && !productsState.data;

  /**
   * Пары баров «этот период / предыдущий» по дням недели. Каждый weekday
   * встречается в неделе ровно один раз, поэтому слоты Mo→So заполняются
   * точным совпадением даты; день без заказов — нулевой бар.
   */
  const chart = useMemo(() => {
    // Реальный API отдаёт date как YYYY-MM-DD; ISO-таймстампы нормализуем
    const byDate = new Map(
      (salesData || []).map((row) => [
        /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : dateKey(new Date(row.date)),
        row,
      ])
    );
    const today = new Date();
    const slots = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(today);
      day.setDate(day.getDate() - i);
      const prevDay = new Date(day);
      prevDay.setDate(prevDay.getDate() - 7);
      const cur = byDate.get(dateKey(day));
      const prev = byDate.get(dateKey(prevDay));
      slots.push({
        weekday: day.getDay(),
        label: DAY_LABELS[day.getDay()],
        cur: { date: dateKey(day), orders: cur?.count ?? 0, sales: Number(cur?.totalSales) || 0 },
        prev: {
          date: dateKey(prevDay),
          orders: prev?.count ?? 0,
          sales: Number(prev?.totalSales) || 0,
        },
      });
    }
    slots.sort((a, b) => WEEK_ORDER.indexOf(a.weekday) - WEEK_ORDER.indexOf(b.weekday));
    const max = Math.max(1, ...slots.flatMap((slot) => [slot.cur.orders, slot.prev.orders]));
    const hasData = slots.some((slot) => slot.cur.orders > 0 || slot.prev.orders > 0);
    return { slots, max, hasData };
  }, [salesData]);

  /**
   * Топ товаров по последним 100 заказам (без отменённых). «Заказов» —
   * число заказов с товаром (не штуки), как в колонке макета.
   */
  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; orders: number; revenue: number }>();
    for (const order of feed.orders) {
      if (order.status === 'cancelled') continue;
      const seen = new Set<string>();
      for (const item of order.items || []) {
        const name = stripPromoLabels(item.name);
        const entry = map.get(name) || { name, orders: 0, revenue: 0 };
        if (!seen.has(name)) {
          entry.orders += 1;
          seen.add(name);
        }
        entry.revenue += (Number(item.price) || 0) * (Number(item.quantity) || 0);
        map.set(name, entry);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.orders - a.orders);
  }, [feed.orders]);

  /** Средняя длительность выполнения по завершённым из выборки. */
  const avgFulfillmentMin = useMemo(() => {
    const deltas: number[] = [];
    for (const order of feed.orders) {
      if (order.status !== 'completed' || !order.statusUpdates) continue;
      const done = order.statusUpdates.find((update) => update.status === 'completed');
      if (!done) continue;
      const delta = (new Date(done.timestamp).getTime() - new Date(order.createdAt).getTime()) / 60000;
      if (delta > 0 && delta < 240) deltas.push(delta);
    }
    if (!deltas.length) return null;
    return Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
  }, [feed.orders]);

  const productsWithoutPhoto = useMemo(
    () => products.filter((product) => !product.image).length,
    [products]
  );

  /** «Выгрузить» — CSV всего агрегата (не только видимой четвёрки). */
  const exportTopCsv = () => {
    const rows = [
      ['#', 'Товар', 'Заказов', 'Выручка (€)'],
      ...topProducts.map((product, i) => [
        String(i + 1),
        product.name,
        String(product.orders),
        product.revenue.toFixed(2).replace('.', ','),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    // BOM — чтобы Excel открыл кириллицу как UTF-8
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `top-produkte-${dateKey(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const barTitle = (period: string, day: { date: string; orders: number; sales: number }) =>
    `${period} · ${dateDDMMYYYY(day.date)} · ${day.orders} заказов · ${euro(day.sales)}`;

  return (
    <div className="flex flex-col gap-4 p-4 pt-6 lg:gap-6 lg:p-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[32px] font-extrabold leading-[38px] tracking-[-.02em] text-gray-900">
            Аналитика
          </h1>
          <p className="m-0 text-base leading-6 text-gray-600">
            Последние 7 дней · сравнение с предыдущей неделей
          </p>
        </div>
        <button
          type="button"
          disabled
          title="Выбор периода появится вместе с расширенной аналитикой"
          className={`${btnPrimary} hidden h-12 px-6 text-lg lg:inline-flex`}
        >
          Изменить период
        </button>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        {/* Левая колонка: график + топ товаров */}
        <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
          {/* Заказы по дням — реальные данные за 14 дней */}
          <Card className="flex flex-col gap-3 p-4 lg:p-6">
            <h2 className="m-0 text-xl font-extrabold leading-7 tracking-[-.01em] text-gray-900 lg:text-2xl lg:leading-[30px]">
              Заказы по дням
            </h2>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#8A6C4C]" />
                <span className="text-xs font-bold leading-4 text-gray-600">Этот период</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#D1D5DB]" />
                <span className="text-xs font-bold leading-4 text-gray-600">Предыдущий</span>
              </span>
            </div>
            {statsFailed ? (
              <LoadError
                framed={false}
                title="Статистика не загрузилась"
                detail={statsState.error}
                onRetry={statsState.reload}
              />
            ) : chart.hasData ? (
              <div className="flex h-[200px] items-end gap-2 lg:gap-6">
                {chart.slots.map((slot) => (
                  <div key={slot.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                    <div className="flex min-h-px w-full flex-1 items-end justify-center gap-1">
                      <span
                        title={barTitle('Предыдущий', slot.prev)}
                        className="w-3 rounded-t bg-[#D1D5DB] lg:w-[18px]"
                        style={{
                          height: Math.max(4, Math.round((slot.prev.orders / chart.max) * BAR_MAX)),
                          opacity: slot.prev.orders > 0 ? 1 : 0.35,
                        }}
                      />
                      <span
                        title={barTitle('Этот период', slot.cur)}
                        className="w-3 rounded-t bg-[#8A6C4C] lg:w-[18px]"
                        style={{
                          height: Math.max(4, Math.round((slot.cur.orders / chart.max) * BAR_MAX)),
                          opacity: slot.cur.orders > 0 ? 1 : 0.35,
                        }}
                      />
                    </div>
                    <span className="text-xs font-bold leading-4 text-gray-600">{slot.label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-16 text-center text-gray-500">Нет данных о заказах</div>
            )}
          </Card>

          {/* Топ товаров — реальные данные */}
          <Card className="flex flex-col gap-3 p-4 lg:p-6">
            <div className="flex items-center gap-3">
              <h2 className="m-0 flex-1 text-xl font-extrabold leading-7 tracking-[-.01em] text-gray-900 lg:text-2xl lg:leading-[30px]">
                Топ товаров
              </h2>
              <button
                type="button"
                onClick={exportTopCsv}
                disabled={!topProducts.length}
                title="Скачать CSV со всеми товарами из выборки"
                className={`${btnGhost} h-8 px-3 text-sm`}
              >
                Выгрузить
              </button>
            </div>
            <div className="flex items-center gap-3 text-xs font-bold uppercase leading-4 tracking-[.04em] text-gray-600">
              <span className="w-8 flex-none">#</span>
              <span className="min-w-0 flex-1">Товар</span>
              <span className="w-16 flex-none text-right lg:w-[110px]">Заказов</span>
              <span className="w-20 flex-none text-right lg:w-[120px]">Выручка</span>
            </div>
            {feedFailed ? (
              <LoadError framed={false} title="Заказы не загрузились" detail={feed.error} onRetry={feed.reload} />
            ) : topProducts.length ? (
              topProducts.slice(0, 4).map((product, i) => (
                <div
                  key={product.name}
                  className="flex items-center gap-3 border-t border-gray-200 py-2 text-base leading-6 transition hover:bg-[#FAF7F2]"
                >
                  <span className="w-8 flex-none font-bold text-[#8A6C4C] tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-gray-900">
                    {product.name}
                  </span>
                  <span className="w-16 flex-none text-right font-bold text-gray-900 tabular-nums lg:w-[110px]">
                    {product.orders}
                  </span>
                  <span className="w-20 flex-none text-right font-bold text-gray-900 tabular-nums lg:w-[120px]">
                    {euro(product.revenue)}
                  </span>
                </div>
              ))
            ) : (
              <div className="border-t border-gray-200 py-8 text-center text-gray-500">
                Пока нет данных по заказам
              </div>
            )}
          </Card>
        </div>

        {/* Правая колонка 360px: score, KPI, рекомендации */}
        <div className="flex flex-col gap-4 lg:gap-6">
          {/* Score — демо */}
          <Card className="flex flex-col gap-3 p-4 lg:p-6">
            <span className="flex items-center gap-2">
              <SectionLabel>Score заведения</SectionLabel>
              <DemoTag />
            </span>
            <div className="flex items-center gap-3">
              <span className="text-4xl font-extrabold leading-10 tracking-[-.02em] text-gray-900 tabular-nums">
                82
              </span>
              <span className="flex-1 text-base leading-6 text-gray-600">из 100</span>
              <span className="text-base font-bold leading-6 text-[#15803D]">↑ 4</span>
            </div>
            {SCORE_ROWS.map((row) => (
              <div key={row.label} className="flex items-center gap-2">
                <span className="w-[130px] flex-none text-sm leading-5 text-gray-600">{row.label}</span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-gray-100">
                  <span
                    className="block h-full rounded"
                    style={{ width: `${row.value}%`, background: row.color }}
                  />
                </span>
                <span className="w-7 flex-none text-right text-sm font-bold leading-5 text-gray-900 tabular-nums">
                  {row.value}
                </span>
              </div>
            ))}
          </Card>

          {/* KPI */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1 lg:gap-6">
            <KpiCard
              label="Новые клиенты"
              value={
                <span className="flex items-center gap-2">
                  64 <DemoTag />
                </span>
              }
              trend="↑ 11 к прошлому периоду"
              trendTone="up"
            />
            <KpiCard
              label="Повторные заказы"
              value={
                <span className="flex items-center gap-2">
                  38 % <DemoTag />
                </span>
              }
              trend="– без изменений"
              trendTone="neutral"
            />
            <KpiCard
              label="Среднее выполнение"
              value={avgFulfillmentMin !== null ? `${avgFulfillmentMin} мин` : '—'}
              trend="по завершённым из последних 100"
              trendTone="neutral"
            />
          </div>

          {/* Рекомендации */}
          <div className="flex flex-col gap-2 rounded-2xl border border-[#EBE0CE] bg-[#F5F0E8] p-4 lg:p-6">
            <span className="text-xs font-bold uppercase leading-4 tracking-[.04em] text-[#8A6C4C]">
              Рекомендации
            </span>
            <span className="text-base font-bold leading-6 text-gray-900">
              {productsFailed
                ? 'Каталог не загрузился — рекомендации по фото недоступны'
                : !productsState.data
                  ? 'Загрузка каталога…'
                  : productsWithoutPhoto > 0
                    ? `Добавьте фото к ${productsWithoutPhoto} товарам — карточки с фото заказывают чаще`
                    : 'У всех товаров есть фото — отличная витрина!'}
            </span>
            <span className="flex items-center gap-2 text-sm leading-5 text-gray-600">
              · Сократите время сборки в пятницу — там теряется 6 минут <DemoTag />
            </span>
            <span className="flex items-center gap-2 text-sm leading-5 text-gray-600">
              · Включите Zone 3 на выходные: 34 отказа по адресу <DemoTag />
            </span>
            <a href="/admin/products" className={`${btnPrimary} mt-2 h-10 w-full text-base no-underline`}>
              Загрузить фото товаров
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
