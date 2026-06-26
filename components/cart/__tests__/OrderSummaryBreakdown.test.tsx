// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import OrderSummaryBreakdown from '../OrderSummaryBreakdown';

function renderText(node: React.ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]*>/g, '');
}

describe('OrderSummaryBreakdown — объяснимый total', () => {
  it('показывает строку скидки купона «Rabatt mit Gutscheincode TEAM -7.74 €» и Gesamtsumme', () => {
    const text = renderText(
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

    expect(text).toContain('Rabatt mit Gutscheincode TEAM');
    expect(text).toContain('-7.74 €');
    expect(text).toContain('Gesamtsumme');
    expect(text).toContain('22.16 €');
  });

  it('если total < subtotal+delivery → есть хотя бы одна discount-строка', () => {
    const text = renderText(
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
    expect(text).toContain('Rabatt mit Gutscheincode TEAM');
  });

  it('без скидки — строки купона нет', () => {
    const text = renderText(
      <OrderSummaryBreakdown
        subtotal={20}
        deliveryFee={2}
        total={22}
        couponDiscount={0}
        loyaltyPointsDiscount={0}
        promotionCalculation={null}
      />
    );
    expect(text).not.toContain('Rabatt mit Gutscheincode');
  });

  it('showDelivery=false: keine Liefergebühr-Zeile, Gesamt ohne Lieferung', () => {
    // subtotal 20 + delivery 3 − coupon 5 = total 18; Gesamt ohne Lieferung = 18 − 3 = 15,00
    const withoutDelivery = renderText(
      <OrderSummaryBreakdown
        subtotal={20}
        deliveryFee={3}
        total={18}
        couponCode="X"
        couponDiscount={5}
        loyaltyPointsDiscount={0}
        promotionCalculation={null}
        showDelivery={false}
      />
    );
    expect(withoutDelivery).not.toContain('Liefergebühr');
    expect(withoutDelivery).toContain('15.00 €');

    // Standard (showDelivery=true) zeigt die Zeile weiterhin.
    const withDelivery = renderText(
      <OrderSummaryBreakdown
        subtotal={20}
        deliveryFee={3}
        total={18}
        couponCode="X"
        couponDiscount={5}
        loyaltyPointsDiscount={0}
        promotionCalculation={null}
      />
    );
    expect(withDelivery).toContain('Liefergebühr');
  });

  it('Treuepunkte-скидка отображается', () => {
    const text = renderText(
      <OrderSummaryBreakdown
        subtotal={20}
        deliveryFee={0}
        total={18}
        couponDiscount={0}
        loyaltyPointsDiscount={2}
        promotionCalculation={null}
      />
    );
    expect(text).toContain('Treuepunkte');
    expect(text).toContain('-2.00 €');
  });

  it('суммирует выбранный акционный BOGO-товар в товарной сумме', () => {
    const text = renderText(
      <OrderSummaryBreakdown
        subtotal={7.9}
        deliveryFee={0}
        total={22.85}
        couponDiscount={0}
        loyaltyPointsDiscount={0}
        promotionCalculation={
          {
            bogoSecondItems: [
              {
                productId: 'bayern-60x40',
                name: 'Bayern Pizza — ca. 60×40',
                quantity: 1,
                unitPrice: 14.95,
                originalUnitPrice: 29.9,
                promotionId: 'promo-bogo',
                promotionName: '2. Artikel -50%',
                label: '2. Artikel -50%',
                bogoMode: 'half_price',
              },
            ],
          } as any
        }
      />
    );

    // Был баг: в товарной сумме оставалось 7.90 €, хотя итог уже включал 14.95 €.
    expect(text.match(/22\.85 €/g) || []).toHaveLength(2);
    expect(text).not.toContain('7.90 €');
  });
});
