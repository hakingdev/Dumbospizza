'use client';

/**
 * Push — рассылка уведомлений в приложение «Dumbo Slice» (Expo Push API).
 * Композер + превью на телефоне + аудитория + отправка/план/тест + история.
 * Бэкенд: /api/admin/push*, движок lib/push/*, крон /api/cron/push-campaigns.
 * Рекламные push (kind promo) получают только устройства с согласием.
 */

import { useMemo, useState } from 'react';
import {
  useCategories,
  useCoupons,
  useJson,
  useProducts,
  type AdminProduct,
} from '../../../components/admin-v2/hooks';
import { dateDDMMYYYY, timeHHmm } from '../../../components/admin-v2/format';
import {
  Card,
  EmptyState,
  ErrorBanner,
  FilterChip,
  LoadError,
  Loading,
  PageHeader,
  SectionLabel,
  TabPill,
  btnGhost,
  btnGhostDanger,
  btnOutline,
  btnPrimary,
  btnSoft,
} from '../../../components/admin-v2/ui';

/* Лимиты — те же, что в lib/push/validate.ts (сервер режет длиннее). */
const TITLE_MAX = 65;
const BODY_MAX = 240;
const TITLE_SOFT = 40;
const BODY_SOFT = 120;

type Kind = 'promo' | 'info';
type Audience = 'all' | 'ios' | 'android';
type LinkType = 'none' | 'home' | 'product' | 'category' | 'cart' | 'loyalty';

type AudienceCounts = { all: number; ios: number; android: number };

type Campaign = {
  id: string;
  title: string;
  body: string;
  imageUrl?: string | null;
  data: { kind?: string; url?: string; promoCode?: string };
  audience: Audience;
  status: 'scheduled' | 'sending' | 'sent' | 'failed' | 'canceled';
  scheduledAt?: string | null;
  sentAt?: string | null;
  createdAt: string;
  recipientCount: number;
  acceptedCount: number;
  deliveredCount: number;
  errorCount: number;
  lastError?: string | null;
};

type PushState = {
  campaigns: Campaign[];
  audience: { promo: AudienceCounts; info: AudienceCounts };
};

const fieldCls =
  'h-12 w-full rounded-xl border border-gray-300 bg-white px-4 text-base leading-6 text-gray-900 outline-none transition focus:border-[#8A6C4C] disabled:cursor-not-allowed disabled:bg-gray-100';

const LINK_LABELS: Record<LinkType, string> = {
  none: 'Без ссылки',
  home: 'Главная',
  product: 'Товар',
  category: 'Категория',
  cart: 'Корзина',
  loyalty: 'Бонусы',
};

const STATUS_META: Record<Campaign['status'], { label: string; bg: string; fg: string }> = {
  scheduled: { label: 'Запланирован', bg: '#FEF9C3', fg: '#713F12' },
  sending: { label: 'Отправляется', bg: '#F5F0E8', fg: '#7C6145' },
  sent: { label: 'Отправлен', bg: '#DCFCE7', fg: '#166534' },
  failed: { label: 'Ошибка', bg: '#FDE6E7', fg: '#B91C1C' },
  canceled: { label: 'Отменён', bg: '#F3F4F6', fg: '#4B5563' },
};

const AUDIENCE_LABELS: Record<Audience, string> = { all: 'Все', ios: 'iOS', android: 'Android' };

function productCategoryId(p: AdminProduct): string {
  if (!p.category) return '';
  return typeof p.category === 'string' ? p.category : p.category._id;
}

/** «Сегодня 18:00» / «27.11.2026 18:00» */
function whenLabel(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return `${sameDay ? 'Сегодня' : dateDDMMYYYY(d)} ${timeHHmm(d)}`;
}

/** Значение для <input type="datetime-local"> в локальном времени. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Counter({ value, soft, max }: { value: number; soft: number; max: number }) {
  const color = value > max ? '#D42A47' : value > soft ? '#B45309' : '#6B7280';
  return (
    <span className="text-xs font-bold tabular-nums" style={{ color }}>
      {value}/{max}
    </span>
  );
}

/* ------------------------------------------------------------ превью */

