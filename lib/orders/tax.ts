/**
 * Налоговая логика (USt./VAT) для чека заказа.
 *
 * Правила (только для ОНЛАЙН-оплаты):
 *  - 7 %  — на все товары еды (Speisen).
 *  - 19 % — ТОЛЬКО на воду и алкогольные напитки.
 *  - Прочие товары (в т.ч. безалкогольные напитки, не являющиеся водой) → 7 %.
 *
 * Для оплаты при получении (cash / bar / card at door) НИЧЕГО не меняем:
 * buildOrderTax возвращает { applied: false } и пустую разбивку — существующее
 * поведение офлайн-чека остаётся прежним.
 *
 * Цены в заказе — Brutto (НДС уже включён), поэтому суммы заказа не меняются:
 * Netto и USt. извлекаются ИЗ Brutto (inclusive VAT), а не добавляются сверху.
 */

export const FOOD_VAT_RATE = 0.07;
/** Вода и алкоголь. */
export const BEVERAGE_VAT_RATE = 0.19;

/**
 * Способы онлайн-оплаты, для которых применяем VAT-разбивку в чеке.
 * В этом проекте онлайн-оплата — это paymentMethod === 'online' (SumUp),
 * но helper устойчив и к другим вариантам (stripe / paypal / card online).
 * ВАЖНО: чистый 'card' = оплата картой у двери (офлайн) → НЕ онлайн.
 */
const EXPLICIT_ONLINE_METHODS = new Set([
  'online',
  'card_online',
  'cardonline',
  'stripe',
  'paypal',
  'sumup',
  'applepay',
  'apple_pay',
  'googlepay',
  'google_pay',
]);

export function isOnlinePaymentMethod(method?: string | null): boolean {
  if (!method) return false;
  const normalized = method.toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (EXPLICIT_ONLINE_METHODS.has(normalized)) return true;
  // 'card online', 'card_online', 'online card' и т.п.
  if (normalized.includes('online')) return true;
  if (normalized.includes('stripe') || normalized.includes('paypal') || normalized.includes('sumup')) {
    return true;
  }
  // cash / bar / card (у двери) → офлайн
  return false;
}

/** Ключевые слова воды (19 %). */
const WATER_KEYWORDS = [
  'wasser',
  'water',
  'mineralwasser',
  'tafelwasser',
  'sprudel',
  'aqua',
  'soda water',
];

/** Ключевые слова алкоголя (19 %). */
const ALCOHOL_KEYWORDS = [
  'bier',
  'beer',
  'radler',
  'weizen',
  'pils',
  'lager',
  'helles',
  'wein',
  'wine',
  'sekt',
  'prosecco',
  'champagner',
  'champagne',
  'vodka',
  'wodka',
  'whisky',
  'whiskey',
  'rum',
  'gin',
  'tequila',
  'likör',
  'likoer',
  'liqueur',
  'schnaps',
  'aperol',
  'spritz',
  'campari',
  'hugo',
  'grappa',
  'brandy',
  'cognac',
  'baileys',
  'jägermeister',
  'jagermeister',
  'cocktail',
];

function matchesAny(haystack: string, keywords: string[]): boolean {
  return keywords.some((kw) => haystack.includes(kw));
}

/**
 * Является ли товар водой или алкоголем (ставка 19 %).
 * Определяем по названию и (если задана) категории — безопасный маппинг,
 * не полагаемся на product.taxRate, т.к. он в данных проставлен непоследовательно.
 */
export function isWaterOrAlcohol(input: { name?: string; category?: string }): boolean {
  const haystack = `${input.name || ''} ${input.category || ''}`.toLowerCase();
  return matchesAny(haystack, WATER_KEYWORDS) || matchesAny(haystack, ALCOHOL_KEYWORDS);
}

/**
 * Нормализует ставку к доле (0.07). Принимает доли (0.07) и проценты (7).
 * Возвращает null, если значение невалидно или ≤ 0 (поле не задано).
 */
function normalizeRate(rate?: number | null): number | null {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  return rate > 1 ? rate / 100 : rate;
}

/**
 * Налоговая ставка для одной позиции.
 * Приоритет — явно заданная ставка товара (taxRate из карточки товара: 7 % / 19 %).
 * Если не задана — определяем по названию/категории (вода/алкоголь → 19 %, иначе 7 %).
 */
export function resolveItemVatRate(item: {
  name?: string;
  category?: string;
  taxRate?: number | null;
}): number {
  const explicit = normalizeRate(item.taxRate);
  if (explicit != null) return explicit;
  return isWaterOrAlcohol(item) ? BEVERAGE_VAT_RATE : FOOD_VAT_RATE;
}

export interface TaxOrderItem {
  name: string;
  quantity: number;
  /** Полная (Brutto) сумма позиции = price * quantity. */
  totalPrice: number;
  category?: string;
  /** Явная ставка НДС товара (доля 0.07 / 0.19), назначенная в карточке товара. */
  taxRate?: number | null;
}

export interface ReceiptLineItem {
  quantity: number;
  name: string;
  vatRate: number;
  /** Brutto-сумма позиции. */
  gross: number;
  net: number;
  vat: number;
}

export interface TaxBreakdownRow {
  rate: number;
  net: number;
  vat: number;
  gross: number;
}

