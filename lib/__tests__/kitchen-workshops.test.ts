// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  activeWorkshopBlocks,
  blockedWorkshopsForItems,
  buildWorkshopBadge,
  buildWorkshopBlockMessage,
  classifyStation,
  classifyWorkshop,
  isBlockActive,
  readWorkshopBlocks,
  withGlobalBlock,
  workshopsInItems,
} from '../kitchen/workshops';

/**
 * Цеха кухни: MakiLove = суши, всё остальное готовящееся = пицца+Beilagen,
 * напитки/десерты не принадлежат никому.
 * На этой классификации стоит стоп по цехам (стоп-бот → /api/orders → чекаут).
 */

const now = new Date('2026-08-15T18:00:00.000Z');
const future = new Date('2026-08-15T18:30:00.000Z').toISOString();
const past = new Date('2026-08-15T17:30:00.000Z').toISOString();

describe('classifyWorkshop', () => {
  it('всё MakiLove — суши', () => {
    expect(classifyWorkshop({ category: 'MakiLove Sushi', name: 'Philadelphia' })).toBe('sushi');
    expect(classifyWorkshop({ category: 'MakiLove', subcategory: 'California' })).toBe('sushi');
    expect(classifyWorkshop({ category: 'MakiLove Sushi', name: 'Sushi Burger' })).toBe('sushi');
  });

  it('пицца и прочие Beilagen — цех пиццы', () => {
    expect(classifyWorkshop({ category: 'Pizzen', name: 'Margherita' })).toBe('pizza');
    expect(classifyWorkshop({ category: 'Beilagen', name: 'Pommes' })).toBe('pizza');
    expect(classifyWorkshop({ category: 'Snacks', name: 'Chicken Wings' })).toBe('pizza');
  });

  it('напитки и десерты — ничей цех', () => {
    expect(classifyWorkshop({ category: 'Getränke', name: 'Cola' })).toBeNull();
    expect(classifyWorkshop({ category: 'Dessert', name: 'Tiramisu' })).toBeNull();
  });

  it('станция fryer идёт в цех пиццы (те же руки)', () => {
    expect(classifyStation({ category: 'Beilagen' })).toBe('fryer');
    expect(classifyWorkshop({ category: 'Beilagen' })).toBe('pizza');
  });
});

describe('readWorkshopBlocks', () => {
  it('нет ключа / мусор → пусто', () => {
    expect(readWorkshopBlocks({})).toEqual({ pizza: '', sushi: '' });
    expect(readWorkshopBlocks({ workshopsBlockedUntil: 'oops' })).toEqual({ pizza: '', sushi: '' });
    expect(readWorkshopBlocks(null)).toEqual({ pizza: '', sushi: '' });
  });

  it('читает метки цехов', () => {
    expect(readWorkshopBlocks({ workshopsBlockedUntil: { sushi: future } })).toEqual({
      pizza: '',
      sushi: future,
    });
  });
});

describe('isBlockActive / activeWorkshopBlocks', () => {
  it('истёкшая и битая метка — не блокирует', () => {
    expect(isBlockActive(past, now)).toBe(false);
    expect(isBlockActive('не дата', now)).toBe(false);
    expect(isBlockActive('', now)).toBe(false);
  });

  it('будущая метка — блокирует', () => {
    expect(isBlockActive(future, now)).toBe(true);
    expect(activeWorkshopBlocks({ pizza: past, sushi: future }, now)).toEqual(['sushi']);
  });
});

describe('workshopsInItems / blockedWorkshopsForItems', () => {
  const cart = [
    { category: 'Pizzen', name: 'Margherita' },
    { category: 'MakiLove Sushi', name: 'Philadelphia' },
    { category: 'Getränke', name: 'Cola' },
  ];

  it('какие цеха задействует заказ', () => {
    expect(workshopsInItems(cart)).toEqual(['pizza', 'sushi']);
    expect(workshopsInItems([{ category: 'Getränke', name: 'Cola' }])).toEqual([]);
  });

  it('стоп суши режет заказ с роллами', () => {
    expect(blockedWorkshopsForItems(cart, { pizza: '', sushi: future }, now)).toEqual(['sushi']);
  });

  it('стоп суши НЕ трогает заказ без суши', () => {
    const pizzaOnly = [{ category: 'Pizzen', name: 'Margherita' }];
    expect(blockedWorkshopsForItems(pizzaOnly, { pizza: '', sushi: future }, now)).toEqual([]);
  });

  it('заказ только из напитков проходит при любом стопе цехов', () => {
    const drinks = [{ category: 'Getränke', name: 'Cola' }];
    expect(blockedWorkshopsForItems(drinks, { pizza: future, sushi: future }, now)).toEqual([]);
  });

  it('истёкший стоп больше не режет', () => {
    expect(blockedWorkshopsForItems(cart, { pizza: past, sushi: past }, now)).toEqual([]);
  });

  it('оба цеха на паузе → оба в ответе', () => {
    expect(blockedWorkshopsForItems(cart, { pizza: future, sushi: future }, now)).toEqual([
      'pizza',
      'sushi',
    ]);
  });
});

