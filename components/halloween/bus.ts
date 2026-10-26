/**
 * События Halloween-слоя. Кнопки и карточки только сообщают, что случилось;
 * если режим выключен, слой не смонтирован и событие никто не слушает.
 */

export type HalloweenRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

export const HW_DRIP = 'hw:drip';
export const HW_BATS = 'hw:bats';
export const HW_FLARE = 'hw:flare';

function emit(name: string, el: Element | null | undefined): boolean {
  if (typeof window === 'undefined' || !el) return false;
  if (document.documentElement.getAttribute('data-hw-zone') !== 'night') return false;
  const r = el.getBoundingClientRect();
  const detail: HalloweenRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  window.dispatchEvent(new CustomEvent<HalloweenRect>(name, { detail }));
  return true;
}

/** Пауза перед закрытием модалки, чтобы капля успела повиснуть на кнопке. */
export const HW_DRIP_HOLD_MS = 650;

/**
 * Товар лёг в корзину — с угла кнопки стекает капля крови.
 * true — капля пошла (ночная витрина), модалке стоит чуть подождать.
 */
export function emitHalloweenDrip(button: Element | null | undefined): boolean {
  return emit(HW_DRIP, button);
}

/** Карточка вспыхнула — из неё вылетают мыши. */
export function emitHalloweenBats(card: Element | null | undefined) {
  emit(HW_BATS, card);
}

/** Телефон: тап по фото/«+» — сначала вспышка, товар открывается через эту паузу. */
export const HW_TAP_OPEN_DELAY_MS = 600;

function matches(query: string) {
  try {
    return !!window.matchMedia?.(query)?.matches;
  } catch {
    return false;
  }
}

/**
 * Телефон (без наведения мышью): поджечь карточку по тапу.
 * true — вспышка с огнём будет, открытие товара стоит отложить на HW_TAP_OPEN_DELAY_MS.
 */
export function flareHalloweenCard(card: Element | null | undefined, ms: number): boolean {
  if (typeof window === 'undefined' || !card) return false;
  if (document.documentElement.getAttribute('data-hw-zone') !== 'night') return false;
  if (matches('(hover: hover) and (pointer: fine)')) return false;
  card.dispatchEvent(new CustomEvent<number>(HW_FLARE, { detail: ms }));
  // «Уменьшить движение»: карточка просто светится — ждать нечего.
  return !matches('(prefers-reduced-motion: reduce)');
}
