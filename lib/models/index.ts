/**
 * Раньше здесь было подключение к MongoDB через mongoose. Теперь БД — Postgres
 * (Supabase) через Drizzle; пул соединений создаётся лениво в lib/db/client.ts.
 *
 * connectToDatabase оставлен как no-op для совместимости: десятки роутов вызывают
 * `await connectToDatabase()` в начале — менять их все не нужно.
 */
import db from '../db/client';

export async function connectToDatabase() {
  return db;
}

export default connectToDatabase;
