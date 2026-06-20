import { describe, it, expect } from 'vitest';
import { toRefId } from '../normalize-id';

/**
 * Регрессия: сохранение товара падало с 500 («неподдерживаемый оператор id»),
 * потому что GET отдаёт category/optionGroupIds через .populate() ОБЪЕКТАМИ
 * ({ id, name, ... }), а роут слал их в запрос/колонку как есть.
 * toRefId приводит любую форму ссылки к строке-id.
 */
describe('toRefId', () => {
  it('строка-id остаётся как есть', () => {
    expect(toRefId('6977f861516ecc1e5bb2a501')).toBe('6977f861516ecc1e5bb2a501');
  });

  it('populated-объект с _id → _id', () => {
    expect(toRefId({ _id: 'abc123', name: 'Pizza' })).toBe('abc123');
  });

  it('сериализованный объект с id (без _id) → id (это и был баг)', () => {
    expect(toRefId({ id: '6977f861516ecc1e5bb2a501', name: 'Crispy Sides', slug: 'crispy-sides' })).toBe(
      '6977f861516ecc1e5bb2a501'
    );
  });

  it('если есть и _id, и id — приоритет у _id', () => {
    expect(toRefId({ _id: 'real', id: 'other' })).toBe('real');
  });

  it('null / undefined / пустая строка → undefined', () => {
    expect(toRefId(null)).toBeUndefined();
    expect(toRefId(undefined)).toBeUndefined();
    expect(toRefId('')).toBeUndefined();
  });

  it('объект без id/_id → undefined', () => {
    expect(toRefId({ name: 'no id here' })).toBeUndefined();
  });

  it('массив populated-объектов нормализуется в массив id', () => {
    const groups = [{ _id: 'g1' }, { id: 'g2' }, 'g3'];
    expect(groups.map(toRefId).filter(Boolean)).toEqual(['g1', 'g2', 'g3']);
  });
});
