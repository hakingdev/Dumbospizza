/**
 * Безопасный доступ к Web Storage.
 *
 * На iOS обращение к localStorage/sessionStorage может БРОСИТЬ исключение,
 * а не просто вернуть null:
 *   • Safari/Chrome iOS с «Alle Cookies blockieren» — SecurityError на само
 *     чтение свойства `window.localStorage`, ещё до getItem/setItem;
 *   • приватный режим и переполненная квота — QuotaExceededError на setItem.
 *
 * Любой такой бросок внутри useEffect всплывает наверх, React размонтирует всё
 * дерево, и посетитель получает «Application error: a client-side exception».
 * Именно так главная падала на телефоне, оставаясь рабочей на десктопе.
 *
 * Поэтому ВЕСЬ доступ к storage идёт только через эти хелперы: storage — это
 * кэш, его недоступность не должна ронять страницу. Не пишите
 * `localStorage.*` напрямую в компонентах.
 */

type StorageKind = 'local' | 'session';

/** Само обращение к свойству уже может бросить — поэтому внутри try. */
function area(kind: StorageKind): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function storageGet(key: string, kind: StorageKind = 'local'): string | null {
  const store = area(kind);
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/** @returns true, если значение действительно записано. */
export function storageSet(key: string, value: string, kind: StorageKind = 'local'): boolean {
  const store = area(kind);
  if (!store) return false;
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(key: string, kind: StorageKind = 'local'): void {
  const store = area(kind);
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // storage недоступен — терять нечего
  }
}