describe('buildWorkshopBlockMessage', () => {
  const blocks = { pizza: '', sushi: future };

  it('называет гостю цех, минуты до конца стопа и что заказать вместо', () => {
    const text = buildWorkshopBlockMessage(['sushi'], { blocks, now });
    expect(text).toContain('derzeit sind keine Bestellungen möglich');
    expect(text).toContain('MakiLove');
    expect(text).toContain('30 Minuten');
    expect(text).toContain('Bestellen Sie solange Pizza, Beilagen und Getränke.');
    // «geschlossen» звучит как «закрыто совсем» — формулировка временная.
    expect(text).not.toContain('geschlossen');
  });

  it('стоит пицца → предлагаем суши, стоят оба → напитки', () => {
    expect(buildWorkshopBlockMessage(['pizza'], { blocks: { pizza: future, sushi: '' }, now })).toContain(
      'Sushi von MakiLove'
    );
    expect(
      buildWorkshopBlockMessage(['pizza', 'sushi'], { blocks: { pizza: future, sushi: future }, now })
    ).toContain('Getränke und Desserts');
  });

  it('минуты считаем по самому долгому из задетых стопов', () => {
    const longer = new Date('2026-08-15T19:00:00.000Z').toISOString();
    const text = buildWorkshopBlockMessage(['pizza', 'sushi'], {
      blocks: { pizza: longer, sushi: future },
      now,
    });
    expect(text).toContain('Pizza & Beilagen + MakiLove');
    expect(text).toContain('60 Minuten');
  });

  it('шаблон из админки: {minutes}, @, {workshop}, {time}; подсказка дописывается', () => {
    const text = buildWorkshopBlockMessage(['sushi'], {
      blocks,
      now,
      template: 'Zu viele Bestellungen für {workshop} – in @ Minuten (ab {time}) wieder möglich.',
    });
    expect(text).toBe(
      'Zu viele Bestellungen für MakiLove (Sushi) – in 30 Minuten (ab 20:30) wieder möglich. ' +
        'Bestellen Sie solange Pizza, Beilagen und Getränke.'
    );
  });

  it('{alternative} в шаблоне — подставляется на месте, а не в конце', () => {
    const text = buildWorkshopBlockMessage(['sushi'], {
      blocks,
      now,
      template: '{alternative} ({workshop} pausiert noch {minutes} Min.)',
    });
    expect(text).toBe(
      'Bestellen Sie solange Pizza, Beilagen und Getränke. (MakiLove (Sushi) pausiert noch 30 Minuten.)'
    );
  });

  it('пустой шаблон в настройках → дефолтный текст', () => {
    expect(buildWorkshopBlockMessage(['sushi'], { blocks, now, template: '   ' })).toContain(
      'In ca. 30 Minuten nehmen wir sie wieder an'
    );
  });

  it('срок неизвестен → без «через 0 минут», но с подсказкой', () => {
    const text = buildWorkshopBlockMessage(['sushi'], { now });
    expect(text).toContain('MakiLove');
    expect(text).not.toContain('0 Minuten');
    expect(text).toContain('Bestellen Sie solange');
  });
});

describe('withGlobalBlock', () => {
  const later = new Date('2026-08-15T18:45:00.000Z').toISOString();

  it('глобальный стоп позже цехового → берём его срок', () => {
    // «весь приём до 18:45, суши до 18:30» — суши раньше 18:45 не поедут.
    expect(withGlobalBlock({ pizza: '', sushi: future }, later)).toEqual({
      pizza: later,
      sushi: later,
    });
  });

  it('цех стоит дольше глобального → остаётся срок цеха', () => {
    // Ровно жалоба ресторана: цех 30 мин, весь приём 10 — обещать 10 нельзя.
    const globalSoon = new Date('2026-08-15T18:10:00.000Z').toISOString();
    expect(withGlobalBlock({ pizza: '', sushi: future }, globalSoon).sushi).toBe(future);
  });

  it('глобального стопа нет → сроки цехов не меняются', () => {
    expect(withGlobalBlock({ pizza: '', sushi: future }, '')).toEqual({ pizza: '', sushi: future });
  });

  it('сообщение с объединённым сроком считает минуты по позднему', () => {
    const merged = withGlobalBlock({ pizza: '', sushi: future }, later);
    expect(buildWorkshopBlockMessage(['sushi'], { blocks: merged, now })).toContain('45 Minuten');
  });
});

describe('buildWorkshopBadge', () => {
  it('плашка на карточке: цех и остаток минут', () => {
    expect(buildWorkshopBadge(['sushi'], { pizza: '', sushi: future }, now)).toBe(
      'MakiLove (Sushi) · noch 30 Min'
    );
  });

  it('без известного срока — только название цеха', () => {
    expect(buildWorkshopBadge(['pizza'], { pizza: past, sushi: '' }, now)).toBe('Pizza & Beilagen');
  });
});
