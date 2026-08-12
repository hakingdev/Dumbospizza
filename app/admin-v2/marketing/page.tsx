'use client';

/**
 * Маркетинг (канва D8 / 09). Акции, промокоды и баннер — реальные данные;
 * штампкарты и push — демо (таких механик пока нет).
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

function promoScheduleLine(promo: any): string {
  const from = promo.validFrom ? dateDDMMYYYY(promo.validFrom) : null;
  const to = promo.validTo ? dateDDMMYYYY(promo.validTo) : null;
  if (from && to) return `${from} – ${to}`;
  if (to) return `до ${to}`;
  if (from) return `с ${from}`;
  return 'без ограничения по датам';
}

function promoDaysLeft(promo: any): number | null {
  if (!promo.validTo) return null;
  const diff = Math.ceil((new Date(promo.validTo).getTime() - Date.now()) / 86400000);
  return diff;
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
        <div className="hidden items-center gap-3 lg:flex">
          <a href="/admin/coupons/new" className={`${btnOutline} h-12 px-6 text-lg no-underline`}>
            Новый промокод
          </a>
          <a href="/admin/promotions/new" className={`${btnPrimary} h-12 px-6 text-lg no-underline`}>
            <Icon d="M5 12h14 M12 5v14" size={20} />
            Создать акцию
          </a>
        </div>
      </div>

      {/* Акции */}
      {promotions.loading && !promotions.data ? (
        <Loading />
      ) : promosFailed ? (
        <LoadError title="Акции не загрузились" detail={promotions.error} onRetry={promotions.reload} />
      ) : promotions.promotions.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 lg:gap-6">
          {promotions.promotions.slice(0, 6).map((promo: any) => {
            const daysLeft = promoDaysLeft(promo);
            const ending = promo.enabled && daysLeft !== null && daysLeft >= 0 && daysLeft <= 3;
            const id = promo._id || promo.id;
            return (
              <Card
                key={id}
                className="flex flex-col gap-4 p-4 transition hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(17,24,39,.10)] lg:p-6"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 items-center rounded-full bg-[#D42A47] px-2.5 text-xs font-bold leading-4 text-white">
                    {PROMO_TYPE_LABELS[promo.type] || 'Промо'}
                  </span>
                  <div className="flex-1" />
                  {ending ? (
                    <span className="inline-flex h-6 items-center rounded-full bg-[#FEF9C3] px-2.5 text-xs font-bold leading-4 text-[#713F12]">
                      Заканчивается
                    </span>
                  ) : promo.enabled ? (
                    <span className="inline-flex h-6 items-center rounded-full bg-[#DCFCE7] px-2.5 text-xs font-bold leading-4 text-[#15803D]">
                      Активна
                    </span>
                  ) : (
                    <span className="inline-flex h-6 items-center rounded-full bg-gray-100 px-2.5 text-xs font-bold leading-4 text-gray-600">
                      Выключена
                    </span>
                  )}
                </div>
                <div>
                  <div className="text-lg font-bold leading-6 text-gray-900">
                    {promo.name || promo.internalName}
                  </div>
                  <div className="text-sm leading-5 text-gray-600">
                    {promoScheduleLine(promo)}
                    {ending && daysLeft !== null ? ` · осталось ${daysLeft} дн.` : ''}
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-2">
                  <a
                    href={`/admin/promotions/edit/${id}`}
                    className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center rounded-xl px-3 text-sm font-bold leading-5 text-gray-900 no-underline transition hover:bg-[#FAF7F2]"
                  >
                    Редактировать
                  </a>
                  <Toggle
                    on={!!promo.enabled}
                    busy={busyId === id}
                    label={promo.enabled ? 'Остановить акцию' : 'Запустить акцию'}
                    onChange={(next) => togglePromotion(promo, next)}
                  />
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

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-6">
        {/* Промокоды */}
        <Card>
          <div className="flex items-center justify-between gap-4 border-b border-gray-200 p-4 lg:p-6">
            <h2 className="m-0 text-xl font-extrabold leading-7 tracking-[-.01em] text-gray-900 lg:text-2xl lg:leading-[30px]">
              Промокоды
            </h2>
            <a href="/admin/coupons" className={`${btnSoft} h-8 px-3 text-sm no-underline`}>
              Все промокоды
            </a>
          </div>
          {coupons.loading && !coupons.data ? (
            <Loading />
          ) : couponsFailed ? (
            <LoadError framed={false} title="Промокоды не загрузились" detail={coupons.error} onRetry={coupons.reload} />
          ) : coupons.coupons.length ? (
            coupons.coupons.slice(0, 5).map((coupon: any, i: number) => (
              <div
                key={coupon._id}
                className={`flex items-center gap-3 px-4 py-4 transition hover:bg-[#FAF7F2] lg:gap-4 lg:px-6 ${
                  i === Math.min(coupons.coupons.length, 5) - 1 ? '' : 'border-b border-gray-200'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold uppercase leading-6 tracking-[.04em] text-gray-900">
                    {coupon.code}
                  </div>
                  <div className="text-sm leading-5 text-gray-600">
                    {coupon.minOrderAmount ? `От ${euro(coupon.minOrderAmount)}` : 'Все заказы'}
                    {coupon.usageLimit ? ` · лимит ${coupon.usageLimit}` : ''}
                  </div>
                </div>
                <span className="text-base font-bold leading-6 text-[#D42A47] tabular-nums">
                  −
                  {coupon.discountType === 'percentage'
                    ? `${Number(coupon.discountValue) || 0} %`
                    : euro(coupon.discountValue)}
                </span>
                <Toggle
                  on={coupon.active !== false}
                  busy={busyId === coupon._id}
                  label={coupon.active !== false ? 'Выключить промокод' : 'Включить промокод'}
                  onChange={(next) => toggleCoupon(coupon, next)}
                />
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-gray-500">Промокодов пока нет</div>
          )}
        </Card>

        <div className="flex flex-col gap-4 lg:gap-6">
          {/* Штампкарты — демо */}
          <div className="flex flex-col gap-4 rounded-2xl border border-[#EBE0CE] bg-[#F5F0E8] p-4 lg:flex-row lg:items-center lg:gap-6 lg:p-6">
            <span className="flex-none text-[40px]">🎁</span>
            <div className="flex-1">
              <h3 className="m-0 mb-1 flex items-center gap-2 text-lg font-bold leading-6 text-gray-900">
                Штампкарты · 10-я пицца бесплатно <DemoTag />
              </h3>
              <p className="m-0 text-sm leading-5 text-gray-600">
                Механики штампов пока нет — работают Treuepunkte (бонусные баллы) в личном кабинете
              </p>
            </div>
            <a
              href="/admin/loyalty"
              className="inline-flex h-10 flex-none cursor-pointer items-center justify-center rounded-xl border border-[#DCC9A9] bg-[#F5F0E8] px-4 text-base font-bold leading-5 text-[#7C6145] no-underline transition hover:bg-[#EBE0CE]"
            >
              Настроить баллы
            </a>
          </div>

          {/* Продвижение */}
          <Card className="flex flex-col gap-4 p-4 lg:p-6">
            <h2 className="m-0 text-xl font-extrabold leading-7 tracking-[-.01em] text-gray-900 lg:text-2xl lg:leading-[30px]">
              Продвижение
            </h2>
            <div className="flex items-center gap-4 border-b border-gray-200 pb-4">
              <div className="min-w-0 flex-1">
                <div className="text-base font-bold leading-6 text-gray-900">
                  Баннер на главной витрине
                </div>
                <div className="overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-5 text-gray-600">
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
            <div className="flex items-center gap-4 border-b border-gray-200 pb-4">
              <div className="min-w-0 flex-1">
                <div className="text-base font-bold leading-6 text-gray-900">SMS-рассылка</div>
                <div className="text-sm leading-5 text-gray-600">
                  Twilio · получатели с согласием из чекаута
                </div>
              </div>
              <a href="/admin/notifications" className={`${btnSoft} h-8 flex-none px-3 text-sm no-underline`}>
                Создать
              </a>
            </div>
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-base font-bold leading-6 text-gray-900">
                  Push-уведомления <DemoTag />
                </div>
                <div className="text-sm leading-5 text-gray-600">
                  Появятся вместе с мобильным приложением
                </div>
              </div>
              <Toggle on={false} busy label="Недоступно" onChange={() => {}} />
            </div>
          </Card>
        </div>
      </div>

      {/* Мобилка: нижние действия */}
      <div className="flex flex-col gap-3 lg:hidden">
        <a href="/admin/promotions/new" className={`${btnPrimary} h-12 w-full text-lg no-underline`}>
          <Icon d="M5 12h14 M12 5v14" size={20} />
          Создать акцию
        </a>
        <a href="/admin/coupons/new" className={`${btnOutline} h-12 w-full text-lg no-underline`}>
          Новый промокод
        </a>
      </div>
    </div>
  );
}
