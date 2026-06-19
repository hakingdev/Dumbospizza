import { NextRequest, NextResponse } from 'next/server';
import { saveBase64Image, deleteImage, saveBinaryImage } from '../../../../lib/upload';
import { isStaff } from '../../../../lib/auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';

// POST /api/admin/upload - Upload an image file
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Unauthorized access' 
      }, { status: 401 });
    }

    const contentType = request.headers.get('content-type') || '';
    let imagePath = '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      const folder = formData.get('folder');

      if (!file || typeof folder !== 'string' || !['products', 'categories'].includes(folder)) {
        return NextResponse.json({
          success: false,
          error: 'Invalid request. Required fields: file, folder (products or categories)'
        }, { status: 400 });
      }

      const hasArrayBuffer = file && typeof (file as any).arrayBuffer === 'function';
      if (!hasArrayBuffer) {
        return NextResponse.json({ success: false, error: 'Invalid file' }, { status: 400 });
      }

      const arrayBuffer = await (file as any).arrayBuffer();
      imagePath = await saveBinaryImage(
        Buffer.from(arrayBuffer),
        (file as any).type,
        folder as 'products' | 'categories',
        (file as any).name
      );
    } else {
      const data = await request.json();
      const { image, folder } = data;

      if (!image || !folder || !['products', 'categories'].includes(folder)) {
        return NextResponse.json({
          success: false,
          error: 'Invalid request. Required fields: image, folder (products or categories)'
        }, { status: 400 });
      }

      imagePath = await saveBase64Image(image, folder as 'products' | 'categories');
    }
    
    return NextResponse.json({
      success: true,
      path: imagePath
    });
  } catch (error: any) {
    console.error('Error uploading image:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

// DELETE /api/admin/upload - Delete an image file
export async function DELETE(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Unauthorized access' 
      }, { status: 401 });
    }

    // Get the image path from query parameters
    const { searchParams } = request.nextUrl;
    const path = searchParams.get('path');
    
    if (!path) {
      return NextResponse.json({
        success: false,
        error: 'Image path is required'
      }, { status: 400 });
    }
    
    // Delete the image
    const deleted = await deleteImage(path);
    
    if (!deleted) {
      return NextResponse.json({
        success: false,
        error: 'Image could not be deleted or does not exist'
      }, { status: 404 });
    }
    
    return NextResponse.json({
      success: true,
      message: 'Image deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting image:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
