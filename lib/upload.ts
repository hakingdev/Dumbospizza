import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

/**
 * Helper functions for handling file uploads
 */

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function isInsideDirectory(parentDir: string, targetPath: string): boolean {
  const relativePath = path.relative(parentDir, targetPath);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

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

// Ensure upload directory exists
const createUploadDirectories = () => {
  for (const dir of [UPLOAD_DIR, path.join(UPLOAD_DIR, 'products'), path.join(UPLOAD_DIR, 'categories')]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
};

/**
 * Save a Base64 image to the file system
 * @param base64Image - Base64 string (must include data URI, e.g., "data:image/jpeg;base64,...")
 * @param folder - Subfolder within uploads directory (e.g., 'products', 'categories')
 * @returns Path to the saved file (relative to public)
 */
export async function saveBase64Image(base64Image: string, folder: 'products' | 'categories'): Promise<string> {
  try {
    // Create upload directories if they don't exist
    createUploadDirectories();
    
    // Check if the image is a valid Base64 string with data URI
    if (!base64Image.startsWith('data:image/')) {
      throw new Error('Invalid image format. Image must be a Base64 data URI.');
    }
    
    // Extract mime type and base64 data
    const matches = base64Image.match(/^data:([^;]+);base64,(.+)$/);
    
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid Base64 string format');
    }
    
    const mimeType = matches[1];
    const base64Data = matches[2];
    const fileExtension = getSafeImageExtension(mimeType);
    
    // Generate a unique filename
    const fileName = `${uuidv4()}.${fileExtension}`;
    
    // Create file path
    const relativePath = `/uploads/${folder}/${fileName}`;
    const filePath = path.join(PUBLIC_DIR, relativePath);
    
    // Save the file
    fs.writeFileSync(filePath, base64Data, { encoding: 'base64' });
    
    // Return the path relative to public directory
    return relativePath;
  } catch (error) {
    console.error('Error saving Base64 image:', error);
    throw error;
  }
}

/**
 * Save a binary image buffer to the file system
 * @param buffer - Image buffer
 * @param mimeType - MIME type (e.g., "image/jpeg")
 * @param folder - Subfolder within uploads directory (e.g., 'products', 'categories')
 * @returns Path to the saved file (relative to public)
 */
export async function saveBinaryImage(
  buffer: Buffer,
  mimeType: string | undefined,
  folder: 'products' | 'categories',
  fileName?: string
): Promise<string> {
  try {
    createUploadDirectories();

    const safeExtension = getSafeImageExtension(mimeType, fileName);
    const finalName = `${uuidv4()}.${safeExtension}`;
    const relativePath = `/uploads/${folder}/${finalName}`;
    const filePath = path.join(PUBLIC_DIR, relativePath);

    fs.writeFileSync(filePath, buffer);
    return relativePath;
  } catch (error) {
    console.error('Error saving binary image:', error);
    throw error;
  }
}

/**
 * Delete an image file from the file system
 * @param filePath - Path to the file (relative to public)
 * @returns Boolean indicating success
 */
export async function deleteImage(filePath: string): Promise<boolean> {
  try {
    // Ensure the file is within the uploads directory for security
    if (!filePath.startsWith('/uploads/')) {
      throw new Error('Invalid file path. Only files in the uploads directory can be deleted.');
    }
    
    const relativePath = filePath.replace(/^\/+/, '');
    const absolutePath = path.resolve(PUBLIC_DIR, relativePath);
    if (!isInsideDirectory(UPLOAD_DIR, absolutePath)) {
      throw new Error('Invalid file path. Only files in the uploads directory can be deleted.');
    }
    
    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      console.warn(`File not found: ${absolutePath}`);
      return false;
    }
    
    // Delete the file
    fs.unlinkSync(absolutePath);
    return true;
  } catch (error) {
    console.error('Error deleting image:', error);
    return false;
  }
}
