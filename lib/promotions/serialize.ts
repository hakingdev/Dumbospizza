import type { PromotionDocument } from '../models/promotion.model';
import type { PromotionPublicView } from './types';
import { getPromotionLifecycle, defaultBadgeForType } from './status';
import { formatHappyHourLabel, formatWeekdayScheduleLabel } from './schedule';

export function toPromotionPublicView(doc: PromotionDocument): PromotionPublicView {
  return {
    id: String(doc._id),
    slug: doc.slug,
    name: doc.name,
    description: doc.description,
    type: doc.type,
    lifecycle: getPromotionLifecycle(doc),
    validFrom: doc.validFrom.toISOString(),
    validTo: doc.validTo.toISOString(),
    image: doc.image,
    bannerImage: doc.bannerImage,
    badgeText:
      doc.badgeText ||
      defaultBadgeForType(doc.type, {
        percentValue: doc.percentValue,
        fixedValue: doc.fixedValue,
        bogoMode: doc.bogoMode,
      }),
    percentValue: doc.percentValue,
    fixedValue: doc.fixedValue,
    minOrderAmount: doc.minOrderAmount,
    bogoMode: doc.bogoMode,
    scope: doc.scope,
    targetProductIds: (doc.targetProductIds || []).map(String),
    targetCategoryIds: (doc.targetCategoryIds || []).map(String),
    targetItems: (doc.targetItems || []).map((i: any) => ({
      productId: String(i.productId),
      sizeName: i.sizeName || '',
    })),
    rewardItems: (doc.rewardItems || []).map((i: any) => ({
      productId: String(i.productId),
      sizeName: i.sizeName || '',
    })),
    seoTitle: doc.seoTitle,
    seoDescription: doc.seoDescription,
    showInModal: doc.showInModal,
    showOnOffersPage: doc.showOnOffersPage,
    weekdayScheduleEnabled: doc.weekdayScheduleEnabled,
    happyHourEnabled: doc.happyHourEnabled,
    activeDaysOfWeek: doc.activeDaysOfWeek,
    activeTimeStart: doc.activeTimeStart,
    activeTimeEnd: doc.activeTimeEnd,
    scheduleTimeZone: doc.scheduleTimeZone,
    weekdayLabel: formatWeekdayScheduleLabel(doc),
    scheduleLabel: doc.happyHourEnabled ? formatHappyHourLabel(doc) : undefined,
  };
}

export function toPromotionAdminView(doc: PromotionDocument) {
  return {
    ...toPromotionPublicView(doc),
    internalName: doc.internalName,
    enabled: doc.enabled,
    gratisTrigger: doc.gratisTrigger,
    giftProductId: doc.giftProductId ? String(doc.giftProductId) : undefined,
    giftProductName: doc.giftProductName,
    giftProductIds: (doc.giftProductIds?.length
      ? doc.giftProductIds
      : doc.giftProductId
        ? [doc.giftProductId]
        : []
    ).map(String),
    audience: doc.audience,
    channel: doc.channel,
    priority: doc.priority,
    usageCount: doc.usageCount,
    viewCount: doc.viewCount,
    modalOpenCount: doc.modalOpenCount,
    clickCount: doc.clickCount,
    orderCount: doc.orderCount,
    revenueTotal: doc.revenueTotal,
    promoCode: doc.promoCode,
    ogImage: doc.ogImage,
    autoNotifyOnStart: doc.autoNotifyOnStart,
    lastAutoNotifyAt: doc.lastAutoNotifyAt?.toISOString(),
    emailCampaignEnabled: doc.emailCampaignEnabled,
    emailSubject: doc.emailSubject,
    emailBodyHtml: doc.emailBodyHtml,
    emailSentAt: doc.emailSentAt?.toISOString(),
    emailSentCount: doc.emailSentCount,
    pushCampaignEnabled: doc.pushCampaignEnabled,
    pushTitle: doc.pushTitle,
    pushBody: doc.pushBody,
    pushSentAt: doc.pushSentAt?.toISOString(),
    pushSentCount: doc.pushSentCount,
  };
}
