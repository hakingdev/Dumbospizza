// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  applyResultToCatalog,
  buildCatalogRecord,
  catalogChanges,
  findHubCategory,
  findHubItems,
  formatCatalogFailure,
  formatCatalogSummary,
  hasCatalogChanges,
  hubCategoryId,
  hubItemId,
  hubOnlyByCategory,
  isHubCategoryId,
  isHubItemId,
  mergeFailedCategories,
  nameSimilarity,
  readLieferandoCatalog,
  readLieferandoCatalogRecord,
  reconcileCatalog,
  setHubItemsOn,
  type LieferandoCatalog,
  type SiteItem,
} from '../lieferando/catalog';
import { itemKey } from '../lieferando/item-key';

/**
 * Сверка снимка каталога Lieferando Hub с сайтом: что есть только в Hub
 * (Burger, «Neu: Sushi Balls…»), что пропало, где имена разошлись; в группу —
 * только изменения относительно прошлого снимка. Факты сняты с живого Hub
 * 04.11.2026 (27 категорий, 143 позиции — здесь выжимка).
 */

const VAR_27 = { text: 'Ca. 27×37 cm (entspricht ca. Ø 36 cm Pizza)', on: true };
const VAR_28 = { text: 'Ca. 28×18 cm (entspricht ca. Ø 26 cm Pizza)', on: false };

const hub = (over: Partial<LieferandoCatalog> = {}): LieferandoCatalog => ({
  takenAt: '2026-11-04T08:00:00.000Z',
  failedCategories: [],
  categories: [
    {
      name: 'Angebot',
      items: [
        { name: "Neu: Fisherman's Slice (Tonno) Pizza", on: true, variations: [VAR_27, VAR_28] },
        { name: 'Neu: Sushi Balls Lachs Panko  7stk', on: false, variations: [] },
        { name: 'Gyoza Gemüse Vegetarische (7 Stück)', on: true, variations: [] },
      ],
    },
    {
      name: 'Pizza',
      items: [
        { name: 'Hawaiian Pizza', on: true, variations: [VAR_27, VAR_28] },
        { name: 'Tiger-Drache 340g', on: true, variations: [] },
      ],
    },
    {
      name: 'Runde Pizza',
      items: [{ name: 'Hawaiian Pizza (rund)', on: true, variations: [{ text: '30 cm', on: true }] }],
    },
    {
      name: 'Burger',
      items: [
        { name: 'Shrimp Party Burger', on: true, variations: [] },
        { name: 'Dry Aged Burger', on: true, variations: [] },
        { name: 'Veganer Burger mit Beyond Meat-Patty und veganem Cheddar-Käse', on: false, variations: [] },
      ],
    },
    {
      name: 'Makilove Nigiri',
      items: [{ name: 'Nigiri Lachs', on: true, variations: [] }],
    },
  ],
  ...over,
});

const site = (over: SiteItem[] = []): SiteItem[] => [
  { name: "Fisherman's Slice (Tonno)", category: 'Angebot', visible: true },
  { name: 'Gyoza Gemüse (7 Stück)', category: 'Angebot', visible: true },
  { name: 'Hawaiian', category: 'Pizza', visible: true },
  { name: 'Tiger-Drache', category: 'Pizza', visible: true },
  { name: 'Nigiri Lachs', category: 'MakiLove Sushi', visible: true },
  { name: 'Riesling 0,75 L', category: 'Alkohol', visible: false },
  { name: 'Mini Pizza Box', category: 'Mini Pizza Box', visible: true },
  ...over,
];

