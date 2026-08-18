/**
 * Рендер чека в байты ESC/POS.
 *
 * Дополняет kitchen-receipt.ts: тот строит «что напечатать» (ops), этот
 * превращает ops в байты для конкретного принтера. Раскладка остаётся в одном
 * месте, различия железа вынесены в профиль.
 *
 * Зачем это нужно. Сейчас раскладка чека живёт в ТРЁХ копиях: ops в
 * kitchen-receipt.ts, ручная вёрстка в scripts/print-agent.js и ещё одна в
 * lib/printing.ts. Они уже разошлись — печатают разные телефоны заведения.
 * Sunmi добавил бы четвёртую копию, на Kotlin. Вместо этого прибор получает
 * готовые байты и не знает о раскладке ничего.
 *
 * Модуль ЧИСТЫЙ: ни базы, ни сети, ни настроек — только ops + профиль → байты.
 */

import type { ReceiptOp } from './kitchen-receipt';

// ---------------------------------------------------------------------------
// Профиль принтера
// ---------------------------------------------------------------------------

export interface PrinterProfile {
  /** Колонок в строке при обычной ширине символа. */
  width: number;
  /**
   * Можно ли использовать двойную ШИРИНУ. На POS-V2s нельзя: она оставляет
   * 16 колонок, куда не влезает даже название заведения. Крупный текст там
   * делается двойной высотой.
   */
  allowDoubleWidth: boolean;
  /**
   * Можно ли слать ESC t (выбор кодовой страницы). На POS-V2s НЕЛЬЗЯ: команда
   * с любым аргументом прекращает печать до конца задания, при этом
   * sendRAWData рапортует успех, а лента протягивается — обманчивый симптом.
   */
  allowCodepageSelect: boolean;
  /** Есть ли автоотрезчик. У ручных приборов нет — вместо отреза протяжка. */
  hasCutter: boolean;
  /** Сколько строк протянуть в конце, чтобы чек можно было оторвать. */
  feedLinesBeforeTear: number;
  /** Font B (мельче, больше колонок). На POS-V2s не влияет на ширину. */
  fontB: boolean;
}

/**
 * Sunmi V2s (POS-V2s, прошивка 1.35). Все значения ИЗМЕРЕНЫ на приборе,
 * а не взяты из справочника — три из них справочнику противоречат.
 */
export const PROFILE_SUNMI_V2S: PrinterProfile = {
  width: 32, // линейка из цифр: и Font A, и Font B дают ровно 32
  allowDoubleWidth: false, // двойная ширина = 16 колонок, шапка не влезает
  allowCodepageSelect: false, // ESC t глушит печать
  hasCutter: false, // ручной прибор, ножа нет
  feedLinesBeforeTear: 4,
  fontB: false, // ширину не меняет, смысла нет
};

/** Epson TM-m30III по LAN — стационарный, 80 мм, с ножом. */
export const PROFILE_EPSON_80MM: PrinterProfile = {
  width: 48,
  allowDoubleWidth: true,
  allowCodepageSelect: true,
  hasCutter: true,
  feedLinesBeforeTear: 3,
  fontB: true,
};

// ---------------------------------------------------------------------------
// Кодировка
// ---------------------------------------------------------------------------

/**
 * Немецкие символы в DOS-страницах (CP437/850/858 совпадают в этом диапазоне).
 *
 * Node не умеет CP858: Buffer знает только utf8/latin1/ascii, а latin1 дал бы
 * ä=0xE4 вместо нужного 0x84 — на бумаге вышел бы посторонний знак. Поэтому
 * таблица собрана вручную; в приложении на приборе лежит её зеркало.
 *
 * Знака евро здесь намеренно НЕТ: он существует только в CP858 (0xD5), а на
 * странице по умолчанию POS-V2s не печатается вообще. Суммы форматируются
 * как «EUR 12,90» — см. formatEuro() в kitchen-receipt.ts.
 */
const DOS_CHARS: Record<string, number> = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ä: 0x84, à: 0x85, å: 0x86, ç: 0x87,
  ê: 0x88, ë: 0x89, è: 0x8a, ï: 0x8b, î: 0x8c, ì: 0x8d, Ä: 0x8e, Å: 0x8f,
  É: 0x90, æ: 0x91, Æ: 0x92, ô: 0x93, ö: 0x94, ò: 0x95, û: 0x96, ù: 0x97,
  ÿ: 0x98, Ö: 0x99, Ü: 0x9a, ø: 0x9b, '£': 0x9c, Ø: 0x9d,
  á: 0xa0, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, '¿': 0xa8,
  ß: 0xe1, µ: 0xe6, '±': 0xf1, '÷': 0xf6, '°': 0xf8, '·': 0xfa,
};

