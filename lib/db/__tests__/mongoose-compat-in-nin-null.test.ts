import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { buildWhere, type ModelRef } from '../mongoose-compat';
import { orders } from '../schema';

/**
 * Регрессия: список SMS-получателей (и получателей рассылки) всегда был пуст.
 * Причина не в записи согласия, а в чтении: фильтр `{$nin: [null, '']}`
 * превращался в `col NOT IN (NULL, '')`, а такое сравнение в SQL даёт UNKNOWN
 * для КАЖДОЙ строки → выборка пустая при 31 согласии в БД.
 */

const dialect = new PgDialect();
const model: ModelRef = {
  table: orders as any,
  columns: getTableColumns(orders) as any,
  colKeys: Object.keys(getTableColumns(orders)),
  config: {},
};

const toSql = (query: Record<string, unknown>) => {
  const where = buildWhere(model, query);
  return where ? dialect.sqlToQuery(where).sql : '';
};

describe('buildWhere — $in/$nin со значением null', () => {
  it('$nin: [null, ""] → NOT IN без NULL + IS NOT NULL (а не «NOT IN (NULL, ...)»)', () => {
    const sql = toSql({ smsMarketingConsent: true, phoneNumber: { $nin: [null, ''] } });
    expect(sql).toContain('is not null');
    // NULL не должен попасть в список сравнения — иначе условие всегда UNKNOWN.
    expect(sql).not.toMatch(/not in \([^)]*null/i);
  });

  it('$nin без null пропускает строки с NULL (семантика Mongo)', () => {
    expect(toSql({ status: { $nin: ['cancelled'] } })).toContain('is null');
  });

  it('$in: [null, x] → col in (x) OR col IS NULL', () => {
    const sql = toSql({ email: { $in: [null, 'a@b.de'] } });
    expect(sql).toContain('is null');
    expect(sql).toMatch(/in \(\$\d+\)/);
  });

  it('$in: [] не матчит ничего; $nin: [] матчит всё', () => {
    expect(toSql({ status: { $in: [] } })).toContain('false');
    expect(toSql({ status: { $nin: [] } })).toContain('true');
  });

  it('обычный $in без null остаётся простым IN', () => {
    const sql = toSql({ status: { $in: ['new', 'preparing'] } });
    expect(sql).toMatch(/in \(\$1, \$2\)/);
    expect(sql).not.toContain('is null');
  });
});
