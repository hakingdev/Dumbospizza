/**
 * Seed «4er Mini Pizza Box»: Kategorie + Konfigurator-Produkt + Mini-Größe (18 cm).
 *
 * ВАЖНО: локальная разработка и прод используют ОДНУ БД (Supabase). Поэтому две фазы:
 *
 *   node scripts/seed-mini-pizza-box.mjs
 *     Фаза «prepare» (безопасно в любой момент): библиотечный размер «Mini 18cm»,
 *     категория mini-pizza-box (active=false) и товар «4er Mini Pizza Box»
 *     (available=false). На витрине НИЧЕГО не появляется.
 *
 *   node scripts/seed-mini-pizza-box.mjs --activate
 *     Запускать ПОСЛЕ деплоя кода конструктора: добавляет размер «Mini 18cm»
 *     каждой пицце (цена по умолчанию = наименьший размер − 2 €, мин. 3,90 €),
 *     включает товар (available=true, basePrice = 4 × самый дешёвый Mini)
 *     и категорию (active=true). До деплоя НЕ запускать: старый прод-код
 *     показал бы Mini-размер в обычном модале пиццы.
 *
 *   node scripts/seed-mini-pizza-box.mjs --deactivate
 *     Kill-Switch: убирает размер «Mini 18cm» у всех пицц, выключает товар и
 *     категорию (данные bleiben erhalten, ничего не удаляется кроме Mini-размера).
 *
 * Скрипт идемпотентен — повторный запуск ничего не дублирует.
 * Цены Mini правятся потом в админке у каждой пиццы (Größen-Editor).
 */
import postgres from 'postgres';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';

const MINI_SIZE_NAME = 'Mini 18cm';
const MINI_SIZE_LABEL = 'Mini ≈ Ø 18 cm';
const CATEGORY_SLUG = 'mini-pizza-box';
const CATEGORY_NAME = 'Mini Pizza Box';
const PRODUCT_NAME = '4er Mini Pizza Box';
const PRODUCT_DESCRIPTION =
  'Stell dir deine Box zusammen: 4 Mini-Pizzen (ca. Ø 18 cm) nach Wahl aus allen unseren Sorten — auch 4× dieselbe. Frisch aus dem Ofen, perfekt zum Teilen.';
const PRODUCT_IMAGE = '/images/mini-pizza-box.svg';
const MIN_MINI_PRICE = 3.9;
const MINI_DISCOUNT_FROM_SMALLEST = 2; // Default: цена наименьшего размера − 2 €

const objectId = () => randomBytes(12).toString('hex');
const round2 = (n) => Math.round(n * 100) / 100;

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '');
  if (!url) throw new Error('DATABASE_URL не найден (ни в env, ни в .env.local)');
  return url;
}

const activate = process.argv.includes('--activate');
const deactivate = process.argv.includes('--deactivate');
const sql = postgres(databaseUrl(), { prepare: false });

async function ensureSizeVariation() {
  const [existing] = await sql`select id from size_variations where name = ${MINI_SIZE_NAME}`;
  if (existing) {
    console.log(`✓ Größen-Variation »${MINI_SIZE_NAME}« existiert (${existing.id})`);
    return existing.id;
  }
  const id = objectId();
  await sql`
    insert into size_variations (id, name, label, "order", active)
    values (${id}, ${MINI_SIZE_NAME}, ${MINI_SIZE_LABEL}, 3, true)
  `;
  console.log(`+ Größen-Variation »${MINI_SIZE_NAME}« angelegt (${id})`);
  return id;
}

async function ensureCategory() {
  const [existing] = await sql`select id, active from categories where slug = ${CATEGORY_SLUG}`;
  if (existing) {
    console.log(`✓ Kategorie »${CATEGORY_NAME}« existiert (active=${existing.active})`);
    return existing.id;
  }
  const id = objectId();
  await sql`
    insert into categories (id, name, slug, active, "order", image)
    values (${id}, ${CATEGORY_NAME}, ${CATEGORY_SLUG}, false, 1, ${PRODUCT_IMAGE})
  `;
  console.log(`+ Kategorie »${CATEGORY_NAME}« angelegt (inaktiv, ${id})`);
  return id;
}

