/**
 * Утреннее перевыключение бессрочного стоп-листа на Lieferando — ЧИСТАЯ часть.
 *
 * Partner Hub каждое утро сам возвращает в продажу всё, что выключили
 * переключателем доступности («bis zum Ende des Tages»), и отменить это
 * переключателем нельзя. Поэтому бессрочно выключенное ботом (lib/menu-stop,
 * записи с `until: null`) надо выключать там заново каждое утро до открытия:
 * крон app/api/cron/menu-stop-reapply ставит агенту команды off (размер —
 * по одной команде на размер, позиции — одной командой со всеми именами) и
 * шлёт в группу одну сводку. Сами отчёты агента по этим командам при успехе
 * молчат (origin='reapply', см. lieferandoReportWanted) — иначе каждое утро
 * группа получала бы по сообщению на команду.
 *
 * Зависимости инжектятся (БД, очередь, Telegram) — модуль тестируется vitest'ом.
 */
import type { LieferandoMenuTarget, MenuStopNamed } from './state';

export interface ReapplyDeps {
  /** Бессрочные записи, сверенные с живыми флагами (service.reconcileIndefiniteMenuStops). */
  reconcile: () => PromiseLike<{ sizes: MenuStopNamed[]; products: MenuStopNamed[] }>;
  /** Команда агенту Lieferando (lib/lieferando-makilove.requestLieferandoCommand, origin='reapply'). */
  queue: (action: 'off', target: LieferandoMenuTarget) => PromiseLike<unknown>;
  /** Жив ли агент (heartbeat свежее AGENT_OFFLINE_MS) — для предупреждения в сводке. */
  agentOnline: () => PromiseLike<boolean>;
  /** Сообщение в группу стоп-бота. */
  send: (text: string) => PromiseLike<unknown>;
  log?: (...args: any[]) => void;
}

export interface ReapplyResult {
  sizes: string[];
  products: string[];
  /** сколько команд поставлено агенту */
  queued: number;
  /** сколько команд поставить не удалось (сбой очереди) */
  failed: number;
  agentOnline: boolean;
  /** сводка отправлена в группу */
  notified: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Текст утренней сводки в группу (parse_mode HTML). */
export function formatReapplySummary(r: Omit<ReapplyResult, 'notified'>): string {
  const lines = ['⛔ <b>Бессрочно выключено</b> — перевыключаю на Lieferando (Hub включил всё с утра):'];
  if (r.sizes.length) lines.push(`🍕 Размеры: ${r.sizes.map(esc).join(', ')}`);
  if (r.products.length) lines.push(`📋 Позиции: ${r.products.map(esc).join(', ')}`);
  lines.push('');
  if (r.failed) {
    lines.push(`⚠️ Не удалось поставить команд агенту: ${r.failed} — проверьте очередь Lieferando.`);
  }
  lines.push(
    r.agentOnline
      ? 'Агент выполнит в фоне; отдельное сообщение придёт только если что-то не выключилось.'
      : '⚠️ Агент Lieferando не на связи — команды ждут в очереди, проверьте VDS.'
  );
  lines.push('Включить обратно — кнопкой в боте (🍕 Размеры / 📋 Позиции) или в админке.');
  return lines.join('\n');
}

/**
 * Перевыключить бессрочный стоп-лист: сверить записи с флагами, поставить
 * команды агенту, прислать сводку. Пустой стоп-лист — тишина (ни команд, ни
 * сообщения). Сбой одной команды не отменяет остальные — считается в failed.
 */
export async function reapplyIndefiniteStops(deps: ReapplyDeps): Promise<ReapplyResult> {
  const log = deps.log || ((...a: any[]) => console.log('[menu-stop-reapply]', ...a));
  const { sizes, products } = await deps.reconcile();
  const result: ReapplyResult = {
    sizes: sizes.map((s) => s.name),
    products: products.map((p) => p.name),
    queued: 0,
    failed: 0,
    agentOnline: true,
    notified: false,
  };
  if (!sizes.length && !products.length) return result;

  const queue = async (target: LieferandoMenuTarget) => {
    try {
      await deps.queue('off', target);
      result.queued += 1;
    } catch (e) {
      result.failed += 1;
      log('queue failed', target, (e as Error)?.message);
    }
  };
  for (const size of sizes) await queue({ kind: 'size', label: size.name });
  if (products.length) await queue({ kind: 'item', names: products.map((p) => p.name) });

  try {
    result.agentOnline = await deps.agentOnline();
  } catch (e) {
    log('agentOnline failed', (e as Error)?.message);
  }

  try {
    await deps.send(formatReapplySummary(result));
    result.notified = true;
  } catch (e) {
    log('send failed', (e as Error)?.message);
  }
  return result;
}
