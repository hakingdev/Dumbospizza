import { describe, it, expect } from 'vitest';
import {
  encodeDos,
  displayWidth,
  wrapWords,
  layoutColumns,
  renderOpsToEscPos,
  PROFILE_SUNMI_V2S,
  PROFILE_EPSON_80MM,
} from '../escpos';
import { buildKitchenReceiptOps, type ReceiptOrder } from '../kitchen-receipt';

/**
 * Достаёт из потока только печатаемые строки, пропуская ESC/POS-команды вместе
 * с их аргументами. Наивная фильтрация по «управляющим символам» здесь не
 * годится: у `ESC a 1` управляющий только сам ESC, а байты `a` и `1` остались бы
 * в тексте и раздули длину строки.
 */
function printableLines(bytes: Uint8Array): string[] {
  const ARG_COUNT: Record<string, number> = {
    '1b40': 0, // ESC @  сброс
    '1b61': 1, // ESC a  выравнивание
    '1b45': 1, // ESC E  жирный
    '1b2d': 1, // ESC -  подчёркивание
    '1b4d': 1, // ESC M  шрифт
    '1b64': 1, // ESC d  протяжка
    '1b74': 1, // ESC t  кодовая страница
    '1d21': 1, // GS !   размер
    '1d42': 1, // GS B   инверсия
    '1d56': 2, // GS V   отрез
  };

  const lines: string[] = [];
  let current = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x1b || b === 0x1d) {
      const key = b.toString(16).padStart(2, '0') + bytes[i + 1].toString(16).padStart(2, '0');
      const args = ARG_COUNT[key];
      if (args === undefined) throw new Error(`неизвестная команда 0x${key}`);
      i += 2 + args;
      continue;
    }
    if (b === 0x0a) {
      lines.push(current);
      current = '';
      i++;
      continue;
    }
    current += String.fromCharCode(b);
    i++;
  }
  if (current) lines.push(current);
  return lines;
}

