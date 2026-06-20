import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Управляемые из тестов значения
let mockPathname = '/menu';
let mockState: any = {};

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

vi.mock('../../../lib/contexts/CartContext', () => ({
  useCart: () => ({ state: mockState }),
}));

import GiftThresholdReminder from '../GiftThresholdReminder';

function nearMissState() {
  return {
    items: [{ id: '1', productId: 'p1', name: 'Pizza', quantity: 1, price: 12 }],
    promotionCalculation: {
      giftThresholds: [
        { promotionId: 'g1', name: 'Gratis', giftName: 'Cola 0,33l', threshold: 20, remaining: 8 },
      ],
      bogoSecondOffers: [],
      freeGiftOffers: [],
    },
    selectedFreeGifts: {},
  };
}

describe('GiftThresholdReminder — не перекрывает хедер в оформлении (bug: header not clickable on checkout)', () => {
  beforeEach(() => {
    mockState = nearMissState();
  });

  it('НЕ рендерит оверлей на /checkout (даже при near-miss подарка)', () => {
    mockPathname = '/checkout';
    const { container } = render(<GiftThresholdReminder />);
    expect(screen.queryByText(/Fast geschafft/i)).not.toBeInTheDocument();
    // нет ни одного fixed inset-0 оверлея, который мог бы ловить клики хедера
    expect(container.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('НЕ рендерит оверлей на /checkout/confirmation', () => {
    mockPathname = '/checkout/confirmation/abc';
    const { container } = render(<GiftThresholdReminder />);
    expect(container.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('НЕ рендерит оверлей на /cart', () => {
    mockPathname = '/cart';
    const { container } = render(<GiftThresholdReminder />);
    expect(screen.queryByText(/Fast geschafft/i)).not.toBeInTheDocument();
    expect(container.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('показывает напоминание на /menu при near-miss', async () => {
    mockPathname = '/menu';
    render(<GiftThresholdReminder />);
    expect(await screen.findByText(/Fast geschafft/i)).toBeInTheDocument();
  });
});
