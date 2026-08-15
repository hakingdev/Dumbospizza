// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { formatBlockTemplate, formatMinutesDe, remainingBlockMinutes } from '../kitchen/block-message';

/**
 * Подстановки в текстах о паузе приёма: те же макросы в «Сообщении при
 * перегрузке кухни» (весь приём) и в сообщении про цех.
 */

const now = new Date('2026-08-15T18:00:00.000Z'); // 20:00 Берлин
const in20 = new Date('2026-08-15T18:20:00.000Z').toISOString();

describe('remainingBlockMinutes', () => {
  it('округляет вверх, минимум 1', () => {
    expect(remainingBlockMinutes(in20, now)).toBe(20);
    expect(remainingBlockMinutes(new Date('2026-08-15T18:00:10.000Z').toISOString(), now)).toBe(1);
  });
  it('истёкший/битый срок → 0', () => {
    expect(remainingBlockMinutes('2026-08-15T17:00:00.000Z', now)).toBe(0);
    expect(remainingBlockMinutes('мусор', now)).toBe(0);
    expect(remainingBlockMinutes('', now)).toBe(0);
  });
});

describe('formatMinutesDe', () => {
  it('единственное число без «Minuten»', () => {
    expect(formatMinutesDe(1)).toBe('1 Minute');
    expect(formatMinutesDe(20)).toBe('20 Minuten');
  });
});

describe('formatBlockTemplate', () => {
  it('{minutes} подставляется со словом — «Versuchen Sie es in {minutes}.»', () => {
    expect(formatBlockTemplate('Die Küche ist überfüllt. Versuchen Sie es in {minutes}.', in20, now)).toBe(
      'Die Küche ist überfüllt. Versuchen Sie es in 20 Minuten.'
    );
  });

  it('привычное «{minutes} Minuten» не даёт «Minuten Minuten»', () => {
    expect(formatBlockTemplate('In ca. {minutes} Minuten geht es weiter.', in20, now)).toBe(
      'In ca. 20 Minuten geht es weiter.'
    );
  });

  it('@ работает как {minutes}', () => {
    expect(formatBlockTemplate('Wieder in @.', in20, now)).toBe('Wieder in 20 Minuten.');
  });

  it('{time} — во сколько снова примем (Берлин)', () => {
    expect(formatBlockTemplate('Ab {time} wieder.', in20, now)).toBe('Ab 20:20 wieder.');
  });

  it('без срока плейсхолдеры исчезают, текст остаётся читаемым', () => {
    expect(formatBlockTemplate('Die Küche ist überfüllt. Bald wieder da: {time}.', '', now)).toBe(
      'Die Küche ist überfüllt. Bald wieder da:.'
    );
  });

  it('шаблон без макросов не трогаем', () => {
    expect(formatBlockTemplate('Die Küche ist überfüllt.', in20, now)).toBe(
      'Die Küche ist überfüllt.'
    );
  });
});
