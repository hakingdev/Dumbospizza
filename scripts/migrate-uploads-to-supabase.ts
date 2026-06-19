/**
 * Перенос старых картинок с диска в Supabase Storage + перезапись путей в БД.
 *
 * Раньше изображения хранились в public/uploads и сохранялись в БД как
 * "/uploads/products/<uuid>.png". Этот скрипт берёт файлы из папки старого
 * сервера, заливает их в публичный bucket Supabase и заменяет значение в БД
 * на полный публичный URL.
 *
 * Запуск:
 *   export DATABASE_URL='postgresql://...'            # Supabase (Session pooler)
 *   export NEXT_PUBLIC_SUPABASE_URL='https://<ref>.supabase.co'
 *   export SUPABASE_SERVICE_ROLE_KEY='<service_role_key>'
 *   export OLD_PUBLIC_DIR='/путь/к/старому/public'    # папка, ВНУТРИ которой лежит uploads/
 *   npx tsx scripts/migrate-uploads-to-supabase.ts
 *
 * Идемпотентно: уже перенесённые строки (URL вместо /uploads/...) пропускаются;
 * повторная заливка существующего файла не дублирует, путь берётся как есть.
 */
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OLD_PUBLIC_DIR = process.env.OLD_PUBLIC_DIR;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

for (const [name, val] of Object.entries({
  DATABASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  OLD_PUBLIC_DIR,
})) {
  if (!val) {
    console.error(`Не задана переменная окружения: ${name}`);
    process.exit(1);
  }
}

// Таблица → колонки, в которых лежат пути к картинкам.
const TARGETS: { table: string; columns: string[] }[] = [
  { table: 'categories', columns: ['image', 'icon'] },
  { table: 'products', columns: ['image'] },
  { table: 'promotions', columns: ['image', 'banner_image', 'og_image'] },
];

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

async function main() {
  const sql = postgres(DATABASE_URL!, { prepare: false });
  const supabase = createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Убедиться, что публичный bucket существует.
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (error) {
      console.error(`Не удалось создать bucket "${BUCKET}": ${error.message}`);
      process.exit(1);
    }
    console.log(`Создан публичный bucket "${BUCKET}"`);
  }

  let uploaded = 0;
  let missing = 0;
  let skipped = 0;

  for (const { table, columns } of TARGETS) {
    for (const column of columns) {
      const rows = await sql`
        SELECT id, ${sql(column)} AS val
        FROM ${sql(table)}
        WHERE ${sql(column)} LIKE '/uploads/%'
      `;

      for (const row of rows) {
        const dbPath: string = row.val; // например "/uploads/products/x.png"
        const objectPath = dbPath.replace(/^\/uploads\//, ''); // "products/x.png"
        const localFile = path.join(OLD_PUBLIC_DIR!, dbPath);

        if (!fs.existsSync(localFile)) {
          console.warn(`  ⚠ файл не найден: ${localFile} (${table}.${column} id=${row.id})`);
          missing++;
          continue;
        }

        const ext = path.extname(localFile).slice(1).toLowerCase();
        const contentType = CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
        const buffer = fs.readFileSync(localFile);

        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(objectPath, buffer, { contentType, cacheControl: '31536000', upsert: true });

        if (upErr) {
          console.error(`  ✗ ошибка заливки ${objectPath}: ${upErr.message}`);
          continue;
        }

        const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
        const publicUrl = data.publicUrl;

        await sql`UPDATE ${sql(table)} SET ${sql(column)} = ${publicUrl} WHERE id = ${row.id}`;
        uploaded++;
        console.log(`  ✓ ${table}.${column} id=${row.id} → ${objectPath}`);
      }
    }
  }

  await sql.end();
  console.log(`\nГотово. Перенесено: ${uploaded}, файлов не найдено: ${missing}, пропущено: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
