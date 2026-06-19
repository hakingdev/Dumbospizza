import { v4 as uuidv4 } from 'uuid';
import { getSupabaseAdmin, STORAGE_BUCKET } from './supabase/admin';

/**
 * Загрузка изображений в Supabase Storage.
 *
 * Раньше файлы писались на локальный диск (public/uploads). На serverless-хостинге
 * (Vercel) файловая система read-only и эфемерная, поэтому такие файлы пропадали
 * (404). Теперь файлы кладутся в публичный bucket Supabase Storage, а в БД
 * сохраняется полный публичный CDN-URL.
 */

const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

type UploadFolder = 'products' | 'categories';

function getSafeImageExtension(mimeType?: string, fileName?: string): string {
  const normalizedMime = mimeType?.toLowerCase().split(';')[0].trim();
  if (normalizedMime) {
    const extension = IMAGE_EXTENSION_BY_MIME[normalizedMime];
    if (!extension) {
      throw new Error('Unsupported image format. Allowed formats: JPEG, PNG, WebP, GIF.');
    }
    return extension;
  }

  const extension = fileName?.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
  if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error('Unable to determine a supported image extension');
  }
  return extension === 'jpeg' ? 'jpg' : extension;
}

/**
 * Загружает буфер изображения в bucket и возвращает публичный URL.
 * @param objectPath - путь внутри bucket, например "products/<uuid>.png"
 */
async function uploadBufferToStorage(
  buffer: Buffer,
  objectPath: string,
  extension: string
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const contentType = CONTENT_TYPE_BY_EXTENSION[extension] || 'application/octet-stream';

  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(objectPath, buffer, {
    contentType,
    cacheControl: '31536000',
    upsert: false,
  });

  if (error) {
    throw new Error(`Не удалось загрузить файл в Supabase Storage: ${error.message}`);
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

/**
 * Сохранить изображение из Base64 data URI.
 * @returns Публичный URL загруженного файла.
 */
export async function saveBase64Image(base64Image: string, folder: UploadFolder): Promise<string> {
  if (!base64Image.startsWith('data:image/')) {
    throw new Error('Invalid image format. Image must be a Base64 data URI.');
  }

  const matches = base64Image.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error('Invalid Base64 string format');
  }

  const mimeType = matches[1];
  const base64Data = matches[2];
  const fileExtension = getSafeImageExtension(mimeType);
  const buffer = Buffer.from(base64Data, 'base64');
  const objectPath = `${folder}/${uuidv4()}.${fileExtension}`;

  return uploadBufferToStorage(buffer, objectPath, fileExtension);
}

/**
 * Сохранить изображение из бинарного буфера (multipart upload).
 * @returns Публичный URL загруженного файла.
 */
export async function saveBinaryImage(
  buffer: Buffer,
  mimeType: string | undefined,
  folder: UploadFolder,
  fileName?: string
): Promise<string> {
  const safeExtension = getSafeImageExtension(mimeType, fileName);
  const objectPath = `${folder}/${uuidv4()}.${safeExtension}`;

  return uploadBufferToStorage(buffer, objectPath, safeExtension);
}

/**
 * Преобразует значение из БД (полный публичный URL Supabase ИЛИ легаси-путь
 * вида "/uploads/products/x.png") в путь внутри bucket ("products/x.png").
 * Возвращает null, если значение не относится к нашему bucket.
 */
function toObjectPath(fileUrlOrPath: string): string | null {
  if (!fileUrlOrPath) return null;

  // Легаси-путь с локального диска.
  if (fileUrlOrPath.startsWith('/uploads/')) {
    return fileUrlOrPath.replace(/^\/uploads\//, '');
  }

  // Полный публичный URL Supabase: .../storage/v1/object/public/<bucket>/<objectPath>
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const idx = fileUrlOrPath.indexOf(marker);
  if (idx !== -1) {
    return fileUrlOrPath.slice(idx + marker.length);
  }

  return null;
}

/**
 * Удалить изображение из Storage. Принимает как полный публичный URL, так и
 * легаси-путь "/uploads/...". Возвращает true при успехе.
 */
export async function deleteImage(fileUrlOrPath: string): Promise<boolean> {
  try {
    const objectPath = toObjectPath(fileUrlOrPath);
    if (!objectPath) {
      console.warn(`deleteImage: путь не относится к bucket "${STORAGE_BUCKET}": ${fileUrlOrPath}`);
      return false;
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([objectPath]);
    if (error) {
      console.error('Error deleting image from Supabase Storage:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error deleting image:', error);
    return false;
  }
}
