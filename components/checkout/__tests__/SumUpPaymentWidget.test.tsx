import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import SumUpPaymentWidget from '../SumUpPaymentWidget';

type MountConfig = Record<string, any>;

/** Мок SDK: считаем mount'ы и unmount'ы, чтобы проверять «живой виджет ровно один». */
function installSumUpMock() {
  const unmounts: Array<ReturnType<typeof vi.fn>> = [];
  const mount = vi.fn((_config: MountConfig) => {
    const unmount = vi.fn();
    unmounts.push(unmount);
    return { unmount };
  });
  (window as any).SumUpCard = { mount };
  const liveWidgets = () =>
    mount.mock.calls.length - unmounts.filter((u) => u.mock.calls.length > 0).length;
  return { mount, unmounts, liveWidgets };
}

const baseProps = {
  checkoutId: 'chk-1',
  amount: 33.9,
  paymentMethods: ['card', 'apple_pay', 'google_pay'],
  onPaid: () => {},
  onError: () => {},
};

describe('SumUpPaymentWidget — фильтр методов и жизненный цикл', () => {
  let sumup: ReturnType<typeof installSumUpMock>;

  beforeEach(() => {
    sumup = installSumUpMock();
  });

  afterEach(() => {
    delete (window as any).SumUpCard;
  });

  it('монтируется один раз, конфиг несёт checkoutId и onPaymentMethodsLoad', async () => {
    render(<SumUpPaymentWidget {...baseProps} />);
    await waitFor(() => expect(sumup.mount).toHaveBeenCalledTimes(1));
    const config = sumup.mount.mock.calls[0][0];
    expect(config.checkoutId).toBe('chk-1');
    expect(config.id).toBe('sumup-card');
    expect(typeof config.onPaymentMethodsLoad).toBe('function');
  });

  it('onPaymentMethodsLoad = пересечение группы и allowlist SumUp: paypal/sepa не проходят', async () => {
    render(<SumUpPaymentWidget {...baseProps} />);
    await waitFor(() => expect(sumup.mount).toHaveBeenCalledTimes(1));
    const { onPaymentMethodsLoad } = sumup.mount.mock.calls[0][0];
    expect(onPaymentMethodsLoad(['card', 'paypal', 'sepa_debit', 'apple_pay'])).toEqual([
      'card',
      'apple_pay',
    ]);
  });

  it('SumUp не передал available → отдаём whitelist группы как есть (не пустоту)', async () => {
    render(<SumUpPaymentWidget {...baseProps} />);
    await waitFor(() => expect(sumup.mount).toHaveBeenCalledTimes(1));
    const { onPaymentMethodsLoad } = sumup.mount.mock.calls[0][0];
    expect(onPaymentMethodsLoad(undefined)).toEqual(['card', 'apple_pay', 'google_pay']);
  });

  it('узкая группа: whitelist ["paypal"] не пропускает карточные методы', async () => {
    render(<SumUpPaymentWidget {...baseProps} paymentMethods={['paypal']} />);
    await waitFor(() => expect(sumup.mount).toHaveBeenCalledTimes(1));
    const { onPaymentMethodsLoad } = sumup.mount.mock.calls[0][0];
    expect(onPaymentMethodsLoad(['card', 'paypal', 'apple_pay', 'google_pay'])).toEqual(['paypal']);
  });

  it('unmount() виджета вызывается при размонтировании компонента', async () => {
    const { unmount } = render(<SumUpPaymentWidget {...baseProps} />);
    await waitFor(() => expect(sumup.mount).toHaveBeenCalledTimes(1));
    unmount();
    expect(sumup.unmounts[0]).toHaveBeenCalledTimes(1);
    expect(sumup.liveWidgets()).toBe(0);
  });

  it('смена checkoutId перемонтирует: старый unmount, живой виджет ровно один', async () => {
    const { rerender } = render(<SumUpPaymentWidget {...baseProps} />);
    await waitFor(() => expect(sumup.mount).toHaveBeenCalledTimes(1));
    rerender(<SumUpPaymentWidget {...baseProps} checkoutId="chk-2" />);
    await waitFor(() => expect(sumup.mount).toHaveBeenCalledTimes(2));
    expect(sumup.unmounts[0]).toHaveBeenCalledTimes(1);
    expect(sumup.mount.mock.calls[1][0].checkoutId).toBe('chk-2');
    expect(sumup.liveWidgets()).toBe(1);
  });

  it('ререндер с эквивалентным whitelist (новая ссылка) не перемонтирует виджет', async () => {
    const { rerender } = render(<SumUpPaymentWidget {...baseProps} />);
    await waitFor(() => expect(sumup.mount).toHaveBeenCalledTimes(1));
    rerender(
      <SumUpPaymentWidget {...baseProps} paymentMethods={['card', 'apple_pay', 'google_pay']} />
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(sumup.mount).toHaveBeenCalledTimes(1);
    expect(sumup.liveWidgets()).toBe(1);
  });

  it('StrictMode (двойной эффект в dev) не оставляет двух живых виджетов', async () => {
    render(
      <StrictMode>
        <SumUpPaymentWidget {...baseProps} />
      </StrictMode>
    );
    await waitFor(() => expect(sumup.liveWidgets()).toBe(1));
    // Дожидаемся хвоста микрозадач: второй mount так и не должен появиться.
    await new Promise((r) => setTimeout(r, 10));
    expect(sumup.liveWidgets()).toBe(1);
  });
});
