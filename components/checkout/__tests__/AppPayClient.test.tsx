// Клиент /pay/[orderId]: тот же OnlinePaymentPanel, но возврат — только в
// схему приложения; подтверждение SumUp — через серверный confirm.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import AppPayClient from '../AppPayClient';

const panelProps = vi.hoisted(() => ({ current: null as any }));
vi.mock('../OnlinePaymentPanel', () => ({
  default: (props: any) => {
    panelProps.current = props;
    return <div data-testid="panel" data-error={props.errorMessage || ''} />;
  },
}));

const ORDER = 'order-1';
let assign: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(() => {
  panelProps.current = null;
  assign = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const base = { orderId: ORDER, amount: 24.5, accessToken: 'tok' };

describe('AppPayClient — PayPal / SEPA', () => {
  it('сразу монтирует панель с токеном; оплата → success в приложение', () => {
    render(<AppPayClient {...base} method="sepa" provider="paypal" sumupIds={[]} />);
    expect(panelProps.current.pay).toMatchObject({ orderId: ORDER, method: 'sepa', accessToken: 'tok', sumupCheckoutId: null });
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => panelProps.current.onPayPalPaid());
    expect(assign).toHaveBeenCalledWith(`dumbospizza://payment?order=${ORDER}&result=success`);
  });

  it('pending capture → тоже success (итог приложение сверит опросом)', () => {
    render(<AppPayClient {...base} method="paypal" provider="paypal" sumupIds={[]} />);
    act(() => panelProps.current.onPayPalPending());
    expect(assign).toHaveBeenCalledWith(`dumbospizza://payment?order=${ORDER}&result=success`);
  });

  it('«Zurück» без ошибок → cancel; редирект строго один раз', () => {
    render(<AppPayClient {...base} method="paypal" provider="paypal" sumupIds={[]} />);
    act(() => panelProps.current.onBack());
    act(() => panelProps.current.onBack());
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(`dumbospizza://payment?order=${ORDER}&result=cancel`);
  });

  it('после ошибки «Zurück» → failed', () => {
    const { getByTestId } = render(<AppPayClient {...base} method="paypal" provider="paypal" sumupIds={[]} />);
    act(() => panelProps.current.onPayPalError('Abgelehnt'));
    expect(getByTestId('panel').getAttribute('data-error')).toBe('Abgelehnt');
    act(() => panelProps.current.onBack());
    expect(assign).toHaveBeenCalledWith(`dumbospizza://payment?order=${ORDER}&result=failed`);
  });
});

describe('AppPayClient — SumUp', () => {
  it('создаёт checkout, подтверждает на сервере, затем success', async () => {
    fetchMock
      .mockImplementationOnce(() => json(200, { success: true, checkoutId: 'chk-9', amount: 24.5 }))
      .mockImplementationOnce(() => json(200, { success: true }));
    render(<AppPayClient {...base} method="online" provider="sumup" sumupIds={['card', 'apple_pay']} />);
    await waitFor(() => expect(panelProps.current.pay.sumupCheckoutId).toBe('chk-9'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/payments/sumup/checkout');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ orderId: ORDER });
    expect(panelProps.current.pay.sumupIds).toEqual(['card', 'apple_pay']);

    await act(async () => { await panelProps.current.onSumUpPaid(); });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/payments/sumup/confirm');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ orderId: ORDER, checkoutId: 'chk-9' });
    expect(assign).toHaveBeenCalledWith(`dumbospizza://payment?order=${ORDER}&result=success`);
  });

  it('confirm отклонён → ошибка на странице, редиректа нет', async () => {
    fetchMock
      .mockImplementationOnce(() => json(200, { success: true, checkoutId: 'chk-9', amount: 24.5 }))
      .mockImplementationOnce(() => json(402, { success: false, status: 'FAILED', error: 'Zahlung fehlgeschlagen' }));
    const { getByTestId } = render(<AppPayClient {...base} method="online" provider="sumup" sumupIds={['card']} />);
    await waitFor(() => expect(panelProps.current.pay.sumupCheckoutId).toBe('chk-9'));
    await act(async () => { await panelProps.current.onSumUpPaid(); });
    expect(assign).not.toHaveBeenCalled();
    expect(getByTestId('panel').getAttribute('data-error')).toBe('Zahlung fehlgeschlagen');
  });

  it('checkout не создан → ошибка, «Zurück» → failed', async () => {
    fetchMock.mockImplementationOnce(() => json(500, { success: false, error: 'SumUp down' }));
    const { getByTestId } = render(<AppPayClient {...base} method="online" provider="sumup" sumupIds={['card']} />);
    await waitFor(() => expect(getByTestId('panel').getAttribute('data-error')).toBe('SumUp down'));
    act(() => panelProps.current.onBack());
    expect(assign).toHaveBeenCalledWith(`dumbospizza://payment?order=${ORDER}&result=failed`);
  });
});