/**
 * Замены для символов, которых нет ни в одной DOS-странице. Без них текст,
 * скопированный из комментария клиента (умные кавычки, длинное тире, эмодзи),
 * превратился бы в «?» посреди строки.
 */
const TRANSLITERATIONS: Record<string, string> = {
  '€': 'EUR', '„': '"', '“': '"', '”': '"', '‘': "'", '’': "'",
  '—': '-', '–': '-', '…': '...', '«': '"', '»': '"', ' ': ' ',
};

/** Строка → байты DOS-страницы. Неизвестное заменяется на '?'. */
export function encodeDos(text: string): number[] {
  const out: number[] = [];
  for (const ch of String(text ?? '')) {
    const replacement = TRANSLITERATIONS[ch];
    if (replacement !== undefined) {
      for (const r of replacement) out.push(r.charCodeAt(0) & 0x7f);
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x80) out.push(code);
    else if (DOS_CHARS[ch] !== undefined) out.push(DOS_CHARS[ch]);
    else out.push(0x3f); // '?'
  }
  return out;
}

/**
 * Видимая длина строки в колонках. Считается по исходным символам, а не по
 * байтам: «ä» это один байт 0x84 и одна колонка, но «€» разворачивается в
 * три символа «EUR» и занимает три колонки.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of String(text ?? '')) {
    width += TRANSLITERATIONS[ch]?.length ?? 1;
  }
  return width;
}

// ---------------------------------------------------------------------------
// Перенос по словам и колонки
// ---------------------------------------------------------------------------

/**
 * Перенос по словам. Принтер сам рвёт строку посреди слова, поэтому переносим
 * заранее. Слово длиннее строки режется жёстко — иначе оно уехало бы за край.
 */
