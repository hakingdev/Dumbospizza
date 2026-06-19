import { NextRequest, NextResponse } from 'next/server';
import { STORAGE_BUCKET } from '../../../../lib/supabase/admin';

/**
 * Легаси-совместимость: раньше картинки лежали на диске и отдавались отсюда.
 * Теперь они в Supabase Storage. Любой запрос к /uploads/<path> (через rewrite
 * из next.config.js) редиректим на публичный CDN-URL Supabase с тем же путём.
 *
 * После миграции (scripts/migrate-uploads-to-supabase.ts) в БД хранятся уже
 * полные URL, поэтому этот роут — лишь подстраховка для несмигрированных ссылок.
 */
export function GET(_request: NextRequest, { params }: { params: { path: string[] } }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const segments = (params.path || []).filter((s) => s && s !== '..');

  if (!supabaseUrl || segments.length === 0) {
    return new NextResponse('Not found', { status: 404 });
  }

  const objectPath = segments.map(encodeURIComponent).join('/');
  const publicUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;

  return NextResponse.redirect(publicUrl, 308);
}