function PhonePreview({
  title,
  body,
  imageUrl,
  linkLabel,
  promoCode,
}: {
  title: string;
  body: string;
  imageUrl: string;
  linkLabel: string | null;
  promoCode: string;
}) {
  const now = new Date();
  const showImage = /^https:\/\/\S+$/i.test(imageUrl.trim());
  return (
    <div className="mx-auto w-full max-w-[320px]">
      <div className="rounded-[44px] bg-gray-900 p-3 shadow-[0_8px_32px_rgba(17,24,39,.25)]">
        <div className="relative flex min-h-[520px] flex-col overflow-hidden rounded-[34px] bg-gradient-to-b from-[#5F4934] via-[#8A6C4C] to-[#C9A97E] px-3 pb-6 pt-3">
          <div className="mx-auto h-6 w-24 rounded-full bg-gray-900" />
          <div className="mt-6 text-center text-white">
            <div className="text-sm font-bold opacity-80">
              {now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <div className="text-[64px] font-extrabold leading-[68px] tracking-[-.02em]">{timeHHmm(now)}</div>
          </div>
          <div className="mt-6 rounded-[20px] bg-white/85 p-3 shadow-[0_2px_8px_rgba(17,24,39,.15)] backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-[6px] bg-[#8A6C4C] text-[11px]">
                🍕
              </span>
              <span className="min-w-0 flex-1 text-[11px] font-bold uppercase tracking-[.04em] text-gray-600">
                Dumbo Slice
              </span>
              <span className="text-[11px] text-gray-500">jetzt</span>
            </div>
            <div className="mt-1.5 flex gap-2">
              <div className="min-w-0 flex-1">
                <div className="break-words text-[15px] font-bold leading-5 text-gray-900">
                  {title || 'Заголовок уведомления'}
                </div>
                <div className="mt-0.5 line-clamp-4 break-words text-[14px] leading-[19px] text-gray-800">
                  {body || 'Текст уведомления появится здесь'}
                </div>
              </div>
              {showImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl.trim()} alt="" className="h-12 w-12 flex-none rounded-lg object-cover" />
              )}
            </div>
          </div>
          <div className="mt-auto flex flex-col items-center gap-1 pt-6 text-center text-xs font-bold text-white/90">
            {linkLabel && <span>Тап открывает: {linkLabel}</span>}
            {promoCode && <span>Промокод в приложении: {promoCode}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ страница */

export default function PushPage() {
  const state = useJson<PushState>('/api/admin/push', 30_000);
  const products = useProducts();
  const categories = useCategories();
  const coupons = useCoupons();

  const [kind, setKind] = useState<Kind>('promo');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [linkType, setLinkType] = useState<LinkType>('home');
  const [productId, setProductId] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [audience, setAudience] = useState<Audience>('all');
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60_000)));
  const [testTarget, setTestTarget] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const counts = state.data?.audience?.[kind] ?? null;
  const recipients = counts ? counts[audience] : null;

  const url = useMemo(() => {
    if (linkType === 'home') return '/home';
    if (linkType === 'cart') return '/cart';
    if (linkType === 'loyalty') return '/account/loyalty';
    if (linkType === 'product') return productId ? `/product/${productId}` : null;
    if (linkType === 'category') return categorySlug ? `/menu?category=${encodeURIComponent(categorySlug)}` : null;
    return null;
  }, [linkType, productId, categorySlug]);

  const linkLabel = useMemo(() => {
    if (linkType === 'none') return null;
    if (linkType === 'product') {
      const p = products.products.find((x) => x._id === productId);
      return p ? `товар «${p.name}»` : null;
    }
    if (linkType === 'category') {
      const c = categories.categories.find((x) => x.slug === categorySlug);
      return c ? `категорию «${c.name}»` : null;
    }
    return LINK_LABELS[linkType].toLowerCase();
  }, [linkType, productId, categorySlug, products.products, categories.categories]);

  const productsByCategory = useMemo(() => {
    const groups = categories.categories.map((c) => ({
      id: c._id,
      name: c.name,
      items: products.products.filter((p) => productCategoryId(p) === c._id),
    }));
    const known = new Set(categories.categories.map((c) => c._id));
    const rest = products.products.filter((p) => !known.has(productCategoryId(p)));
    if (rest.length) groups.push({ id: '_rest', name: 'Без категории', items: rest });
    return groups.filter((g) => g.items.length);
  }, [products.products, categories.categories]);

  const activeCoupons = coupons.coupons.filter((c: any) => c.active !== false);

  const tooLong = title.length > TITLE_MAX || body.length > BODY_MAX;
  const linkMissing = (linkType === 'product' || linkType === 'category') && !url;
  const canSubmit = !!title.trim() && !!body.trim() && !tooLong && !linkMissing && !busy;

  const payload = () => ({
    title: title.trim(),
    body: body.trim(),
    imageUrl: imageUrl.trim() || null,
    kind,
    url,
    promoCode: promoCode || null,
    audience,
  });

  const submit = async () => {
    if (!canSubmit) return;
    const when = schedule ? new Date(scheduledAt) : null;
    if (schedule && (!when || Number.isNaN(when.getTime()) || when.getTime() < Date.now())) {
      setNotice({ tone: 'error', text: 'Выберите время отправки в будущем' });
      return;
    }
    const who = `${recipients ?? '?'} ${kind === 'promo' ? 'устройствам с согласием на рекламу' : 'активным устройствам'}`;
    const question = when
      ? `Запланировать push на ${whenLabel(when.toISOString())} (${AUDIENCE_LABELS[audience]})?`
      : `Отправить push сейчас ${who} (${AUDIENCE_LABELS[audience]})?`;
    if (!window.confirm(question)) return;

    setBusy('submit');
    setNotice(null);
    try {
      const res = await fetch('/api/admin/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload(), scheduledAt: when ? when.toISOString() : null }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setNotice({ tone: 'error', text: json?.error || 'Не удалось отправить' });
      } else {
        const c: Campaign = json.campaign;
        setNotice({
          tone: c?.status === 'failed' ? 'error' : 'ok',
          text: when
            ? `Запланировано на ${whenLabel(c?.scheduledAt)}`
            : c?.status === 'failed'
              ? `Не отправлено: ${c.lastError || 'ошибка Expo'}`
              : `Отправлено: ${c?.acceptedCount ?? 0} из ${c?.recipientCount ?? 0} принято Expo`,
        });
        setTitle('');
        setBody('');
        setImageUrl('');
        setPromoCode('');
        setSchedule(false);
      }
    } catch {
      setNotice({ tone: 'error', text: 'Не удалось отправить' });
    }
    setBusy(null);
    state.reload();
  };

  const sendTest = async () => {
    const target = testTarget.trim();
    if (!target || !title.trim() || !body.trim() || tooLong || linkMissing) return;
    setBusy('test');
    setNotice(null);
    const isToken = /^Expo(nent)?PushToken\[/.test(target);
    try {
      const res = await fetch('/api/admin/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload(), ...(isToken ? { token: target } : { phoneNumber: target }) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setNotice({ tone: 'error', text: json?.error || 'Тест не отправлен' });
      } else if (json.accepted === json.deviceCount) {
        setNotice({ tone: 'ok', text: `Тест отправлен на ${json.deviceCount} устр.` });
      } else {
        setNotice({
          tone: 'error',
          text: `Принято ${json.accepted} из ${json.deviceCount}: ${(json.errors || []).join(', ')}`,
        });
      }
    } catch {
      setNotice({ tone: 'error', text: 'Тест не отправлен' });
    }
    setBusy(null);
  };

  const campaignAction = async (id: string, action: 'cancel' | 'send-now') => {
    if (action === 'send-now' && !window.confirm('Отправить этот push прямо сейчас?')) return;
    if (action === 'cancel' && !window.confirm('Отменить запланированный push?')) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/push/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) alert(json?.error || 'Не удалось выполнить действие');
    } catch {
      alert('Не удалось выполнить действие');
    }
    setBusy(null);
    state.reload();
  };

  const failed = !!state.error && !state.data;
  const promoCounts = state.data?.audience?.promo;

  return (
    <div className="flex flex-col gap-4 p-4 pt-6 lg:gap-6 lg:p-0">
      <PageHeader
        title="Push-уведомления"
        subtitle={
          promoCounts
            ? `Приложение Dumbo Slice · с согласием на рекламу: ${promoCounts.all} (iOS ${promoCounts.ios} · Android ${promoCounts.android})`
            : failed
              ? 'Данные не загрузились'
              : 'Загрузка…'
        }
      />

      {notice && (
        notice.tone === 'error' ? (
          <ErrorBanner text={notice.text} onRetry={() => setNotice(null)} retryLabel="Скрыть" />
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-[#BBF7D0] bg-[#DCFCE7] px-4 py-3">
            <span className="min-w-0 flex-1 text-sm font-bold leading-5 text-[#166534]">{notice.text}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="h-8 flex-none cursor-pointer rounded-lg border-none bg-white px-3 text-sm font-bold text-[#166534]"
            >
              Скрыть
            </button>
          </div>
        )
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        {/* Композер */}
        <Card className="flex flex-col gap-5 p-4 lg:p-6">
          <div className="flex flex-col gap-2">
            <SectionLabel>Тип</SectionLabel>
            <div className="flex flex-wrap gap-1">
              <TabPill label="Акция / реклама" active={kind === 'promo'} onClick={() => setKind('promo')} />
              <TabPill label="Информация" active={kind === 'info'} onClick={() => setKind('info')} />
            </div>
            <p className="m-0 text-sm leading-5 text-gray-600">
              {kind === 'promo'
                ? 'Получат только устройства, где клиент разрешил рекламные уведомления.'
                : 'Служебное сообщение для всех устройств (например, «сегодня закрыто»). Без рекламы — иначе нужен тип «Акция».'}
            </p>
          </div>

          <label className="flex flex-col gap-2">
            <span className="flex items-center justify-between gap-3">
              <SectionLabel>Заголовок</SectionLabel>
              <Counter value={title.length} soft={TITLE_SOFT} max={TITLE_MAX} />
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={TITLE_MAX + 20}
              placeholder="🍕 2+1 auf alle Pizzen"
              className={fieldCls}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="flex items-center justify-between gap-3">
              <SectionLabel>Текст</SectionLabel>
              <Counter value={body.length} soft={BODY_SOFT} max={BODY_MAX} />
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={BODY_MAX + 40}
              placeholder="Nur heute: Bestelle zwei Pizzen und die dritte geht auf uns."
              className={`${fieldCls} h-auto resize-y py-3`}
            />
            <span className="text-xs leading-4 text-gray-500">
              Клиенты видят текст на немецком. В свёрнутом виде видно ~{TITLE_SOFT} символов заголовка и ~{BODY_SOFT} текста.
            </span>
          </label>

          <label className="flex flex-col gap-2">
            <SectionLabel>Картинка (необязательно)</SectionLabel>
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…/banner.jpg"
              className={fieldCls}
            />
            {imageUrl.trim() && !/^https:\/\/\S+$/i.test(imageUrl.trim()) && (
              <span className="text-xs font-bold text-[#D42A47]">Нужна ссылка, начинающаяся с https://</span>
            )}
          </label>

          <div className="flex flex-col gap-2">
            <SectionLabel>Что откроется по тапу</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(LINK_LABELS) as LinkType[]).map((t) => (
                <FilterChip key={t} label={LINK_LABELS[t]} active={linkType === t} onClick={() => setLinkType(t)} />
              ))}
            </div>
            {linkType === 'product' && (
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className={fieldCls}>
                <option value="">{products.loading ? 'Загрузка товаров…' : 'Выберите товар'}</option>
                {productsByCategory.map((g) => (
                  <optgroup key={g.id} label={g.name}>
                    {g.items.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}
                        {p.available === false ? ' (нет в наличии)' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
            {linkType === 'category' && (
              <select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className={fieldCls}>
                <option value="">{categories.loading ? 'Загрузка категорий…' : 'Выберите категорию'}</option>
                {categories.categories
                  .filter((c) => c.slug)
                  .map((c) => (
                    <option key={c._id} value={c.slug}>
                      {c.name}
                      {c.active === false ? ' (скрыта)' : ''}
                    </option>
                  ))}
              </select>
            )}
          </div>

          <label className="flex flex-col gap-2">
            <SectionLabel>Промокод (необязательно)</SectionLabel>
            <select value={promoCode} onChange={(e) => setPromoCode(e.target.value)} className={fieldCls}>
              <option value="">Без промокода</option>
              {activeCoupons.map((c: any) => (
                <option key={c._id} value={String(c.code).toUpperCase()}>
                  {String(c.code).toUpperCase()} · −
                  {c.discountType === 'percentage' ? `${c.discountValue} %` : `${c.discountValue} €`}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-2">
            <SectionLabel>Аудитория</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {(['all', 'ios', 'android'] as Audience[]).map((a) => (
                <FilterChip
                  key={a}
                  label={a === 'all' ? 'Все устройства' : AUDIENCE_LABELS[a]}
                  count={counts ? counts[a] : undefined}
                  active={audience === a}
                  onClick={() => setAudience(a)}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>Когда</SectionLabel>
            <div className="flex flex-wrap gap-1">
              <TabPill label="Сейчас" active={!schedule} onClick={() => setSchedule(false)} />
              <TabPill label="Запланировать" active={schedule} onClick={() => setSchedule(true)} />
            </div>
            {schedule && (
              <input
                type="datetime-local"
                value={scheduledAt}
                min={toLocalInput(new Date())}
                onChange={(e) => setScheduledAt(e.target.value)}
                className={`${fieldCls} max-w-xs`}
              />
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center">
            <button
              type="button"
              disabled={!canSubmit || recipients === 0}
              onClick={submit}
              className={`${btnPrimary} h-12 px-6 text-lg`}
            >
              {busy === 'submit' ? 'Отправка…' : schedule ? 'Запланировать' : 'Отправить сейчас'}
            </button>
            <span className="text-sm leading-5 text-gray-600">
              {recipients === null
                ? ''
                : recipients === 0
                  ? 'Нет подходящих устройств'
                  : `Получателей: ${recipients}`}
            </span>
          </div>

          <div className="flex flex-col gap-2 rounded-xl bg-[#FAF7F2] p-3">
            <SectionLabel>Тест на одно устройство</SectionLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={testTarget}
                onChange={(e) => setTestTarget(e.target.value)}
                placeholder="Телефон (+49…) или ExponentPushToken[…]"
                className={fieldCls}
              />
              <button
                type="button"
                disabled={!testTarget.trim() || !title.trim() || !body.trim() || tooLong || linkMissing || !!busy}
                onClick={sendTest}
                className={`${btnOutline} h-12 flex-none px-5 text-base`}
              >
                {busy === 'test' ? 'Отправка…' : 'Тест'}
              </button>
            </div>
            <span className="text-xs leading-4 text-gray-500">
              Тест игнорирует согласие на рекламу и не попадает в историю.
            </span>
          </div>
        </Card>

        {/* Превью */}
        <div className="flex flex-col gap-3 lg:sticky lg:top-6">
          <SectionLabel>Превью на экране блокировки</SectionLabel>
          <PhonePreview
            title={title}
            body={body}
            imageUrl={imageUrl}
            linkLabel={linkLabel}
            promoCode={promoCode}
          />
        </div>
      </div>

      {/* История */}
      <Card className="flex flex-col gap-3 p-4 lg:p-6">
        <div className="flex items-center gap-3">
          <h2 className="m-0 flex-1 text-xl font-extrabold leading-7 tracking-[-.01em] text-gray-900 lg:text-2xl lg:leading-[30px]">
            История
          </h2>
          <button type="button" onClick={state.reload} className={`${btnGhost} h-8 px-3 text-sm`}>
            Обновить
          </button>
        </div>
        {state.error && state.data && <ErrorBanner text="История не обновилась" onRetry={state.reload} />}
        {state.loading && !state.data ? (
          <Loading />
        ) : failed ? (
          <LoadError framed={false} title="История не загрузилась" detail={state.error} onRetry={state.reload} />
        ) : state.data?.campaigns?.length ? (
          <>
            <div className="hidden items-center gap-3 text-xs font-bold uppercase leading-4 tracking-[.04em] text-gray-600 xl:flex">
              <span className="min-w-0 flex-1">Уведомление</span>
              <span className="w-[130px] flex-none">Статус</span>
              <span className="w-[90px] flex-none text-right">Получат.</span>
              <span className="w-[100px] flex-none text-right">Доставлено</span>
              <span className="w-[80px] flex-none text-right">Ошибки</span>
              <span className="w-[150px] flex-none" />
            </div>
            {state.data.campaigns.map((c) => {
              const meta = STATUS_META[c.status] || STATUS_META.sent;
              const pendingReceipts = c.status === 'sent' && c.acceptedCount > c.deliveredCount + c.errorCount;
              return (
                <div
                  key={c.id}
                  className="flex flex-col gap-2 border-t border-gray-200 py-3 xl:flex-row xl:items-center xl:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold leading-6 text-gray-900">
                      {c.title}
                    </div>
                    <div className="overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-5 text-gray-600">
                      {c.data?.kind === 'info' ? 'Инфо' : 'Акция'} · {AUDIENCE_LABELS[c.audience] || c.audience} ·{' '}
                      {c.status === 'scheduled'
                        ? `на ${whenLabel(c.scheduledAt).replace('Сегодня', 'сегодня')}`
                        : whenLabel(c.sentAt || c.createdAt)}
                      {c.data?.promoCode ? ` · ${c.data.promoCode}` : ''}
                    </div>
                    {c.lastError && (c.status === 'failed' || c.errorCount > 0 || c.recipientCount === 0) && (
                      <div className="text-xs font-bold leading-4 text-[#B91C1C]">{c.lastError}</div>
                    )}
                  </div>
                  <span className="w-[130px] flex-none">
                    <span
                      className="inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold leading-4"
                      style={{ background: meta.bg, color: meta.fg }}
                    >
                      {meta.label}
                    </span>
                  </span>
                  <div className="flex gap-4 text-sm xl:contents">
                    <span className="flex-none tabular-nums text-gray-900 xl:w-[90px] xl:text-right xl:text-base xl:font-bold">
                      <span className="text-gray-500 xl:hidden">Получат. </span>
                      {c.status === 'scheduled' ? '—' : c.recipientCount}
                    </span>
                    <span className="flex-none tabular-nums text-[#15803D] xl:w-[100px] xl:text-right xl:text-base xl:font-bold">
                      <span className="text-gray-500 xl:hidden">Доставлено </span>
                      {c.status === 'scheduled' ? '—' : c.deliveredCount}
                      {pendingReceipts && (
                        <span title="Ждём подтверждения от Apple/Google (до 15 мин)" className="text-gray-400">
                          {' '}
                          …
                        </span>
                      )}
                    </span>
                    <span
                      className="flex-none tabular-nums xl:w-[80px] xl:text-right xl:text-base xl:font-bold"
                      style={{ color: c.errorCount ? '#D42A47' : '#6B7280' }}
                    >
                      <span className="text-gray-500 xl:hidden">Ошибки </span>
                      {c.status === 'scheduled' ? '—' : c.errorCount}
                    </span>
                  </div>
                  <span className="flex flex-none gap-1 xl:w-[150px] xl:justify-end">
                    {c.status === 'scheduled' && (
                      <>
                        <button
                          type="button"
                          disabled={busy === c.id}
                          onClick={() => campaignAction(c.id, 'send-now')}
                          className={`${btnSoft} h-8 px-3 text-sm`}
                        >
                          Сейчас
                        </button>
                        <button
                          type="button"
                          disabled={busy === c.id}
                          onClick={() => campaignAction(c.id, 'cancel')}
                          className={`${btnGhostDanger} h-8 px-3 text-sm`}
                        >
                          Отменить
                        </button>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </>
        ) : (
          <EmptyState
            title="Push ещё не отправляли"
            note="Здесь появятся отправленные и запланированные уведомления со статистикой доставки."
          />
        )}
      </Card>
    </div>
  );
}
