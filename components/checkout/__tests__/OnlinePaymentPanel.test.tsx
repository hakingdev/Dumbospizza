import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OnlinePaymentPanel, { type OnlinePaymentState } from '../OnlinePaymentPanel';

// PayPal SDK не грузим: стабы провайдера и кнопок (funding-источник — в data-атрибут).
vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PayPalButtons: ({ fundingSource }: { fundingSource?: string }) => (
    <div data-testid="paypal-buttons" data-funding={fundingSource || 'stack'} />
  ),
}));

const t = (_key: string, fallback?: string) => fallback ?? _key;

function makePay(overrides: Partial<OnlinePaymentState> = {}): OnlinePaymentState {
  return {
    orderId: 'order-1',
    amount: 33.9,
    method: 'online',
    sumupIds: ['card', 'apple_pay', 'google_pay'],
    sumupCheckoutId: 'chk-1',
    accessToken: 'token',
    ...overrides,
  };
}

const noopHandlers = {
  onSumUpPaid: () => {},
  onSumUpError: () => {},
  onPayPalPaid: () => {},
  onPayPalPending: () => {},
  onPayPalCancel: () => {},
  onPayPalError: () => {},
};

describe('OnlinePaymentPanel — ровно один виджет выбранного метода', () => {
  let mount: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_PAYPAL_CLIENT_ID', 'test-client');
    mount = vi.fn(() => ({ unmount: vi.fn() }));
    (window as any).SumUpCard = { mount };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as any).SumUpCard;
  });

  it('карточная группа: SumUp-виджет с whitelist группы, PayPal-кнопок в DOM нет', async () => {
    const { container } = render(
      <OnlinePaymentPanel pay={makePay()} language="de" t={t} onBack={() => {}} {...noopHandlers} />
    );
    expect(container.querySelector('#sumup-card')).toBeTruthy();
    expect(screen.queryByTestId('paypal-buttons')).toBeNull();
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    const { onPaymentMethodsLoad } = mount.mock.calls[0][0];
    expect(onPaymentMethodsLoad(['card', 'paypal', 'apple_pay'])).toEqual(['card', 'apple_pay']);
  });

  it('PayPal: одна standalone-кнопка paypal — SumUp-виджета нет, mount не вызывается', async () => {
    const { container } = render(
      <OnlinePaymentPanel
        pay={makePay({ method: 'paypal', sumupIds: [], sumupCheckoutId: null })}
        language="de"
        t={t}
        onBack={() => {}}
        {...noopHandlers}
      />
    );
    const buttons = await screen.findByTestId('paypal-buttons');
    expect(buttons.getAttribute('data-funding')).toBe('paypal');
    expect(container.querySelector('#sumup-card')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(mount).not.toHaveBeenCalled();
  });

  it('SEPA: одна standalone-кнопка sepa (через PayPal) — ни SumUp, ни жёлтого стека', async () => {
    const { container } = render(
      <OnlinePaymentPanel
        pay={makePay({ method: 'sepa', sumupIds: [], sumupCheckoutId: null })}
        language="de"
        t={t}
        onBack={() => {}}
        {...noopHandlers}
      />
    );
    const buttons = await screen.findByTestId('paypal-buttons');
    expect(buttons.getAttribute('data-funding')).toBe('sepa');
    expect(container.querySelector('#sumup-card')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(mount).not.toHaveBeenCalled();
  });

  it('«Zurück zur Zahlungsart» вызывает onBack (возврат к списку без потери корзины)', () => {
    const onBack = vi.fn();
    render(
      <OnlinePaymentPanel pay={makePay()} language="de" t={t} onBack={onBack} {...noopHandlers} />
    );
    fireEvent.click(screen.getByText('Zurück zur Zahlungsart'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('панель показывает сумму к оплате', () => {
    render(
      <OnlinePaymentPanel pay={makePay()} language="de" t={t} onBack={() => {}} {...noopHandlers} />
    );
    expect(screen.getByText(/33\.90 €/)).toBeTruthy();
  });
});
