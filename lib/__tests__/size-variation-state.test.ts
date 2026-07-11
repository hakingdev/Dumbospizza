import { describe, expect, it } from 'vitest';
import {
  applySizeVariationStates,
  removeOrphanedSizeVariations,
  removeSizeVariation,
} from '../size-variation-state';

describe('applySizeVariationStates', () => {
  it('выключает связанный размер и обновляет название, не меняя цену', () => {
    const sizes = applySizeVariationStates(
      [{ variationId: 'size-1', name: 'Alt', label: 'old', price: 9.5 }],
      [{ _id: 'size-1', name: 'Solo', label: 'Ø 26 cm', active: false }]
    );

    expect(sizes).toEqual([
      {
        variationId: 'size-1',
        name: 'Solo',
        label: 'Ø 26 cm',
        price: 9.5,
        active: false,
      },
    ]);
  });

  it('не выключает legacy-размер без variationId', () => {
    const legacy = { name: 'Legacy', price: 7 };
    expect(applySizeVariationStates([legacy], [])).toEqual([legacy]);
  });

  it('убирает привязанный размер, если он уже удалён из библиотеки', () => {
    const sizes = [
      { variationId: 'existing', name: 'Small', price: 8 },
      { variationId: 'deleted', name: '40×40', price: 20 },
      { id: 'legacy', name: 'Legacy', price: 7 },
    ];

    expect(removeOrphanedSizeVariations(sizes, [{ _id: 'existing' }])).toEqual([
      sizes[0],
      sizes[2],
    ]);
  });

  it('перепривязывает старый id по названию и считает 40×30 тем же размером, что 30×40', () => {
    expect(
      removeOrphanedSizeVariations(
        [{ variationId: 'old-id', name: 'ca. 40×30', price: 16.9 }],
        [{ _id: 'new-id', name: 'ca. 30x40', active: true }]
      )
    ).toEqual([
      { variationId: 'new-id', name: 'ca. 40×30', price: 16.9 },
    ]);
  });

  it('удаляет размер по variationId и поддерживает старую привязку через id', () => {
    expect(
      removeSizeVariation(
        [
          { variationId: 'deleted', name: '40×40' },
          { id: 'deleted', name: '40×40 legacy link' },
          { variationId: 'existing', name: 'Small' },
        ],
        'deleted',
        'ca. 40×40'
      )
    ).toEqual([{ variationId: 'existing', name: 'Small' }]);
  });
});
