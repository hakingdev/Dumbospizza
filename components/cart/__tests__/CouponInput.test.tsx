import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let mockValidateCoupon: any;
let mockValidatePromotionCode: any;

vi.mock('../../../lib/api-client', () => ({
  validateCoupon: (...a: any[]) => mockValidateCoupon(...a),
  validatePromotionCode: (...a: any[]) => mockValidatePromotionCode(...a),
}));
vi.mock('../../../lib/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'de' }),
}));
vi.mock('../../../lib/i18n', () => ({
  // t возвращает ключ (или fallback) — удобно проверять выбор по reason.
  loadTranslation: async () => ({ t: (k: string, fb?: string) => fb || k }),
}));
vi.mock('../PromoConflictDialog', () => ({ default: () => null }));

import CouponInput from '../CouponInput';

beforeEach(() => {
  mockValidateCoupon = vi.fn();
  mockValidatePromotionCode = vi.fn();
});

function renderInput(props: any = {}) {
  return render(
    <CouponInput
      orderAmount={20}
      onCouponApplied={props.onCouponApplied || vi.fn()}
      onCouponRemoved={props.onCouponRemoved || vi.fn()}
      onPromotionCodeApplied={props.onPromotionCodeApplied}
      onPromotionCodeRemoved={props.onPromotionCodeRemoved}
      angebotConflictActive={props.angebotConflictActive}
    />
  );
}

function typeAndSubmit(code: string) {
  const input = screen.getByPlaceholderText('checkout.promo_placeholder');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.submit(input.closest('form')!);
}

describe('CouponInput — стабильная валидация по reason', () => {
  it('AC #4: not_found → пробуем промо-код акции', async () => {
    mockValidateCoupon.mockResolvedValue({ success: false, reason: 'not_found' });
    mockValidatePromotionCode.mockResolvedValue({
      success: true,
      promotionCode: { code: 'TEAM' },
    });
    const onPromo = vi.fn();
    renderInput({ onPromotionCodeApplied: onPromo });
    typeAndSubmit('TEAM');

    await waitFor(() => expect(onPromo).toHaveBeenCalledWith('TEAM'));
    expect(mockValidatePromotionCode).toHaveBeenCalled();
  });

  it('AC #5: expired → показываем expired и НЕ пробуем промо-код', async () => {
    mockValidateCoupon.mockResolvedValue({ success: false, reason: 'expired' });
    const onApplied = vi.fn();
    renderInput({ onCouponApplied: onApplied });
    typeAndSubmit('TEAM');

    await waitFor(() => expect(screen.getByText('errors.promo_expired')).toBeTruthy());
    expect(mockValidatePromotionCode).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('AC #1/#6: валидный купон применяется, без «expired» (даже при gratis Angebot)', async () => {
    mockValidateCoupon.mockResolvedValue({
      success: true,
      coupon: { code: 'TEAM', discount: 5, discountType: 'fixed', discountValue: 5 },
    });
    const onApplied = vi.fn();
    // gratis совместим → angebotConflictActive=false (денежной акции нет)
    renderInput({ onCouponApplied: onApplied, angebotConflictActive: false });
    typeAndSubmit('TEAM');

    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(screen.queryByText('errors.promo_expired')).toBeNull();
    expect(mockValidatePromotionCode).not.toHaveBeenCalled();
  });

  it('AC #2: невалидная попытка не вызывает onCouponApplied, input остаётся', async () => {
    mockValidateCoupon.mockResolvedValue({ success: false, reason: 'not_found' });
    mockValidatePromotionCode.mockResolvedValue({ success: false, reason: 'not_found' });
    const onApplied = vi.fn();
    renderInput({ onCouponApplied: onApplied });
    typeAndSubmit('BADCODE');

    await waitFor(() => expect(mockValidatePromotionCode).toHaveBeenCalled());
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('checkout.promo_placeholder')).toBeTruthy();
  });

  it('AC #8 (race): устаревший ответ не перезаписывает результат нового запроса', async () => {
    // Запрос A (expired) разрешится ПОЗЖЕ запроса B (success) — A должен быть проигнорирован.
    let resolveA: (v: any) => void = () => {};
    const aPromise = new Promise((res) => (resolveA = res));
    mockValidateCoupon
      .mockReturnValueOnce(aPromise) // submit #1
      .mockResolvedValueOnce({
        success: true,
        coupon: { code: 'TEAM', discount: 5, discountType: 'fixed', discountValue: 5 },
      }); // submit #2
    const onApplied = vi.fn();
    renderInput({ onCouponApplied: onApplied });

    typeAndSubmit('TEAM'); // A (seq 1)
    typeAndSubmit('TEAM'); // B (seq 2)

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1)); // применился B
    resolveA({ success: false, reason: 'expired' }); // поздний A
    await Promise.resolve();

    // stale expired не должен появиться
    expect(screen.queryByText('errors.promo_expired')).toBeNull();
  });

  it('кнопка удаления: aria-label, клик → onCouponRemoved + onPromotionCodeRemoved, input возвращается', async () => {
    mockValidateCoupon.mockResolvedValue({
      success: true,
      coupon: { code: 'TEAM10', discount: 5, discountType: 'fixed', discountValue: 5 },
    });
    const onRemoved = vi.fn();
    const onPromoRemoved = vi.fn();
    renderInput({ onCouponRemoved: onRemoved, onPromotionCodeRemoved: onPromoRemoved });
    typeAndSubmit('TEAM10');

    const removeBtn = await screen.findByLabelText('Promo-Code entfernen');
    fireEvent.click(removeBtn);
    expect(onRemoved).toHaveBeenCalled();
    expect(onPromoRemoved).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByPlaceholderText('checkout.promo_placeholder')).toBeTruthy()
    );
  });
});
