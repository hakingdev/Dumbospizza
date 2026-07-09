import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OrderVatReceiptModal from '../OrderVatReceiptModal';

const onlineOrder = {
  orderNumber: '250622001',
  createdAt: '2026-06-22T12:00:00.000Z',
  paymentMethod: 'online',
  total: 12,
  items: [
    { name: 'Pizza Margherita', quantity: 1, price: 9.5, totalPrice: 9.5 },
    { name: 'Wasser 0.5L', quantity: 1, price: 2.5, totalPrice: 2.5 },
  ],
};

describe('OrderVatReceiptModal — авто-всплывающий НДС-чек', () => {
  it('open=false → ничего не рендерит', () => {
    const { container } = render(
      <OrderVatReceiptModal order={onlineOrder} open={false} onClose={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('online + open → показывает модалку с Beleg', () => {
    render(<OrderVatReceiptModal order={onlineOrder} open onClose={() => {}} />);
    expect(screen.getByTestId('receipt-modal')).toBeTruthy();
    // Точный заголовок: в чеке есть ещё «Beleg-Nr.», и /Beleg/ матчил бы оба.
    expect(screen.getByText('Beleg (inkl. MwSt.)')).toBeTruthy();
    expect(screen.getByText(/Aufschlüsselung der Steuern/)).toBeTruthy();
  });

  it.each(['cash', 'card'])('офлайн-оплата (%s) → модалка не показывается даже при open', (pm) => {
    const { container } = render(
      <OrderVatReceiptModal order={{ ...onlineOrder, paymentMethod: pm }} open onClose={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('клик по кнопке закрытия вызывает onClose', () => {
    const onClose = vi.fn();
    render(<OrderVatReceiptModal order={onlineOrder} open onClose={onClose} />);
    fireEvent.click(screen.getByTestId('receipt-modal-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('клик по оверлею закрывает, клик по содержимому — нет', () => {
    const onClose = vi.fn();
    render(<OrderVatReceiptModal order={onlineOrder} open onClose={onClose} />);
    fireEvent.click(screen.getByText(/Aufschlüsselung der Steuern/));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('receipt-modal'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape закрывает модалку', () => {
    const onClose = vi.fn();
    render(<OrderVatReceiptModal order={onlineOrder} open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
