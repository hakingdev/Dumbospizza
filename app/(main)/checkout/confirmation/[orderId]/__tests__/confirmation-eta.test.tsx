import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('../../../../../../lib/contexts/CartContext', () => ({ useCart: () => ({ clearCart: vi.fn() }) }));
vi.mock('../../../../../../lib/contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'de' }) }));
vi.mock('../../../../../../lib/i18n', () => ({
  loadTranslation: async () => ({ t: (_k: string, fallback?: string) => fallback ?? _k }),
}));
vi.mock('../../../../../../lib/analytics/meta-pixel', () => ({ trackMetaEvent: vi.fn() }));
vi.mock('../../../../../../lib/analytics/google-ads', () => ({ trackGoogleAdsPurchase: vi.fn() }));
vi.mock('../../../../../../components/checkout/OrderVatReceipt', () => ({ default: () => null }));
vi.mock('../../../../../../components/checkout/OrderVatReceiptModal', () => ({ default: () => null }));
vi.mock('../../../../../../lib/client-cache', () => ({
  cachedJson: async (url: string) =>
    url.includes('settings')
      ? { success: true, settings: { deliveryTime: '30-70', address: 'Kurhausstraße 11A, 97688 Bad Kissingen' } }
      : { success: true, zones: [] },
}));

import OrderConfirmationPage from '../page';

const baseOrder = {
  orderNumber: '261024001',
  createdAt: '2026-10-24T16:00:00Z', // 18:00 в Бад-Киссингене
  items: [],
  subtotal: 12.9,
  deliveryFee: 0,
  total: 12.9,
  paymentMethod: 'cash',
  customerName: 'Test Kunde',
  phoneNumber: '01700000000',
};

function mockOrder(order: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, order }) }))
  );
}

describe('страница подтверждения: «когда» и «где»', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('доставка без Wunschzeit — окно из настройки магазина', async () => {
    mockOrder({
      ...baseOrder,
      deliveryType: 'delivery',
      deliveryAddress: { street: 'Schurzstraße', houseNumber: '12', postalCode: '97688', city: 'Bad Kissingen' },
    });
    render(<OrderConfirmationPage params={{ orderId: 'o1' }} />);
    await waitFor(() => expect(screen.getByText('Voraussichtliche Lieferung')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('18:30–19:10 Uhr')).toBeTruthy());
  });

  it('самовывоз с Wunschzeit — время и адрес ресторана', async () => {
    mockOrder({ ...baseOrder, deliveryType: 'pickup', desiredDeliveryTime: '19:15' });
    render(<OrderConfirmationPage params={{ orderId: 'o2' }} />);
    await waitFor(() => expect(screen.getByText('Abholbereit')).toBeTruthy());
    expect(screen.getByText('19:15 Uhr')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByText('Kurhausstraße 11A, 97688 Bad Kissingen').length).toBeGreaterThan(0)
    );
    expect(screen.getByText(/Gewünschte Abholzeit/)).toBeTruthy();
  });
});
