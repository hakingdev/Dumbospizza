import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OrderVatReceipt from '../OrderVatReceipt';

const baseOrder = {
  orderNumber: '250620001',
  createdAt: '2026-06-20T17:30:00.000Z',
  subtotal: 12,
  deliveryFee: 2.5,
  total: 14.5,
  customerName: 'Max Mustermann',
  items: [
    { name: 'Pizza Margherita', quantity: 1, price: 9.5, totalPrice: 9.5 },
    { name: 'Wasser 0.5L', quantity: 1, price: 2.5, totalPrice: 2.5 },
  ],
};

describe('OrderVatReceipt — клиентский НДС-чек (Beleg)', () => {
  it('онлайн-оплата: рендерит реквизиты продавца, печатаемую область и обе ставки', () => {
    const { container } = render(
      <OrderVatReceipt order={{ ...baseOrder, paymentMethod: 'online' }} />
    );
    // Печатаемая область с фиксированным id (на неё завязан @media print).
    expect(container.querySelector('#vat-receipt')).toBeTruthy();
    // Реквизиты продавца и USt-IdNr попадают в чек.
    expect(screen.getByText('Weisses Haus GmbH')).toBeTruthy();
    expect(screen.getByText(/USt-IdNr.*DE365866180/)).toBeTruthy();
    // Номер заказа и обе налоговые ставки (встречаются и в позициях, и в разбивке).
    expect(screen.getByText('#250620001')).toBeTruthy();
    expect(screen.getAllByText('7%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('19%').length).toBeGreaterThan(0);
  });

  it.each(['cash', 'card'])('офлайн-оплата (%s): чек не формируется', (paymentMethod) => {
    const { container } = render(<OrderVatReceipt order={{ ...baseOrder, paymentMethod }} />);
    expect(container.firstChild).toBeNull();
  });

  it('онлайн только с едой: есть 7 %, нет 19 %', () => {
    render(
      <OrderVatReceipt
        order={{
          ...baseOrder,
          paymentMethod: 'online',
          items: [{ name: 'Pizza Salami', quantity: 1, price: 11, totalPrice: 11 }],
        }}
      />
    );
    expect(screen.getAllByText('7%').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('19%').length).toBe(0);
  });
});
