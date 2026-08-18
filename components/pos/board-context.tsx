'use client';

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { usePosBoard, type PosBoard, type PosLoad } from './data';
import { playPosChime, stopPosChime, unlockPosSound } from './sound';

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

/** Как часто напоминать о непринятом заказе. */
const CHIME_REPEAT_MS = 10_000;

/**
 * Звонит, пока заказ не приняли.
 *
 * Одного сигнала на приход мало: в шуме кухни его пропускают, а непринятый заказ
 * — это гость, который ждёт ответа и не знает, услышали ли его. Поэтому звонок
 * повторяется каждые десять секунд, пока на ленте есть заказ в статусе «новый»,
 * и замолкает ровно тогда, когда ему назначили время и приняли.
 *
 * Заодно звонит и на первый ответ сервера — в отличие от прежнего поведения.
 * Раньше первая выборка только запоминалась, чтобы перезапуск киоска не устраивал
 * концерт; теперь молчать нельзя: если прибор перезагрузился, а заказ так и висит
 * непринятым, тишина означала бы, что о нём никто не узнает.
 */
function usePosNewOrderChime(state: PosLoad<PosBoard>) {
  const seen = useRef<Set<string>>(new Set());

  const pending =
    state.status === 'ready' ? state.data.orders.filter((order) => order.status === 'new') : [];
  const pendingIds = pending.map((order) => order.id).join(',');
  const hasPending = pending.length > 0;

  // Приход нового заказа — звонок немедленно, не дожидаясь очередного повтора.
  useEffect(() => {
    if (state.status !== 'ready') return;
    const ids = pendingIds ? pendingIds.split(',') : [];
    const fresh = ids.filter((id) => !seen.current.has(id));
    // Множество пересобираем по текущей ленте: принятый заказ должен забыться,
    // иначе его возврат в «новые» пройдёт молча.
    seen.current = new Set(ids);
    if (fresh.length > 0) playPosChime();
  }, [pendingIds, state.status]);

  // Напоминание, пока не приняли.
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(playPosChime, CHIME_REPEAT_MS);
    return () => {
      clearInterval(timer);
      // Заказ приняли — обрываем звук, не дожидаясь конца рингтона. Выбранный
      // на приборе звук может тянуться полминуты, и звонок поверх уже принятого
      // заказа учит не обращать на него внимания.
      stopPosChime();
    };
  }, [hasPending]);
}
