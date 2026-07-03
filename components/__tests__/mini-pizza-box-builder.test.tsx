import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// useCart wird gemockt — der Builder braucht hier nur addItem.
const addItem = vi.fn();
vi.mock('../../lib/contexts/CartContext', () => ({
  useCart: () => ({ addItem }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

import { MiniPizzaBoxBuilder } from '../mini-pizza-box/MiniPizzaBoxBuilder';

// Echte Menüdaten-Form: Pizzen mit Mini-Größe (18 cm) + eine ohne (wird gefiltert).
const PRODUCTS = [
  {
    _id: 'pizza-1',
    name: 'Margherita',
    description: 'Tomatensauce, Mozzarella',
    category: { slug: 'pizza' },
    sizes: [
      { name: 'ca. 20x20', price: 6.9 },
      { name: 'Mini 18cm', price: 4.9 },
    ],
  },
  {
    _id: 'pizza-2',
    name: 'Brooklyn',
    description: 'Salami, Käse',
    category: { slug: 'pizza' },
    sizes: [
      { name: 'ca. 20x20', price: 9.9 },
      { name: 'Mini 18cm', price: 5.9 },
    ],
  },
  {
    _id: 'pizza-3',
    name: 'Ohne Mini',
    description: 'hat keine Mini-Größe',
    category: { slug: 'pizza' },
    sizes: [{ name: 'ca. 20x20', price: 7.9 }],
  },
];

const BOX_PRODUCT = {
  id: 'box-1',
  name: '4er Mini Pizza Box',
  image: '/images/mini-pizza-box.svg',
  categoryId: 'cat-minibox',
};

beforeEach(() => {
  addItem.mockClear();
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ success: true, products: PRODUCTS }),
  }) as any;
  // jsdom hat kein matchMedia — framer-motion (useReducedMotion) braucht einen Stub.
  window.matchMedia =
    window.matchMedia ||
    (((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as any);
});

const addActiveSortToBox = () =>
  fireEvent.click(screen.getByRole('button', { name: /In die Box/i }));

describe('MiniPizzaBoxBuilder — 4er Mini Pizza Box', () => {
  it('zeigt nur Sorten MIT Mini-Größe und startet mit leerer Box', async () => {
    render(<MiniPizzaBoxBuilder isOpen onClose={() => {}} product={BOX_PRODUCT} />);

    // Alphabetisch: Brooklyn zuerst sichtbar.
    await screen.findAllByText('Brooklyn');
    expect(screen.queryByText('Ohne Mini')).not.toBeInTheDocument();

    expect(screen.getByTestId('minibox-total').textContent).toContain('0 €');
    const cta = screen.getByRole('button', { name: /Wähle 4 Mini-Pizzen/i });
    expect(cta).toBeDisabled();
  });

  it('nach 4 Minis: Summe = Summe der Mini-Preise, EINE Warenkorb-Position mit 4 Optionen', async () => {
    render(<MiniPizzaBoxBuilder isOpen onClose={() => {}} product={BOX_PRODUCT} />);
    await screen.findAllByText('Brooklyn');

    // 2× Brooklyn (5,90) …
    addActiveSortToBox();
    addActiveSortToBox();
    // … weiter zur Margherita (4,90) und 2× einlegen.
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Sorte' }));
    await screen.findAllByText('Margherita');
    addActiveSortToBox();
    addActiveSortToBox();

    // 2×5,90 + 2×4,90 = 21,60 €
    await waitFor(() =>
      expect(screen.getByTestId('minibox-total').textContent).toContain('21,60 €')
    );

    const cta = await screen.findByRole('button', { name: /In den Warenkorb/i });
    expect(cta).toBeEnabled();
    fireEvent.click(cta);

    expect(addItem).toHaveBeenCalledTimes(1);
    const item = addItem.mock.calls[0][0];
    expect(item).toMatchObject({
      productId: 'box-1',
      name: '4er Mini Pizza Box',
      quantity: 1,
      price: 21.6,
      basePrice: 21.6,
    });
    expect(item.options).toHaveLength(4);
    expect(item.options.map((o: any) => o.name)).toEqual([
      'Brooklyn',
      'Brooklyn',
      'Margherita',
      'Margherita',
    ]);
    expect(item.options.every((o: any) => o.group === 'Mini Pizza ca. 18 cm')).toBe(true);
    // Eindeutige id je Box: zwei Boxen im Warenkorb verschmelzen nicht.
    expect(item.id).toMatch(/^minibox-/);
  });

  it('unter 4 Minis bleibt der Warenkorb-Button gesperrt; Slot-Tap entfernt wieder', async () => {
    render(<MiniPizzaBoxBuilder isOpen onClose={() => {}} product={BOX_PRODUCT} />);
    await screen.findAllByText('Brooklyn');

    addActiveSortToBox();
    addActiveSortToBox();
    addActiveSortToBox();
    await waitFor(() =>
      expect(screen.getByTestId('minibox-total').textContent).toContain('17,70 €')
    );
    expect(screen.getByRole('button', { name: /Wähle 4 Mini-Pizzen/i })).toBeDisabled();

    // Einen Slot wieder leeren → Summe sinkt.
    fireEvent.click(screen.getAllByRole('button', { name: /Brooklyn entfernen/i })[0]);
    await waitFor(() =>
      expect(screen.getByTestId('minibox-total').textContent).toContain('11,80 €')
    );
  });

  it('zeigt ALLE Sorten als Thumbnail-Leiste; Tap springt direkt zur Sorte', async () => {
    render(<MiniPizzaBoxBuilder isOpen onClose={() => {}} product={BOX_PRODUCT} />);
    await screen.findAllByText('Brooklyn');

    // Beide Sorten mit Mini-Größe sind gleichzeitig als Thumbnails sichtbar.
    expect(screen.getByRole('button', { name: 'Sorte wählen: Brooklyn' })).toBeInTheDocument();
    const margheritaThumb = screen.getByRole('button', { name: 'Sorte wählen: Margherita' });

    // Tap auf Margherita-Thumbnail → Karussell zeigt Margherita (Mini-Preis 4,90 €).
    fireEvent.click(margheritaThumb);
    await screen.findByText('4,90 €');
    expect(margheritaThumb).toHaveAttribute('aria-current', 'true');
  });

  it('meldet »nicht verfügbar«, wenn keine Sorte eine Mini-Größe hat', async () => {
    (global.fetch as any).mockResolvedValue({
      json: async () => ({
        success: true,
        products: [PRODUCTS[2]], // nur die Sorte ohne Mini
      }),
    });
    render(<MiniPizzaBoxBuilder isOpen onClose={() => {}} product={BOX_PRODUCT} />);
    await screen.findByText('Mini Box gerade nicht verfügbar');
  });
});