describe('readLieferandoCatalog', () => {
  it('тело агента → снимок; мусор и пустота → null', () => {
    const parsed = readLieferandoCatalog({
      takenAt: '2026-11-04T08:00:00.000Z',
      categories: [
        {
          name: ' Burger ',
          items: [
            { name: 'Dry Aged  Burger', on: true, variations: [{ text: ' 6stk ', on: false }, 'голая строка', { text: '' }] },
            { name: '', on: true },
            null,
          ],
        },
        { name: '', items: [] },
        'мусор',
      ],
      failedCategories: ['Wein', 7, ''],
    });
    expect(parsed).toEqual({
      takenAt: '2026-11-04T08:00:00.000Z',
      categories: [
        {
          name: 'Burger',
          items: [
            {
              name: 'Dry Aged Burger',
              on: true,
              variations: [
                { text: '6stk', on: false },
                { text: 'голая строка', on: true },
              ],
            },
          ],
        },
      ],
      failedCategories: ['Wein'],
    });
    expect(readLieferandoCatalog(null)).toBeNull();
    expect(readLieferandoCatalog({ categories: [] })).toBeNull();
    expect(readLieferandoCatalog({ categories: 'x' })).toBeNull();
    // без takenAt — подставляется запасное время
    expect(readLieferandoCatalog({ categories: [{ name: 'A', items: [] }] }, '2026-01-01T00:00:00.000Z')?.takenAt).toBe(
      '2026-01-01T00:00:00.000Z'
    );
  });

  it('запись из БД: ключи прошлой сверки читаются, без takenAt — null', () => {
    const rec = readLieferandoCatalogRecord({
      ...hub(),
      receivedAt: '2026-11-04T08:01:00.000Z',
      hubOnlyKeys: ['dryagedburger'],
      mismatchKeys: ['a~b'],
    });
    expect(rec?.hubOnlyKeys).toEqual(['dryagedburger']);
    expect(rec?.mismatchKeys).toEqual(['a~b']);
    expect(rec?.receivedAt).toBe('2026-11-04T08:01:00.000Z');
    expect(readLieferandoCatalogRecord({ categories: [{ name: 'A', items: [] }] })).toBeNull();
  });
});

describe('id для кнопок бота', () => {
  it('короткие, стабильные, в лимит callback_data; «X» и «X (rund)» — один id', () => {
    const id = hubItemId('Veganer Burger mit Beyond Meat-Patty und veganem Cheddar-Käse');
    expect(id).toMatch(/^hub-i[0-9a-f]{8}$/);
    expect(hubItemId('Hawaiian Pizza')).toBe(hubItemId('Hawaiian Pizza (rund)'));
    expect(hubItemId('Dry Aged Burger')).not.toBe(hubItemId('Shrimp Party Burger'));
    expect(hubCategoryId('Burger')).toMatch(/^hub-c[0-9a-f]{8}$/);
    expect(hubCategoryId('Burger')).toBe(hubCategoryId(' burger '));
    expect(isHubItemId(id)).toBe(true);
    expect(isHubCategoryId(id)).toBe(false);
    expect(isHubCategoryId(hubCategoryId('Burger'))).toBe(true);
    expect(isHubItemId('6ab13e01bac562cf69912ba6')).toBe(false);
    // ctrl_it_off_<id>_<page> ≤ 64 байт
    expect(Buffer.byteLength(`ctrl_it_off_${id}_99`)).toBeLessThanOrEqual(64);
  });

  it('поиск по id: категория, строки с одним ключом, переключение в снимке', () => {
    const c = hub();
    expect(findHubCategory(c, hubCategoryId('burger'))?.name).toBe('Burger');
    expect(findHubCategory(c, hubCategoryId('nope'))).toBeNull();
    const found = findHubItems(c, hubItemId('Hawaiian'));
    expect(found?.category).toBe('Pizza');
    expect(found?.items.map((i) => i.name)).toEqual(['Hawaiian Pizza', 'Hawaiian Pizza (rund)']);
    expect(findHubItems(c, 'hub-i00000000')).toBeNull();

    const next = setHubItemsOn(c, hubItemId('Hawaiian'), false)!;
    expect(next.categories[1].items[0].on).toBe(false);
    expect(next.categories[2].items[0].on).toBe(false);
    expect(c.categories[1].items[0].on).toBe(true); // исходный снимок не тронут
    expect(setHubItemsOn(c, 'hub-i00000000', false)).toBeNull();
  });
});

