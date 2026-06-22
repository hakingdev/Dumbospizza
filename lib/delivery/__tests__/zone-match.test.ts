import { describe, it, expect } from 'vitest';
import {
  selectDeliveryZone,
  haversineDistanceKm,
  roundKm,
  formatDeliveryFee,
  sortZonesForMap,
  sortZonesForList,
  matchZoneByAddress,
  zoneDistrictToken,
  type DeliveryZoneLike,
} from '../zone-match';

const namedZones: DeliveryZoneLike[] = [
  { _id: 'z', name: 'Bad Kissingen Zentrum', minOrderAmount: 20, deliveryFee: 0, maxDistance: 3 },
  { _id: 'g', name: 'Bad Kissingen Garitz', minOrderAmount: 20, deliveryFee: 2, maxDistance: 5 },
  { _id: 'e', name: 'Euerdorf', minOrderAmount: 30, deliveryFee: 2, maxDistance: 2 },
];

describe('zoneDistrictToken', () => {
  it('срезает ведущий «Bad Kissingen»', () => {
    expect(zoneDistrictToken('Bad Kissingen Garitz')).toBe('garitz');
    expect(zoneDistrictToken('Euerdorf')).toBe('euerdorf');
    expect(zoneDistrictToken('Bad Kissingen')).toBe('bad kissingen');
  });
});

describe('matchZoneByAddress — по району/Ortsteil', () => {
  it('центр Bad Kissingen без Ortsteil → Zentrum (20 €), а не далёкая зона 30 €', () => {
    const z = matchZoneByAddress({ localities: ['Bad Kissingen'], postcode: '97688' }, namedZones);
    expect(z?._id).toBe('z');
  });

  it('Ortsteil Garitz → Bad Kissingen Garitz', () => {
    const z = matchZoneByAddress({ localities: ['Garitz', 'Bad Kissingen'] }, namedZones);
    expect(z?._id).toBe('g');
  });

  it('отдельный город Euerdorf → Euerdorf', () => {
    const z = matchZoneByAddress({ localities: ['Euerdorf'] }, namedZones);
    expect(z?._id).toBe('e');
  });

  it('неизвестная локация → null (далее радиусный fallback)', () => {
    expect(matchZoneByAddress({ localities: ['Würzburg'] }, namedZones)).toBeNull();
    expect(matchZoneByAddress({ localities: [] }, namedZones)).toBeNull();
  });
});

function zone(maxDistance: number, extra: Partial<DeliveryZoneLike> = {}): DeliveryZoneLike {
  return {
    _id: extra._id ?? `z${maxDistance}`,
    name: extra.name ?? `${maxDistance} km`,
    minOrderAmount: extra.minOrderAmount ?? 10,
    deliveryFee: extra.deliveryFee ?? 0,
    maxDistance,
  };
}

const zones124 = [zone(1), zone(2), zone(4)];

describe('selectDeliveryZone', () => {
  it('0.8 km → зона 1 km', () => {
    const r = selectDeliveryZone(0.8, zones124);
    expect(r.canDeliver).toBe(true);
    expect(r.zone?.maxDistance).toBe(1);
  });

  it('1.5 km → зона 2 km (а не 4)', () => {
    expect(selectDeliveryZone(1.5, zones124).zone?.maxDistance).toBe(2);
  });

  it('3.9 km → зона 4 km', () => {
    expect(selectDeliveryZone(3.9, zones124).zone?.maxDistance).toBe(4);
  });

  it('4.1 km → вне зоны доставки', () => {
    const r = selectDeliveryZone(4.1, zones124);
    expect(r.canDeliver).toBe(false);
    expect(r.reason).toBe('outside_delivery_area');
  });

  it('граница distance == maxDistance попадает в зону', () => {
    expect(selectDeliveryZone(2, zones124).zone?.maxDistance).toBe(2);
  });

  it('нет зон → no_zone', () => {
    const r = selectDeliveryZone(1, []);
    expect(r.canDeliver).toBe(false);
    expect(r.reason).toBe('no_zone');
  });

  it('разный порядок зон не ломает выбор минимальной подходящей', () => {
    const shuffled = [zone(4), zone(1), zone(2)];
    expect(selectDeliveryZone(1.5, shuffled).zone?.maxDistance).toBe(2);
  });
});

describe('haversineDistanceKm', () => {
  it('одна и та же точка → 0', () => {
    expect(haversineDistanceKm({ lat: 50.2, lng: 10.07 }, { lat: 50.2, lng: 10.07 })).toBe(0);
  });

  it('~1.11 км на 0.01° широты', () => {
    const d = haversineDistanceKm({ lat: 50.2, lng: 10.07 }, { lat: 50.21, lng: 10.07 });
    expect(d).toBeGreaterThan(1.0);
    expect(d).toBeLessThan(1.2);
  });
});

describe('roundKm', () => {
  it('округляет до 2 знаков', () => {
    expect(roundKm(1.23456)).toBe(1.23);
    expect(roundKm(2)).toBe(2);
  });
});

describe('formatDeliveryFee', () => {
  it('0 → Kostenlos', () => {
    expect(formatDeliveryFee(0)).toBe('Kostenlos');
  });
  it('3 → 3.00 €', () => {
    expect(formatDeliveryFee(3)).toBe('3.00 €');
  });
});

describe('sortZonesForMap / sortZonesForList', () => {
  it('map: от большего радиуса к меньшему', () => {
    expect(sortZonesForMap(zones124).map((z) => z.maxDistance)).toEqual([4, 2, 1]);
  });
  it('list: от меньшего к большему', () => {
    expect(sortZonesForList([zone(4), zone(1), zone(2)]).map((z) => z.maxDistance)).toEqual([1, 2, 4]);
  });
  it('не мутируют вход', () => {
    const input = [zone(1), zone(2), zone(4)];
    sortZonesForMap(input);
    expect(input.map((z) => z.maxDistance)).toEqual([1, 2, 4]);
  });
});
