import { describe, it, expect, afterEach, vi } from 'vitest';
import { storageGet, storageSet, storageRemove } from '../safe-storage';

/**
 * Диагноз, ради которого написан хелпер: на iOS доступ к Web Storage не просто
 * возвращает null, а БРОСАЕТ. Бросок внутри useEffect размонтирует всё дерево
 * React — витрина превращается в «Application error» на телефоне, оставаясь
 * рабочей на десктопе.
 */

const originalLocal = Object.getOwnPropertyDescriptor(window, 'localStorage');
const originalSession = Object.getOwnPropertyDescriptor(window, 'sessionStorage');

/** Safari/Chrome iOS с «Alle Cookies blockieren»: бросает само чтение свойства. */
function blockStorageAccess(kind: 'localStorage' | 'sessionStorage') {
  Object.defineProperty(window, kind, {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
}

/** Приватный режим / переполненная квота: свойство есть, но setItem бросает. */
function fillQuota(kind: 'localStorage' | 'sessionStorage') {
  Object.defineProperty(window, kind, {
    configurable: true,
    value: {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(() => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      }),
      removeItem: vi.fn(() => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      }),
    },
  });
}

afterEach(() => {
  if (originalLocal) Object.defineProperty(window, 'localStorage', originalLocal);
  if (originalSession) Object.defineProperty(window, 'sessionStorage', originalSession);
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('safe-storage', () => {
  it('читает и пишет, когда storage доступен', () => {
    expect(storageSet('pizza-cart', '{"items":[]}')).toBe(true);
    expect(storageGet('pizza-cart')).toBe('{"items":[]}');

    storageRemove('pizza-cart');
    expect(storageGet('pizza-cart')).toBeNull();
  });

  it('различает local и session', () => {
    storageSet('order:1:token', 'abc', 'session');

    expect(storageGet('order:1:token', 'session')).toBe('abc');
    expect(storageGet('order:1:token', 'local')).toBeNull();
  });

  it('отдаёт null вместо броска, когда cookies заблокированы', () => {
    blockStorageAccess('localStorage');

    expect(() => storageGet('pizza-cart')).not.toThrow();
    expect(storageGet('pizza-cart')).toBeNull();
  });

  it('возвращает false вместо броска, когда запись запрещена', () => {
    blockStorageAccess('localStorage');

    expect(() => storageSet('pizza-cart', 'x')).not.toThrow();
    expect(storageSet('pizza-cart', 'x')).toBe(false);
  });

  it('переживает переполненную квоту на setItem (приватный режим iOS)', () => {
    fillQuota('localStorage');

    expect(() => storageSet('pizza-cart', 'x')).not.toThrow();
    expect(storageSet('pizza-cart', 'x')).toBe(false);
  });

  it('не бросает при removeItem на недоступном storage', () => {
    fillQuota('sessionStorage');

    expect(() => storageRemove('order:1:token', 'session')).not.toThrow();
  });
});