describe('reconcileCatalog', () => {
  it('только в Hub: Burger и Sushi Balls; совпавшие — по itemKey (Pizza/rund, Neu:, порции)', () => {
    const r = reconcileCatalog(hub(), site());
    expect(r.hubOnly.map((h) => `${h.category}: ${h.name}`)).toEqual([
      'Angebot: Neu: Sushi Balls Lachs Panko  7stk',
      'Burger: Shrimp Party Burger',
      'Burger: Dry Aged Burger',
      'Burger: Veganer Burger mit Beyond Meat-Patty und veganem Cheddar-Käse',
    ]);
    expect(r.hubOnly.find((h) => h.name.startsWith('Veganer'))?.on).toBe(false);
    expect(r.matched).toBe(6); // Fisherman, Gyoza, Hawaiian ×2, Tiger-Drache, Nigiri
    expect(r.mismatches).toEqual([]);
  });

  it('только на сайте (алкоголь, Mini Pizza Box) — не ошибка; похожее имя в Hub → несовпадение', () => {
    const r = reconcileCatalog(
      hub({
        categories: [
          ...hub().categories,
          { name: 'Crispy Sides', items: [{ name: 'Chicken Wings Hot Honey 12 Stk', on: true, variations: [] }] },
        ],
      }),
      site([{ name: 'Chicken Wings Hot Honey', category: 'Crispy Sides', visible: true }])
    );
    // itemKey срезает «12 Stk» → это точное совпадение, не mismatch
    expect(r.mismatches).toEqual([]);

    const r2 = reconcileCatalog(
      hub({ categories: [{ name: 'Pizza', items: [{ name: 'Brooklyn mussels pizza', on: true, variations: [] }] }] }),
      [{ name: 'Brooklyn Mussel', category: 'Pizza', visible: true }]
    );
    expect(r2.mismatches).toEqual([
      { site: 'Brooklyn Mussel', hub: 'Brooklyn mussels pizza', key: 'brooklynmussel~brooklynmussels' },
    ]);
    expect(r2.hubOnly).toEqual([]); // объяснено несовпадением, не «новое»
  });

  it('скрытые категории сайта в несовпадения не попадают, но пару для Hub дают', () => {
    const r = reconcileCatalog(
      hub({ categories: [{ name: 'Wein', items: [{ name: 'Riesling 0,75 L', on: true, variations: [] }, { name: 'Riesling 0,2 L', on: true, variations: [] }] }] }),
      [{ name: 'Riesling 0,75 L', category: 'Alkohol', visible: false }, { name: 'Riesling 0,25 L', category: 'Alkohol', visible: false }]
    );
    expect(r.matched).toBe(1);
    expect(r.mismatches).toEqual([]);
    expect(r.hubOnly.map((h) => h.name)).toEqual(['Riesling 0,2 L']);
  });

  it('похожесть имён: подстрока и Дайс', () => {
    expect(nameSimilarity('tigerdrache', 'tigerdrache')).toBe(1);
    expect(nameSimilarity('tigerdrache', 'tigerdrache340g')).toBeGreaterThan(0.75);
    expect(nameSimilarity('hawaiian', 'margherita')).toBeLessThan(0.3);
    expect(nameSimilarity('a', 'b')).toBe(0);
  });
});

describe('catalogChanges: в группу только новое', () => {
  it('первый снимок: всё, что только в Hub — новое; пропавшего нет', () => {
    const c = hub();
    const report = reconcileCatalog(c, site());
    const changes = catalogChanges(null, c, report);
    expect(changes.newHubOnly.map((h) => h.name)).toEqual(report.hubOnly.map((h) => h.name));
    expect(changes.gone).toEqual([]);
    expect(changes.newMismatches).toEqual([]);
    expect(hasCatalogChanges(changes)).toBe(true);
  });

  it('тот же снимок назавтра — тишина', () => {
    const c = hub();
    const report = reconcileCatalog(c, site());
    const prev = buildCatalogRecord(c, report, '2026-11-04T08:01:00.000Z');
    const changes = catalogChanges(prev, c, reconcileCatalog(c, site()));
    expect(hasCatalogChanges(changes)).toBe(false);
  });

  it('появилась новая строка без пары, пропала старая, выключение состояния — не изменение', () => {
    const c = hub();
    const prev = buildCatalogRecord(c, reconcileCatalog(c, site()), '2026-11-04T08:01:00.000Z');
    const next = hub({
      categories: c.categories.map((cat) =>
        cat.name === 'Burger'
          ? {
              name: 'Burger',
              items: [
                { name: 'Shrimp Party Burger', on: false, variations: [] }, // выключили — не новость
                { name: 'Dry Aged Burger', on: true, variations: [] },
                { name: 'Lachsburger mit Remoulade', on: true, variations: [] }, // новая
              ],
            }
          : cat.name === 'Makilove Nigiri'
            ? { name: 'Makilove Nigiri', items: [] } // Nigiri Lachs пропал
            : cat
      ),
    });
    const changes = catalogChanges(prev, next, reconcileCatalog(next, site()));
    expect(changes.newHubOnly.map((h) => h.name)).toEqual(['Lachsburger mit Remoulade']);
    expect(changes.gone).toEqual([
      { category: 'Burger', name: 'Veganer Burger mit Beyond Meat-Patty und veganem Cheddar-Käse' },
      { category: 'Makilove Nigiri', name: 'Nigiri Lachs' },
    ]);
  });

  it('товар сайта удалили — его Hub-строка становится «новой без пары»', () => {
    const c = hub();
    const prev = buildCatalogRecord(c, reconcileCatalog(c, site()), '2026-11-04T08:01:00.000Z');
    const changes = catalogChanges(
      prev,
      c,
      reconcileCatalog(c, site().filter((s) => s.name !== 'Tiger-Drache'))
    );
    expect(changes.newHubOnly.map((h) => h.name)).toEqual(['Tiger-Drache 340g']);
  });

  it('новое несовпадение имён — один раз; впервые не открывшаяся категория — один раз', () => {
    const c = hub({ categories: [{ name: 'Pizza', items: [{ name: 'Brooklyn mussels pizza', on: true, variations: [] }] }] });
    const s: SiteItem[] = [{ name: 'Brooklyn Mussel', category: 'Pizza', visible: true }];
    const first = catalogChanges(null, c, reconcileCatalog(c, s));
    expect(first.newMismatches).toHaveLength(1);
    const prev = buildCatalogRecord(c, reconcileCatalog(c, s), 'x');
    const again = catalogChanges(prev, c, reconcileCatalog(c, s));
    expect(again.newMismatches).toEqual([]);

    const failed = { ...c, failedCategories: ['Wein'] };
    expect(catalogChanges(prev, failed, reconcileCatalog(failed, s)).newFailedCategories).toEqual(['Wein']);
    const prevFailed = { ...prev, failedCategories: ['Wein'] };
    expect(catalogChanges(prevFailed, failed, reconcileCatalog(failed, s)).newFailedCategories).toEqual([]);
  });
});

