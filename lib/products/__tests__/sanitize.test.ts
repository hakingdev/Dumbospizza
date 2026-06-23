import { describe, it, expect } from 'vitest';
import { sanitizeProductInput, normalizeTaxRate } from '../sanitize';

describe('normalizeTaxRate', () => {
  it('доли остаются долями', () => {
    expect(normalizeTaxRate(0.07)).toBe(0.07);
    expect(normalizeTaxRate(0.19)).toBe(0.19);
  });

  it('проценты переводятся в доли', () => {
    expect(normalizeTaxRate(7)).toBe(0.07);
    expect(normalizeTaxRate(19)).toBe(0.19);
  });

  it('строки парсятся', () => {
    expect(normalizeTaxRate('19')).toBe(0.19);
    expect(normalizeTaxRate('0.07')).toBe(0.07);
  });

  it.each([0, -1, NaN, undefined, null, 'abc', {}])('невалидное (%s) → undefined', (v) => {
    expect(normalizeTaxRate(v as any)).toBeUndefined();
  });
});

describe('sanitizeProductInput', () => {
  it('убирает иммутабельные/служебные поля', () => {
    const out = sanitizeProductInput({
      _id: 'abc',
      id: 'abc',
      __v: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      name: 'Pizza',
      basePrice: 9.5,
    });
    expect(out).not.toHaveProperty('_id');
    expect(out).not.toHaveProperty('id');
    expect(out).not.toHaveProperty('__v');
    expect(out).not.toHaveProperty('createdAt');
    expect(out).not.toHaveProperty('updatedAt');
    expect(out.name).toBe('Pizza');
    expect(out.basePrice).toBe(9.5);
  });

  it('нормализует taxRate (проценты → доли)', () => {
    expect(sanitizeProductInput({ name: 'Bier', taxRate: 19 }).taxRate).toBe(0.19);
    expect(sanitizeProductInput({ name: 'Pizza', taxRate: 0.07 }).taxRate).toBe(0.07);
  });

  it('невалидный taxRate удаляется (поле не трогаем при обновлении)', () => {
    expect(sanitizeProductInput({ name: 'X', taxRate: 0 })).not.toHaveProperty('taxRate');
    expect(sanitizeProductInput({ name: 'X', taxRate: NaN })).not.toHaveProperty('taxRate');
  });

  it('не мутирует исходный объект', () => {
    const raw = { _id: 'abc', name: 'Pizza', taxRate: 19 };
    sanitizeProductInput(raw);
    expect(raw._id).toBe('abc');
    expect(raw.taxRate).toBe(19);
  });

  it('сохраняет прочие поля как есть (category/sizes/optionGroupIds)', () => {
    const out = sanitizeProductInput({
      name: 'Pizza',
      category: 'pizza',
      sizes: [{ id: '1', name: 'S', price: 5 }],
      optionGroupIds: ['g1'],
    });
    expect(out.category).toBe('pizza');
    expect(out.sizes).toEqual([{ id: '1', name: 'S', price: 5 }]);
    expect(out.optionGroupIds).toEqual(['g1']);
  });
});
