import { NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { getSetting, getMewsPosEnabled } from '../../../../lib/settings';
import { getCategories } from '../../../../lib/db/utils';
import { fetchMewsPosCategories } from '../../../../lib/mews-pos/sync';
import { getCategoryHours } from '../../../../lib/categories/category-hours';
import { Product } from '../../../../lib/models/product.model';
import { readSizeVariationStates } from '../../../../lib/size-variation-sync';
import { normalizedSizeName } from '../../../../lib/size-variation-state';
import {
  DEFAULT_WORKSHOP_BLOCK_MESSAGE,
  WORKSHOPS,
  WORKSHOP_BLOCK_MESSAGE_KEY,
  WORKSHOP_IDS,
  activeWorkshopBlocks,
  buildWorkshopBlockMessage,
  classifyWorkshop,
  isBlockActive,
  readWorkshopBlocks,
  withGlobalBlock,
  type WorkshopId,
} from '../../../../lib/kitchen/workshops';

export const dynamic = 'force-dynamic';

/**
 * GET /api/kitchen/blocks — какие цеха сейчас остановлены (стоп-бот/админка).
 *
 * Публичный и без секретов: корзина на клиенте знает только categoryId позиции,
 * поэтому сервер отдаёт СПИСОК категорий остановленных цехов — классификация
 * (lib/kitchen/workshops.ts) остаётся в одном месте и по именам категорий.
 * Шаблон сообщения (админка) отдаём тоже: текст про «через N минут» чекаут
 * собирает сам — только для тех цехов, чьи позиции реально лежат в корзине.
 * Сюда же — окна категорий по графику: витрина опрашивает этот адрес раз в
 * минуту, так серые бургеры «оживают» в 17:00 без перезагрузки.
 * И стоп-лист позиций/размеров (стоп-бот, админка, POS): id снятых с продажи
 * товаров и ключи выключенных размеров библиотеки — корзина живёт в браузере
 * сутки, и строку, выключенную ПОСЛЕ её добавления, иначе отклонит только сервер.
 */
export async function GET() {
  try {
    await connectToDatabase();
    const settings = (await getSetting<Record<string, any>>('storeSettings', {})) || {};
    const now = new Date();

    const blocks = readWorkshopBlocks(settings);
    const blockedWorkshops = activeWorkshopBlocks(blocks, now);

    // Стоп-лист: все available=false (не только из бота) + неактивные размеры
    // библиотеки (тот же 60-секундный кэш, что и гидрация товаров).
    const [soldOutProducts, sizeVariations] = await Promise.all([
      Product.find({ available: false }).select('available').lean(),
      readSizeVariationStates(),
    ]);
    const soldOutProductIds = (soldOutProducts as any[]).map((product) => String(product._id));
    const inactiveSizeKeys = Array.from(
      new Set(
        sizeVariations
          .filter((variation) => variation.active === false)
          .map((variation) => normalizedSizeName(variation.name))
          .filter(Boolean)
      )
    );
    const template = settings[WORKSHOP_BLOCK_MESSAGE_KEY] || DEFAULT_WORKSHOP_BLOCK_MESSAGE;

    /** categoryId → остановленный цех, которому она принадлежит. */
    const blockedCategories: Record<string, WorkshopId> = {};
    if (blockedWorkshops.length > 0) {
      // Источник категорий тот же, что у /api/categories (локальная БД или Mews).
      const categories = (await getMewsPosEnabled())
        ? await fetchMewsPosCategories()
        : await getCategories({});
      const stopped = new Set<WorkshopId>(blockedWorkshops);
      for (const category of categories as any[]) {
        const workshop = classifyWorkshop({ category: category?.name });
        if (workshop && stopped.has(workshop)) {
          blockedCategories[String(category._id)] = workshop;
        }
      }
    }

    return NextResponse.json(
      {
        success: true,
        /** Глобальный стоп приёма (сильнее цехов) */
        ordersBlockedUntil: isBlockActive(settings.ordersBlockedUntil, now)
          ? settings.ordersBlockedUntil
          : null,
        /** Цех → до какого времени стоит ('' — работает) */
        blocks: WORKSHOP_IDS.reduce<Record<string, string>>((acc, id) => {
          acc[id] = isBlockActive(blocks[id], now) ? blocks[id] : '';
          return acc;
        }, {}),
        labels: WORKSHOP_IDS.reduce<Record<string, string>>((acc, id) => {
          acc[id] = WORKSHOPS[id].de;
          return acc;
        }, {}),
        blockedWorkshops,
        blockedCategories,
        messageTemplate: template,
        /**
         * Время продажи категорий/подкатегорий (бургеры 17–22): окна с графиком,
         * open — можно ли заказать СЕЙЧАС (по часам сервера, с часами ресторана).
         */
        categoryHours: await getCategoryHours(),
        /** Товары с available=false — корзина/чекаут помечают такие строки. */
        soldOutProductIds,
        /** Ключи (normalizedSizeName) размеров библиотеки с active=false. */
        inactiveSizeKeys,
        message:
          blockedWorkshops.length > 0
            ? buildWorkshopBlockMessage(blockedWorkshops, {
                // Срок с учётом глобального стопа — он сильнее цехов.
                blocks: withGlobalBlock(blocks, settings.ordersBlockedUntil),
                now,
                template,
              })
            : null,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    console.error('Error reading kitchen blocks:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