describe('mergeFailedCategories', () => {
  it('не открывшаяся категория берётся из прошлого снимка — её строки не «пропадают»', () => {
    const prev = buildCatalogRecord(hub(), reconcileCatalog(hub(), site()), 'x');
    const current = hub({
      categories: hub().categories.filter((c) => c.name !== 'Burger'),
      failedCategories: ['Burger', 'Wein'],
    });
    const merged = mergeFailedCategories(current, prev);
    expect(merged.categories.map((c) => c.name)).toContain('Burger');
    expect(merged.categories.find((c) => c.name === 'Burger')?.items).toHaveLength(3);
    const changes = catalogChanges(prev, merged, reconcileCatalog(merged, site()));
    expect(changes.gone).toEqual([]);
    expect(changes.newHubOnly).toEqual([]);
    expect(mergeFailedCategories(current, null)).toBe(current);
    expect(mergeFailedCategories(hub(), prev)).toEqual(hub()); // без failed — ничего не подставляется
  });
});

describe('formatCatalogSummary / formatCatalogFailure', () => {
  it('сводка: новое по категориям, пропавшее, несовпадения, не открывшиеся', () => {
    const text = formatCatalogSummary(
      {
        newHubOnly: [
          { category: 'Burger', name: 'Dry Aged Burger', on: true, key: 'a' },
          { category: 'Burger', name: 'Shrimp & Party', on: false, key: 'b' },
          { category: 'Angebot', name: 'Neu: Sushi Balls Lachs Panko 7stk', on: true, key: 'c' },
        ],
        gone: [{ category: 'Pizza', name: 'Old <Pizza>' }],
        newMismatches: [{ site: 'Tiger-Drache', hub: 'Tiger-Drache 340g', key: 'k' }],
        newFailedCategories: ['Wein'],
      },
      hub()
    );
    expect(text).toContain('🛵📋 <b>Сверка каталога Lieferando</b>');
    expect(text).toContain('категорий: 5, позиций: 10');
    expect(text).toContain('🆕 <b>Новое на Lieferando, нет на сайте:</b>');
    expect(text).toContain('• Burger: Dry Aged Burger, Shrimp &amp; Party (выкл)');
    expect(text).toContain('• Angebot: Neu: Sushi Balls Lachs Panko 7stk');
    expect(text).toContain('➖ <b>Пропало из Lieferando:</b> Old &lt;Pizza&gt;');
    expect(text).toContain('⚠️ <b>Имена не совпадают — бот не переключит на Lieferando:</b>');
    expect(text).toContain('• Tiger-Drache ↔ Tiger-Drache 340g');
    expect(text).toContain('⚠️ Не открылись категории: Wein');
  });

  it('сообщение о сбое', () => {
    expect(formatCatalogFailure('сессия истекла', 'daily')).toContain('Ежедневный снимок каталога Lieferando не удался');
    expect(formatCatalogFailure('', 'command')).toContain('Причина неизвестна');
  });
});

