/**
 * Активные зоны доставки из БД (с автосидом при пустой таблице).
 * Общий код для `/api/delivery/check-zone` и `/api/delivery/analyze-address`.
 */

import { connectToDatabase } from '../models';
import { DeliveryZone } from '../models/delivery-zone.model';
import { deliveryZones as seedZones } from '../seed-products';

export async function loadActiveDeliveryZones(): Promise<any[]> {
  await connectToDatabase();
  let zones = await DeliveryZone.find({ active: true }).sort({ sortOrder: 1, name: 1 });
  if (zones.length === 0 && seedZones.length > 0) {
    const docs = seedZones.map((zone, index) => ({
      name: zone.name,
      minOrderAmount: zone.minOrderAmount,
      deliveryFee: zone.deliveryFee || 0,
      maxDistance: zone.maxDistance || 0,
      active: true,
      sortOrder: index,
    }));
    await DeliveryZone.insertMany(docs);
    zones = await DeliveryZone.find({ active: true }).sort({ sortOrder: 1, name: 1 });
  }
  return zones;
}
