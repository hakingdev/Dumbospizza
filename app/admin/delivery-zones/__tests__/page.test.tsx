import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// next/dynamic → синхронный стаб карты (Leaflet не грузим в jsdom), пишем highlightedZoneId в data-атрибут.
vi.mock('next/dynamic', () => ({
  default: () => (props: any) =>
    <div data-testid="zone-map" data-highlighted={props.highlightedZoneId ?? ''} />,
}));

import DeliveryZonesPage from '../page';

const zones = [
  { _id: '1', name: 'Zone 1', minOrderAmount: 10, deliveryFee: 1, maxDistance: 1, active: true, sortOrder: 0 },
  { _id: '2', name: 'Zone 2', minOrderAmount: 20, deliveryFee: 3, maxDistance: 2, active: true, sortOrder: 1 },
  { _id: '4', name: 'Zone 4', minOrderAmount: 30, deliveryFee: 5, maxDistance: 4, active: true, sortOrder: 2 },
];

const json = (data: any) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

beforeEach(() => {
  global.fetch = vi.fn((url: any, opts: any) => {
    const u = String(url);
    if (u.includes('/api/delivery-zones')) return json({ success: true, zones });
    if (u.includes('/api/delivery/check-zone') && opts?.method === 'POST') {
      return json({
        success: true,
        canDeliver: true,
        zone: { id: '2', name: 'Zone 2', minOrderAmount: 20, deliveryFee: 3, maxDistance: 2 },
        distance: 1.5,
        coordinates: { lat: 50.21, lng: 10.07 },
        restaurantCoordinates: { lat: 50.2, lng: 10.07 },
      });
    }
    if (u.includes('/api/delivery/check-zone')) {
      return json({ success: true, restaurantLocation: { lat: 50.2, lng: 10.07 } });
    }
    return json({});
  }) as any;
});

describe('Admin delivery-zones — проверка адреса подсвечивает зону (AC #7)', () => {
  it('после Prüfen: карта получает highlightedZoneId, карточка зоны 2 подсвечена, показано сообщение', async () => {
    render(<DeliveryZonesPage />);

    // дождаться загрузки зон
    await waitFor(() => expect(screen.getByText('Zone 2')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('Adresse prüfen...'), {
      target: { value: 'Teststr. 5, 97688 Bad Kissingen' },
    });
    fireEvent.click(screen.getByText('Prüfen'));

    // сообщение об успехе
    await waitFor(() =>
      expect(screen.getByTestId('address-check-result').textContent).toContain('Adresse liegt in Zone: 1.5 km')
    );

    // карта получила highlightedZoneId = '2'
    expect(screen.getByTestId('zone-map').getAttribute('data-highlighted')).toBe('2');

    // карточка зоны 2 подсвечена, остальные — нет
    const row2 = document.querySelector('[data-zone-id="2"]');
    const row1 = document.querySelector('[data-zone-id="1"]');
    expect(row2?.getAttribute('data-highlighted')).toBe('true');
    expect(row2?.className).toContain('ring-primary-500');
    expect(row1?.getAttribute('data-highlighted')).toBe('false');
  });
});
