/**
 * Настройки печати для POS-приборов — то, что правится в админке.
 *
 * Живут одним ключом в таблице settings (jsonb), поэтому добавление полей не
 * требует миграции. Отдельным ключом, а НЕ внутри storeSettings: тот читается
 * почти на каждом запросе (заказы, витрина, стоп-бот), и раздувать его
 * настройками принтера незачем.
 *
 * Значения по умолчанию — не из справочника, а измеренные на живом Sunmi V2s:
 * ширина 32 колонки, ножа нет, двойная ширина непригодна. Подробности в
 * lib/receipt/escpos.ts.
 */

import { getSetting, setSetting } from '../settings';
// Именно WorkshopId, а не KitchenStation: цеха, которые можно останавливать и
// печатать раздельно, — только pizza и sushi. В KitchenStation есть ещё fryer
// и none, они к делению по приборам отношения не имеют.
import { WORKSHOP_IDS, type WorkshopId } from '../kitchen/workshops';

export const POS_PRINT_SETTINGS_KEY = 'posPrintSettings';

export interface PosReceiptHeader {
  title: string;
  address: string;
  phone: string;
}

export interface PosPrintSettings {
  /** Выключатель автопечати на приборах. Не трогает LAN-агент. */
  enabled: boolean;
  /** Интервал опроса очереди прибором, мс. */
  pollMs: number;
  /** Колонок в строке. На Sunmi V2s измерено 32; Font B её не увеличивает. */
  width: number;
  /**
   * Печатать основной текст жирным. При плотности принтера 100 это было
   * необходимо для читаемости; после подъёма до 130 обычное начертание тоже
   * читается, поэтому по умолчанию выключено.
   */
  boldBody: boolean;
  /** Двойная высота у шапки, категорий, типа заказа, итога и HINWEIS. */
  bigAccents: boolean;
  /** Строк протяжки в конце — чтобы чек можно было оторвать. Ножа у V2s нет. */
  feedLines: number;
  /** Сколько копий печатать (второй экземпляр на выдачу и т.п.). */
  copies: number;
  /** Шапка чека. Раньше была захардкожена в трёх местах и разошлась. */
  header: PosReceiptHeader;
  /** Подвал. Пусто — не печатать. */
  footer: string;
  /**
   * Какие цеха печатать на приборах. null — все. Позволяет поставить прибор
   * на суши-станцию и печатать только её позиции.
   */
  workshops: WorkshopId[] | null;
}

export const DEFAULT_POS_PRINT_SETTINGS: PosPrintSettings = {
  enabled: true,
  pollMs: 3000,
  width: 32,
  boldBody: false,
  bigAccents: true,
  feedLines: 4,
  copies: 1,
  header: {
    title: 'DUMBO SLICE PIZZA',
    address: 'Kurhausstr. 11A - Bad Kissingen',
    // Мобильный: заказы идут через него. Стационарный 0971 72730 остаётся
    // в Impressum как официальный контакт заведения.
    phone: 'Tel: +49 163 2165979',
  },
  footer: 'Kein Kassenbon',
  workshops: null,
};

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

const asBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const asText = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

/**
 * Приводит что угодно из БД к валидным настройкам.
 *
 * Настройки правит человек через админку, а прибор на их основе шлёт команды
 * принтеру. Мусор в ширине строки разъедет весь чек, поэтому границы жёсткие:
 * 24..64 колонки, протяжка не больше 12 строк, копий не больше трёх.
 */
export function normalizePosPrintSettings(raw: unknown): PosPrintSettings {
  const d = DEFAULT_POS_PRINT_SETTINGS;
  if (!raw || typeof raw !== 'object') return { ...d, header: { ...d.header } };
  const r = raw as Record<string, any>;
  const header = (r.header ?? {}) as Record<string, any>;

  const workshops = Array.isArray(r.workshops)
    ? (r.workshops.filter((w: unknown): w is WorkshopId =>
        WORKSHOP_IDS.includes(w as WorkshopId)
      ) as WorkshopId[])
    : null;

  return {
    enabled: asBool(r.enabled, d.enabled),
    pollMs: clampInt(r.pollMs, 1000, 60_000, d.pollMs),
    width: clampInt(r.width, 24, 64, d.width),
    boldBody: asBool(r.boldBody, d.boldBody),
    bigAccents: asBool(r.bigAccents, d.bigAccents),
    feedLines: clampInt(r.feedLines, 0, 12, d.feedLines),
    copies: clampInt(r.copies, 1, 3, d.copies),
    header: {
      title: asText(header.title, d.header.title),
      address: asText(header.address, d.header.address),
      phone: asText(header.phone, d.header.phone),
    },
    footer: asText(r.footer, d.footer),
    // Пустой список означал бы «не печатать ничего» — почти наверняка ошибка
    // в админке, поэтому трактуем его как «все цеха».
    workshops: workshops && workshops.length ? workshops : null,
  };
}

export async function getPosPrintSettings(): Promise<PosPrintSettings> {
  const stored = await getSetting<unknown>(POS_PRINT_SETTINGS_KEY, undefined);
  return normalizePosPrintSettings(stored);
}

export async function setPosPrintSettings(
  patch: Partial<PosPrintSettings>
): Promise<PosPrintSettings> {
  const current = await getPosPrintSettings();
  const next = normalizePosPrintSettings({
    ...current,
    ...patch,
    header: { ...current.header, ...(patch.header ?? {}) },
  });
  await setSetting(POS_PRINT_SETTINGS_KEY, next);
  return next;
}
