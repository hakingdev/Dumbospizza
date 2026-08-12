'use client';

/**
 * Аналитика (канва D7 / 08). Реальные данные: «Заказы по дням» из
 * /api/admin/stats, топ товаров и средняя доставка — по последним 100
 * заказам, «фото товаров» — по каталогу. Score и клиентские метрики — демо.
 */

import { useMemo } from 'react';
import {
  useAdminStats,
  useOrdersFeed,
  useProducts,
} from '../../../components/admin-v2/hooks';
import { dateDDMMYYYY, euro, euroWhole } from '../../../components/admin-v2/format';
import { stripPromoLabels } from '../../../lib/orders/gift-label';
import { Card, DemoTag, KpiCard, LoadError, SectionLabel, btnGhost } from '../../../components/admin-v2/ui';

const DAY_LABELS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
/** Ось недели всегда Mo→So, как в дизайн-канве (индексы getDay). */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function AnalyticsPage() {
  const statsState = useAdminStats();
  const { salesData } = statsState;
  const feed = useOrdersFeed({ limit: 100 });
  const productsState = useProducts();
  const { products } = productsState;

  const statsFailed = !!statsState.error && !statsState.data;
  const feedFailed = !!feed.error && !feed.data;
  const productsFailed = !!productsState.error && !productsState.data;

  /**
   * Бары «выручка по дням» из stats.salesData (getDailySales: totalSales/count).
   * Последние 7 дней содержат каждый день недели ровно один раз, поэтому
   * данные раскладываются по фиксированным слотам Mo→So без потерь;
   * реальная дата бара — в тултипе. День без заказов — пустой слот.
   */
  const chart = useMemo(() => {
    const slice = (salesData || []).slice(-7);
    const byWeekday = new Map<number, { date: string; sales: number; orders: number }>();
    for (const row of slice) {
      byWeekday.set(new Date(row.date).getDay(), {
        date: row.date,
        sales: Number(row.totalSales) || 0,
        orders: Number(row.count) || 0,
      });
    }
    const rows = WEEK_ORDER.map((weekday) => {
      const entry = byWeekday.get(weekday);
      return {
        label: DAY_LABELS[weekday],
        date: entry?.date ?? null,
        sales: entry?.sales ?? 0,
        orders: entry?.orders ?? 0,
      };
    });
    const max = Math.max(1, ...rows.map((row) => row.sales));
    // Не «KW n», как в макете: скользящее окно 7 дней задевает две календарные
    // недели — честнее показать реальный диапазон дат
    const dayMonth = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
    const rangeLabel = slice.length
      ? `${dayMonth.format(new Date(slice[0].date))} – ${dayMonth.format(
          new Date(slice[slice.length - 1].date)
        )}`
      : '';
    return { rows, max, hasData: byWeekday.size > 0, rangeLabel };
  }, [salesData]);

  /** Топ товаров по последним 100 заказам (без отменённых). */
  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; count: number; revenue: number }>();
    for (const order of feed.orders) {
      if (order.status === 'cancelled') continue;
      for (const item of order.items || []) {
        const name = stripPromoLabels(item.name);
        const entry = map.get(name) || { name, count: 0, revenue: 0 };
        entry.count += Number(item.quantity) || 0;
        entry.revenue += (Number(item.price) || 0) * (Number(item.quantity) || 0);
        map.set(name, entry);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
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

  return (
    <div className="flex flex-col gap-4 p-4 pt-6 lg:gap-6 lg:p-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[32px] font-extrabold leading-[38px] tracking-[-.02em] text-gray-900">
            Аналитика
          </h1>
          <p className="m-0 text-base leading-6 text-gray-600">
            Последние 7 дней · топ товаров по последним 100 заказам
          </p>
        </div>
        <button type="button" disabled title="Выбор периода появится вместе с расширенной аналитикой" className={`${btnGhost} hidden h-12 px-6 text-lg lg:inline-flex`}>
          Изменить период
        </button>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[2fr_1fr] lg:gap-6">
        {/* Заказы по дням — реальные данные */}
        <Card className="flex flex-col gap-6 p-4 lg:p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="m-0 text-xl font-extrabold leading-7 tracking-[-.01em] text-gray-900 lg:text-2xl lg:leading-[30px]">
              Выручка по дням
            </h2>
            <span className="text-sm leading-5 text-gray-500 tabular-nums">{chart.rangeLabel}</span>
          </div>
          {statsFailed ? (
            <LoadError
              framed={false}
              title="Статистика не загрузилась"
              detail={statsState.error}
              onRetry={statsState.reload}
            />
          ) : chart.hasData ? (
            <div className="flex h-[220px] items-end gap-2 lg:gap-4">
              {chart.rows.map((row, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-2">
                  <span
                    className="flex w-full items-end justify-center"
                    style={{ height: 180 }}
                    title={
                      row.date
                        ? `${dateDDMMYYYY(row.date)} · ${euro(row.sales)}${
                            row.orders ? ` · ${row.orders} заказов` : ''
                          }`
                        : 'Нет данных за этот день'
                    }
                  >
                    {/* Тон как в макете: чем выше выручка дня, тем насыщеннее бар */}
                    <span
                      className="w-4/5 rounded-t-lg bg-[#B8956B] transition-all"
                      style={{
                        height: Math.max(4, Math.round((row.sales / chart.max) * 180) || 4),
                        opacity: row.sales > 0 ? 0.35 + 0.65 * (row.sales / chart.max) : 0.25,
                      }}
                    />
                  </span>
                  <span className="text-sm leading-5 text-gray-400">{row.label}</span>
                  {/* Мобилка: колонка ~42px — сумма без центов, иначе не влезает */}
                  <span className="whitespace-nowrap text-[10px] leading-4 text-gray-500 tabular-nums lg:hidden">
                    {euroWhole(row.sales)}
                  </span>
                  <span className="hidden text-xs leading-4 text-gray-500 tabular-nums lg:block">
                    {euro(row.sales)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-16 text-center text-gray-500">Нет данных о продажах</div>
          )}
        </Card>

        {/* Score — демо */}
        <Card className="flex flex-col gap-4 p-4 lg:p-6">
          <span className="flex items-center gap-2">
            <SectionLabel>Score заведения</SectionLabel>
            <DemoTag />
          </span>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-extrabold leading-10 tracking-[-.02em] text-gray-900 tabular-nums">
              82
            </span>
            <span className="text-base leading-6 text-gray-600">из 100</span>
            <span className="text-sm font-bold leading-5 text-[#15803D]">↑ 4</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-gray-100">
            <span className="block h-2 w-[82%] bg-[#B8956B]" />
          </div>
          <div className="h-px bg-gray-200" />
          <div className="flex flex-col gap-3">
            {[
              { label: 'Качество меню', value: 92, color: '#15803D' },
              { label: 'Отзывы', value: 88, color: '#15803D' },
              { label: 'Время доставки', value: 61, color: '#D42A47' },
              { label: 'Отмены', value: 74, color: '#713F12' },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3">
                <span className="flex-1 text-base leading-6 text-gray-900">{row.label}</span>
                <span className="text-base font-bold leading-6 tabular-nums" style={{ color: row.color }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:gap-6">
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

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-6">
        {/* Топ товаров — реальные данные */}
        <Card>
          <div className="border-b border-gray-200 p-4 lg:p-6">
            <h2 className="m-0 text-xl font-extrabold leading-7 tracking-[-.01em] text-gray-900 lg:text-2xl lg:leading-[30px]">
              Топ товаров
            </h2>
          </div>
          <div className="grid grid-cols-[32px_1fr_72px_96px] gap-4 border-b border-gray-200 bg-gray-100 px-4 py-3 text-xs font-bold uppercase leading-4 tracking-[.04em] text-gray-600 lg:px-6">
            <span>#</span>
            <span>Товар</span>
            <span className="text-right">Шт.</span>
            <span className="text-right">Выручка</span>
          </div>
          {feedFailed ? (
            <LoadError framed={false} title="Заказы не загрузились" detail={feed.error} onRetry={feed.reload} />
          ) : topProducts.length ? (
            topProducts.map((product, i) => (
              <div
                key={product.name}
                className={`grid grid-cols-[32px_1fr_72px_96px] items-center gap-4 px-4 py-4 transition hover:bg-[#FAF7F2] lg:px-6 ${
                  i === topProducts.length - 1 ? '' : 'border-b border-gray-200'
                }`}
              >
                <span className="text-base font-bold leading-6 text-[#9A7A56] tabular-nums">{i + 1}</span>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-base leading-6 text-gray-900">
                  {product.name}
                </span>
                <span className="text-right text-base font-bold leading-6 text-gray-900 tabular-nums">
                  {product.count}
                </span>
                <span className="text-right text-base leading-6 text-gray-900 tabular-nums">
                  {euro(product.revenue)}
                </span>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-gray-500">Пока нет данных по заказам</div>
          )}
        </Card>

        {/* Рекомендации */}
        <div
          className="flex flex-col gap-4 rounded-2xl p-6 lg:p-8"
          style={{
            background:
              'radial-gradient(120% 140% at 85% 10%, rgba(212,42,71,.55) 0%, rgba(212,42,71,0) 55%), linear-gradient(135deg, #B8956B 0%, #7C6145 60%, #4A3826 100%)',
          }}
        >
          <span className="text-xs font-bold uppercase leading-4 tracking-[.04em] text-white/70">
            Рекомендации
          </span>
          <span className="text-xl font-extrabold leading-7 text-white lg:text-2xl lg:leading-[30px]">
            {productsFailed
              ? 'Каталог не загрузился — рекомендации по фото недоступны'
              : !productsState.data
                ? 'Загрузка каталога…'
                : productsWithoutPhoto > 0
                  ? `Добавьте фото к ${productsWithoutPhoto} товарам — карточки с фото заказывают чаще`
                  : 'У всех товаров есть фото — отличная витрина!'}
          </span>
          <div className="flex flex-col gap-2 text-base leading-6 text-white/85">
            <span className="flex items-center gap-2">
              · Сократите время сборки в пятницу — там теряется 6 минут <DemoTag />
            </span>
            <span className="flex items-center gap-2">
              · Включите Zone 3 на выходные: 34 отказа по адресу <DemoTag />
            </span>
          </div>
          <div className="flex-1" />
          <a
            href="/admin/products"
            className="inline-flex h-14 w-fit cursor-pointer items-center rounded-xl border-none bg-[#F5F0E8] px-8 text-lg font-bold leading-5 text-[#7C6145] no-underline transition hover:bg-[#EBE0CE] lg:text-xl"
          >
            Загрузить фото товаров
          </a>
        </div>
      </div>
    </div>
  );
}
