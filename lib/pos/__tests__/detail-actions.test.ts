import { describe, it, expect } from 'vitest';
import {
  POS_CONFIRM_SHEET,
  POS_DETAIL_VIEW,
  posActionIntent,
} from '../detail-actions';
import type { PosBoardStatus } from '../board';

/**
 * Регресс заказа #260820002: касание при выходе с экрана деталей попало в
 * «Ist unterwegs», и гость получил «unterwegs» через 8 секунд после приёма.
 * Правило: всё, что немедленно уведомляет гостя, из панели действий одним
 * касанием недостижимо.
 */
describe('действия экрана деталей', () => {
  const statuses = Object.keys(POS_DETAIL_VIEW) as PosBoardStatus[];

  it('перевод в «Unterwegs» требует подтверждения (инцидент #260820002)', () => {
    const unterwegs = POS_DETAIL_VIEW.preparing.actions.find((a) => a.next === 'delivering');
    expect(unterwegs).toBeDefined();
    expect(posActionIntent(unterwegs!)).toEqual({ kind: 'confirm', next: 'delivering' });
  });

  it('отмена требует подтверждения на каждом экране, где она есть', () => {
    for (const status of statuses) {
      for (const action of POS_DETAIL_VIEW[status].actions) {
        if (action.next !== 'cancelled') continue;
        expect(posActionIntent(action)).toEqual({ kind: 'confirm', next: 'cancelled' });
      }
    }
  });

  it('у каждого подтверждаемого действия есть текст шторки', () => {
    // Действие с confirm без текста открыло бы пустую шторку — а молча снять
    // подтверждение нельзя, это и был инцидент.
    for (const status of statuses) {
      for (const action of POS_DETAIL_VIEW[status].actions) {
        const intent = posActionIntent(action);
        if (intent.kind !== 'confirm') continue;
        expect(POS_CONFIRM_SHEET[intent.next], `${status}: ${action.label}`).toBeDefined();
      }
    }
  });

  it('кнопки выхода и приёма не несут статуса — «назад» не трогает заказ', () => {
    for (const status of statuses) {
      for (const action of POS_DETAIL_VIEW[status].actions) {
        const intent = posActionIntent(action);
        if (intent.kind === 'exit' || intent.kind === 'accept-flow') {
          expect(action.next, `${status}: ${action.label}`).toBeUndefined();
        }
      }
    }
  });
});
