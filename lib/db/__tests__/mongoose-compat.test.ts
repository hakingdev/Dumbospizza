import { describe, it, expect } from 'vitest';
import { toColumnValues } from '../mongoose-compat';

/**
 * Регрессия: сохранение карточки товара падало с 500
 * («value.toISOString is not a function»), потому что форма слала createdAt/updatedAt
 * ISO-строкой, а Drizzle timestamp(mode:'date') ждёт объект Date.
 * toColumnValues теперь приводит строки/числа к Date для date-колонок.
 */

// Фейковая модель в духе Drizzle: dataType:'date' = timestamp(mode:'date').
const model = {
  colKeys: ['name', 'basePrice', 'available', 'createdAt', 'updatedAt'],
  columns: {
    name: { dataType: 'string' },
    basePrice: { dataType: 'number' },
    available: { dataType: 'boolean' },
    createdAt: { dataType: 'date' },
    updatedAt: { dataType: 'date' },
  },
} as any;

describe('toColumnValues — приведение дат (фикс 500 при сохранении товара)', () => {
  it('ISO-строка для date-колонки → объект Date', () => {
    const iso = '2026-01-26T23:19:36.675Z';
    const out = toColumnValues(model, { name: 'Pizza', createdAt: iso, updatedAt: iso });
    expect(out.createdAt).toBeInstanceOf(Date);
    expect((out.createdAt as Date).toISOString()).toBe(iso);
    expect(out.updatedAt).toBeInstanceOf(Date);
  });

  it('число (timestamp) → Date', () => {
    const t = 1781900000000;
    const out = toColumnValues(model, { createdAt: t });
    expect(out.createdAt).toBeInstanceOf(Date);
    expect((out.createdAt as Date).getTime()).toBe(t);
  });

  it('Date остаётся Date (без двойного преобразования ошибок)', () => {
    const d = new Date('2026-02-01T10:00:00.000Z');
    const out = toColumnValues(model, { createdAt: d });
    expect(out.createdAt).toBe(d);
  });

  it('невалидная дата-строка пропускается (колонка не ставится)', () => {
    const out = toColumnValues(model, { createdAt: 'не дата' });
    expect('createdAt' in out).toBe(false);
  });

  it('не-date колонки не трогаются; неизвестные ключи отбрасываются; undefined пропускается', () => {
    const out = toColumnValues(model, {
      name: 'Pizza',
      basePrice: 8.9,
      available: true,
      unknownField: 'drop me',
      updatedAt: undefined,
    });
    expect(out).toEqual({ name: 'Pizza', basePrice: 8.9, available: true });
    expect('unknownField' in out).toBe(false);
    expect('updatedAt' in out).toBe(false);
  });
});
