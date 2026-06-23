import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// useCart wird gemockt — der Builder braucht hier nur addItem.
const addItem = vi.fn();
vi.mock('../../lib/contexts/CartContext', () => ({
  useCart: () => ({ addItem }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

import { MatchdayComboBuilder } from '../matchday-combo-builder';

// Echte Menüdaten-Form: Pizza mit 30×40-Variante ("ca. 40x30") + Getränke.
const PRODUCTS = [
  {
    _id: 'pizza-1',
    name: 'Margherita',
    category: { slug: 'pizza' },
    sizes: [{ name: 'ca. 40x30', price: 13.9 }],
  },
  {
    _id: 'pizza-2',
    name: 'Brooklyn',
    category: { slug: 'pizza' },
    sizes: [{ name: 'ca. 40x30', price: 18.9 }],
  },
  {
    _id: 'drink-1',
    name: 'Coca Cola 0,33l',
    category: { slug: 'getränke' },
    sizes: [],
  },
];

beforeEach(() => {
  addItem.mockClear();
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ success: true, products: PRODUCTS }),
  }) as any;
});

describe('MatchdayComboBuilder — Picker-Schriftgröße (Fix: auf Mobil nicht winzig)', () => {
  it('rendert keine nativen Selects und nutzt große Custom-Picker', async () => {
    const { container } = render(<MatchdayComboBuilder isDe={true} />);

    // Warten, bis die Menüdaten geladen sind und die Selects erscheinen.
    await screen.findByLabelText('1. Pizza wählen');

    expect(container.querySelectorAll('select')).toHaveLength(0);

    const pickers = screen.getAllByRole('combobox');
    expect(pickers).toHaveLength(4); // 2 Pizzen + 2 Getränke-Slots

    for (const picker of pickers) {
      expect(picker.className).toContain('text-base');
      expect(picker.className).toContain('min-h-[56px]');
      expect(picker.className).not.toMatch(/\btext-sm\b/);
    }
  });

  it('berechnet den Kombi-Preis = Pizza1 + Pizza2 − 5 € aus den Menüdaten', async () => {
    render(<MatchdayComboBuilder isDe={true} />);
    await screen.findByLabelText('1. Pizza wählen');

    // Vorauswahl: Margherita (13,90) + Brooklyn (18,90) = 32,80 − 5 = 27,80
    await waitFor(() => {
      expect(screen.getByTestId('combo-total')).toHaveTextContent('27,80 €');
    });
  });

  it('legt die Kombi als EINZELNE Positionen in den Warenkorb (Summe = Kombi-Preis)', async () => {
    render(<MatchdayComboBuilder isDe={true} />);
    await screen.findByLabelText('1. Pizza wählen');
    await waitFor(() => {
      expect(screen.getByTestId('combo-total')).toHaveTextContent('27,80 €');
    });

    const addBtn = screen.getByRole('button', { name: /Kombi/i });
    fireEvent.click(addBtn);

    // Vorauswahl: 2 Pizzen + 1 Getränk + 1 Rabatt = 4 getrennte Positionen.
    expect(addItem).toHaveBeenCalledTimes(4);
    const added = addItem.mock.calls.map((c) => c[0]);

    // Alle teilen dieselbe comboId.
    const comboIds = new Set(added.map((i) => i.comboId));
    expect(comboIds.size).toBe(1);

    const roles = added.map((i) => i.comboRole).sort();
    expect(roles).toEqual(['discount', 'drink', 'pizza', 'pizza']);

    // Pizzen mit echtem Preis, Getränk gratis, Rabatt −5 €.
    const pizzas = added.filter((i) => i.comboRole === 'pizza');
    expect(pizzas.map((p) => p.price).sort()).toEqual([13.9, 18.9]);
    expect(added.find((i) => i.comboRole === 'drink').price).toBe(0);
    expect(added.find((i) => i.comboRole === 'discount').price).toBe(-5);

    // Summe aller Positionen = Kombi-Preis.
    const sum = added.reduce((s, i) => s + i.price * i.quantity, 0);
    expect(sum).toBeCloseTo(27.8, 2);
  });
});
