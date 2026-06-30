/**
 * Защита React от падений при включённом авто-переводчике браузера
 * (Google Translate / Chrome «Перевести страницу»).
 *
 * Переводчик оборачивает текстовые узлы в <font>-теги и подменяет их прямо в DOM.
 * При следующем ре-рендере React вызывает removeChild/insertBefore на узлах, которых
 * уже нет на ожидаемом месте, и кидает NotFoundError → «ошибка на стороне клиента».
 * Следствие — мигание/перескоки модалок акций (Angebote) и гратиса.
 *
 * Решение (рекомендация из facebook/react#11538): делаем removeChild/insertBefore
 * терпимыми к «чужому» родителю — вместо исключения молча возвращаем узел.
 * Патч ставится один раз, до первой реконсиляции (импортируется в клиентском
 * Providers, код модуля выполняется при импорте на клиенте).
 *
 * ВАЖНО для insertBefore: если опорный узел уже «уехал» (переводчик переместил его),
 * мы НЕ дописываем newNode в конец родителя. Дозапись в конец меняет ПОРЯДОК соседних
 * элементов, из-за чего сопоставление React fiber↔DOM сбивается, и клик по одной кнопке
 * срабатывает как клик по другой ссылке на странице (баг: CTA «Jetzt bestellen» в блоке
 * Gratis-Artikel уводил на страницу вина /category/wein вместо главной/меню).
 * Каноничный безопасный вариант — вернуть newNode без вставки: краш предотвращён,
 * порядок узлов не нарушен, а React сам выправит поддерево на следующем рендере.
 */

declare global {
  // eslint-disable-next-line no-var
  var __gtCompatPatched: boolean | undefined;
}

if (typeof window !== 'undefined' && !window.__gtCompatPatched) {
  window.__gtCompatPatched = true;

  if (typeof Node === 'function' && Node.prototype) {
    const originalRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
      if (child.parentNode !== this) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('[gt-compat] removeChild: узел не принадлежит этому родителю — пропуск', child);
        }
        return child;
      }
      return originalRemoveChild.call(this, child) as T;
    };

    const originalInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function <T extends Node>(
      this: Node,
      newNode: T,
      referenceNode: Node | null
    ): T {
      if (referenceNode && referenceNode.parentNode !== this) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('[gt-compat] insertBefore: опорный узел из другого родителя — пропуск вставки (без перестановки)', referenceNode);
        }
        // НЕ дописываем в конец (иначе ломается порядок и привязка кликов).
        return newNode;
      }
      return originalInsertBefore.call(this, newNode, referenceNode) as T;
    };
  }
}

export {};
