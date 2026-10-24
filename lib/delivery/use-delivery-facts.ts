"use client";

import { useEffect, useState } from 'react';
import { cachedJson } from '../client-cache';
import {
  formatDeliveryTimeRange,
  parseDeliveryTimeRange,
  summarizeDeliveryZones,
  type DeliveryZoneSummary,
} from './delivery-facts';

export interface DeliveryFacts extends DeliveryZoneSummary {
  /** «30–70» из настройки магазина deliveryTime; null — не задано. */
  timeRange: string | null;
  /** Та же настройка в минутах — для окна «zwischen 18:40 und 19:20». */
  timeRangeMinutes: { from: number; to: number } | null;
  /** Адрес ресторана (для самовывоза) из настроек магазина. */
  storeAddress: string | null;
  loaded: boolean;
}

const EMPTY: DeliveryFacts = {
  timeRange: null,
  timeRangeMinutes: null,
  storeAddress: null,
  freeUpToKm: null,
  minOrderFrom: null,
  paidFeeFrom: null,
  loaded: false,
};

/**
 * Время доставки и условия зон для текстов витрины. Пока данные не пришли,
 * loaded=false — обещание не показываем вовсе, а не показываем устаревшее.
 */
export function useDeliveryFacts(): DeliveryFacts {
  const [facts, setFacts] = useState<DeliveryFacts>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      cachedJson<any>('/api/settings/store').catch(() => null),
      cachedJson<any>('/api/delivery-zones').catch(() => null),
    ]).then(([settings, zones]) => {
      if (cancelled) return;
      const address = String(settings?.settings?.address ?? '').trim();
      setFacts({
        timeRange: formatDeliveryTimeRange(settings?.settings?.deliveryTime),
        timeRangeMinutes: parseDeliveryTimeRange(settings?.settings?.deliveryTime),
        storeAddress: address || null,
        ...summarizeDeliveryZones(Array.isArray(zones?.zones) ? zones.zones : []),
        loaded: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return facts;
}
