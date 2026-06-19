import { describe, it, expect, vi } from 'vitest';
import {
  collectParticipatingProductIds,
  loadParticipatingProducts,
} from '../angebote-page-data';

/**
 * Страница акции грузилась долго: дубль-запрос промо + риск N+1 по товарам.
 * Тесты фиксируют: id товаров дедуплицируются, а запросов к БД — не больше 2
 * (по id и по категориям), без N+1.
 */

// промо с 16 товарами × 4 размера в target и reward (как реальная «Halben Preis»)
const makePromo = (over: Record<string, unknown> = {}) => {
  const productIds = Array.from({ length: 16 }, (_, i) => `prod${i}`);
  const sizes = ['20x20', '40x30', '40x40', '60x40'];
  const items = productIds.flatMap((productId) => sizes.map((sizeName) => ({ productId, sizeName })));
  return {
    targetItems: items, // 64
    rewardItems: items, // 64
    targetProductIds: [],
    targetCategoryIds: [],
    ...over,
  } as any;
};

describe('collectParticipatingProductIds', () => {
  it('дедуплицирует 128 записей target+reward в 16 уникальных id', () => {
    const ids = collectParticipatingProductIds(makePromo());
    expect(ids).toHaveLength(16);
    expect(new Set(ids).size).toBe(16);
  });

  it('включает легаси targetProductIds и тоже дедуплицирует', () => {
    const ids = collectParticipatingProductIds(
      makePromo({ targetProductIds: ['prod0', 'legacyX'] })
    );
    expect(ids).toContain('legacyX');
    expect(ids.filter((x) => x === 'prod0')).toHaveLength(1); // без дублей
    expect(ids).toHaveLength(17);
  });
});

describe('loadParticipatingProducts — число запросов', () => {
  const rows = (ids: string[]) =>
    ids.map((id, i) => ({ _id: id, name: `Pizza ${String.fromCharCode(90 - i)}`, basePrice: 9 + i }));

  it('товары только по id → РОВНО один запрос (нет N+1)', async () => {
    const find = vi.fn(async (q: any) => rows(q._id.$in));
    const out = await loadParticipatingProducts(makePromo(), find);
    expect(find).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(16);
    // отсортировано по имени (de)
    expect(out[0].name.localeCompare(out[1].name, 'de')).toBeLessThanOrEqual(0);
  });

  it('с категориями → не более 2 запросов, без дублей товаров', async () => {
    const find = vi.fn(async (q: any) => {
      if (q._id) return rows(q._id.$in); // prod0..prod15
      if (q.category) return [{ _id: 'prod0', name: 'Dup', basePrice: 5 }, { _id: 'catX', name: 'Cola', basePrice: 2 }];
      return [];
    });
    const out = await loadParticipatingProducts(makePromo({ targetCategoryIds: ['cat1'] }), find);
    expect(find).toHaveBeenCalledTimes(2);
    // prod0 пришёл из обоих запросов, но в результате один раз; catX добавлен
    expect(out.filter((p) => p.id === 'prod0')).toHaveLength(1);
    expect(out.some((p) => p.id === 'catX')).toBe(true);
    expect(out).toHaveLength(17);
  });

  it('пустое таргетирование → запросов нет', async () => {
    const find = vi.fn(async () => []);
    const out = await loadParticipatingProducts(
      { targetItems: [], rewardItems: [], targetProductIds: [], targetCategoryIds: [] } as any,
      find
    );
    expect(find).not.toHaveBeenCalled();
    expect(out).toHaveLength(0);
  });
});
