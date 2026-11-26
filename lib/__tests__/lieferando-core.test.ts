// @vitest-environment node
import { describe, it, expect } from 'vitest';
// Чистые матчеры агента Lieferando (scripts/lieferando/core.mjs): Playwright
// там импортируется лениво, поэтому модуль грузится без браузера.
import { sizeKey, itemKey } from '../../scripts/lieferando/core.mjs';

/**
 * Как агент сопоставляет цели стоп-бота с Partner Hub:
 *   размер — по числам подписи (сайт «ca. 27x37» ↔ Hub «Ca. 27×37 cm (entspricht ca. Ø 36 cm Pizza)»);
 *   позиция — по нормализованному имени (сайт «Hawaiian» ↔ Hub «Hawaiian Pizza (rund)»).
 * Подписи Hub сняты с живой страницы 02.11.2026.
 */

describe('sizeKey', () => {
  it('размеры сайта ↔ подписи вариантов Hub', () => {
    expect(sizeKey('30 cm')).toBe('30');
    expect(sizeKey('30 cm')).toBe(sizeKey(' 30cm '));
    expect(sizeKey('ca. 27x37')).toBe('27x37');
    expect(sizeKey('Ca. 27×37 cm (entspricht ca. Ø 36 cm Pizza)')).toBe('27x37');
    expect(sizeKey('ca. 28x18')).toBe(sizeKey('Ca. 28×18 cm (entspricht ca. Ø 26 cm Pizza)'));
    expect(sizeKey('6 Stk')).toBe(sizeKey('6stk'));
    expect(sizeKey('24 Stk')).toBe('24');
  });

  it('порядок чисел и хвост «≈ Ø …» не мешают, разные размеры не совпадают', () => {
    expect(sizeKey('37x27')).toBe('27x37');
    expect(sizeKey('ca.30x40 ≈ Ø 36 cm')).toBe('30x40');
    expect(sizeKey('30 cm')).not.toBe(sizeKey('36 cm'));
    expect(sizeKey('27x37')).not.toBe(sizeKey('28x18'));
    expect(sizeKey('30 cm')).not.toBe(sizeKey('30x40'));
  });

  it('без чисел — пустой ключ', () => {
    expect(sizeKey('Standard')).toBe('');
    expect(sizeKey('')).toBe('');
    expect(sizeKey(undefined)).toBe('');
  });
});

describe('itemKey', () => {
  it('имя сайта совпадает и с Detroit-, и с «(rund)»-строкой Hub', () => {
    expect(itemKey('Hawaiian')).toBe(itemKey('Hawaiian Pizza'));
    expect(itemKey('Hawaiian')).toBe(itemKey('Hawaiian Pizza (rund)'));
    expect(itemKey('Margherita Pizza')).toBe(itemKey('Margherita Pizza (rund)'));
    expect(itemKey("Katz's Corner")).toBe(itemKey('Katz’s Corner (rund)'));
    expect(itemKey('Hot Dog Pizza')).toBe(itemKey('Hotdog-Pizza'));
    expect(itemKey('White Pizza (Vegetarisch)')).toBe(itemKey('White Pizza (Vegetarisch) (rund)'));
    expect(itemKey("Fisherman's Slice (Tonno)")).toBe(itemKey("Neu: Fisherman's Slice (Tonno) Pizza"));
  });

  it('разные позиции не склеиваются', () => {
    expect(itemKey('Pepperoni Pizza')).not.toBe(itemKey('Hot Honey Pepperoni Pizza'));
    expect(itemKey('Brooklyn Pizza')).not.toBe(itemKey('Brooklyn mussels pizza'));
    expect(itemKey('Margherita')).not.toBe(itemKey('Margherita + Cola'));
    expect(itemKey('Pizzabrot')).not.toBe(itemKey('Brot'));
  });
});

// --- расписание снимков каталога ------------------------------------------------------

import { catalogDue, localDayHour } from '../../scripts/lieferando/core.mjs';

describe('catalogDue — когда агенту снимать каталог Hub', () => {
  const at = (iso: string) => new Date(iso);
  // 12.11.2026 — зима, Берлин = UTC+1
  const base = { hourFrom: 9, everyMin: 60, timeZone: 'Europe/Berlin' };

  it('localDayHour считает день и час в зоне ресторана', () => {
    expect(localDayHour(at('2026-11-12T23:30:00.000Z'), 'Europe/Berlin')).toEqual({ day: '2026-11-13', hour: 0 });
  });

  it('до 09:00 — рано, даже если сегодня ещё не снимали', () => {
    expect(catalogDue({ ...base, now: at('2026-11-12T07:59:00.000Z'), lastDay: '2026-11-11', lastAt: 0 })).toBeNull();
  });

  it('09:00 и сегодня не снимали → daily', () => {
    expect(catalogDue({ ...base, now: at('2026-11-12T08:00:10.000Z'), lastDay: '2026-11-11', lastAt: 0 })).toBe('daily');
  });

  it('в течение дня: через час после последнего снимка → refresh, раньше — нет', () => {
    const lastAt = at('2026-11-12T08:00:30.000Z').getTime();
    const day = '2026-11-12';
    expect(catalogDue({ ...base, now: at('2026-11-12T08:40:00.000Z'), lastDay: day, lastAt })).toBeNull();
    expect(catalogDue({ ...base, now: at('2026-11-12T09:00:31.000Z'), lastDay: day, lastAt })).toBe('refresh');
  });

  it('everyMin = 0 — только раз в день; hourFrom = -1 — снимки выключены', () => {
    const lastAt = at('2026-11-12T08:00:30.000Z').getTime();
    expect(catalogDue({ ...base, everyMin: 0, now: at('2026-11-12T15:00:00.000Z'), lastDay: '2026-11-12', lastAt })).toBeNull();
    expect(catalogDue({ ...base, hourFrom: -1, now: at('2026-11-12T15:00:00.000Z'), lastDay: '', lastAt: 0 })).toBeNull();
  });

  it('после полуночи до 09:00 обновлений нет (ночью Hub никто не трогает)', () => {
    const lastAt = at('2026-11-12T21:00:00.000Z').getTime();
    expect(catalogDue({ ...base, now: at('2026-11-13T01:30:00.000Z'), lastDay: '2026-11-12', lastAt })).toBeNull();
  });
});
