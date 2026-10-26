/**
 * Halloween-режим витрины: один флаг `halloweenMode` в storeSettings.
 *
 * Флаг глобальный (шапка, подвал, логотип), а «ночная» зона с эффектами —
 * только витринные страницы: главная, меню, категории, товар. Чекаут,
 * кабинет, юр. страницы и прочие разделы остаются спокойными.
 */

export function isHalloweenMode(storeSettings: Record<string, any> | null | undefined): boolean {
  // Локальная проверка без записи в боевые настройки: HALLOWEEN_FORCE=on|off в .env.local.
  if (process.env.NODE_ENV === 'development' && process.env.HALLOWEEN_FORCE) {
    return process.env.HALLOWEEN_FORCE === 'on';
  }
  return storeSettings?.halloweenMode === true;
}

const NIGHT_PATH = /^\/(?:$|menu\/?$|category\/[^/]+\/?$|product\/[^/]+\/?$)/;

export function isHalloweenNightPath(pathname: string | null | undefined): boolean {
  return NIGHT_PATH.test(pathname || '');
}

/**
 * Ставит data-hw-zone на <html> до первой отрисовки: страницы витрины
 * пререндерятся статически, путь на сервере layout не знает.
 */
export function halloweenZoneScript(): string {
  return `(function(){try{if(${NIGHT_PATH.toString()}.test(location.pathname)){document.documentElement.setAttribute('data-hw-zone','night')}}catch(e){}})();`;
}
