'use client';

/**
 * Оболочка нового портала («Каркас десктоп» + «Каркас экрана»):
 *  - десктоп (lg+): топбар 64px, icon-рельса 112px, флайаут 300px по ховеру;
 *  - мобилка: хедер 56px, нижний таб-бар 72px, «Ещё» — bottom sheet.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { ReactNode, useState } from 'react';
import {
  ADMIN_V2_BASE,
  AdminNavItem,
  MOBILE_MORE_KEYS,
  MOBILE_TABS,
  NAV_ALL,
  NAV_BOTTOM,
  NAV_MAIN,
  activeNavKey,
} from './nav';
import { Icon } from './ui';
import { initials } from './format';
import { useStoreSettings } from './hooks';

/* ---------------------------------------------------------------- логотип */

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href={ADMIN_V2_BASE}
      className={`whitespace-nowrap font-extrabold tracking-[-.02em] no-underline ${
        compact ? 'text-xl leading-6' : 'text-[28px] leading-8'
      }`}
    >
      <span className="text-gray-900">Dumbos</span>
      <span className="text-[#9A7A56]">Pizza</span>
    </Link>
  );
}

/* ------------------------------------------------- пилюля с рестораном */

function RestaurantPill({ compact = false }: { compact?: boolean }) {
  const { settings } = useStoreSettings();
  const name = settings?.storeName || 'Dumbos Pizza';
  const address = settings?.address || 'Kurhausstraße 11A, Bad Kissingen';
  const label = compact ? address.split(',')[0] : `${name} · ${address}`;
  return (
    <div
      title="Переключение между заведениями появится, когда точек станет больше одной"
      className={`flex min-w-0 cursor-default items-center overflow-hidden rounded-full border border-[#EBE0CE] bg-[#FAF7F2] ${
        compact ? 'h-8 flex-1 gap-1.5 px-2.5' : 'h-10 max-w-[340px] gap-2 px-3.5'
      }`}
    >
      <Icon
        d="M3 9.5 5 3h14l2 6.5 M4 9.5V21h16V9.5 M9 21v-6h6v6"
        size={compact ? 16 : 20}
        stroke="#9A7A56"
        className="flex-none"
      />
      <span
        className={`overflow-hidden text-ellipsis whitespace-nowrap font-bold text-gray-900 ${
          compact ? 'text-xs leading-4' : 'text-base leading-6'
        }`}
      >
        {label}
      </span>
      <Icon d="m6 9 6 6 6-6" size={compact ? 14 : 16} stroke="#9CA3AF" className="flex-none" />
    </div>
  );
}

/* --------------------------------------------------------------- аватар */

function Avatar({ compact = false }: { compact?: boolean }) {
  const { data: session } = useSession();
  return (
    <Link
      href={`${ADMIN_V2_BASE}/settings?tab=account`}
      title={session?.user?.name || 'Аккаунт'}
      className={`flex flex-none items-center justify-center rounded-full bg-[#EBE4D8] font-bold text-[#7C6145] no-underline ${
        compact ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'
      }`}
    >
      {initials(session?.user?.name)}
    </Link>
  );
}

/* ------------------------------------------------------- десктоп: топбар */

