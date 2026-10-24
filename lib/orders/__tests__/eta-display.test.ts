import { describe, it, expect } from 'vitest';
import { resolveOrderEta } from '../eta-display';

const createdAt = '2026-10-24T16:00:00Z'; // 18:00 в Бад-Киссингене (MESZ)

describe('resolveOrderEta', () => {
  it('Wunschzeit гостя важнее всего', () => {
    expect(resolveOrderEta({ desiredDeliveryTime: '19:30', createdAt }, { from: 30, to: 70 })).toEqual({
      kind: 'desired',
      time: '19:30',
    });
  });

  it('время кухни считается от etaSetAt', () => {
    expect(
      resolveOrderEta({ etaMinutes: 45, etaSetAt: '2026-10-24T16:05:00Z', createdAt }, { from: 30, to: 70 })
    ).toEqual({ kind: 'kitchen', time: '18:50' });
  });

  it('иначе окно из настройки магазина от момента заказа', () => {
    expect(resolveOrderEta({ createdAt }, { from: 30, to: 70 })).toEqual({
      kind: 'window',
      from: '18:30',
      to: '19:10',
    });
  });

  it('без данных — null (оставляем общий текст)', () => {
    expect(resolveOrderEta({}, null)).toBeNull();
  });
});
