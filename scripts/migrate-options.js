/**
 * Одноразовая миграция extras (вшитые топпинги/соусы) в переиспользуемые
 * опции (Option) и группы опций (OptionGroup), с привязкой к товарам.
 *
 * Группы:
 *   - "Saucen"             — из extras.sauces
 *   - "Zusätzliche Beläge" — из extras.toppings (кроме «+5 Stk»)
 *   - "+5 Stück"           — топпинг «+5 Stk» (для сайдов)
 *
 * Идемпотентно: опции/группы ищутся по имени, повторный запуск не задвоит.
 * Старые extras НЕ удаляются (используются как fallback, но в UI скрыты при наличии групп).
 *
 * Запуск:  MONGODB_URI=mongodb://127.0.0.1:27017/dumbospizza node scripts/migrate-options.js
 */
const mongoose = require('mongoose');

const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dumbospizza';
const PLUS5 = '+5 Stk';

async function upsertOption(col, name, price) {
  const existing = await col.findOne({ name });
  if (existing) return existing._id;
  const res = await col.insertOne({
    name,
    price: Number(price) || 0,
    active: true,
    order: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  return res.insertedId;
}

async function upsertGroup(col, name, optionIds, rules, order) {
  const existing = await col.findOne({ name });
  if (existing) {
    await col.updateOne(
      { _id: existing._id },
      { $set: { optionIds, ...rules, updatedAt: new Date() } }
    );
    return existing._id;
  }
  const res = await col.insertOne({
    name,
    optionIds,
    required: rules.required || false,
    minSelect: rules.minSelect || 0,
    maxSelect: rules.maxSelect || 0,
    active: true,
    order: order || 0,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  return res.insertedId;
}

async function main() {
  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  const products = db.collection('products');
  const options = db.collection('options');
  const groups = db.collection('optiongroups');

  const all = await products
    .find({ $or: [{ 'extras.toppings.0': { $exists: true } }, { 'extras.sauces.0': { $exists: true } }] })
    .toArray();

  // собрать уникальные опции по категориям
  const priceByName = {};
  const belagNames = new Set();
  const plus5Names = new Set();
  const sauceNames = new Set();

  for (const p of all) {
    const e = p.extras || {};
    for (const t of e.toppings || []) {
      priceByName[t.name] = t.price;
      if (t.name === PLUS5) plus5Names.add(t.name);
      else belagNames.add(t.name);
    }
    for (const s of e.sauces || []) {
      priceByName[s.name] = s.price;
      sauceNames.add(s.name);
    }
  }

  // создать опции
  const idByName = {};
  for (const name of new Set([...belagNames, ...plus5Names, ...sauceNames])) {
    idByName[name] = await upsertOption(options, name, priceByName[name]);
  }

  // создать группы
  const belageGroupId = belagNames.size
    ? await upsertGroup(groups, 'Zusätzliche Beläge', [...belagNames].map((n) => idByName[n]), { required: false, minSelect: 0, maxSelect: 0 }, 0)
    : null;
  const plus5GroupId = plus5Names.size
    ? await upsertGroup(groups, '+5 Stück', [...plus5Names].map((n) => idByName[n]), { required: false, minSelect: 0, maxSelect: 1 }, 1)
    : null;
  const sauceGroupId = sauceNames.size
    ? await upsertGroup(groups, 'Saucen', [...sauceNames].map((n) => idByName[n]), { required: false, minSelect: 0, maxSelect: 0 }, 2)
    : null;

  // привязать группы к товарам
  let updated = 0;
  for (const p of all) {
    const e = p.extras || {};
    const hasBelag = (e.toppings || []).some((t) => t.name !== PLUS5);
    const hasPlus5 = (e.toppings || []).some((t) => t.name === PLUS5);
    const hasSauce = (e.sauces || []).length > 0;

    const ids = [];
    if (hasBelag && belageGroupId) ids.push(belageGroupId);
    if (hasPlus5 && plus5GroupId) ids.push(plus5GroupId);
    if (hasSauce && sauceGroupId) ids.push(sauceGroupId);

    await products.updateOne({ _id: p._id }, { $set: { optionGroupIds: ids } });
    updated++;
  }

  console.log(`Опции: ${Object.keys(idByName).length}`);
  console.log(`Группы: Beläge(${belagNames.size}), +5 Stück(${plus5Names.size}), Saucen(${sauceNames.size})`);
  console.log(`Товаров привязано: ${updated}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