export function wrapWords(text: string, maxLen: number): string[] {
  const limit = Math.max(1, maxLen);
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (let word of words) {
    while (displayWidth(word) > limit) {
      if (line) {
        lines.push(line);
        line = '';
      }
      let head = '';
      for (const ch of word) {
        if (displayWidth(head + ch) > limit) break;
        head += ch;
      }
      lines.push(head);
      word = word.slice(head.length);
    }
    if (!word) continue;
    if (!line) line = word;
    else if (displayWidth(line) + 1 + displayWidth(word) <= limit) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const CONT_INDENT = '   ';

/**
 * Строка «слева … справа». Собирается вручную, а не через leftRight принтера:
 * при переполнении тот печатает колонки вплотную, и название слипается с ценой.
 * Здесь пробел перед правой колонкой гарантирован, а длинное название
 * переносится с отступом.
 */
export function layoutColumns(left: string, right: string, width: number): string[] {
  const l = String(left ?? '').trim();
  const r = String(right ?? '');
  if (!r) return wrapWords(l, width);

  const firstMax = Math.max(8, width - displayWidth(r) - 1);
  const lines = wrapWords(l, firstMax);
  const first = lines.shift() as string;
  const gap = Math.max(1, width - displayWidth(first) - displayWidth(r));
  const out = [first + ' '.repeat(gap) + r];
  if (lines.length) {
    for (const cont of wrapWords(lines.join(' '), Math.max(8, width - CONT_INDENT.length))) {
      out.push(CONT_INDENT + cont);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Сборка байт
// ---------------------------------------------------------------------------

class ByteWriter {
  private readonly bytes: number[] = [];

  raw(...values: number[]): void {
    for (const v of values) this.bytes.push(v & 0xff);
  }

  text(value: string): void {
    for (const b of encodeDos(value)) this.bytes.push(b);
  }

  line(value: string): void {
    this.text(value);
    this.bytes.push(0x0a);
  }

  toBuffer(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/**
 * ops → байты ESC/POS для заданного профиля.
 *
 * Профиль решает, что физически возможно: на POS-V2s «крупно» превращается в
 * двойную высоту, а отрез — в протяжку, и вызывающему коду знать об этом не надо.
 */
export function renderOpsToEscPos(
  ops: ReceiptOp[],
  profile: PrinterProfile = PROFILE_SUNMI_V2S
): Uint8Array {
  const w = new ByteWriter();
  const width = profile.width;

  // GS ! n — старший полубайт ШИРИНА, младший ВЫСОТА, вопреки части документации.
  const setSize = (double: boolean) => {
    if (!double) w.raw(0x1d, 0x21, 0x00);
    else if (profile.allowDoubleWidth) w.raw(0x1d, 0x21, 0x11);
    else w.raw(0x1d, 0x21, 0x01); // только высота: ширина колонок сохраняется
  };

  w.raw(0x1b, 0x40); // ESC @ — сброс режимов от прошлого чека
  if (profile.allowCodepageSelect) w.raw(0x1b, 0x74, 19); // PC858
  if (profile.fontB) w.raw(0x1b, 0x4d, 0x01);

  let centered = false;

  for (const op of ops) {
    switch (op.type) {
      case 'align':
        centered = op.value === 'center';
        w.raw(0x1b, 0x61, centered ? 0x01 : 0x00);
        break;

      case 'line':
        w.line('-'.repeat(width));
        break;

      case 'blank':
        w.raw(0x0a);
        break;

      case 'text': {
        if (op.bold) w.raw(0x1b, 0x45, 0x01);
        if (op.double) setSize(true);
        // При двойной ширине в строку влезает вдвое меньше — переносим по ней.
        const effective = op.double && profile.allowDoubleWidth ? Math.floor(width / 2) : width;
        // Ведущие пробелы сохраняются: ими помечены допы («   - Sauce: Aioli»),
        // и без отступа кухня прочитает доп как отдельную позицию заказа.
        // wrapWords режет по пробелам и сам по себе отступ бы потерял.
        const indent = /^\s*/.exec(op.text)?.[0] ?? '';
        const body = op.text.slice(indent.length);
        const room = Math.max(4, effective - indent.length);
        for (const l of wrapWords(body, room)) w.line(indent + l);
        if (op.double) setSize(false);
        if (op.bold) w.raw(0x1b, 0x45, 0x00);
        break;
      }

      case 'lr': {
        // Колонки печатаются обычной шириной всегда: двойная разъезжается,
        // а цена справа должна стоять ровно.
        if (op.bold) w.raw(0x1b, 0x45, 0x01);
        for (const l of layoutColumns(op.left, op.right, width)) w.line(l);
        if (op.bold) w.raw(0x1b, 0x45, 0x00);
        break;
      }

      case 'cut':
        for (let i = 0; i < profile.feedLinesBeforeTear; i++) w.raw(0x0a);
        if (profile.hasCutter) w.raw(0x1d, 0x56, 0x42, 0x00);
        else w.raw(0x1b, 0x64, profile.feedLinesBeforeTear); // оторвать вручную
        break;
    }
  }

  return w.toBuffer();
}

/**
 * Предпросмотр ровно того, что выйдет на бумаге.
 *
 * Восстанавливается из УЖЕ СОБРАННЫХ байт, а не строится параллельно: иначе это
 * была бы ещё одна независимая раскладка, которая однажды разойдётся с реальной.
 * Старый renderOpsToText для этого не годится — он не переносит длинные строки
 * и показывает то, чего принтер не напечатает.
 *
 * Нужен для кнопки «предпросмотр чека» в админке и для проверок в скриптах.
 */
export function renderOpsToPaperLines(
  ops: ReceiptOp[],
  profile: PrinterProfile = PROFILE_SUNMI_V2S
): string[] {
  const bytes = renderOpsToEscPos(ops, profile);
  const reverse = new Map<number, string>();
  for (const [ch, code] of Object.entries(DOS_CHARS)) reverse.set(code, ch);

  const lines: string[] = [];
  let current = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x1b || b === 0x1d) {
      // Длина аргументов у используемых нами команд: ESC @ без аргумента,
      // GS V с двумя, остальные с одним.
      const cmd = bytes[i + 1];
      const args = b === 0x1b && cmd === 0x40 ? 0 : b === 0x1d && cmd === 0x56 ? 2 : 1;
      i += 2 + args;
      continue;
    }
    if (b === 0x0a) {
      lines.push(current);
      current = '';
      i++;
      continue;
    }
    current += b < 0x80 ? String.fromCharCode(b) : (reverse.get(b) ?? '?');
    i++;
  }
  if (current) lines.push(current);
  return lines;
}

/** Байты в base64 — в таком виде чек уезжает на прибор в JSON. */
export function escPosToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
