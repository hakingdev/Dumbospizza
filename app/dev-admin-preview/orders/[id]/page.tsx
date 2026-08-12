'use client';

/** Превью карточки заказа (временное, см. ../../preview-shared.tsx). */

import { PreviewPage } from '../../preview-shared';
import OrderCardPage from '../../../admin-v2/orders/[id]/page';

export default function Page() {
  return (
    <PreviewPage>
      <OrderCardPage />
    </PreviewPage>
  );
}
