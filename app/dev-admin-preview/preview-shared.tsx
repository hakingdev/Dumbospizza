'use client';

/**
 * ВРЕМЕННАЯ страница визуальной проверки нового портала БЕЗ логина:
 * мок-сессия (только клиентский гейт) + мок-fetch с фикстурами из
 * дизайн-канвы. Никакие мутации до реального API не доходят.
 * Удалить после приёмки: app/dev-admin-preview/
 */

import { SessionProvider } from 'next-auth/react';
import { notFound } from 'next/navigation';
import AdminV2Shell from '../../components/admin-v2/shell';
import HomePage from '../admin-v2/page';
import OrdersPage from '../admin-v2/orders/page';
import MenuPage from '../admin-v2/menu/page';
import VenuePage from '../admin-v2/venue/page';
import ReviewsPage from '../admin-v2/reviews/page';
import AnalyticsPage from '../admin-v2/analytics/page';
import MarketingPage from '../admin-v2/marketing/page';
import SettingsPage from '../admin-v2/settings/page';
import HelpPage from '../admin-v2/help/page';
import NewsPage from '../admin-v2/news/page';

/* ------------------------------------------------------------ фикстуры */

function todayAt(hhmm: string, minusDays = 0): string {
  const [h, m] = hhmm.split(':').map(Number);
  const date = new Date();
  date.setDate(date.getDate() - minusDays);
  date.setHours(h, m, 0, 0);
  return date.toISOString();
}