export interface OrderTaxResult {
  /** true — применяем VAT-разбивку (онлайн-оплата); false — офлайн, поведение прежнее. */
  applied: boolean;
  lineItems: ReceiptLineItem[];
  /** Разбивка по ставкам (только при applied). Строка 19 % появляется лишь при наличии воды/алкоголя. */
  breakdown: TaxBreakdownRow[];
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Извлекает Netto и USt. ИЗ Brutto-суммы (НДС включён в цену). */
function splitGross(gross: number, rate: number): { net: number; vat: number } {
  const net = round2(gross / (1 + rate));
  const vat = round2(gross - net);
  return { net, vat };
}

/**
 * Строит позиции чека и налоговую разбивку из товаров заказа.
 * Для офлайн-оплаты возвращает applied:false и пустую разбивку.
 */
export function buildOrderTax(order: {
  items: TaxOrderItem[];
  paymentMethod?: string | null;
}): OrderTaxResult {
  const applied = isOnlinePaymentMethod(order.paymentMethod);

  const lineItems: ReceiptLineItem[] = (order.items || []).map((item) => {
    const gross = round2(item.totalPrice || 0);
    const vatRate = resolveItemVatRate(item);
    const { net, vat } = splitGross(gross, vatRate);
    return {
      quantity: item.quantity,
      name: item.name,
      vatRate,
      gross,
      net,
      vat,
    };
  });

  if (!applied) {
    return { applied: false, lineItems, breakdown: [] };
  }

  // Группируем по ставке. Строку создаём только если по ставке есть Brutto > 0,
  // поэтому при заказе из одной еды будет только 7 %, а 19 % — лишь при воде/алкоголе.
  const grossByRate = new Map<number, number>();
  for (const line of lineItems) {
    grossByRate.set(line.vatRate, round2((grossByRate.get(line.vatRate) || 0) + line.gross));
  }

  const breakdown: TaxBreakdownRow[] = Array.from(grossByRate.entries())
    .filter(([, gross]) => gross > 0)
    .sort(([a], [b]) => a - b)
    .map(([rate, gross]) => {
      const { net, vat } = splitGross(gross, rate);
      return { rate, net, vat, gross };
    });

  return { applied: true, lineItems, breakdown };
}

/** Сумма без валюты в немецком формате: 2.5 → "2,50". */
export function formatAmount(amount: number): string {
  return amount.toFixed(2).replace('.', ',');
}

/**
 * Денежная сумма в немецком формате: 2.5 → "2,50€".
 * Без пробела перед € — компактно, т.к. поле description в SumUp жёстко
 * ограничено по длине (см. MAX_SUMUP_DESCRIPTION_LENGTH).
 */
export function formatEuro(amount: number): string {
  return `${formatAmount(amount)}€`;
}

/** Ставка в процентах для чека: 0.07 → "7%". */
export function formatVatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * Лимит поля `description` в SumUp checkout API — в БАЙТАХ UTF-8 (проверено
 * эмпирически: ~254 байта; 255+ → 400 Validation error). Важно считать байты,
 * а не символы: «€» = 3 байта, «ü» = 2 байта. Берём 250 с запасом.
 * Перенос строк разрешён.
 */
export const MAX_SUMUP_DESCRIPTION_LENGTH = 250;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Текст описания для SumUp-checkout (единственное поле, которое попадает в чек
 * SumUp). Содержит позиции (Artikel) и разбивку налогов (Aufschlüsselung der
 * Steuern) вместо одной общей строки.
 *
 * Формат позиции: "1x Pizza Margherita | 7% | 9,50 €".
 *
 * Поле ограничено ~250 символами (см. MAX_SUMUP_DESCRIPTION_LENGTH), поэтому
 * налоговую разбивку (компактную, ≤ 2 строк, обязательную для чека) сохраняем
 * всегда, а список позиций обрезаем по бюджету с пометкой «+N weitere Artikel».
 */
export function buildSumUpCheckoutDescription(order: {
  orderNumber: string;
  items: TaxOrderItem[];
  paymentMethod?: string | null;
}): string {
  const header = `Dumbo Pizza Bestellung #${order.orderNumber}`;
  const tax = buildOrderTax(order);

  if (!tax.applied || tax.lineItems.length === 0) {
    return header;
  }

  const itemLines = tax.lineItems.map(
    (line) => `${line.quantity}x ${line.name} | ${formatVatRate(line.vatRate)} | ${formatEuro(line.gross)}`
  );

  // В таблице налогов «€» опускаем (валюта очевидна) — экономит байты при
  // жёстком лимите description; в позициях «€» сохраняем для читабельности цен.
  const steuernBlock = [
    'Aufschlüsselung der Steuern:',
    ...tax.breakdown.map(
      (row) =>
        `${formatVatRate(row.rate)}: Netto ${formatAmount(row.net)} | USt. ${formatAmount(
          row.vat
        )} | Brutto ${formatAmount(row.gross)}`
    ),
  ].join('\n');

  // Бюджет под список позиций (в БАЙТАХ): header + разбивка налогов всегда присутствуют.
  const fixed = byteLength(`${header}\n\nArtikel:\n\n\n${steuernBlock}`);
  const itemsBudget = MAX_SUMUP_DESCRIPTION_LENGTH - fixed;
  const shownItems = fitItemLines(itemLines, itemsBudget);

  return [header, '', 'Artikel:', shownItems.join('\n'), '', steuernBlock].join('\n');
}

/**
 * Подбирает максимум первых позиций, помещающихся в бюджет (в БАЙТАХ, с учётом
 * переносов строк). Если влезают не все — заменяет хвост строкой
 * «+K weitere Artikel», уменьшая K, пока всё не уложится.
 */
function fitItemLines(itemLines: string[], budget: number): string[] {
  const joinedBytes = (arr: string[]) => byteLength(arr.join('\n'));
  if (itemLines.length === 0 || joinedBytes(itemLines) <= budget) {
    return itemLines;
  }
  for (let shown = itemLines.length - 1; shown >= 1; shown--) {
    const candidate = [...itemLines.slice(0, shown), `+${itemLines.length - shown} weitere Artikel`];
    if (joinedBytes(candidate) <= budget) return candidate;
  }
  return [`+${itemLines.length} weitere Artikel`];
}
