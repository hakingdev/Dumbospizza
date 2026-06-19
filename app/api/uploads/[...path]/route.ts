import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

function getSafePath(segments: string[]) {
  const uploadsRoot = path.resolve(process.cwd(), 'public', 'uploads');
  const requestedPath = path.resolve(uploadsRoot, ...segments);
  const relativePath = path.relative(uploadsRoot, requestedPath);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return requestedPath;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const safePath = getSafePath(params.path || []);
  if (!safePath) {
    return new Response('Invalid path', { status: 400 });
  }

  if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
    return new Response('Not found', { status: 404 });
  }

  const fileBuffer = fs.readFileSync(safePath);
  const ext = path.extname(safePath).toLowerCase();
  const contentType =
    ext === '.png' ? 'image/png' :
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
    ext === '.webp' ? 'image/webp' :
    ext === '.gif' ? 'image/gif' :
    'application/octet-stream';

  return new Response(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  });
}

