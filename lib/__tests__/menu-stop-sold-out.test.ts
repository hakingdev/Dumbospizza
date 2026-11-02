import { describe, expect, it } from 'vitest';
import {
  EMPTY_SOLD_OUT,
  isProductSoldOut,
  isSizeInactive,
  lineProductId,
  linesFromOrderRejection,
  soldOutCartMessage,
  soldOutLineTitle,
  soldOutLinesIn,
  soldOutReasonFor,
  type SoldOutSnapshot,
} from '../menu-stop/sold-out';
import { normalizedSizeName } from '../size-variation-state';

/**
 * Страховка корзины от стоп-листа (стоп-бот «🍕 Размеры» / «📋 Позиции»,
 * админка, POS): строки с выключенным товаром или размером помечаются ДО
 * оформления, а отказ сервера разбирается на конкретные строки.
 */

const hawaiian30 = {
  id: 'p-hawaiian',
  productId: 'p-hawaiian',
  name: 'Hawaiian',
  size: { id: 's30', name: '30 cm', label: 'Ø 30 cm' },
};
const hawaiian36 = {
  id: 'p-hawaiian#2',
  productId: 'p-hawaiian',
  name: 'Hawaiian',
  size: { id: 's36', name: '36 cm', label: 'Ø 36 cm' },
};
const detroit = {
  id: 'p-detroit',
  productId: 'p-detroit',
  name: 'Detroit Classic',
  // В корзине лежит СТАРОЕ написание — библиотека с тех пор переименовала размер.
  size: { id: 'sd', name: 'ca. 40x30', label: 'ca.30x40 ≈ Ø 36 cm' },
};
const cola = { id: 'p-cola', productId: 'p-cola', name: 'Cola 0,5 l' };
const legacyLine = { id: 'p-legacy', name: 'Salat ohne productId' };

// Ключи — как их отдаёт /api/kitchen/blocks: normalizedSizeName(name) библиотеки.
const snapshot: SoldOutSnapshot = {
  soldOutProductIds: ['p-cola', 'p-legacy'],
  inactiveSizeKeys: [normalizedSizeName('36 cm'), normalizedSizeName('ca. 30x40')],
};

describe('lineProductId', () => {
  it('берёт productId, а без него id строки без суффикса дубля «#n»', () => {
    expect(lineProductId(hawaiian36)).toBe('p-hawaiian');
    expect(lineProductId({ id: 'p-x#3' })).toBe('p-x');
    expect(lineProductId({ id: 'p-x' })).toBe('p-x');
  });
});

describe('isProductSoldOut / isSizeInactive', () => {
  it('товар — по id; пустой id не совпадает ни с чем', () => {
    expect(isProductSoldOut(snapshot, 'p-cola')).toBe(true);
    expect(isProductSoldOut(snapshot, 'p-hawaiian')).toBe(false);
    expect(isProductSoldOut(snapshot, '')).toBe(false);
    expect(isProductSoldOut(EMPTY_SOLD_OUT, 'p-cola')).toBe(false);
  });

  it('размер сравнивается через normalizedSizeName: регистр, пробелы, ×, порядок сторон', () => {
    expect(isSizeInactive(snapshot, '36 cm')).toBe(true);
    expect(isSizeInactive(snapshot, '36cm')).toBe(true);
    expect(isSizeInactive(snapshot, '36 CM')).toBe(true);
    expect(isSizeInactive(snapshot, 'ca. 30x40')).toBe(true);
    expect(isSizeInactive(snapshot, 'ca. 40x30')).toBe(true);
    expect(isSizeInactive(snapshot, 'ca. 30×40')).toBe(true);
    expect(isSizeInactive(snapshot, '30 cm')).toBe(false);
    expect(isSizeInactive(snapshot, '')).toBe(false);
  });

  it('ключи снимка тоже нормализуются (сырое имя вместо ключа не ломает сравнение)', () => {
    expect(isSizeInactive({ soldOutProductIds: [], inactiveSizeKeys: ['36 CM'] }, '36 cm')).toBe(true);
  });
});

