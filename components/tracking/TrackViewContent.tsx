'use client';

import { useEffect } from 'react';
import { trackMetaEvent } from '../../lib/analytics/meta-pixel';

/** Meta Pixel ViewContent при открытии страницы товара (монтируется в product/[id]/layout). */
export default function TrackViewContent({ productId }: { productId: string }) {
  useEffect(() => {
    if (!productId) return;
    trackMetaEvent('ViewContent', {
      content_ids: [productId],
      content_type: 'product',
    });
  }, [productId]);

  return null;
}
