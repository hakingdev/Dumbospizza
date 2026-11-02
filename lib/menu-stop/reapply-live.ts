/**
 * Утреннее перевыключение бессрочного стоп-листа на Lieferando — живая обвязка
 * (БД, очередь агента, Telegram). Чистая логика — в ./reapply.
 *
 * Два входа:
 *   - runIndefiniteReapply()       — крон-роут app/api/cron/menu-stop-reapply
 *                                    (ручной запуск или Vercel Cron);
 *   - maybeReapplyIndefiniteStops() — из поллинга агента (app/api/lieferando/agent GET):
 *                                    раз в день после REAPPLY_AFTER_MINUTES. Агент
 *                                    поллит 24/7, и в этот момент он заведомо жив —
 *                                    команды не зависнут в очереди. Не зависит от
 *                                    лимита Vercel Cron (на Hobby — 2 крона, оба заняты).
 *
 * Отдельный модуль, а не service.ts: service импортируется из telegram-control,
 * а здесь нужен sendControlMessage оттуда же — иначе цикл импортов.
 */
import { AGENT_OFFLINE_MS, getLieferandoState, requestLieferandoCommand } from '../lieferando-makilove';
import { sendControlMessage } from '../telegram-control';
import { reapplyIndefiniteStops, type ReapplyResult } from './reapply';
import { claimDailyReapply, markDailyReapply, reconcileIndefiniteMenuStops } from './service';

export async function runIndefiniteReapply(now: Date = new Date()): Promise<ReapplyResult> {
  const result = await reapplyIndefiniteStops({
    reconcile: () => reconcileIndefiniteMenuStops(),
    queue: (action, target) =>
      requestLieferandoCommand(action, target, new Date(), { origin: 'reapply' }),
    agentOnline: async () => {
      const seen = (await getLieferandoState()).agentSeenAt;
      return Boolean(seen) && now.getTime() - new Date(seen as string).getTime() <= AGENT_OFFLINE_MS;
    },
    send: (text) => sendControlMessage(text),
  });
  await markDailyReapply(now);
  return result;
}

/** Проверять, не пора ли, не чаще раза в минуту на инстанс (агент поллит каждые 20 с). */
const CHECK_EVERY_MS = 60_000;
let lastCheckAt = 0;

/**
 * Из поллинга агента: best-effort, ошибки только в лог — поллинг команд важнее.
 * Возвращает результат, если перевыключение запускалось, иначе null.
 */
export async function maybeReapplyIndefiniteStops(
  now: Date = new Date()
): Promise<ReapplyResult | null> {
  if (now.getTime() - lastCheckAt < CHECK_EVERY_MS) return null;
  lastCheckAt = now.getTime();
  try {
    if (!(await claimDailyReapply(now))) return null;
    const result = await runIndefiniteReapply(now);
    console.log('[menu-stop-reapply] from agent poll', result);
    return result;
  } catch (e) {
    console.error('[menu-stop-reapply] from agent poll failed', (e as Error)?.message);
    return null;
  }
}

/** Для тестов: сбросить троттлинг между прогонами. */
export function resetReapplyThrottle(): void {
  lastCheckAt = 0;
}
