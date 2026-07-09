// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { canTransition, mapCaptureStatus } from '../status';

describe('canTransition — переходы только вперёд (ТЗ §5)', () => {
  it('нормальный жизненный цикл', () => {
    expect(canTransition('created', 'approved')).toBe(true);
    expect(canTransition('created', 'captured')).toBe(true);
    expect(canTransition('approved', 'captured')).toBe(true);
    expect(canTransition('captured', 'partially_refunded')).toBe(true);
    expect(canTransition('captured', 'refunded')).toBe(true);
    expect(canTransition('partially_refunded', 'refunded')).toBe(true);
    expect(canTransition('captured', 'reversed')).toBe(true);
  });

  it('откаты запрещены', () => {
    expect(canTransition('captured', 'created')).toBe(false);
    expect(canTransition('captured', 'approved')).toBe(false);
    expect(canTransition('approved', 'created')).toBe(false);
    expect(canTransition('refunded', 'captured')).toBe(false);
    expect(canTransition('failed', 'captured')).toBe(false);
    expect(canTransition('reversed', 'captured')).toBe(false);
  });

  it('тот же статус — не переход (идемпотентный no-op)', () => {
    expect(canTransition('captured', 'captured')).toBe(false);
    expect(canTransition('created', 'created')).toBe(false);
  });

  it('терминальные статусы никуда не переходят', () => {
    for (const from of ['refunded', 'failed', 'cancelled', 'reversed'] as const) {
      for (const to of ['created', 'approved', 'captured', 'refunded'] as const) {
        if (from === to) continue;
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });
});

describe('mapCaptureStatus — статусы PayPal → внутренние', () => {
  it('маппинг', () => {
    expect(mapCaptureStatus('COMPLETED')).toBe('captured');
    expect(mapCaptureStatus('PENDING')).toBe('approved');
    expect(mapCaptureStatus('DECLINED')).toBe('failed');
    expect(mapCaptureStatus('FAILED')).toBe('failed');
    expect(mapCaptureStatus('REFUNDED')).toBe('refunded');
    expect(mapCaptureStatus('PARTIALLY_REFUNDED')).toBe('partially_refunded');
    expect(mapCaptureStatus('SOMETHING_NEW')).toBeNull();
  });
});