async function ensureBoxProduct(categoryId, pizzas) {
  // «ab»-Preis der Karte: 4 × günstigster (Default-)Mini-Preis.
  const miniDefault = (p) => {
    const prices = (p.sizes || []).map((s) => Number(s.price)).filter((n) => n > 0);
    const smallest = prices.length ? Math.min(...prices) : Number(p.base_price) || 0;
    return Math.max(MIN_MINI_PRICE, round2(smallest - MINI_DISCOUNT_FROM_SMALLEST));
  };
  const miniPrice = (p) => {
    const mini = (p.sizes || []).find(
      (s) => (s?.name || '').trim().toLowerCase() === MINI_SIZE_NAME.toLowerCase()
    );
    return mini ? Number(mini.price) : miniDefault(p);
  };
  const cheapestMini = Math.min(...pizzas.map(miniPrice));
  const basePrice = round2(cheapestMini * 4);

  const [existing] = await sql`
    select id from products where category = ${categoryId} and name = ${PRODUCT_NAME}
  `;
  if (existing) {
    await sql`update products set base_price = ${basePrice}, updated_at = now() where id = ${existing.id}`;
    console.log(`✓ Produkt »${PRODUCT_NAME}« existiert — »ab«-Preis aktualisiert: ${basePrice} €`);
    return existing.id;
  }
  const id = objectId();
  await sql`
    insert into products (id, name, description, category, base_price, image, available, featured, tax_rate, sizes, option_group_ids)
    values (${id}, ${PRODUCT_NAME}, ${PRODUCT_DESCRIPTION}, ${categoryId}, ${basePrice},
            ${PRODUCT_IMAGE}, false, false, 0.07, '[]'::jsonb, '[]'::jsonb)
  `;
  console.log(`+ Produkt »${PRODUCT_NAME}« angelegt (nicht verfügbar, ab ${basePrice} €, ${id})`);
  return id;
}

async function addMiniSizesToPizzas(pizzas, variationId) {
  let added = 0;
  for (const p of pizzas) {
    const sizes = Array.isArray(p.sizes) ? p.sizes : [];
    const hasMini = sizes.some(
      (s) => (s?.name || '').trim().toLowerCase() === MINI_SIZE_NAME.toLowerCase()
    );
    if (hasMini) continue;
    const prices = sizes.map((s) => Number(s.price)).filter((n) => n > 0);
    const smallest = prices.length ? Math.min(...prices) : Number(p.base_price) || 0;
    const price = Math.max(MIN_MINI_PRICE, round2(smallest - MINI_DISCOUNT_FROM_SMALLEST));
    // ans ENDE anhängen: sizes[0] bleibt Default-Auswahl im (alten) Modal
    const next = [
      ...sizes,
      {
        id: String(Date.now() + added),
        name: MINI_SIZE_NAME,
        size: MINI_SIZE_NAME,
        label: MINI_SIZE_LABEL,
        price,
        variationId,
        priceModifier: 0,
      },
    ];
    await sql`update products set sizes = ${sql.json(next)}, updated_at = now() where id = ${p.id}`;
    console.log(`  + ${p.name}: Mini ${price} €`);
    added++;
  }
  console.log(added ? `+ Mini-Größe bei ${added} Pizzen ergänzt` : '✓ Alle Pizzen haben bereits eine Mini-Größe');
}

const [pizzaCategory] = await sql`select id from categories where slug = 'pizza'`;
if (!pizzaCategory) throw new Error('Kategorie »pizza« nicht gefunden');
const pizzas = await sql`
  select id, name, base_price, sizes from products
  where category = ${pizzaCategory.id} and available = true
  order by name
`;
console.log(`${pizzas.length} verfügbare Pizzen gefunden\n`);

if (deactivate) {
  console.log('— Deaktivierung —');
  const all = await sql`select id, name, sizes from products where category = ${pizzaCategory.id}`;
  let removed = 0;
  for (const p of all) {
    const sizes = Array.isArray(p.sizes) ? p.sizes : [];
    const next = sizes.filter(
      (s) => (s?.name || '').trim().toLowerCase() !== MINI_SIZE_NAME.toLowerCase()
    );
    if (next.length === sizes.length) continue;
    await sql`update products set sizes = ${sql.json(next)}, updated_at = now() where id = ${p.id}`;
    removed++;
  }
  await sql`update products set available = false, updated_at = now() where name = ${PRODUCT_NAME}`;
  await sql`update categories set active = false, updated_at = now() where slug = ${CATEGORY_SLUG}`;
  console.log(`✅ Deaktiviert (Mini-Größe bei ${removed} Pizzen entfernt, Kategorie/Produkt aus).`);
  await sql.end();
  process.exit(0);
}

const variationId = await ensureSizeVariation();
const categoryId = await ensureCategory();

if (activate) {
  console.log('\n— Aktivierung —');
  await addMiniSizesToPizzas(pizzas, variationId);
  // Preise neu lesen (falls Minis gerade angelegt/geändert wurden) und Box scharf schalten.
  const fresh = await sql`
    select id, name, base_price, sizes from products
    where category = ${pizzaCategory.id} and available = true
  `;
  const productId = await ensureBoxProduct(categoryId, fresh);
  await sql`update products set available = true, updated_at = now() where id = ${productId}`;
  await sql`update categories set active = true, updated_at = now() where id = ${categoryId}`;
  console.log('\n✅ Mini Pizza Box ist LIVE (Kategorie aktiv, Produkt verfügbar).');
} else {
  await ensureBoxProduct(categoryId, pizzas);
  console.log(
    '\n✅ Vorbereitet (Kategorie inaktiv, Produkt nicht verfügbar).\n' +
      '   Nach dem Deploy aktivieren: node scripts/seed-mini-pizza-box.mjs --activate'
  );
}

await sql.end();