describe('soldOutReasonFor / soldOutLinesIn', () => {
  it('товар сильнее размера; строки без размера не судятся по размеру', () => {
    expect(soldOutReasonFor(snapshot, cola)).toBe('product');
    expect(soldOutReasonFor(snapshot, legacyLine)).toBe('product');
    expect(soldOutReasonFor(snapshot, hawaiian36)).toBe('size');
    expect(soldOutReasonFor(snapshot, detroit)).toBe('size');
    expect(soldOutReasonFor(snapshot, hawaiian30)).toBeNull();
    expect(
      soldOutReasonFor({ soldOutProductIds: ['p-hawaiian'], inactiveSizeKeys: snapshot.inactiveSizeKeys }, hawaiian36)
    ).toBe('product');
  });

  it('возвращает только проблемные строки в порядке корзины', () => {
    const lines = soldOutLinesIn(snapshot, [hawaiian30, hawaiian36, detroit, cola]);
    expect(lines.map((l) => [l.item.id, l.reason])).toEqual([
      ['p-hawaiian#2', 'size'],
      ['p-detroit', 'size'],
      ['p-cola', 'product'],
    ]);
    expect(soldOutLinesIn(EMPTY_SOLD_OUT, [hawaiian30, hawaiian36, detroit, cola])).toEqual([]);
    expect(soldOutLinesIn(snapshot, [])).toEqual([]);
  });

  it('сырой === по имени размера пропустил бы переименованный размер (регресс)', () => {
    // Ровно то, от чего защищает правило: «ca. 40x30» в корзине, «ca. 30x40» в библиотеке.
    expect(snapshot.inactiveSizeKeys.includes(detroit.size.name)).toBe(false);
    expect(soldOutReasonFor(snapshot, detroit)).toBe('size');
  });
});

describe('тексты', () => {
  it('заголовок строки — имя и размер', () => {
    expect(soldOutLineTitle(hawaiian36)).toBe('Hawaiian · 36 cm');
    expect(soldOutLineTitle(cola)).toBe('Cola 0,5 l');
  });

  it('сообщение блокировки склоняется по числу и причине', () => {
    expect(soldOutCartMessage([])).toBe('');
    expect(soldOutCartMessage([{ item: cola, reason: 'product' }])).toBe(
      '„Cola 0,5 l“ ist heute nicht mehr verfügbar. Bitte entfernen Sie den Artikel aus dem Warenkorb, um fortzufahren.'
    );
    expect(soldOutCartMessage([{ item: hawaiian36, reason: 'size' }])).toBe(
      '„Hawaiian · 36 cm“ ist in dieser Größe heute nicht verfügbar. Bitte entfernen Sie den Artikel aus dem Warenkorb, um fortzufahren.'
    );
    expect(
      soldOutCartMessage([
        { item: hawaiian36, reason: 'size' },
        { item: cola, reason: 'product' },
      ])
    ).toBe(
      '„Hawaiian · 36 cm“, „Cola 0,5 l“ sind heute nicht mehr verfügbar. Bitte entfernen Sie diese Artikel aus dem Warenkorb, um fortzufahren.'
    );
  });
});

describe('linesFromOrderRejection', () => {
  const cart = [hawaiian30, hawaiian36, detroit, cola];

  it('403 с unavailableProductIds помечает ВСЕ строки этих товаров', () => {
    const lines = linesFromOrderRejection(cart, 403, {
      success: false,
      error: '„Hawaiian“ ist leider nicht mehr verfügbar. Bitte entfernen Sie den Artikel aus dem Warenkorb.',
      unavailableProductIds: ['p-hawaiian'],
    });
    expect(lines.map((l) => [l.item.id, l.reason])).toEqual([
      ['p-hawaiian', 'product'],
      ['p-hawaiian#2', 'product'],
    ]);
  });

  it('400 про размер помечает строки с этим размером (через normalizedSizeName)', () => {
    const lines = linesFromOrderRejection(cart, 400, {
      success: false,
      error: 'Die Größe „36cm“ ist nicht mehr verfügbar. Bitte aktualisieren Sie den Warenkorb.',
    });
    expect(lines.map((l) => [l.item.id, l.reason])).toEqual([['p-hawaiian#2', 'size']]);

    const renamed = linesFromOrderRejection(cart, 400, {
      success: false,
      error: 'Die Größe „ca. 30x40“ ist nicht mehr verfügbar. Bitte aktualisieren Sie den Warenkorb.',
    });
    expect(renamed.map((l) => l.item.id)).toEqual(['p-detroit']);
  });

  it('400 «erneut eine verfügbare Größe» помечает строку товара без размера', () => {
    const noSize = { id: 'p-pizza', productId: 'p-pizza', name: 'Margherita' };
    const lines = linesFromOrderRejection([noSize, hawaiian30], 400, {
      success: false,
      error: 'Bitte wählen Sie für „Margherita“ erneut eine verfügbare Größe.',
    });
    expect(lines.map((l) => [l.item.id, l.reason])).toEqual([['p-pizza', 'size']]);
  });

  it('другие отказы — общая ошибка, строк нет', () => {
    expect(linesFromOrderRejection(cart, 403, { success: false, error: 'Wir öffnen um 11:00' })).toEqual([]);
    expect(linesFromOrderRejection(cart, 400, { success: false, error: 'Ungültige Telefonnummer' })).toEqual([]);
    expect(linesFromOrderRejection(cart, 500, null)).toEqual([]);
    expect(linesFromOrderRejection(cart, 403, { unavailableProductIds: 'p-cola' })).toEqual([]);
    expect(linesFromOrderRejection(cart, 403, { unavailableProductIds: ['p-unknown'] })).toEqual([]);
  });
});
