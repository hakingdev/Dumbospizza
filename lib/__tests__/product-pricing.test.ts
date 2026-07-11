import { describe, it, expect } from 'vitest';
import {
  getOrderableSizes,
  getProductDisplayPrice,
  hasNoActiveRegularSizes,
} from '../product-pricing';

/**
 * Mini-Größe (18 cm) speichert den Sortenpreis für die 4er Mini Pizza Box und
 * darf weder einzeln bestellbar sein noch den »ab«-Preis im Menü drücken.
 */
describe('product-pricing — Mini-Größe (4er Mini Pizza Box)', () => {
  const pizza = {
    basePrice: 6.9,
    sizes: [
      { name: 'ca. 20x20', price: 6.9 },
      { name: 'ca. 40x30', price: 13.9 },
      { name: 'Mini 18cm', price: 4.9 },
    ],
  };

  it('getOrderableSizes filtert die Mini-Größe heraus', () => {
    expect(getOrderableSizes(pizza).map((s) => s.name)).toEqual(['ca. 20x20', 'ca. 40x30']);
  });

  it('getProductDisplayPrice ignoriert den Mini-Preis («ab» bleibt 6,90)', () => {
    expect(getProductDisplayPrice(pizza)).toBe(6.9);
  });

  it('ohne bestellbare Größen fällt der Preis auf basePrice zurück', () => {
    expect(
      getProductDisplayPrice({ basePrice: 19.6, sizes: [{ name: 'Mini 18cm', price: 4.9 }] })
    ).toBe(19.6);
  });

  it('выключенный библиотечный размер нельзя заказать и он не влияет на цену «от»', () => {
    const product = {
      basePrice: 20,
      sizes: [
        { name: 'Small', price: 6.9, active: false },
        { name: 'Large', price: 13.9, active: true },
      ],
    };

    expect(getOrderableSizes(product).map((s) => s.name)).toEqual(['Large']);
    expect(getProductDisplayPrice(product)).toBe(13.9);
  });

  it('помечает товар недоступным, если выключены все обычные размеры', () => {
    expect(
      hasNoActiveRegularSizes({
        sizes: [
          { name: 'Small', price: 6.9, active: false },
          { name: 'Mini 18cm', price: 4.9, active: true },
        ],
      })
    ).toBe(true);
  });
});
