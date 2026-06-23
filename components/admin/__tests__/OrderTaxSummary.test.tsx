import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OrderTaxSummary from '../OrderTaxSummary';

const items = [
  { name: 'Pizza Margherita', quantity: 1, price: 9.5, totalPrice: 9.5 },
  { name: 'Wasser 0.5L', quantity: 1, price: 2.5, totalPrice: 2.5 },
];

describe('OrderTaxSummary — налоговая разбивка только для онлайн-оплаты', () => {
  it('онлайн-оплата: показывает разбивку 7 % и 19 %', () => {
    render(<OrderTaxSummary order={{ paymentMethod: 'online', items }} />);
    expect(screen.getByTestId('order-tax-summary')).toBeTruthy();
    expect(screen.getByTestId('tax-row-7')).toBeTruthy();
    expect(screen.getByTestId('tax-row-19')).toBeTruthy();
    expect(screen.getByTestId('tax-row-7').textContent).toContain('USt. 7%');
    expect(screen.getByTestId('tax-row-7').textContent).toContain('Brutto 9,50 €');
    expect(screen.getByTestId('tax-row-19').textContent).toContain('USt. 19%');
    expect(screen.getByTestId('tax-row-19').textContent).toContain('Brutto 2,50 €');
  });

  it.each(['cash', 'card'])('офлайн-оплата (%s): ничего не показывает', (paymentMethod) => {
    const { container } = render(<OrderTaxSummary order={{ paymentMethod, items }} />);
    expect(screen.queryByTestId('order-tax-summary')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('онлайн только с едой: есть строка 7 %, нет строки 19 %', () => {
    render(
      <OrderTaxSummary
        order={{
          paymentMethod: 'online',
          items: [{ name: 'Pizza Salami', quantity: 1, price: 11, totalPrice: 11 }],
        }}
      />
    );
    expect(screen.getByTestId('tax-row-7')).toBeTruthy();
    expect(screen.queryByTestId('tax-row-19')).toBeNull();
  });

  it('онлайн с алкоголем: 19 % присутствует', () => {
    render(
      <OrderTaxSummary
        order={{
          paymentMethod: 'online',
          items: [
            { name: 'Pizza Salami', quantity: 1, price: 11, totalPrice: 11 },
            { name: 'Bier', quantity: 2, price: 3, totalPrice: 6 },
          ],
        }}
      />
    );
    expect(screen.getByTestId('tax-row-19')).toBeTruthy();
  });
});
