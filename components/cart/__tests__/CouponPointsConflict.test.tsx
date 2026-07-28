import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Правило «ENTWEDER Code ODER Punkte»: если клиент уже списал Treuepunkte,
 * ввод Gutschein-/Aktionscode не применяется молча — сначала явный выбор.
 * (Диалог здесь НЕ мокаем — проверяем именно кнопки выбора.)
 */

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
  loadTranslation: async () => ({ t: (k: string, fb?: string) => fb || k }),
}));

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
      appliedLoyaltyPoints={props.appliedLoyaltyPoints}
    />
  );
}

function typeAndSubmit(code: string) {
  const input = screen.getByPlaceholderText('checkout.promo_placeholder');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.submit(input.closest('form')!);
}

const validCoupon = {
  success: true,
  coupon: { code: 'TEAM', discount: 5, discountType: 'fixed', discountValue: 5 },
};

describe('CouponInput — конфликт «Code vs. Treuepunkte»', () => {
  it('списаны баллы → валидный купон НЕ применяется сразу, показан диалог выбора', async () => {
    mockValidateCoupon.mockResolvedValue(validCoupon);
    const onApplied = vi.fn();
    renderInput({ onCouponApplied: onApplied, appliedLoyaltyPoints: 5 });
    typeAndSubmit('TEAM');

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByText('Treuepunkte oder Promo-Code?')).toBeTruthy();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('«Punkte behalten» → код не применяется', async () => {
    mockValidateCoupon.mockResolvedValue(validCoupon);
    const onApplied = vi.fn();
    renderInput({ onCouponApplied: onApplied, appliedLoyaltyPoints: 5 });
    typeAndSubmit('TEAM');

    fireEvent.click(await screen.findByText('Punkte behalten'));
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('«Promo-Code anwenden» → купон применяется (баллы снимет CartContext)', async () => {
    mockValidateCoupon.mockResolvedValue(validCoupon);
    const onApplied = vi.fn();
    renderInput({ onCouponApplied: onApplied, appliedLoyaltyPoints: 5 });
    typeAndSubmit('TEAM');

    fireEvent.click(await screen.findByText('Promo-Code anwenden'));
    expect(onApplied).toHaveBeenCalledWith(validCoupon.coupon);
  });

  it('Aktionscode акции с уже списанными баллами тоже спрашивает выбор', async () => {
    mockValidateCoupon.mockResolvedValue({ success: false, reason: 'not_found' });
    mockValidatePromotionCode.mockResolvedValue({
      success: true,
      promotionCode: { code: 'TEAM' },
    });
    const onPromo = vi.fn();
    renderInput({ onPromotionCodeApplied: onPromo, appliedLoyaltyPoints: 3 });
    typeAndSubmit('TEAM');

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(onPromo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Promo-Code anwenden'));
    expect(onPromo).toHaveBeenCalledWith('TEAM');
  });

  it('без списанных баллов диалог не показывается (обычный путь не сломан)', async () => {
    mockValidateCoupon.mockResolvedValue(validCoupon);
    const onApplied = vi.fn();
    renderInput({ onCouponApplied: onApplied, appliedLoyaltyPoints: 0 });
    typeAndSubmit('TEAM');

    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
