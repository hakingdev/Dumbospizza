import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// Карта → стаб, пишем highlightedZoneId в data-атрибут (Leaflet в jsdom не грузим).
vi.mock('next/dynamic', () => ({
  default: () => (props: any) =>
    <div data-testid="zone-map-stub" data-highlighted={props.highlightedZoneId ?? ''} />,
}));
vi.mock('../../../../lib/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'de' }),
}));
vi.mock('../../../../lib/i18n', () => ({
  loadTranslation: async () => ({ t: (k: string, fb?: string) => fb || k }),
}));

import DeliveryPage from '../page';

const zones = [
  { _id: '1', name: '0-2 km', minOrderAmount: 20, deliveryFee: 0, maxDistance: 2 },
  { _id: '2', name: '2-4 km', minOrderAmount: 22, deliveryFee: 1, maxDistance: 4 },
  { _id: '3', name: '4-6 km', minOrderAmount: 24, deliveryFee: 2, maxDistance: 6 },
  { _id: '4', name: '6-8 km', minOrderAmount: 27, deliveryFee: 3, maxDistance: 8 },
  { _id: '5', name: '8-10 km', minOrderAmount: 28, deliveryFee: 4, maxDistance: 10 },
  { _id: '6', name: '10-12 km', minOrderAmount: 36, deliveryFee: 4, maxDistance: 12 },
];

const json = (data: any) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

beforeEach(() => {
  global.fetch = vi.fn(() =>
    json({ success: true, zones, restaurantLocation: { lat: 50.2, lng: 10.07 } })
  ) as any;
});

describe('DeliveryPage — мобильные зоны (pills) + подсветка', () => {
  it('рендерит контейнер, карту и таб-бар со ВСЕМИ зонами', async () => {
    render(<DeliveryPage />);
    await waitFor(() => expect(screen.getByTestId('delivery-zone-tabs')).toBeTruthy());

    expect(screen.getByTestId('delivery-page-container')).toBeTruthy();
    expect(screen.getByTestId('delivery-zones-map')).toBeTruthy();

    const tabs = screen.getByTestId('delivery-zone-tabs');
    for (const z of zones) {
      expect(within(tabs).getByText(z.name)).toBeTruthy();
    }
  });

  it('по умолчанию подсвечена ближайшая зона (0-2 km)', async () => {
    render(<DeliveryPage />);
    await waitFor(() =>
      expect(screen.getByTestId('zone-map-stub').getAttribute('data-highlighted')).toBe('1')
    );
  });

  it('клик по pill «4-6 km» → карта получает highlightedZoneId, деталь обновляется', async () => {
    render(<DeliveryPage />);
    const tabs = await screen.findByTestId('delivery-zone-tabs');

    fireEvent.click(within(tabs).getByText('4-6 km'));

    await waitFor(() =>
      expect(screen.getByTestId('zone-map-stub').getAttribute('data-highlighted')).toBe('3')
    );
    // карточка выбранной зоны под pills показывает Mindestbestellwert этой зоны
    expect(screen.getAllByText(/24,00\s*€/).length).toBeGreaterThan(0);
  });

  it('метрики: сумма с whitespace-nowrap (€ не отрывается), блок метрик присутствует', async () => {
    render(<DeliveryPage />);
    await screen.findByTestId('delivery-zone-tabs');

    const metrics = screen.getAllByTestId('delivery-zone-metrics');
    expect(metrics.length).toBeGreaterThan(0);

    // суммы рендерятся одним узлом с nowrap (а не «24,00» + отдельный «€»)
    const amount = within(metrics[0]).getByText(/€/);
    expect(amount.className).toContain('whitespace-nowrap');
  });

  it('бесплатная зона (0-2 km, fee=0) → «Kostenlos» без разрыва', async () => {
    render(<DeliveryPage />);
    await screen.findByTestId('delivery-zone-tabs');
    // по умолчанию выбрана 0-2 km (fee 0) → в карточке есть Kostenlos
    const kostenlos = screen.getAllByText('Kostenlos');
    expect(kostenlos.length).toBeGreaterThan(0);
    expect(kostenlos[0].className).toContain('whitespace-nowrap');
  });
});