describe('applyResultToCatalog', () => {
  it('отчёт item/makilove (ok) обновляет общие переключатели; size и ошибки — нет', () => {
    const c = hub();
    const next = applyResultToCatalog(c, { ok: true, action: 'off', target: { kind: 'item', names: ['Hawaiian'] } })!;
    expect(next.categories[1].items[0].on).toBe(false);
    expect(next.categories[2].items[0].on).toBe(false);
    expect(applyResultToCatalog(next, { ok: true, action: 'off', target: { kind: 'item', names: ['Hawaiian'] } })).toBeNull();
    const maki = applyResultToCatalog(c, { ok: true, action: 'off', target: { kind: 'makilove' } })!;
    expect(maki.categories.find((x) => x.name === 'Makilove Nigiri')?.items[0].on).toBe(false);
    expect(maki.categories[1].items[0].on).toBe(true);
    expect(applyResultToCatalog(c, { ok: false, action: 'off', target: { kind: 'item', names: ['Hawaiian'] } })).toBeNull();
    expect(applyResultToCatalog(c, { ok: true, action: 'off', target: { kind: 'size' } })).toBeNull();
    expect(applyResultToCatalog(c, { ok: true, action: 'off', target: { kind: 'item', names: [] } })).toBeNull();
  });
});

describe('hubOnlyByCategory (строки для экрана бота)', () => {
  it('Hub-строки без пары по категориям, одна кнопка на ключ, on = все включены', () => {
    const c = hub({
      categories: [
        ...hub().categories,
        { name: 'Runde Pizza', items: [{ name: 'Dry Aged Burger (rund)', on: false, variations: [] }] },
      ],
    });
    const siteKeys = new Set(site().map((s) => itemKey(s.name)));
    const rows = hubOnlyByCategory(c, siteKeys);
    expect(Array.from(rows.keys())).toEqual(['Angebot', 'Burger', 'Runde Pizza']);
    expect(rows.get('Angebot')).toEqual([
      { id: hubItemId('Neu: Sushi Balls Lachs Panko  7stk'), name: 'Neu: Sushi Balls Lachs Panko  7stk', on: false },
    ]);
    expect(rows.get('Burger')?.map((r) => r.name)).toEqual([
      'Shrimp Party Burger',
      'Dry Aged Burger',
      'Veganer Burger mit Beyond Meat-Patty und veganem Cheddar-Käse',
    ]);
    // «(rund)»-двойник в другой категории — тот же id
    expect(rows.get('Runde Pizza')?.[0].id).toBe(hubItemId('Dry Aged Burger'));
  });
});

// --- раскладка и состояние Hub для экрана бота ---------------------------------------

import { hubKeysByCategory, hubStateByKey, normalizeCategoryName } from '../lieferando/catalog';

describe('hubStateByKey / hubKeysByCategory', () => {
  const snapshot = {
    takenAt: '2026-11-12T08:00:00.000Z',
    failedCategories: [],
    categories: [
      {
        name: 'Angebot',
        items: [
          { name: 'Gyoza Gemüse Vegetarische (7 Stück)', on: true, variations: [] },
          { name: 'Gyoza Hähnchen & Gemüse (7 Stück)', on: false, variations: [] },
        ],
      },
      { name: 'Pizza', items: [{ name: 'Hawaiian Pizza', on: true, variations: [] }] },
      { name: 'Runde Pizza', items: [{ name: 'Hawaiian Pizza (rund)', on: false, variations: [] }] },
    ],
  };

  it('состояние по ключу имени: вкл / выкл / вперемешку (Detroit и «(rund)» под одним ключом)', () => {
    const state = hubStateByKey(snapshot);
    expect(state.get(itemKey('Gyoza Gemüse (7 Stück)'))).toBe('on'); // имя сайта — тот же ключ
    expect(state.get(itemKey('Gyoza Hähnchen & Gemüse (7 Stück)'))).toBe('off');
    expect(state.get(itemKey('Hawaiian'))).toBe('mixed');
    expect(state.get(itemKey('Нет такой'))).toBeUndefined();
  });

  it('ключи по категории Hub: гёдза лежит в «Angebot», хотя на сайте она в суши', () => {
    const keys = hubKeysByCategory(snapshot);
    expect(keys.get(normalizeCategoryName('angebot'))?.has(itemKey('Gyoza Gemüse (7 Stück)'))).toBe(true);
    expect(keys.get(normalizeCategoryName('Pizza'))?.has(itemKey('Hawaiian'))).toBe(true);
    expect(keys.get(normalizeCategoryName('Burger'))).toBeUndefined();
  });
});
