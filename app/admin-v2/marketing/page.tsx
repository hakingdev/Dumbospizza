'use client';

/**
 * Маркетинг (канва D8, узел 40:1755). Акции, промокоды и баннер — реальные
 * данные (показатели акций — orderCount/revenueTotal из админ-вью, применения
 * промокодов — usageCount); штампкарты и push — демо (таких механик пока нет).
 */

import { useState } from 'react';
import {
  useCoupons,
  useJson,
  usePromotions,
} from '../../../components/admin-v2/hooks';
import { dateDDMMYYYY, euro } from '../../../components/admin-v2/format';
import {
  Card,
  DemoTag,
  Icon,
  LoadError,
  Loading,
  btnGhost,
  btnOutline,
  btnPrimary,
  btnSoft,
} from '../../../components/admin-v2/ui';

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

const PROMO_TYPE_LABELS: Record<string, string> = {
  percent: 'Скидка %',
  fixed: 'Скидка €',
  bogo: '2+1',
  gratis: 'Gratis',
};

function Toggle({
  on,
  onChange,
  busy,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  busy?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => onChange(!on)}
      className="relative h-[26px] w-11 flex-none cursor-pointer rounded-full border-none transition disabled:opacity-50"
      style={{ background: on ? '#8A6C4C' : '#D1D5DB' }}
    >
      <span
        className="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgba(17,24,39,.24)] transition-all"
        style={{ left: on ? 21 : 3 }}
      />
    </button>
  );
}

/**
 * Статус карточки акции по канве D8: бейдж + подпись справа + набор действий.
 * Считается на клиенте из enabled/validFrom/validTo, чтобы не зависеть от
 * серверного lifecycle (у него !enabled = 'expired').
 */
function promoStatus(promo: any): {
  kind: 'active' | 'scheduled' | 'ending' | 'expired' | 'off';
  badge: { label: string; bg: string; fg: string };
  note: string | null;
} {
  const now = Date.now();
  const from = promo.validFrom ? new Date(promo.validFrom).getTime() : null;
  const to = promo.validTo ? new Date(promo.validTo).getTime() : null;
  if (!promo.enabled) {
    return { kind: 'off', badge: { label: 'Выключена', bg: '#F3F4F6', fg: '#4B5563' }, note: null };
  }
  if (from && now < from) {
    return {
      kind: 'scheduled',
      badge: { label: 'Запланирована', bg: '#F3F4F6', fg: '#4B5563' },
      note: `с ${dateDDMMYYYY(promo.validFrom)}`,
    };
  }
  if (to && now > to) {
    return {
      kind: 'expired',
      badge: { label: 'Завершена', bg: '#F3F4F6', fg: '#4B5563' },
      note: `до ${dateDDMMYYYY(promo.validTo)}`,
    };
  }
  const daysLeft = to ? Math.ceil((to - now) / 86400000) : null;
  if (daysLeft !== null && daysLeft <= 3) {
    return {
      kind: 'ending',
      badge: { label: 'Заканчивается', bg: '#FEF9C3', fg: '#713F12' },
      note: `осталось ${daysLeft} ${plural(daysLeft, 'день', 'дня', 'дней')}`,
    };
  }
  return {
    kind: 'active',
    badge: { label: PROMO_TYPE_LABELS[promo.type] || 'Промо', bg: '#D42A47', fg: '#FFFFFF' },
    note: 'Активна',
  };
}

/** «Mo, Di · до 31.08.2026» — дни из weekdayLabel админ-вью, даты кампании. */
function promoScheduleLine(promo: any): string {
  const days = promo.weekdayLabel || 'Все дни';
  const to = promo.validTo ? `до ${dateDDMMYYYY(promo.validTo)}` : 'без срока';
  return `${days} · ${to}`;
}

