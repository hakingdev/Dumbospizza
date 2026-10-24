/**
 * Подстановка {name} в строку перевода. Своя, а не интерполяция i18next:
 * до загрузки переводов компоненты используют заглушку t(key, fallback),
 * которая вернула бы объект опций вместо строки. Синтаксис {name} — как в
 * шаблонах стоп-сообщений (formatBlockTemplate).
 */
export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    vars[key] == null ? match : String(vars[key])
  );
}
