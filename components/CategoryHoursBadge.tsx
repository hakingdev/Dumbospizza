"use client";

import { useKitchenBlocks } from '../lib/contexts/KitchenBlocksContext';
import { availabilityShortBadge } from '../lib/categories/availability';

/**
 * «🕒 ab 17:00» у названия категории или подкатегории вне времени продажи
 * (бургеры утром). У подкатегории молчит, если закрыта вся категория — это
 * уже сказано у заголовка категории.
 */
export function CategoryHoursBadge({
  categoryId,
  subcategoryId,
  className = 'px-2.5 py-0.5 text-sm leading-6',
}: {
  categoryId?: string | null;
  subcategoryId?: string | null;
  /** Размер и отступы; по умолчанию — для заголовков. */
  className?: string;
}) {
  const { scheduleClosureFor } = useKitchenBlocks();
  const categoryClosed = categoryId ? scheduleClosureFor({ categoryId }) : null;
  const window = subcategoryId
    ? categoryClosed
      ? null
      : scheduleClosureFor({ subcategoryId })
    : categoryClosed;
  if (!window) return null;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full bg-amber-100 font-medium text-amber-900 ${className}`}
    >
      🕒 {availabilityShortBadge(window)}
    </span>
  );
}
