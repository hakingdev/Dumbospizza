/**
 * Одноразовая миграция размеров под новую модель (Lieferando-style):
 *  - priceModifier (надбавка) -> price (абсолютная цена) = basePrice + priceModifier
 *  - создаёт библиотеку SizeVariation из уникальных размеров и связывает variationId
 *  - basePrice товара = минимальная цена среди размеров
 *
 * Идемпотентно: повторный запуск не задвоит библиотеку и не сломает уже сконвертированные цены.
 *
 * Запуск:  MONGODB_URI=mongodb://127.0.0.1:27017/dumbospizza node scripts/migrate-sizes.js
 */
const mongoose = require('mongoose');

const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dumbospizza';

async function main() {
  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  const products = db.collection('products');
  const sizevariations = db.collection('sizevariations');

  const all = await products.find({ 'sizes.0': { $exists: true } }).toArray();

  // 1) собрать уникальные размеры в порядке появления
  const order = [];
  for (const p of all) {
    for (const s of p.sizes || []) {
      if (s.name && !order.includes(s.name)) order.push(s.name);
    }
  }

  // 2) создать/найти записи библиотеки
  const nameToId = {};
  for (let i = 0; i < order.length; i++) {
    const name = order[i];
    const existing = await sizevariations.findOne({ name });
    if (existing) {
      nameToId[name] = existing._id.toString();
    } else {
      const res = await sizevariations.insertOne({
        name,
        label: '',
        order: i,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      nameToId[name] = res.insertedId.toString();
    }
  }

  // 3) сконвертировать размеры товаров
  let updated = 0;
  for (const p of all) {
    const base = Number(p.basePrice) || 0;
    const newSizes = (p.sizes || []).map((s) => {
      const price =
        s.price != null && s.price !== undefined
          ? Number(s.price)
          : Math.round((base + (Number(s.priceModifier) || 0)) * 100) / 100;
      return {
        id: s.id || nameToId[s.name],
        variationId: nameToId[s.name],
        name: s.name,
        label: s.label || '',
        price,
        // legacy
        size: s.size || s.name,
        priceModifier: Number(s.priceModifier) || 0
      };
    });
    const newBase = newSizes.length ? Math.min(...newSizes.map((x) => x.price)) : base;
    await products.updateOne({ _id: p._id }, { $set: { sizes: newSizes, basePrice: newBase } });
    updated++;
  }

  console.log(`Библиотека размеров: ${order.length} (${order.join(', ')})`);
  console.log(`Товаров сконвертировано: ${updated}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
