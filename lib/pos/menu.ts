/**
 * Товар из базы → строка меню терминала.
 *
 * Модуль ЧИСТЫЙ: его импортирует и маршрут `/api/pos/v1/menu`, и экраны меню —
 * тип у отправителя и получателя обязан быть один, иначе переименованное поле
 * обнаружится только на кухне.
 */

import { posEuro } from './board';

/** Категория в списке: сколько позиций и сколько из них погашено. */
export interface PosMenuCategory {
  id: string;
  name: string;
  itemCount: number;
  stoppedCount: number;
}

export interface PosMenuSize {
  id: string;
  name: string;
  price: string;
  active: boolean;
}

export interface PosMenuItem {
  id: string;
  name: string;
  /** Размеры и цены одной строкой — на 360 dp таблица не помещается. */
  sub: string;
  available: boolean;
  sizes: PosMenuSize[];
}

export function toMenuSizes(product: any): PosMenuSize[] {
  return (product?.sizes ?? [])
    .filter((size: any) => size && (size.id || size.name))
    .map((size: any) => ({
      id: String(size.id ?? size.name),
      name: String(size.label || size.name || ''),
      price: posEuro(size.price),
      // active отсутствует у старых записей — там размер считается рабочим.
      active: size.active !== false,
    }));
}

export function toMenuItem(product: any): PosMenuItem {
  const sizes = toMenuSizes(product);
  return {
    id: String(product?._id ?? product?.id ?? ''),
    name: String(product?.name ?? ''),
    sub: sizes.length
      ? sizes.map((s) => `${s.name} ${s.price}`).join(' · ')
      : posEuro(product?.basePrice),
    available: product?.available !== false,
    sizes,
  };
}
