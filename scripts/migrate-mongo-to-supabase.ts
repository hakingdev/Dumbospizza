/**
 * Перенос данных из локальной MongoDB в Supabase/Postgres (Drizzle).
 *
 * Запуск:
 *   export DATABASE_URL='postgresql://...'    # Supabase Session/direct
 *   export MONGODB_URI='mongodb://127.0.0.1:27017/dumbospizza'
 *   npx tsx scripts/migrate-mongo-to-supabase.ts
 *
 * Идемпотентно: вставка с onConflictDoNothing по id. Перезапуск не дублирует.
 * ObjectId → hex-строка (тот же _id), вложенные доки → jsonb, __v отбрасывается.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getTableColumns, type Table } from 'drizzle-orm';
import * as schema from '../lib/db/schema';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dumbospizza';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL не задан');
  process.exit(1);
}

// Mongo-коллекция → Drizzle-таблица
const MAP: { collection: string; table: Table }[] = [
  { collection: 'categories', table: schema.categories },
  { collection: 'products', table: schema.products },
  { collection: 'options', table: schema.options },
  { collection: 'optiongroups', table: schema.optionGroups },
  { collection: 'sizevariations', table: schema.sizeVariations },
  { collection: 'deliveryzones', table: schema.deliveryZones },
  { collection: 'coupons', table: schema.coupons },
  { collection: 'promotions', table: schema.promotions },
  { collection: 'promotioncampaignlogs', table: schema.promotionCampaignLogs },
  { collection: 'users', table: schema.users },
  { collection: 'loyaltyprograms', table: schema.loyaltyPrograms },
  { collection: 'pushdevices', table: schema.pushDevices },
  { collection: 'settings', table: schema.settings },
  { collection: 'orders', table: schema.orders },
  { collection: 'preorders', table: schema.preOrders },
  { collection: 'whatsappqueues', table: schema.whatsappQueue },
];

/** Рекурсивно: ObjectId → hex-строка, Date сохраняем, остальное проходит насквозь. */
function convert(v: any): any {
  if (v === null || v === undefined) return v;
  if (v instanceof ObjectId || (v && typeof v.toHexString === 'function')) return v.toHexString();
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v.map(convert);
  if (typeof v === 'object') {
    const out: any = {};
    for (const k of Object.keys(v)) out[k] = convert(v[k]);
    return out;
  }
  return v;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

async function main() {
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const mdb = mongo.db();

  const sql = postgres(DATABASE_URL!, { prepare: false });
  const db = drizzle(sql, { schema });

  console.log('Перенос Mongo → Supabase\n');
  let grandTotal = 0;

  for (const { collection, table } of MAP) {
    const columns = getTableColumns(table);
    const allowed = new Set(Object.keys(columns));
    const docs = await mdb.collection(collection).find({}).toArray();

    if (docs.length === 0) {
      console.log(`  ${collection.padEnd(22)} → 0 (пусто)`);
      continue;
    }

    const rows = docs.map((doc: any) => {
      const converted = convert(doc);
      const row: any = {};
      // _id → id
      if (converted._id !== undefined) row.id = converted._id;
      for (const key of Object.keys(converted)) {
        if (key === '_id' || key === '__v') continue;
        if (!allowed.has(key)) continue; // отбрасываем поля без колонки
        const val = converted[key];
        if (val === null || val === undefined) continue; // пусть сработает DEFAULT
        row[key] = val;
      }
      return row;
    });

    let inserted = 0;
    for (const part of chunk(rows, 500)) {
      const res = await db
        .insert(table)
        .values(part)
        .onConflictDoNothing({ target: (table as any).id })
        .returning({ id: (table as any).id });
      inserted += res.length;
    }
    grandTotal += inserted;
    const skipped = rows.length - inserted;
    console.log(
      `  ${collection.padEnd(22)} → ${inserted} вставлено${skipped ? `, ${skipped} пропущено (уже есть)` : ''}`
    );
  }

  console.log(`\nИтого вставлено строк: ${grandTotal}`);
  await sql.end();
  await mongo.close();
}

main().catch((e) => {
  console.error('\nОШИБКА:', e);
  process.exit(1);
});