/** Локальный YYYY-MM-DD, как date у реального getDailySales (to_char). */
function dayKey(minusDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() - minusDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

const ORDERS = [
  {
    _id: 'prev-1042',
    orderNumber: '260810042',
    customerName: 'Anna Vogel',
    phoneNumber: '+49 971 555 218',
    deliveryType: 'delivery',
    deliveryZone: { id: 'z1', name: 'Zone 1' },
    deliveryAddress: { street: 'Kurhausstr.', houseNumber: '12', postalCode: '97688', city: 'Bad Kissingen' },
    items: [
      {
        name: 'Pizza Salami',
        quantity: 2,
        price: 10.5,
        size: { id: 's32', name: '32 cm', size: '32', price: 10.5 },
        extras: { toppings: [{ id: 't1', name: 'extra Käse', price: 1.5 }] },
      },
      { name: 'Sushi Set Dumbo · 12 St.', quantity: 1, price: 14.5 },
      { name: 'Coca-Cola 0,5 l', quantity: 1, price: 3.0 },
    ],
    subtotal: 38.5,
    deliveryFee: 0,
    discount: { code: 'DUMBO10', amount: 3.85, type: 'percentage' },
    total: 34.65,
    paymentMethod: 'online',
    paymentStatus: 'completed',
    status: 'new',
    notes: 'Bitte an der Seitentür klingeln',
    createdAt: todayAt('18:42'),
    statusUpdates: [{ status: 'new', timestamp: todayAt('18:42') }],
  },
  {
    _id: 'prev-1041',
    orderNumber: '260810041',
    customerName: 'Stefan Braun',
    phoneNumber: '+49 971 555 101',
    deliveryType: 'pickup',
    items: [
      { name: 'Pizza Margherita', quantity: 1, price: 8.5 },
      { name: 'Cheese Bombs', quantity: 1, price: 6.9 },
    ],
    subtotal: 15.4,
    deliveryFee: 0,
    total: 21.9,
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    status: 'preparing',
    createdAt: todayAt('18:31'),
    statusUpdates: [
      { status: 'new', timestamp: todayAt('18:31') },
      { status: 'preparing', timestamp: todayAt('18:34') },
    ],
  },
  {
    _id: 'prev-1040',
    orderNumber: '260810040',
    customerName: 'Petra Lang',
    phoneNumber: '+49 971 555 340',
    deliveryType: 'delivery',
    deliveryZone: { id: 'z1', name: 'Zone 1' },
    deliveryAddress: { street: 'Ludwigstr.', houseNumber: '4', postalCode: '97688', city: 'Bad Kissingen' },
    items: [{ name: 'Pizza Familienpaket', quantity: 5, price: 12.42 }],
    subtotal: 62.1,
    deliveryFee: 0,
    total: 62.1,
    paymentMethod: 'card',
    paymentStatus: 'pending',
    status: 'ready_for_delivery',
    createdAt: todayAt('18:20'),
    statusUpdates: [
      { status: 'new', timestamp: todayAt('18:20') },
      { status: 'preparing', timestamp: todayAt('18:22') },
    ],
  },
  {
    _id: 'prev-1039',
    orderNumber: '260810039',
    customerName: 'Lukas Hofmann',
    phoneNumber: '+49 971 555 512',
    deliveryType: 'delivery',
    deliveryZone: { id: 'z2', name: 'Zone 2' },
    deliveryAddress: { street: 'Bergstr.', houseNumber: '8', postalCode: '97688', city: 'Reiterswiesen' },
    items: [{ name: 'Sushi Party Box', quantity: 4, price: 13.55 }],
    subtotal: 54.2,
    deliveryFee: 2.5,
    total: 54.2,
    paymentMethod: 'online',
    paymentStatus: 'completed',
    status: 'delivering',
    etaMinutes: 38,
    createdAt: todayAt('18:12'),
    statusUpdates: [
      { status: 'new', timestamp: todayAt('18:12') },
      { status: 'preparing', timestamp: todayAt('18:14') },
      { status: 'delivering', timestamp: todayAt('18:40') },
    ],
  },
  {
    _id: 'prev-1036',
    orderNumber: '260810036',
    customerName: 'Nina Weber',
    phoneNumber: '+49 971 555 707',
    deliveryType: 'delivery',
    deliveryZone: { id: 'z1', name: 'Zone 1' },
    items: [{ name: 'Pizza Tonno', quantity: 2, price: 14.9 }],
    subtotal: 29.8,
    deliveryFee: 0,
    total: 29.8,
    paymentMethod: 'card',
    paymentStatus: 'completed',
    status: 'completed',
    createdAt: todayAt('17:58'),
    statusUpdates: [
      { status: 'new', timestamp: todayAt('17:58') },
      { status: 'completed', timestamp: todayAt('18:49') },
    ],
  },
  {
    _id: 'prev-1034',
    orderNumber: '260810034',
    customerName: 'Jonas Keller',
    phoneNumber: '+49 971 555 909',
    deliveryType: 'delivery',
    items: [{ name: 'Pizza Salami', quantity: 1, price: 16.4 }],
    subtotal: 16.4,
    deliveryFee: 0,
    total: 16.4,
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    status: 'cancelled',
    createdAt: todayAt('17:41'),
    statusUpdates: [
      { status: 'new', timestamp: todayAt('17:41') },
      { status: 'cancelled', timestamp: todayAt('17:52') },
    ],
  },
];

/*
 * Архив прошлых дней (~185 шт.) — чтобы вкладки История/Архив и «Показать ещё»
 * вели себя как на проде с сотнями заказов (баг-репорт №9: лимит 100 без
 * пагинации). Мок отдаёт срез по ?limit и настоящий total.
 */
const ARCHIVE_ORDERS = Array.from({ length: 185 }, (_, i) => ({
  _id: `prev-arch-${i}`,
  orderNumber: String(260700900 - i),
  customerName: ['Anna Vogel', 'Stefan Braun', 'Petra Lang', 'Lukas Hofmann'][i % 4],
  phoneNumber: '+49 971 555 000',
  deliveryType: i % 3 ? 'delivery' : 'pickup',
  deliveryZone: { id: 'z1', name: 'Zone 1' },
  items: [{ name: 'Pizza Salami', quantity: 1, price: 9.5 }],
  subtotal: 9.5,
  deliveryFee: 0,
  total: 9.5,
  paymentMethod: 'cash',
  paymentStatus: 'completed',
  status: i % 11 === 0 ? 'cancelled' : 'completed',
  createdAt: todayAt('19:00', 1 + Math.floor(i / 8)),
}));

const ALL_ORDERS = [...ORDERS, ...ARCHIVE_ORDERS];

const STATS = {
  success: true,
  stats: {
    totalOrders: 4210,
    totalProducts: 126,
    totalCategories: 8,
    totalUsers: 812,
    totalLoyaltyUsers: 204,
    pendingOrders: 6,
    todayOrders: 47,
    todaySales: 1284.4,
  },
  // Ключи и формат как у реального getDailySales (date=YYYY-MM-DD,
  // totalSales/count) — фикстура с выдуманными полями уже замаскировала
  // баг №4 (график нулей). 14 дней: аналитика сравнивает недели (?days=14).
  salesData: [
    ...[13, 12, 11, 10, 9, 8, 7].map((minusDays, i) => ({
      date: dayKey(minusDays),
      totalSales: [702.2, 748.9, 401.6, 981.3, 1188.6, 1391.0, 1064.5][i],
      count: [27, 29, 15, 38, 46, 54, 41][i],
    })),
    ...[6, 5, 4, 3, 2, 1, 0].map((minusDays, i) => ({
      date: dayKey(minusDays),
      totalSales: [812.4, 640.1, 118.9, 924.6, 1310.2, 1178.4, 1284.4][i],
      count: [31, 24, 5, 35, 51, 44, 47][i],
    })),
  ],
};

const USERS = [
  { _id: 'u1', name: 'Michael Klein', email: 'michael@dumbospizza.de', role: 'admin' },
  { _id: 'u2', name: 'Timo Schulz', email: 'timo@dumbospizza.de', role: 'staff' },
  { _id: 'u3', name: 'Anja Vogt', email: 'anja@dumbospizza.de', role: 'staff' },
];

// Поля как у toPromotionAdminView: orderCount/revenueTotal/weekdayLabel
const PROMOTIONS = [
  {
    _id: 'p1',
    name: '2 + 1 gratis · Pizza 32 cm',
    type: 'bogo',
    enabled: true,
    validFrom: todayAt('00:00', 30),
    validTo: todayAt('23:59', -21),
    weekdayLabel: 'Mo, Di, Mi, Do',
    orderCount: 142,
    revenueTotal: 3214,
  },
  {
    _id: 'p2',
    name: 'Softdrink gratis ab 25 €',
    type: 'gratis',
    enabled: true,
    validFrom: todayAt('00:00', 10),
    // ~2,5 дня до конца → карточка «Заканчивается», как в канве D8
    validTo: todayAt('23:59', -2),
    orderCount: 86,
    revenueTotal: 2480,
  },
  { _id: 'p3', name: '3 Pizzen zum halben Preis', type: 'percent', enabled: false },
];

const COUPONS = [
  { _id: 'c1', code: 'DUMBO10', discountType: 'percentage', discountValue: 10, usageCount: 84, active: true },
  { _id: 'c2', code: 'SUSHI5', discountType: 'fixed', discountValue: 5, minOrderAmount: 30, usageCount: 12, active: false },
  { _id: 'c3', code: 'WELCOME', discountType: 'percentage', discountValue: 15, usageCount: 208, active: true },
];

const ZONES = [
  { _id: 'z1', name: 'Zone 1 · Zentrum', maxDistance: 3, deliveryFee: 0, minOrderAmount: 15, active: true },
  { _id: 'z2', name: 'Zone 2 · Reiterswiesen', maxDistance: 6, deliveryFee: 2.5, minOrderAmount: 25, active: true },
  { _id: 'z3', name: 'Zone 3 · Umland', maxDistance: 10, deliveryFee: 4.5, minOrderAmount: 35, active: false },
];

const BANNERS = [{ _id: 'b1', title: 'Sushi Lieferung', enabled: true, order: 1 }];

/* --------------------------------------------------------- мок fetch */

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/*
 * Симуляция отказов API для проверки error-UI (баг-репорт №1):
 * ?fail=orders,stats,products,settings — 500 на выбранных GET;
 * ?fail=all — на всех. Ключи см. FAIL_ROUTES.
 */
const FAIL_ROUTES: [string, (path: string) => boolean][] = [
  ['orders', (p) => p.startsWith('/api/orders')],
  ['stats', (p) => p.startsWith('/api/admin/stats')],
  ['products', (p) => p.startsWith('/api/products')],
  ['categories', (p) => p.startsWith('/api/categories')],
  ['options', (p) => p.startsWith('/api/options') || p.startsWith('/api/option-groups')],
  ['settings', (p) => p.startsWith('/api/settings/store')],
  ['zones', (p) => p.startsWith('/api/delivery-zones')],
  ['promotions', (p) => p.startsWith('/api/promotions')],
  ['coupons', (p) => p.startsWith('/api/coupons')],
  ['banners', (p) => p.startsWith('/api/banners')],
  ['users', (p) => p.startsWith('/api/users')],
];

function shouldFail(url: string): boolean {
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  if (!path.startsWith('/api/')) return false;
  let targets: Set<string>;
  try {
    const raw = new URLSearchParams(window.location.search).get('fail');
    if (!raw) return false;
    targets = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  } catch {
    return false;
  }
  if (targets.has('all')) return true;
  return FAIL_ROUTES.some(([key, test]) => targets.has(key) && test(path));
}

function matchMock(url: string, method: string): unknown | null {
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  if (!path.startsWith('/api/')) return null;

  // Любые мутации из превью не доходят до сервера
  if (method !== 'GET') return { success: true };

  if (/^\/api\/orders\/[^/?]+/.test(path)) {
    const id = decodeURIComponent(path.split('/')[3].split('?')[0]);
    const order = ORDERS.find((o) => o._id === id) || ORDERS[0];
    return { success: true, order };
  }
  if (path.startsWith('/api/orders')) {
    const limit = Number(new URLSearchParams(path.split('?')[1] || '').get('limit')) || 100;
    return {
      success: true,
      orders: ALL_ORDERS.slice(0, limit),
      pagination: {
        total: ALL_ORDERS.length,
        page: 1,
        limit,
        pages: Math.ceil(ALL_ORDERS.length / limit),
      },
    };
  }
  if (path.startsWith('/api/admin/stats')) return STATS;
  if (path.startsWith('/api/users')) return { success: true, users: USERS };
  if (path.startsWith('/api/promotions')) return { success: true, promotions: PROMOTIONS };
  if (path.startsWith('/api/coupons')) return { success: true, coupons: COUPONS };
  if (path.startsWith('/api/delivery-zones')) return { success: true, zones: ZONES };
  if (path.startsWith('/api/banners')) return { success: true, banners: BANNERS };
  return null; // products/categories/options/settings — реальные публичные GET
}

if (typeof window !== 'undefined' && !(window as any).__adminPreviewFetchPatched) {
  (window as any).__adminPreviewFetchPatched = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const method = (
      init?.method ||
      (input instanceof Request ? input.method : 'GET') ||
      'GET'
    ).toUpperCase();
    if (method === 'GET' && shouldFail(url)) {
      return new Response(JSON.stringify({ success: false, error: 'Preview: симуляция 500' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const mock = matchMock(url, method);
    if (mock) return jsonResponse(mock);
    return realFetch(input as any, init);
  };
}

const MOCK_SESSION: any = {
  user: { name: 'Dev Preview', email: 'preview@dumbospizza.de', role: 'admin' },
  expires: '2099-01-01T00:00:00.000Z',
};

export function PreviewPage({ screen, children }: { screen?: string; children?: React.ReactNode }) {
  // Только для локальной разработки: на проде страницы предпросмотра нет
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }
  let page = children ?? <HomePage />;
  if (screen === 'orders') page = <OrdersPage />;
  else if (screen === 'menu') page = <MenuPage />;
  else if (screen === 'venue') page = <VenuePage />;
  else if (screen === 'reviews') page = <ReviewsPage />;
  else if (screen === 'analytics') page = <AnalyticsPage />;
  else if (screen === 'marketing') page = <MarketingPage />;
  else if (screen === 'settings') page = <SettingsPage />;
  else if (screen === 'help') page = <HelpPage />;
  else if (screen === 'news') page = <NewsPage />;

  return (
    <SessionProvider session={MOCK_SESSION}>
      <AdminV2Shell>{page}</AdminV2Shell>
    </SessionProvider>
  );
}
