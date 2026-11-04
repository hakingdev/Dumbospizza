/**
 * Ключ позиции для сопоставления имени сайта с Hub-строкой Lieferando.
 *
 * ⚠️ ТОЧНАЯ КОПИЯ `itemKey` из scripts/lieferando/core.mjs. Агент (VDS) не
 * умеет импортировать TypeScript, а сервер не может тянуть core.mjs (в нём
 * ленивый import('playwright'), которого нет в бандле Next) — поэтому две
 * копии, а их тождество сторожит тест lib/__tests__/lieferando-item-key.test.ts:
 * он сравнивает ИСХОДНИК тела функции в обоих файлах и прогоняет корпус имён.
 * Меняешь нормализацию — меняй в обоих файлах одинаково.
 *
 * Правила: без «Pizza», «(rund)», маркетингового «Neu:», веса/порции
 * («340g», «7 Stück»), слов vegetarisch/vegan, регистра, пунктуации и пробелов;
 * «Pommes Frites» ≡ «Fries». Объём напитков («0,33 L») НЕ срезается — им они
 * и различаются.
 *   «Hawaiian» ≡ «Hawaiian Pizza» ≡ «Hawaiian Pizza (rund)»;
 *   «Katz's Corner» ≡ «Katz’s Corner (rund)»; «Hot Dog Pizza» ≡ «Hotdog-Pizza».
 */
export function itemKey(name: unknown): string {
  return (
    String(name || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/^\s*neu\s*:/, ' ')
      .replace(/\(\s*rund\s*\)/g, ' ')
      .replace(/\bpizza\b/g, ' ')
      // Сайт и Hub по-разному дописывают вес/порцию и «vegetarisch»:
      // «Tiger-Drache» ↔ «Tiger-Drache 340g», «Gourmet Pizza (vegetarisch)» ↔
      // «Gourmet Pizza», «Gyoza Gemüse (7 Stück)» ↔ «Gyoza Gemüse Vegetarische
      // (7 Stück)» — всё это одна позиция. Сверка 04.11.2026: без этого 5 из
      // 117 общих позиций не находились.
      // (объём ml/l НЕ срезаем: напитки различаются именно им — 0,33 L ≠ 1,0 L)
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|st|stk|stück|pcs)\b\.?/g, ' ')
      .replace(/\b(?:vegetarische?|vegan(?:e|er|es)?)\b/g, ' ')
      .replace(/\bpommes\s+frites\b/g, 'fries')
      .replace(/[’'`´"„“”.,;:!?&+\-–—/\\()]/g, ' ')
      .replace(/\s+/g, '')
  );
}
