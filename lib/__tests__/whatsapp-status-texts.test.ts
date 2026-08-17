// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveStatusTexts } from '../whatsapp';

/**
 * Тексты статуса, которые уходят гостю в WhatsApp. Подпись (label) — это
 * переменная {{2}} утверждённого шаблона Twilio, то есть ровно то, что человек
 * прочитает. Ошибка здесь видна не в логах, а у клиента в телефоне.
 *
 * Ключевое различие: у самовывоза нет «unterwegs» — гость приходит сам.
 */
describe('resolveStatusTexts', () => {
  it('доставка: «уехал к гостю» на переходе в тему «Доставка»', () => {
    const { label, message } = resolveStatusTexts('ready_for_delivery', 'delivery', '260817005');
    expect(label).toBe('Unterwegs');
    expect(message).toBe('Ihre Bestellung 260817005 ist unterwegs.');
  });

  it('самовывоз: тот же статус — «можно забирать», без «unterwegs»', () => {
    const { label, message } = resolveStatusTexts('ready_for_delivery', 'pickup', '260817006');
    expect(label).toBe('Abholbereit');
    expect(message).toContain('abgeholt werden');
    expect(message).not.toContain('unterwegs');
  });

  it('закрытие заказа: доставка — «fertig», самовывоз — «abgeholt»', () => {
    expect(resolveStatusTexts('completed', 'delivery').label).toBe('Fertig');
    expect(resolveStatusTexts('completed', 'pickup').label).toBe('Abgeholt');
  });

  it('«в пути» у самовывоза не превращается в «unterwegs»', () => {
    // Статус delivering достижим из админки и для самовывоза — гость всё равно
    // не должен получить, что заказ «в пути».
    expect(resolveStatusTexts('delivering', 'pickup').label).toBe('Abholbereit');
    expect(resolveStatusTexts('delivering', 'delivery').label).toBe('Unterwegs');
  });

  it('остальные статусы одинаковы для обоих типов', () => {
    for (const type of ['delivery', 'pickup']) {
      expect(resolveStatusTexts('preparing', type).label).toBe('Wird vorbereitet');
      expect(resolveStatusTexts('cancelled', type).label).toBe('Storniert');
    }
  });

  it('неизвестный статус не роняет отправку', () => {
    const { label, message } = resolveStatusTexts('bogus', 'delivery', '123');
    expect(label).toBe('bogus');
    expect(message).toBe('Ihre Bestellung 123: bogus');
  });

  it('тип заказа не задан → трактуем как доставку', () => {
    expect(resolveStatusTexts('ready_for_delivery').label).toBe('Unterwegs');
  });
});