/** Ищет подпоследовательность байт — для проверки, что команда отправлена. */
function contains(haystack: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe('encodeDos', () => {
  it('немецкие умляуты идут байтами DOS-страницы, а не latin1', () => {
    // Ключевой момент: latin1 дал бы ä=0xE4, и на бумаге вышел бы не тот знак.
    expect(encodeDos('ä')).toEqual([0x84]);
    expect(encodeDos('ö')).toEqual([0x94]);
    expect(encodeDos('ü')).toEqual([0x81]);
    expect(encodeDos('ß')).toEqual([0xe1]);
    expect(encodeDos('Ä Ö Ü')).toEqual([0x8e, 0x20, 0x99, 0x20, 0x9a]);
  });

  it('евро разворачивается в EUR — знака нет на странице по умолчанию', () => {
    expect(encodeDos('€')).toEqual([0x45, 0x55, 0x52]);
  });

  it('типографика из комментариев клиента не превращается в мусор', () => {
    expect(encodeDos('—')).toEqual([0x2d]);
    expect(encodeDos('„тест“')).toEqual([0x22, 0x3f, 0x3f, 0x3f, 0x3f, 0x22]);
  });

  it('неизвестный символ становится вопросительным знаком, а не рвёт поток', () => {
    expect(encodeDos('日')).toEqual([0x3f]);
  });
});

describe('displayWidth', () => {
  it('умляут занимает одну колонку, евро — три', () => {
    expect(displayWidth('ä')).toBe(1);
    expect(displayWidth('€')).toBe(3);
    expect(displayWidth('12,90 €')).toBe(9);
  });
});

describe('wrapWords', () => {
  it('переносит по словам, не разрывая их', () => {
    expect(wrapWords('Pizza Margherita gross', 12)).toEqual(['Pizza', 'Margherita', 'gross']);
  });

  it('слово длиннее строки режется жёстко, иначе уехало бы за край', () => {
    expect(wrapWords('AAAAAAAAAAAAAAA', 5)).toEqual(['AAAAA', 'AAAAA', 'AAAAA']);
  });

  it('пустой текст даёт одну пустую строку, а не ноль строк', () => {
    expect(wrapWords('', 10)).toEqual(['']);
  });
});

describe('layoutColumns', () => {
  it('цена прижата вправо, между колонками всегда есть пробел', () => {
    const [line] = layoutColumns('1x Margherita', 'EUR 7,90', 32);
    expect(line).toHaveLength(32);
    expect(line.endsWith('EUR 7,90')).toBe(true);
    expect(line.startsWith('1x Margherita')).toBe(true);
  });

  it('длинное название переносится, цена остаётся на первой строке', () => {
    const lines = layoutColumns('1x Pizza mit sehr langem Namen und Extras', 'EUR 12,90', 32);
    expect(lines[0].endsWith('EUR 12,90')).toBe(true);
    expect(lines.length).toBeGreaterThan(1);
    // Продолжение с отступом — чтобы не читалось как отдельная позиция.
    expect(lines[1].startsWith('   ')).toBe(true);
  });

  it('название и цена не слипаются даже при переполнении', () => {
    const [line] = layoutColumns('1x AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'EUR 9,90', 32);
    expect(line).toMatch(/ EUR 9,90$/);
  });
});

describe('renderOpsToEscPos — профиль Sunmi V2s', () => {
  const ops = buildKitchenReceiptOps({
    orderId: '1001',
    deliveryType: 'delivery',
    customerName: 'Müller',
    totalAmount: 12.9,
    items: [{ name: 'Margherita', quantity: 1, price: 7.9, category: 'Pizza' }],
  } as ReceiptOrder);

  const bytes = renderOpsToEscPos(ops, PROFILE_SUNMI_V2S);

  it('начинается со сброса ESC @', () => {
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
  });

  it('НЕ содержит ESC t — эта команда глушит печать на POS-V2s', () => {
    expect(contains(bytes, [0x1b, 0x74])).toBe(false);
  });

  it('НЕ содержит команду отреза — ножа у прибора нет', () => {
    expect(contains(bytes, [0x1d, 0x56])).toBe(false);
  });

  it('заканчивается протяжкой ESC d вместо отреза', () => {
    expect(contains(bytes, [0x1b, 0x64])).toBe(true);
  });

  it('крупный текст идёт двойной высотой, а не двойной шириной', () => {
    expect(contains(bytes, [0x1d, 0x21, 0x01])).toBe(true); // только высота
    expect(contains(bytes, [0x1d, 0x21, 0x11])).toBe(false); // ширина запрещена
  });

  it('допы сохраняют отступ — иначе читаются как отдельные позиции', () => {
    const withAddons = renderOpsToEscPos(
      buildKitchenReceiptOps({
        orderId: '1004',
        deliveryType: 'pickup',
        totalAmount: 7.9,
        items: [
          {
            name: 'Margherita',
            quantity: 1,
            price: 7.9,
            category: 'Pizza',
            customizations: ['Sauce: Aioli', 'Topping: sehr viel Rucola und Peperoni dazu'],
          },
        ],
      } as ReceiptOrder),
      PROFILE_SUNMI_V2S
    );
    const lines = printableLines(withAddons);
    const addon = lines.find((l) => l.includes('Sauce: Aioli'));
    expect(addon?.startsWith('   ')).toBe(true);
    // Отступ держится и на перенесённых строках длинного допа.
    const wrapped = lines.filter((l) => l.includes('Rucola') || l.includes('Peperoni'));
    expect(wrapped.length).toBeGreaterThan(0);
    for (const l of wrapped) expect(l.startsWith('   ')).toBe(true);
  });

  it('ни одна печатаемая строка не длиннее 32 колонок', () => {
    for (const line of printableLines(bytes)) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
  });

  it('длинное название переносится, а не уезжает за край', () => {
    const long = renderOpsToEscPos(
      buildKitchenReceiptOps({
        orderId: '1003',
        deliveryType: 'delivery',
        totalAmount: 9.9,
        items: [
          {
            name: 'Pizza Quattro Stagioni mit Extra Kaese und Peperoni',
            quantity: 1,
            price: 9.9,
            category: 'Pizza',
          },
        ],
      } as ReceiptOrder),
      PROFILE_SUNMI_V2S
    );
    const lines = printableLines(long);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(32);
    // Название действительно разбилось на несколько строк, а не обрезалось.
    expect(lines.some((l) => l.includes('Quattro'))).toBe(true);
    expect(lines.some((l) => l.includes('Peperoni'))).toBe(true);
  });
});

describe('renderOpsToEscPos — профиль Epson 80 мм', () => {
  const ops = buildKitchenReceiptOps({
    orderId: '1002',
    deliveryType: 'pickup',
    totalAmount: 20,
    items: [{ name: 'Calzone', quantity: 2, price: 10, category: 'Pizza' }],
  } as ReceiptOrder);

  const bytes = renderOpsToEscPos(ops, PROFILE_EPSON_80MM);

  it('кодовая страница выбирается — стационарный принтер её понимает', () => {
    expect(contains(bytes, [0x1b, 0x74, 19])).toBe(true);
  });

  it('отрез отправляется — нож есть', () => {
    expect(contains(bytes, [0x1d, 0x56])).toBe(true);
  });

  it('двойная ширина разрешена', () => {
    expect(contains(bytes, [0x1d, 0x21, 0x11])).toBe(true);
  });
});
