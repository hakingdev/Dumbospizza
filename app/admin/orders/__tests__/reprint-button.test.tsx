import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import OrdersPage from '../page';

/**
 * Кнопка «Печать» в списке заказов — повторная печать кухонного чека.
 * Проверяем контракт с сервером: POST /api/orders/[id]/reprint и обратная
 * связь оператору (чек печатает агент на кассовом ПК, не браузер).
 */
const ORDER = {
  _id: 'o1',
  orderNumber: '260731002',
  customerName: 'Kesselring',
  phoneNumber: '01706570610',
  total: 31.4,
  status: 'preparing',
  kitchenPrintStatus: 'completed',
  items: [],
  createdAt: '2026-07-31T15:18:49.564Z',
};

function mockFetch(reprintResponse: any = { success: true }) {
  return vi.fn(async (url: string, init?: any) => {
    if (String(url).includes('/reprint')) {
      return { ok: true, json: async () => reprintResponse } as any;
    }
    return { ok: true, json: async () => ({ success: true, orders: [ORDER] }) } as any;
  });
}

async function renderWithOrder() {
  render(<OrdersPage />);
  await waitFor(() => expect(screen.getByTestId('reprint-o1')).toBeTruthy());
}

describe('Кнопка повторной печати заказа', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('кнопка есть у каждого заказа', async () => {
    vi.stubGlobal('fetch', mockFetch());
    await renderWithOrder();

    expect(screen.getByTestId('reprint-o1').textContent).toContain('Печать');
  });

  it('клик ставит заказ в очередь печати: POST /api/orders/[id]/reprint', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    await renderWithOrder();

    fireEvent.click(screen.getByTestId('reprint-o1'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/orders/o1/reprint', { method: 'POST' })
    );
    // Чек печатает агент — оператору показываем «поставлено в очередь».
    await waitFor(() => expect(screen.getByTestId('reprint-queued-o1')).toBeTruthy());
  });

  it('без подтверждения запрос не уходит (защита от промаха по строке)', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => false));
    await renderWithOrder();

    fireEvent.click(screen.getByTestId('reprint-o1'));

    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/reprint'))).toHaveLength(0);
  });

  it('отказ сервера (неоплаченный онлайн-заказ) показывается оператору', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: false, error: 'не подтверждена оплата' }));
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);
    await renderWithOrder();

    fireEvent.click(screen.getByTestId('reprint-o1'));

    await waitFor(() => expect(alertMock).toHaveBeenCalled());
    expect(String(alertMock.mock.calls[0][0])).toContain('не подтверждена оплата');
    expect(screen.queryByTestId('reprint-queued-o1')).toBeNull();
  });
});
