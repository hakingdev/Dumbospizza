// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { DEFAULT_RETURN_TO, createTransaction, sanitizeReturnTo, statesMatch } from '../state';

describe('sanitizeReturnTo — защита от открытого редиректа', () => {
  it('пропускает относительные пути', () => {
    expect(sanitizeReturnTo('/checkout')).toBe('/checkout');
    expect(sanitizeReturnTo('/account?tab=orders')).toBe('/account?tab=orders');
  });

  it('режет абсолютные URL на чужой домен', () => {
    expect(sanitizeReturnTo('https://evil.example/phish')).toBe(DEFAULT_RETURN_TO);
    expect(sanitizeReturnTo('http://evil.example')).toBe(DEFAULT_RETURN_TO);
  });

  it('режет протокол-относительные адреса — браузер увёл бы на чужой хост', () => {
    expect(sanitizeReturnTo('//evil.example/phish')).toBe(DEFAULT_RETURN_TO);
    expect(sanitizeReturnTo('/\\evil.example')).toBe(DEFAULT_RETURN_TO);
  });

  it('режет javascript: и прочие схемы', () => {
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe(DEFAULT_RETURN_TO);
  });

  it('пустое значение даёт кабинет', () => {
    expect(sanitizeReturnTo(null)).toBe(DEFAULT_RETURN_TO);
    expect(sanitizeReturnTo(undefined)).toBe(DEFAULT_RETURN_TO);
    expect(sanitizeReturnTo('')).toBe(DEFAULT_RETURN_TO);
  });
});

describe('statesMatch — сверка CSRF-state', () => {
  it('совпадающие state проходят', () => {
    expect(statesMatch('abc123', 'abc123')).toBe(true);
  });

  it('несовпадающие не проходят', () => {
    expect(statesMatch('abc123', 'abc124')).toBe(false);
  });

  it('разная длина не роняет сравнение', () => {
    expect(statesMatch('short', 'muchlongerstate')).toBe(false);
  });

  it('отсутствующий state в URL — отказ', () => {
    expect(statesMatch(null, 'abc123')).toBe(false);
    expect(statesMatch('', 'abc123')).toBe(false);
  });
});

describe('createTransaction', () => {
  it('state и nonce случайны и не совпадают между собой', () => {
    const a = createTransaction('google', '/checkout');
    const b = createTransaction('google', '/checkout');
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.state).not.toBe(a.nonce);
  });

  it('адрес возврата санируется на входе', () => {
    expect(createTransaction('apple', 'https://evil.example').returnTo).toBe(DEFAULT_RETURN_TO);
    expect(createTransaction('apple', '/checkout').returnTo).toBe('/checkout');
  });
});
