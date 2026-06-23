import { describe, expect, it } from 'vitest';
import { dedupKey, planDelivery, type QueueCandidate } from '../whatsapp-delivery';

const placedText =
  'Vielen Dank für Ihre Bestellung!\n\nIhre Bestellung 260623010 wurde erfolgreich aufgegeben.';

describe('planDelivery', () => {
  it('collapses duplicate rows for the same order to a single delivery', () => {
    const candidates: QueueCandidate[] = [
      { id: 'a', phone: '+4912345', text: placedText, orderId: '260623010' },
      { id: 'b', phone: '+4912345', text: placedText, orderId: '260623010' },
    ];

    const { toClaim, toSkip } = planDelivery(candidates, new Set());

    expect(toClaim).toEqual(['a']); // oldest wins
    expect(toSkip).toEqual(['b']);
  });

  it('does not re-deliver a message already sent / in-flight for the order', () => {
    const candidates: QueueCandidate[] = [
      { id: 'a', phone: '+4912345', text: placedText, orderId: '260623010' },
    ];
    const occupied = new Set([dedupKey(candidates[0])]);

    const { toClaim, toSkip } = planDelivery(candidates, occupied);

    expect(toClaim).toEqual([]);
    expect(toSkip).toEqual(['a']);
  });

  it('keeps distinct messages (different order / different text)', () => {
    const candidates: QueueCandidate[] = [
      { id: 'a', phone: '+4912345', text: placedText, orderId: '260623010' },
      { id: 'b', phone: '+4999999', text: 'Ihre Bestellung 260623011 ist unterwegs.', orderId: '260623011' },
    ];

    const { toClaim, toSkip } = planDelivery(candidates, new Set());

    expect(toClaim).toEqual(['a', 'b']);
    expect(toSkip).toEqual([]);
  });

  it('falls back to phone+text key when orderId is missing', () => {
    const candidates: QueueCandidate[] = [
      { id: 'a', phone: '+4912345', text: 'Promo', orderId: null },
      { id: 'b', phone: '+4912345', text: 'Promo', orderId: null },
      { id: 'c', phone: '+4900000', text: 'Promo', orderId: null },
    ];

    const { toClaim, toSkip } = planDelivery(candidates, new Set());

    expect(toClaim).toEqual(['a', 'c']);
    expect(toSkip).toEqual(['b']);
  });
});
