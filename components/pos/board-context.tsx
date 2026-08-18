'use client';

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { usePosBoard, type PosBoard, type PosLoad } from './data';
import { playPosChime, unlockPosSound } from './sound';

/**
 * Лента терминала, общая на все экраны.
 *
 * Живёт в раскладке `/pos`, а не на странице заказов, по двум причинам, и вторая
 * важнее первой:
 *   1) экран заказов и экран приёма читают одно и то же — два своих опроса
 *      дважды спрашивали бы сервер об одном и том же каждые пять секунд;
 *   2) **сигнал о новом заказе обязан звучать на любом экране.** Повар может
 *      стоять в меню или в стоп-листе, и именно тогда заказ и придёт.
 */

interface PosBoardValue {
  state: PosLoad<PosBoard>;
  refresh: () => Promise<void>;
  skewRef: { current: number };
}

const BoardContext = createContext<PosBoardValue | null>(null);

export function PosBoardProvider({ children }: { children: ReactNode }) {
  const board = usePosBoard();
  usePosNewOrderChime(board.state);

  useEffect(() => {
    // Первое касание экрана снимает запрет браузера на звук. Слушатель одноразовый
    // и на всё окно: на киоске человек всё равно нажмёт куда-нибудь.
    const unlock = () => unlockPosSound();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  return <BoardContext.Provider value={board}>{children}</BoardContext.Provider>;
}

export function usePosBoardContext(): PosBoardValue {
  const value = useContext(BoardContext);
  if (!value) throw new Error('usePosBoardContext вне PosBoardProvider');
  return value;
}

/**
 * Звонит, когда на ленте появился НЕПРИНЯТЫЙ заказ, которого раньше не было.
 *
 * Первый ответ сервера только запоминается и не звучит: иначе перезагрузка
 * страницы и каждый перезапуск киоска устраивали бы концерт из заказов, которые
 * повар уже видел. Забытый заказ при этом не потеряется — он остаётся на экране
 * и никуда не девается.
 */
function usePosNewOrderChime(state: PosLoad<PosBoard>) {
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (state.status !== 'ready') return;
    const incoming = state.data.orders.filter((order) => order.status === 'new');

    if (seen.current === null) {
      seen.current = new Set(incoming.map((order) => order.id));
      return;
    }

    const fresh = incoming.filter((order) => !seen.current!.has(order.id));
    // Множество пересобираем по текущей ленте, а не копим вечно: принятый заказ
    // должен забыться, иначе возврат в «новые» (например, после отмены приёма)
    // пройдёт молча.
    seen.current = new Set(incoming.map((order) => order.id));
    if (fresh.length > 0) playPosChime();
  }, [state]);
}
