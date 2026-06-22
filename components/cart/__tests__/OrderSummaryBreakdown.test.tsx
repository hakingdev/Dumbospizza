import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import OrderSummaryBreakdown from '../OrderSummaryBreakdown';

describe('OrderSummaryBreakdown — объяснимый total', () => {
  it('показывает строку скидки купона «Rabatt mit Gutscheincode TEAM -7.74 €» и Gesamtsumme', () => {
    render(
      <OrderSummaryBreakdown
        subtotal={29.9}
        deliveryFee={0}
        total={22.16}
        couponCode="TEAM"
        couponDiscount={7.74}
        loyaltyPointsDiscount={0}
        promotionCalculation={null}
      />
    );

    const line = screen.getByTestId('coupon-discount-line');
    expect(line.textContent).toContain('Rabatt mit Gutscheincode TEAM');
    expect(line.textContent).toContain('-7.74 €');

    const root = screen.getByTestId('order-summary-breakdown');
    expect(root.textContent).toContain('Gesamtsumme');
    expect(within(root).getByText('22.16 €')).toBeTruthy();
  });

  it('если total < subtotal+delivery → есть хотя бы одна discount-строка', () => {
    render(
      <OrderSummaryBreakdown
        subtotal={29.9}
        deliveryFee={0}
        total={22.16}
        couponCode="TEAM"
        couponDiscount={7.74}
        loyaltyPointsDiscount={0}
        promotionCalculation={null}
      />
    );
    expect(screen.queryByTestId('coupon-discount-line')).not.toBeNull();
  });

  it('без скидки — строки купона нет', () => {
    render(
      <OrderSummaryBreakdown
        subtotal={20}
        deliveryFee={2}
        total={22}
        couponDiscount={0}
        loyaltyPointsDiscount={0}
        promotionCalculation={null}
      />
    );
    expect(screen.queryByTestId('coupon-discount-line')).toBeNull();
  });

  it('Treuepunkte-скидка отображается', () => {
    render(
      <OrderSummaryBreakdown
        subtotal={20}
        deliveryFee={0}
        total={18}
        couponDiscount={0}
        loyaltyPointsDiscount={2}
        promotionCalculation={null}
      />
    );
    expect(screen.getByText('Treuepunkte')).toBeTruthy();
    expect(screen.getByText('-2.00 €')).toBeTruthy();
  });
});