function DesktopTopBar() {
  return (
    <div className="sticky top-0 z-40 flex h-16 flex-none items-center gap-4 border-b border-gray-200 bg-white px-6">
      <Logo />
      <div className="flex-1" />
      <RestaurantPill />
      <a
        href="/admin"
        title="Старая админка (все сервисы)"
        aria-label="Старая админка"
        className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-gray-200 bg-white text-[#9A7A56] transition hover:bg-[#FAF7F2]"
      >
        <Icon d="M4 4h6v6H4Z M14 4h6v6h-6Z M4 14h6v6H4Z M14 14h6v6h-6Z" size={20} />
      </a>
      <div
        className="flex h-10 flex-none items-center gap-0.5 rounded-full bg-gray-100 p-1"
        title="Язык интерфейса портала — пока только русский"
      >
        {['RU', 'DE', 'EN'].map((lang, i) => (
          <span
            key={lang}
            className={
              i === 0
                ? 'inline-flex h-8 items-center rounded-full bg-[#8A6C4C] px-3 text-sm font-bold leading-5 text-white'
                : 'inline-flex h-8 cursor-not-allowed items-center rounded-full px-3 text-sm font-bold leading-5 text-gray-400'
            }
          >
            {lang}
          </span>
        ))}
      </div>
      <Avatar />
    </div>
  );
}

/* ------------------------------------------------- десктоп: рельса */

function RailItem({ item, active }: { item: AdminNavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      title={item.label}
      className={`relative flex h-[68px] items-center justify-center no-underline transition ${
        active ? 'bg-[#FAF7F2]' : 'hover:bg-[#FAF7F2]'
      }`}
    >
      <span
        className="absolute bottom-4 left-0 top-4 w-[3px] rounded"
        style={{ background: active ? '#8A6C4C' : 'transparent' }}
      />
      <Icon d={item.icon} size={24} stroke={active ? '#9A7A56' : '#9CA3AF'} />
    </Link>
  );
}

/* Без ховер-флайаута с подразделами — по итогам QA он не нужен:
   иконка ведёт в раздел, имя раздела показывает нативный title. */
function DesktopRail({ activeKey }: { activeKey: string }) {
  return (
    <nav className="relative z-20 hidden w-[112px] flex-none flex-col border-r border-gray-200 bg-white lg:flex">
      {NAV_MAIN.map((item) => (
        <RailItem key={item.key} item={item} active={item.key === activeKey} />
      ))}
      <div className="flex-1" />
      <div className="border-t border-gray-200 pb-2">
        {NAV_BOTTOM.map((item) => (
          <RailItem key={item.key} item={item} active={item.key === activeKey} />
        ))}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------ мобилка: хедер */

function MobileHeader() {
  return (
    <div className="sticky top-0 z-40 flex h-14 flex-none items-center gap-3 border-b border-gray-200 bg-white px-4">
      <Logo compact />
      <RestaurantPill compact />
      <Avatar compact />
    </div>
  );
}

/* --------------------------------------------------- мобилка: таб-бар */

const TAB_ICONS: Record<string, string> = {
  home: 'M3 9.5 12 2l9 7.5V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z M9 22V12h6v10',
  orders: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z M3 6h18 M16 10a4 4 0 0 1-8 0',
  menu: 'M12 7v14 M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z',
  analytics: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
};

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  if (!open) return null;
  const items = MOBILE_MORE_KEYS.map((key) => NAV_ALL.find((item) => item.key === key)!).filter(Boolean);
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
          Ещё
        </h2>
        <div className="flex flex-col">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className="flex h-12 cursor-pointer items-center gap-3 rounded-xl border-none bg-transparent px-3 text-left text-base font-bold leading-6 text-gray-900 transition hover:bg-[#FAF7F2]"
              onClick={() => {
                onClose();
                router.push(item.href);
              }}
            >
              <Icon d={item.icon} size={22} stroke="#9A7A56" className="flex-none" />
              {item.label}
              <span className="flex-1" />
              <Icon d="m9 6 6 6-6 6" size={18} stroke="#9CA3AF" className="flex-none" />
            </button>
          ))}
          <button
            type="button"
            className="mt-1 flex h-12 cursor-pointer items-center gap-3 rounded-xl border-none bg-transparent px-3 text-left text-base font-bold leading-6 text-[#D42A47] transition hover:bg-[#FDE6E7]"
            onClick={() => signOut({ callbackUrl: '/admin/login' })}
          >
            <Icon
              d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9"
              size={22}
              className="flex-none"
            />
            Выход
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileTabBar({ activeKey }: { activeKey: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const router = useRouter();
  const moreActive = MOBILE_MORE_KEYS.includes(activeKey);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-[72px] grid-cols-5 border-t border-gray-200 bg-white pb-2 lg:hidden">
        {MOBILE_TABS.map((tab) => {
          const isMore = tab.key === 'more';
          const active = isMore ? moreActive : tab.key === activeKey;
          const navItem = NAV_ALL.find((item) => item.key === tab.key);
          return (
            <button
              key={tab.key}
              type="button"
              className={`relative flex cursor-pointer flex-col items-center justify-end gap-1 border-none pb-1.5 transition ${
                active ? 'bg-[#FAF7F2]' : 'bg-transparent'
              }`}
              onClick={() => {
                if (isMore) setMoreOpen(true);
                else if (navItem) router.push(navItem.href);
              }}
            >
              <span
                className="absolute top-0 h-[3px] w-6 rounded"
                style={{ background: active ? '#8A6C4C' : 'transparent' }}
              />
              <Icon d={TAB_ICONS[tab.key]} size={24} stroke={active ? '#9A7A56' : '#9CA3AF'} />
              <span
                className={`text-[11px] font-bold leading-[14px] ${
                  active ? 'text-gray-900' : 'text-gray-600'
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}

/* ------------------------------------------------------------- оболочка */

export default function AdminV2Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || ADMIN_V2_BASE;
  const activeKey = activeNavKey(pathname);

  /*
   * Контент рендерится РОВНО ОДИН раз (иначе задваиваются запросы, поллинг
   * и модалки); десктопная рельса/топбар и мобильные хедер/таб-бар
   * скрываются классами по брейкпоинту lg.
   */
  return (
    <div className="min-h-screen bg-[#FAFAFA] font-sans text-gray-900 antialiased">
      <div className="hidden lg:block">
        <DesktopTopBar />
      </div>
      <div className="lg:hidden">
        <MobileHeader />
      </div>

      <div className="relative lg:flex lg:min-h-[calc(100vh-64px)] lg:items-stretch">
        <DesktopRail activeKey={activeKey} />
        <main className="min-h-[calc(100vh-56px)] min-w-0 pb-24 lg:min-h-0 lg:flex-1 lg:p-8 lg:pb-8">
          <div className="lg:mx-auto lg:max-w-[1200px]">{children}</div>
        </main>
      </div>

      <MobileTabBar activeKey={activeKey} />
    </div>
  );
}
