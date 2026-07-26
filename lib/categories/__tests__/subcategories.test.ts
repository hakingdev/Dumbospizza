import { describe, it, expect } from 'vitest';
import {
  sanitizeSubcategories,
  readSubcategories,
  resolveSubcategoryId,
  matchCategory,
  groupBySubcategory,
  countBySubcategory,
} from '../subcategories';

describe('sanitizeSubcategories', () => {
  it('проставляет id новым строкам и нумерует порядок по позиции', () => {
    const result = sanitizeSubcategories([
      { id: '', name: ' Rund ', order: 5 },
      { name: 'Eckig' },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Rund');
    expect(result[0].id).toMatch(/^[a-f0-9]{24}$/);
    expect(result.map((s) => s.order)).toEqual([0, 1]);
  });

  it('сохраняет существующий id — переименование не отвязывает товары', () => {
    const [row] = sanitizeSubcategories([{ id: 'abc123', name: 'Philadelphia XL' }]);
    expect(row.id).toBe('abc123');
  });

  it('отбрасывает пустые имена и разводит дубли id', () => {
    const result = sanitizeSubcategories([
      { id: 'dup', name: 'California' },
      { id: 'dup', name: 'Sushi Burger' },
      { id: 'x', name: '   ' },
      null,
    ]);

    expect(result.map((s) => s.name)).toEqual(['California', 'Sushi Burger']);
    expect(result[0].id).not.toBe(result[1].id);
  });

  it('терпит не-массив', () => {
    expect(sanitizeSubcategories(undefined)).toEqual([]);
  });
});

describe('readSubcategories', () => {
  it('сортирует по order и переживает мусор в данных', () => {
    const names = readSubcategories({
      subcategories: [
        { id: 'b', name: 'B', order: 2 },
        { id: 'a', name: 'A', order: 1 },
        { name: 'без id' },
      ],
    }).map((s) => s.name);

    expect(names).toEqual(['A', 'B']);
  });

  it('возвращает пустой список для слага-строки', () => {
    expect(readSubcategories('pizza')).toEqual([]);
  });
});

describe('resolveSubcategoryId', () => {
  const subs = [{ id: 'rund', name: 'Rund', order: 0 }];

  it('оставляет метку своей категории', () => {
    expect(resolveSubcategoryId(subs, 'rund')).toBe('rund');
  });

  it('снимает чужую метку — она не переезжает при смене категории', () => {
    expect(resolveSubcategoryId(subs, 'philadelphia')).toBeNull();
    expect(resolveSubcategoryId(subs, '')).toBeNull();
    expect(resolveSubcategoryId(subs, undefined)).toBeNull();
  });
});

describe('matchCategory', () => {
  const categories = [{ _id: 'id1', slug: 'pizza', name: 'Pizza' }];

  it('находит по id, слагу и populate-объекту', () => {
    expect(matchCategory(categories, 'id1')?.slug).toBe('pizza');
    expect(matchCategory(categories, 'pizza')?.slug).toBe('pizza');
    expect(matchCategory(categories, { _id: 'id1', name: 'Pizza' })?.slug).toBe('pizza');
  });

  it('возвращает undefined, когда категории нет', () => {
    expect(matchCategory(categories, 'sushi')).toBeUndefined();
    expect(matchCategory(categories, null)).toBeUndefined();
  });
});

describe('countBySubcategory', () => {
  const subs = [
    { id: 'phil', name: 'Philadelphia', order: 0 },
    { id: 'cali', name: 'California', order: 1 },
  ];
  const get = (p: { sub?: string | null }) => p.sub;

  it('считает по меткам, товары без метки — под ключом пустой строки', () => {
    const counts = countBySubcategory(
      [{ sub: 'phil' }, { sub: 'phil' }, { sub: null }, { sub: 'weg' }],
      subs,
      get
    );

    expect(counts).toEqual({ phil: 2, '': 2 });
    expect(counts.cali).toBeUndefined();
  });
});

describe('groupBySubcategory', () => {
  const subs = [
    { id: 'phil', name: 'Philadelphia', order: 0 },
    { id: 'cali', name: 'California', order: 1 },
  ];
  const get = (p: { sub?: string | null }) => p.sub;

  it('идёт в порядке ресторана, товары без метки первыми и без заголовка', () => {
    const groups = groupBySubcategory(
      [{ sub: 'cali' }, { sub: null }, { sub: 'phil' }],
      subs,
      get
    );

    expect(groups.map((g) => g.name)).toEqual(['', 'Philadelphia', 'California']);
    expect(groups[0].id).toBeNull();
  });

  it('пустые подкатегории не выводятся', () => {
    const groups = groupBySubcategory([{ sub: 'phil' }], subs, get);
    expect(groups.map((g) => g.name)).toEqual(['Philadelphia']);
  });

  it('метка удалённой подкатегории не теряет товар', () => {
    const groups = groupBySubcategory([{ sub: 'weg' }], subs, get);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBeNull();
    expect(groups[0].products).toHaveLength(1);
  });

  it('без подкатегорий отдаёт один блок, а на пустом списке — ничего', () => {
    expect(groupBySubcategory([{ sub: null }], [], get)).toHaveLength(1);
    expect(groupBySubcategory([], [], get)).toEqual([]);
  });
});
