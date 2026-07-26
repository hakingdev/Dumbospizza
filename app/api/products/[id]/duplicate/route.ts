import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { Product } from '../../../../../lib/models/product.model';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../../../lib/auth';
import { toRefId } from '../../../../../lib/normalize-id';

async function isAuthorized() {
  const session = await getServerSession(authOptions);
  return isStaff(session);
}

/**
 * POST /api/products/[id]/duplicate — копия товара для правки «как новый».
 *
 * Копия создаётся СКРЫТОЙ (available: false), чтобы дубль не появился в меню
 * до того, как его отредактируют. Идентификаторы Mews не копируются: они
 * привязаны к конкретной позиции в POS, дубль с тем же mewsProductId ломал бы
 * синхронизацию. Размеры получают свежие id, ссылки на общие справочники
 * (variationId, optionGroupIds) сохраняются — они переиспользуемые.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!await isAuthorized()) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const source = await Product.findById(params.id);

    if (!source) {
      return NextResponse.json({ success: false, error: 'Product not found' }, { status: 404 });
    }

    const plain = typeof source.toObject === 'function' ? source.toObject() : { ...source };
    const {
      _id,
      id,
      createdAt,
      updatedAt,
      mewsProductId,
      mewsProductTypeId,
      mewsSku,
      mewsProductVariantIds,
      mewsModifierSetIds,
      ...rest
    } = plain;

    const copy = new Product({
      ...rest,
      name: `${plain.name} (Kopie)`,
      category: toRefId(plain.category) || plain.category,
      available: false,
      featured: false,
      sizes: Array.isArray(plain.sizes)
        ? plain.sizes.map((size: any) => ({ ...size, id: size.variationId || size.id }))
        : [],
    });
    await copy.save();

    return NextResponse.json({ success: true, product: copy }, { status: 201 });
  } catch (error: any) {
    console.error('Error duplicating product:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
