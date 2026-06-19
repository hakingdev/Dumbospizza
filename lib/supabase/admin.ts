/**
 * Серверный клиент Supabase с service_role ключом — для операций, недоступных
 * анонимному клиенту (загрузка/удаление в Storage). НИКОГДА не импортировать в
 * клиентский код: service_role даёт полный доступ в обход RLS.
 *
 * Клиент создаётся лениво и кэшируется, чтобы не пересоздавать его на каждый запрос
 * (и чтобы импорт модуля не падал на этапе билда, когда переменные ещё не заданы).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (!cached) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY должны быть заданы для работы с Supabase Storage'
      );
    }
    cached = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/** Имя bucket'а в Supabase Storage (публичный). Можно переопределить через env. */
export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';
