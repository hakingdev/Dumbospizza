import { describe, it, expect, vi, beforeEach } from 'vitest';
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
