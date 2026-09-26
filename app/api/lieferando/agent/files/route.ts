import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Самообновление агента Lieferando (scripts/lieferando/agent.mjs).
 *
 * GET            — манифест: { version, files: { имя: { hash, bytes } } };
 * GET ?file=имя  — содержимое файла (text/plain) + X-File-Hash для сверки.
 *
 * Агент сравнивает хэши манифеста со своими локальными файлами, скачивает
 * изменившиеся, прогоняет node --check и перезапускается (start-agent.bat).
 * Файлы попадают в serverless-бандл через outputFileTracingIncludes
 * в next.config.js — без этого readFileSync на Vercel их не найдёт.
 *
 * Auth: тот же X-Lieferando-Agent-Key, что и у соседнего route агента.
 */

export const dynamic = 'force-dynamic';

const AGENT_FILES = ['agent.mjs', 'core.mjs', 'toggle.mjs'] as const;
const AGENT_DIR = path.join(process.cwd(), 'scripts', 'lieferando');

function authorized(request: NextRequest): boolean {
  const secret = (
    process.env.LIEFERANDO_AGENT_SECRET ||
    process.env.PRINT_AGENT_SECRET ||
    ''
  ).trim();
  if (!secret) return false;
  return request.headers.get('X-Lieferando-Agent-Key') === secret;
}

/** Единая схема хэша (и здесь, и в агенте): sha256 от байтов, первые 12 hex. */
const hash12 = (data: Buffer | string) =>
  crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const name = request.nextUrl.searchParams.get('file');
    if (name) {
      if (!(AGENT_FILES as readonly string[]).includes(name)) {
        return NextResponse.json({ success: false, error: 'Unknown file' }, { status: 400 });
      }
      const content = fs.readFileSync(path.join(AGENT_DIR, name));
      return new NextResponse(content, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-File-Hash': hash12(content),
        },
      });
    }

    const files: Record<string, { hash: string; bytes: number }> = {};
    for (const f of AGENT_FILES) {
      const content = fs.readFileSync(path.join(AGENT_DIR, f));
      files[f] = { hash: hash12(content), bytes: content.length };
    }
    const version = hash12(AGENT_FILES.map((f) => `${f}:${files[f].hash}`).join('\n'));
    return NextResponse.json({ success: true, version, files });
  } catch (error) {
    console.error('[lieferando-agent-files] GET failed:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