export default function MarketingPage() {
  const promotions = usePromotions();
  const coupons = useCoupons();
  const bannersState = useJson<{ banners: any[] }>(`/api/banners?admin=1`);
  const banners = bannersState.data?.banners ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);

  const promosFailed = !!promotions.error && !promotions.data;
  const couponsFailed = !!coupons.error && !coupons.data;
  const bannersFailed = !!bannersState.error && !bannersState.data;
  const allLoaded = !!promotions.data && !!coupons.data && !!bannersState.data;
  const anyFailed = promosFailed || couponsFailed || bannersFailed;

  const activePromos = promotions.promotions.filter((promo) => promo.enabled).length;
  const mainBanner = banners[0];

  const togglePromotion = async (promo: any, next: boolean) => {
    setBusyId(promo._id || promo.id);
    try {
      const res = await fetch(`/api/promotions/${promo._id || promo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) alert(json?.error || 'Не удалось обновить акцию');
    } catch {
      alert('Не удалось обновить акцию');
    }
    promotions.reload();
    setBusyId(null);
  };

  const toggleCoupon = async (coupon: any, next: boolean) => {
    setBusyId(coupon._id);
    try {
      const res = await fetch(`/api/coupons/${coupon._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...coupon, active: next }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) alert(json?.error || 'Не удалось обновить промокод');
    } catch {
      alert('Не удалось обновить промокод');
    }
    coupons.reload();
    setBusyId(null);
  };

  const toggleBanner = async (banner: any, next: boolean) => {
    setBusyId(banner._id);
    try {
      const res = await fetch(`/api/banners/${banner._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...banner, enabled: next }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) alert(json?.error || 'Не удалось обновить баннер');
    } catch {
      alert('Не удалось обновить баннер');
    }
    bannersState.reload();
    setBusyId(null);
  };

  return (
    <div className="flex flex-col gap-4 p-4 pt-6 lg:gap-6 lg:p-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[32px] font-extrabold leading-[38px] tracking-[-.02em] text-gray-900">
            Маркетинг
          </h1>
          <p className="m-0 text-base leading-6 text-gray-600">
            {allLoaded ? (
              <>
                {activePromos} {plural(activePromos, 'активная акция', 'активные акции', 'активных акций')} ·{' '}
                {coupons.coupons.length} {plural(coupons.coupons.length, 'промокод', 'промокода', 'промокодов')} ·{' '}
                {banners.length} {plural(banners.length, 'баннер', 'баннера', 'баннеров')}
              </>
            ) : anyFailed ? (
              'Часть данных не загрузилась'
            ) : (
              'Загрузка…'
            )}
          </p>
        </div>
        <a
          href="/admin/coupons/new"
          className={`${btnPrimary} hidden h-12 px-6 text-lg no-underline lg:inline-flex`}
        >
          Новый промокод
        </a>
      </div>

      {/* Акции */}
      {promotions.loading && !promotions.data ? (
        <Loading />
      ) : promosFailed ? (
        <LoadError title="Акции не загрузились" detail={promotions.error} onRetry={promotions.reload} />
      ) : promotions.promotions.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 lg:gap-6">
          {promotions.promotions.slice(0, 6).map((promo: any) => {
            const id = promo._id || promo.id;
            const status = promoStatus(promo);
            const hasMetrics = (Number(promo.orderCount) || 0) > 0 || (Number(promo.revenueTotal) || 0) > 0;
            return (
              <Card
                key={id}
                className="flex flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(17,24,39,.10)] lg:p-5"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="inline-flex h-6 flex-none items-center rounded-full px-2.5 text-xs font-bold leading-4"
                    style={{ background: status.badge.bg, color: status.badge.fg }}
                  >
                    {status.badge.label}
                  </span>
                  {status.note && (
                    <span className="min-w-0 flex-1 text-xs font-bold leading-4 text-gray-600">
                      {status.note}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="text-lg font-bold leading-6 text-gray-900">
                    {promo.name || promo.internalName}
                  </div>
                  <div className="text-sm leading-5 text-gray-600">
                    {status.kind === 'off' ? `Не запущена · ${promoScheduleLine(promo)}` : promoScheduleLine(promo)}
                  </div>
                </div>
                {hasMetrics && (
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold uppercase leading-4 tracking-[.04em] text-gray-600">
                        Заказов
                      </div>
                      <div className="text-xl font-extrabold leading-6 tracking-[-.01em] text-gray-900 tabular-nums">
                        {Number(promo.orderCount) || 0}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold uppercase leading-4 tracking-[.04em] text-gray-600">
                        Выручка
                      </div>
                      <div className="text-xl font-extrabold leading-6 tracking-[-.01em] text-gray-900 tabular-nums">
                        {euro(promo.revenueTotal)}
                      </div>
                    </div>
                  </div>
                )}
                <div className="mt-auto flex items-center gap-3 pt-1">
                  {status.kind === 'off' ? (
                    <button
                      type="button"
                      disabled={busyId === id}
                      onClick={() => togglePromotion(promo, true)}
                      className={`${btnPrimary} h-10 flex-1 px-4 text-base`}
                    >
                      Запустить акцию
                    </button>
                  ) : status.kind === 'ending' || status.kind === 'expired' ? (
                    <a
                      href={`/admin/promotions/edit/${id}`}
                      className={`${btnSoft} h-10 flex-1 px-4 text-base no-underline`}
                    >
                      Продлить акцию
                    </a>
                  ) : (
                    <>
                      <a
                        href={`/admin/promotions/edit/${id}`}
                        className={`${btnGhost} h-10 px-4 text-base no-underline`}
                      >
                        Редактировать
                      </a>
                      <button
                        type="button"
                        disabled={busyId === id}
                        onClick={() => togglePromotion(promo, false)}
                        className={`${btnGhost} h-10 px-4 text-base`}
                      >
                        Остановить
                      </button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-8 text-center text-gray-500">
          Акций пока нет —{' '}
          <a href="/admin/promotions/new" className="font-bold text-[#8A6C4C] underline">
            создайте первую
          </a>
        </Card>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
        {/* Левая колонка: промокоды + штампкарты */}
        <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
          <Card className="flex flex-col gap-3 p-4 lg:p-6">
            <div className="flex items-center gap-3">
              <h2 className="m-0 flex-1 text-xl font-extrabold leading-7 tracking-[-.01em] text-gray-900 lg:text-2xl lg:leading-[30px]">
                Промокоды
              </h2>
              <a href="/admin/coupons" className={`${btnGhost} h-8 px-3 text-sm no-underline`}>
                Все коды
              </a>
            </div>
            <div className="flex items-center gap-3 text-xs font-bold uppercase leading-4 tracking-[.04em] text-gray-600">
              <span className="w-24 flex-none lg:w-[120px]">Код</span>
              <span className="min-w-0 flex-1">Условие</span>
              <span className="hidden w-[120px] flex-none text-right sm:block">Применений</span>
              <span className="w-16 flex-none text-right lg:w-[100px]">Скидка</span>
              <span className="w-[52px] flex-none text-right lg:w-[60px]">Вкл.</span>
            </div>
            {coupons.loading && !coupons.data ? (
              <Loading />
            ) : couponsFailed ? (
              <LoadError framed={false} title="Промокоды не загрузились" detail={coupons.error} onRetry={coupons.reload} />
            ) : coupons.coupons.length ? (
              coupons.coupons.slice(0, 5).map((coupon: any) => (
                <div
                  key={coupon._id}
                  className="flex items-center gap-3 border-t border-gray-200 py-2 transition hover:bg-[#FAF7F2]"
                >
                  <span className="w-24 flex-none overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold uppercase leading-6 text-[#7C6145] lg:w-[120px]">
                    {coupon.code}
                  </span>
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-base leading-6 text-gray-600">
                    {coupon.minOrderAmount ? `От ${euro(coupon.minOrderAmount)}` : 'Все заказы'}
                    {coupon.usageLimit ? ` · лимит ${coupon.usageLimit}` : ''}
                  </span>
                  <span className="hidden w-[120px] flex-none text-right text-base font-bold leading-6 text-gray-900 tabular-nums sm:block">
                    {Number(coupon.usageCount) || 0}
                  </span>
                  <span className="w-16 flex-none text-right text-base font-bold leading-6 text-gray-900 tabular-nums lg:w-[100px]">
                    −
                    {coupon.discountType === 'percentage'
                      ? `${Number(coupon.discountValue) || 0} %`
                      : euro(coupon.discountValue)}
                  </span>
                  <span className="flex w-[52px] flex-none justify-end lg:w-[60px]">
                    <Toggle
                      on={coupon.active !== false}
                      busy={busyId === coupon._id}
                      label={coupon.active !== false ? 'Выключить промокод' : 'Включить промокод'}
                      onChange={(next) => toggleCoupon(coupon, next)}
                    />
                  </span>
                </div>
              ))
            ) : (
              <div className="border-t border-gray-200 py-8 text-center text-gray-500">
                Промокодов пока нет
              </div>
            )}
          </Card>

          {/* Штампкарты — демо */}
          <div className="flex flex-col gap-4 rounded-2xl border border-[#EBE0CE] bg-[#F5F0E8] p-4 lg:flex-row lg:items-center lg:px-6 lg:py-5">
            <span className="flex-none text-4xl leading-10">🎁</span>
            <div className="min-w-0 flex-1">
              <h3 className="m-0 flex items-center gap-2 text-lg font-bold leading-6 text-gray-900">
                Штампкарты · 10-я пицца бесплатно <DemoTag />
              </h3>
              <p className="m-0 text-sm leading-5 text-gray-600">
                Механики штампов пока нет — работают Treuepunkte (бонусные баллы) в личном кабинете
              </p>
            </div>
            <a href="/admin/loyalty" className={`${btnOutline} h-10 flex-none px-4 text-base no-underline`}>
              Настроить
            </a>
          </div>
        </div>

        {/* Правая колонка 380px: продвижение */}
        <Card className="flex flex-col gap-3 p-4 lg:p-6">
          <h2 className="m-0 text-xl font-extrabold leading-7 tracking-[-.01em] text-gray-900 lg:text-2xl lg:leading-[30px]">
            Продвижение
          </h2>
          <div className="flex items-center gap-3 border-t border-gray-200 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-base font-bold leading-6 text-gray-900">
                Баннер на главной витрине
              </div>
              <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-4 text-gray-600">
                {mainBanner
                  ? mainBanner.title || mainBanner.name || 'Первый баннер ленты'
                  : bannersFailed
                    ? 'Баннеры не загрузились'
                    : bannersState.data
                      ? 'Баннеров пока нет'
                      : 'Загрузка…'}
              </div>
            </div>
            {mainBanner ? (
              <Toggle
                on={mainBanner.enabled !== false}
                busy={busyId === mainBanner._id}
                label={mainBanner.enabled !== false ? 'Выключить баннер' : 'Включить баннер'}
                onChange={(next) => toggleBanner(mainBanner, next)}
              />
            ) : bannersFailed ? (
              <button type="button" onClick={bannersState.reload} className={`${btnSoft} h-8 px-3 text-sm`}>
                Повторить
              </button>
            ) : (
              <a href="/admin/banners" className={`${btnSoft} h-8 px-3 text-sm no-underline`}>
                Создать
              </a>
            )}
          </div>
          <div className="flex items-center gap-3 border-t border-gray-200 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-base font-bold leading-6 text-gray-900">SMS-рассылка</div>
              <div className="text-xs leading-4 text-gray-600">
                Twilio · получатели с согласием из чекаута
              </div>
            </div>
            <a href="/admin/notifications" className={`${btnSoft} h-8 flex-none px-3 text-sm no-underline`}>
              Создать
            </a>
          </div>
          <div className="flex items-center gap-3 border-t border-gray-200 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-base font-bold leading-6 text-gray-900">
                Push-уведомления <DemoTag />
              </div>
              <div className="text-xs leading-4 text-gray-600">
                Появятся вместе с мобильным приложением
              </div>
            </div>
            <Toggle on={false} busy label="Недоступно" onChange={() => {}} />
          </div>
        </Card>
      </div>

      {/* Мобилка: нижние действия (на десктопе — в шапке по канве) */}
      <div className="flex flex-col gap-3 lg:hidden">
        <a href="/admin/coupons/new" className={`${btnPrimary} h-12 w-full text-lg no-underline`}>
          Новый промокод
        </a>
        <a href="/admin/promotions/new" className={`${btnOutline} h-12 w-full text-lg no-underline`}>
          <Icon d="M5 12h14 M12 5v14" size={20} />
          Создать акцию
        </a>
      </div>
    </div>
  );
}
