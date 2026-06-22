/**
 * Единый источник истины для телефона ресторана (fallback, пока не загрузились
 * настройки магазина). Используется в header, footer, about и т.д.
 */
export const DEFAULT_STORE_PHONE = '+49 163 2165979';

/** Преобразует отображаемый номер в корректный tel:-href (только цифры и +). */
export function phoneToTelHref(phone: string | null | undefined): string {
  return `tel:${(phone || DEFAULT_STORE_PHONE).replace(/[^\d+]/g, '')}`;
}
