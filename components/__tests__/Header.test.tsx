import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import de from '../../public/locales/de/common.json';

// t: ключ → значение из de common.json (как на реальном сайте), иначе fallback.
const tDe = (k: string, fb?: string) =>
  (k.split('.').reduce<any>((o, p) => (o == null ? o : o[p]), de) as string) ?? fb ?? k;

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
vi.mock('../../lib/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'de' }),
}));
vi.mock('../../lib/i18n', () => ({
  loadTranslation: async () => ({ t: tDe }),
}));
vi.mock('../../lib/contexts/CartContext', () => ({
  useCart: () => ({ cartItemsCount: 0, state: { items: [] } }),
}));
vi.mock('../cart/CartModal', () => ({ CartModal: () => null }));

import { Header } from '../header';

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, settings: { phone: '+49 163 2165979' } }) })
  ) as any;
});

describe('Header — без километража зоны в верхней панели', () => {
  it('не показывает «0-2 km» / «N-N km»', async () => {
    render(<Header />);
    // дождаться загрузки переводов
    await screen.findByRole('link', { name: /Liefergebiete/i });

    expect(screen.queryByText(/0-2\s*km/i)).toBeNull();
    expect(screen.queryByText(/\d+\s*-\s*\d+\s*km/i)).toBeNull();
  });

  it('ссылка Liefergebiete остаётся в навигации и ведёт на /delivery', async () => {
    render(<Header />);
    const links = await screen.findAllByRole('link', { name: /Liefergebiete/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links.some((a) => a.getAttribute('href') === '/delivery')).toBe(true);
  });
});

describe('Header — телефон ресторана (из настроек / fallback)', () => {
  it('показывает +49 163 2165979 с корректным tel-href, старого номера нет', async () => {
    render(<Header />);
    await waitFor(() => expect(screen.getByText('+49 163 2165979')).toBeTruthy());

    const telLinks = screen.getAllByRole('link', { name: /\+49 163 2165979/ });
    expect(telLinks.some((a) => a.getAttribute('href') === 'tel:+491632165979')).toBe(true);
    expect(screen.queryByText(/022\s*210-210/)).toBeNull();
  });

  it('burger menu использует тот же номер', async () => {
    render(<Header />);
    await screen.findByText('+49 163 2165979'); // top bar загрузился

    fireEvent.click(screen.getByLabelText('Menü'));
    // в открытом меню тоже номер из настроек, не старый
    const all = screen.getAllByText('+49 163 2165979');
    expect(all.length).toBeGreaterThanOrEqual(2); // top bar + burger
    expect(screen.queryByText(/022\s*210-210/)).toBeNull();
  });

  it('store settings override: показывает номер из API', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, settings: { phone: '+49 971 123456' } }) })
    ) as any;
    render(<Header />);
    await waitFor(() => expect(screen.getByText('+49 971 123456')).toBeTruthy());
    expect(screen.queryByText(/022\s*210-210/)).toBeNull();
  });
});

describe('Header — часы из недельного графика', () => {
  const schedule = {
    mon: [
      { start: '10:00', end: '14:00' },
      { start: '17:00', end: '21:00' },
    ],
    tue: [],
    wed: [{ start: '17:00', end: '22:00' }],
    thu: [{ start: '17:00', end: '22:00' }],
    fri: [{ start: '17:00', end: '22:00' }],
    sat: [{ start: '17:00', end: '22:00' }],
    sun: [{ start: '17:00', end: '22:00' }],
  };
  const mockSettings = (settings: Record<string, unknown>) => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, settings }) })
    ) as any;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('разные смены по дням — в полосе только сегодняшние', async () => {
    vi.setSystemTime(new Date('2026-10-19T10:00:00Z')); // понедельник, 12:00 Берлин
    mockSettings({ ordersWeeklySchedule: schedule });
    render(<Header />);
    await waitFor(() => expect(screen.getByText('heute 10:00–14:00, 17:00–21:00')).toBeTruthy());
  });

  it('выходной сегодня — «heute Ruhetag»', async () => {
    vi.setSystemTime(new Date('2026-10-20T10:00:00Z')); // вторник
    mockSettings({ ordersWeeklySchedule: schedule });
    render(<Header />);
    await waitFor(() => expect(screen.getByText('heute Ruhetag')).toBeTruthy());
  });

  it('одинаковые часы на всю неделю — прежнее «täglich»', async () => {
    vi.setSystemTime(new Date('2026-10-20T10:00:00Z'));
    mockSettings({ ordersStartHour: '17:00', ordersEndHour: '22:00' });
    render(<Header />);
    await waitFor(() => expect(screen.getByText('täglich 17:00 - 22:00')).toBeTruthy());
  });
});
