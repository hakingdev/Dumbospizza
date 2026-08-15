import { NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { Promotion } from '../../../../../lib/models/promotion.model';
import { getSetting } from '../../../../../lib/settings';
import { toPromotionPublicView } from '../../../../../lib/promotions/serialize';
import { isPromotionEffectivelyActive } from '../../../../../lib/promotions/status';
import {
  formatMinutesAsHHmm,
  getNowMinutesInTimeZone,
  parseOrdersTimeToMinutes,
} from '../../../../../lib/order-acceptance-hours';
import { normalizeFreeDeliveryThreshold } from '../../../../../lib/delivery/delivery-fee';
import {
  WORKSHOPS,
  WORKSHOP_BLOCK_MESSAGE_KEY,
  activeWorkshopBlocks,
  buildWorkshopBlockMessage,
  readWorkshopBlocks,
} from '../../../../../lib/kitchen/workshops';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/bootstrap
 * Публичные настройки для мобильного приложения (без секретов).
 */
export async function GET() {
  try {
    await connectToDatabase();
    const s = (await getSetting<Record<string, any>>('storeSettings', {})) || {};

    const startMinutes = parseOrdersTimeToMinutes(s.ordersStartHour, 16);
    const endMinutes = parseOrdersTimeToMinutes(s.ordersEndHour, 22);
    const timeZone = (s.ordersTimeZone as string) || 'Europe/Berlin';
    const blockedUntil = s.ordersBlockedUntil ? new Date(s.ordersBlockedUntil as string) : null;
    const blockReason = (s.ordersBlockedReason as string) || 'Кухня переполнена. Попробуйте позже.';
    const beforeOpenTemplate =
      (s.ordersClosedMessageBeforeOpen as string) || 'Мы откроем в {time}';
    const afterCloseMessage =
      (s.ordersClosedMessageAfterClose as string) || 'Мы закрыты, вернемся к вам завтра.';

    const now = new Date();
    const nowMinutes = getNowMinutesInTimeZone(timeZone, now);

    const modalPromos = await Promotion.find({
      enabled: true,
      showInModal: true,
      validFrom: { $lte: now },
      validTo: { $gte: now },
      $or: [{ channel: 'all' }, { channel: 'app' }],
    })
      .sort({ priority: -1 })
      .limit(10)
      .lean();

    // Стоп по цехам не закрывает приём целиком — он режет только позиции цеха.
    const workshopBlocks = readWorkshopBlocks(s);
    const blockedWorkshops = activeWorkshopBlocks(workshopBlocks, now);

    let acceptingOrders = true;
    let ordersClosedMessage: string | null = null;

    if (blockedUntil && blockedUntil.getTime() > now.getTime()) {
      acceptingOrders = false;
      ordersClosedMessage = blockReason;
    } else if (nowMinutes < startMinutes) {
      acceptingOrders = false;
      const timeLabel = formatMinutesAsHHmm(startMinutes);
      ordersClosedMessage = beforeOpenTemplate.replace('{time}', timeLabel);
    } else if (nowMinutes >= endMinutes) {
      acceptingOrders = false;
      ordersClosedMessage = afterCloseMessage;
    }

    const data = {
      siteName: (s.siteName as string) || 'Dumbos Pizza',
      ordersStartTime: formatMinutesAsHHmm(startMinutes),
      ordersEndTime: formatMinutesAsHHmm(endMinutes),
      // Старые клиенты: только час (не точно для :30)
      ordersStartHour: Math.floor(startMinutes / 60),
      ordersEndHour: Math.floor(endMinutes / 60),
      ordersTimeZone: timeZone,
      ordersBlockedUntil: s.ordersBlockedUntil ?? null,
      ordersBlockedReason: (s.ordersBlockedReason as string) || null,
      ordersClosedMessageBeforeOpen: (s.ordersClosedMessageBeforeOpen as string) || null,
      ordersClosedMessageAfterClose: (s.ordersClosedMessageAfterClose as string) || null,
      // 0 — правило выключено, действует тариф зоны (настройка магазина).
      freeDeliveryThresholdEuro: normalizeFreeDeliveryThreshold(s.freeDeliveryThreshold),
      /** Можно ли сейчас оформить заказ (та же логика, что POST /api/orders) */
      acceptingOrders,
      /** Текст для пользователя, если acceptingOrders === false */
      ordersClosedMessage,
      /**
       * Остановленные цеха (стоп-бот): приём в целом открыт, но заказы с
       * позициями этих цехов сервер отклонит. Пусто — готовят всё.
       */
      blockedWorkshops: blockedWorkshops.map((id) => ({
        id,
        label: WORKSHOPS[id].de,
        blockedUntil: workshopBlocks[id],
      })),
      blockedWorkshopsMessage:
        blockedWorkshops.length > 0
          ? buildWorkshopBlockMessage(blockedWorkshops, {
              blocks: workshopBlocks,
              now,
              template: s[WORKSHOP_BLOCK_MESSAGE_KEY] as string,
            })
          : null,
      /** Активные акции для модального окна и бейджей в приложении */
      activePromotions: modalPromos
        .filter((p) => isPromotionEffectivelyActive(p as any, now))
        .map((p) => toPromotionPublicView(p as any)),
      promoModalDismissHours:
        typeof s.promoModalDismissHours === 'number' ? s.promoModalDismissHours : 24,
    };

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('mobile bootstrap:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
