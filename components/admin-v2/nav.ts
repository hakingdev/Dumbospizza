/**
 * Навигация нового портала (/admin-v2) — структура из дизайн-канвы
 * «Каркас десктоп»: рельса основных разделов + служебные внизу.
 * Ховер-флайаут с подразделами удалён по итогам QA — иконка ведёт
 * сразу в раздел, поэтому у пунктов нет subs.
 */

export type AdminNavItem = {
  key: string;
  label: string;
  href: string;
  /** d-атрибут иконки 24×24 (stroke=2, round) из дизайн-системы. */
  icon: string;
};

export const ADMIN_V2_BASE = '/admin-v2';

export const NAV_MAIN: AdminNavItem[] = [
  {
    key: 'home',
    label: 'Главная',
    href: ADMIN_V2_BASE,
    icon: 'M3 9.5 12 2l9 7.5V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z M9 22V12h6v10',
  },
  {
    key: 'orders',
    label: 'Заказы',
    href: `${ADMIN_V2_BASE}/orders`,
    icon: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z M3 6h18 M16 10a4 4 0 0 1-8 0',
  },
  {
    key: 'menu',
    label: 'Меню',
    href: `${ADMIN_V2_BASE}/menu`,
    icon: 'M12 7v14 M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z',
  },
  {
    key: 'venue',
    label: 'Заведение',
    href: `${ADMIN_V2_BASE}/venue`,
    icon: 'M3 9.5 5 3h14l2 6.5 M4 9.5V21h16V9.5 M9 21v-6h6v6',
  },
  {
    key: 'reviews',
    label: 'Отзывы',
    href: `${ADMIN_V2_BASE}/reviews`,
    icon: 'M11.5 3.5 14 9l6 .8-4.3 4.2 1 6-5.2-2.8L6 20l1-6L2.7 9.8 8.8 9Z',
  },
  {
    key: 'analytics',
    label: 'Аналитика',
    href: `${ADMIN_V2_BASE}/analytics`,
    icon: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  },
  {
    key: 'marketing',
    label: 'Маркетинг',
    href: `${ADMIN_V2_BASE}/marketing`,
    icon: 'm3 11 15-6v12L3 13Z M3 11v4a2 2 0 0 0 2 2h2l1 4',
  },
];

export const NAV_BOTTOM: AdminNavItem[] = [
  {
    key: 'settings',
    label: 'Настройки',
    href: `${ADMIN_V2_BASE}/settings`,
    icon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.5 14.4a1.7 1.7 0 0 0 .3 1.9 2 2 0 1 1-2.8 2.8 1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2 2 2 0 1 1-2.8-2.8 1.7 1.7 0 0 0-1.2-2.9 2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9 2 2 0 1 1 2.8-2.8 1.7 1.7 0 0 0 2.9-1.2 2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2 2 2 0 1 1 2.8 2.8 1.7 1.7 0 0 0 1.2 2.9 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.5 1.1Z',
  },
  {
    key: 'help',
    label: 'Помощь',
    href: `${ADMIN_V2_BASE}/help`,
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7 M12 17h.01',
  },
  {
    key: 'news',
    label: 'Что нового',
    href: `${ADMIN_V2_BASE}/news`,
    icon: 'M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z M18 17l.9 2.1 2.1.9-2.1.9L18 23l-.9-2.1-2.1-.9 2.1-.9Z',
  },
];

export const NAV_ALL: AdminNavItem[] = [...NAV_MAIN, ...NAV_BOTTOM];

/** Разделы мобильного таб-бара (из «Каркас экрана»): 4 прямых + «Ещё». */
export const MOBILE_TABS: { key: string; label: string }[] = [
  { key: 'home', label: 'Главная' },
  { key: 'orders', label: 'Заказы' },
  { key: 'menu', label: 'Меню' },
  { key: 'analytics', label: 'Аналитика' },
  { key: 'more', label: 'Ещё' },
];

/** Разделы, живущие в мобильном «Ещё» (bottom sheet). */
export const MOBILE_MORE_KEYS = ['venue', 'reviews', 'marketing', 'settings', 'help', 'news'];

/** Активный раздел по pathname (включая зеркала экранов на /dev-admin-preview). */
export function activeNavKey(pathname: string): string {
  pathname = pathname.replace(/^\/dev-admin-preview(?=\/|$)/, ADMIN_V2_BASE);
  if (!pathname.startsWith(ADMIN_V2_BASE)) return 'home';
  const rest = pathname.slice(ADMIN_V2_BASE.length).replace(/^\//, '');
  const first = rest.split('/')[0];
  if (!first) return 'home';
  const found = NAV_ALL.find((item) => item.href === `${ADMIN_V2_BASE}/${first}`);
  return found ? found.key : 'home';
}
