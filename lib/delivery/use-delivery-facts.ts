"use client";

import { useEffect, useState } from 'react';
import { cachedJson } from '../client-cache';
import {
  formatDeliveryTimeRange,
  summarizeDeliveryZones,
  type DeliveryZoneSummary,
} from './delivery-facts';

export interface DeliveryFacts extends DeliveryZoneSummary {
  /** «30–70» из настройки магазина deliveryTime; null — не задано. */
  timeRange: string | null;
  loaded: boolean;
}

const EMPTY: DeliveryFacts = {
  timeRange: null,
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
      setFacts({
        timeRange: formatDeliveryTimeRange(settings?.settings?.deliveryTime),
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
