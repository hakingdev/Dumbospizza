import { Order } from '../models/order.model';

/**
 * Очередь печати кухонных чеков для принт-агента.
 *
 * Гарантия «один заказ = один чек» держится на трёх уровнях:
 *  1) здесь — атомарный claim: выдача заказа агенту = ОДИН UPDATE с условием на
 *     текущий статус (`WHERE kitchen_print_status='pending'`, см. mongoose-compat
 *     findOneAndUpdate → `UPDATE ... WHERE ... RETURNING`). Ноль затронутых строк =
 *     заказ уже забрал другой тик/экземпляр агента — пропускаем. Никаких
 *     read-then-write. Это же закрывает случай нескольких экземпляров агента.
 *  2) на агенте — persistent-хранилище напечатанных ключей (scripts/print-agent-core.js):
 *     повторная выдача уже напечатанного заказа (reclaim, потерянный ACK) — no-op.
 *  3) на агенте — нереентрантный тик polling'а.
 *
 * Lease: заказ в статусе 'printing' считается зависшим, если не подтверждён
 * дольше PRINT_CLAIM_LEASE_MS (агент упал между печатью и mark-printed, потерялся
 * ответ и т.п.). Lease заведомо больше максимального времени печати (печать чека
 * секунды, таймаут принтера 8 с, сетевые таймауты) — по умолчанию 10 минут.
 * Истечение lease НЕ возвращает заказ в 'pending' автоматически: он выдаётся
 * агенту повторно ЯВНЫМ reclaim'ом здесь же, атомарно и с логированием; от
 * повторной печати защищает идемпотентный ключ на агенте.
 */
const PRINT_CLAIM_LEASE_MS = Math.max(
  60_000,
  parseInt(process.env.PRINT_CLAIM_LEASE_MS || '', 10) || 10 * 60_000
);

type AnyRecord = Record<string, any>;

export interface ClaimOptions {
  /** Идентификатор агента из заголовка X-Print-Agent-Id — только для логов. */
  agentId?: string;
  /** Инъекция модели/времени/логов для тестов. */
  model?: Pick<typeof Order, 'find' | 'findOneAndUpdate'>;
  now?: () => Date;
  log?: (msg: string) => void;
  logWarn?: (msg: string) => void;
  leaseMs?: number;
}

function orderRef(candidate: AnyRecord): { id: string; num: string } {
  const id = String(candidate._id || candidate.id);
  return { id, num: String(candidate.orderNumber || id) };
}

/**
 * Атомарно выдать агенту пачку заказов на печать.
 *
 * @param baseQuery дополнительные условия выборки (гейт по оплате и т.п.) —
 *                  БЕЗ kitchenPrintStatus, статусы добавляются здесь.
 * @returns заказы, которые агент имеет право напечатать (status уже 'printing').
 */
export async function claimPendingPrintOrders(
  baseQuery: AnyRecord,
  limit: number,
  opts: ClaimOptions = {}
): Promise<any[]> {
  const model = opts.model ?? Order;
  const log = opts.log ?? ((msg: string) => console.log(msg));
  const logWarn = opts.logWarn ?? ((msg: string) => console.warn(msg));
  const agent = opts.agentId || 'unknown';
  const leaseMs = opts.leaseMs ?? PRINT_CLAIM_LEASE_MS;
  const now = opts.now ? opts.now() : new Date();

  const claimed: any[] = [];

  // 1) Свежие заказы из очереди: атомарный claim pending → printing.
  const candidates = await model
    .find({ ...baseQuery, kitchenPrintStatus: 'pending' })
    .sort({ createdAt: -1 })
    .limit(limit);

  for (const candidate of candidates) {
    const { id, num } = orderRef(candidate);
    const order = await model.findOneAndUpdate(
      { _id: id, kitchenPrintStatus: 'pending' },
      { $set: { kitchenPrintStatus: 'printing' } }
    );
    if (order) {
      claimed.push(order);
      log(`[print-queue] decision=claimed order=${num} order_id=${id} agent=${agent}`);
    } else {
      log(`[print-queue] decision=skipped_already_claimed order=${num} order_id=${id} agent=${agent}`);
    }
  }

  // 2) Явный reclaim зависших 'printing' старше lease. Условие на updatedAt
  //    входит в WHERE, а сам UPDATE обновляет updated_at ($onUpdate) — из двух
  //    конкурирующих reclaim'ов пройдёт ровно один, lease продлевается.
  if (claimed.length < limit) {
    const cutoff = new Date(now.getTime() - leaseMs);
    const stale = await model
      .find({ ...baseQuery, kitchenPrintStatus: 'printing', updatedAt: { $lte: cutoff } })
      .sort({ createdAt: -1 })
      .limit(limit - claimed.length);

    for (const candidate of stale) {
      const { id, num } = orderRef(candidate);
      const order = await model.findOneAndUpdate(
        { _id: id, kitchenPrintStatus: 'printing', updatedAt: { $lte: cutoff } },
        { $set: { kitchenPrintStatus: 'printing' } }
      );
      if (order) {
        claimed.push(order);
        logWarn(
          `[print-queue] decision=reclaimed_stale order=${num} order_id=${id} agent=${agent} ` +
            `lease_ms=${leaseMs} (заказ висел в printing без подтверждения — выдан повторно; ` +
            `дубль печати блокирует идемпотентный ключ на агенте)`
        );
      } else {
        log(`[print-queue] decision=skipped_reclaim_race order=${num} order_id=${id} agent=${agent}`);
      }
    }
  }

  return claimed;
}

/**
 * Подтверждение печати от агента — идемпотентно по заказу: повторный вызов на
 * уже подтверждённом заказе просто ещё раз выставляет тот же терминальный статус.
 * Один атомарный UPDATE вместо прежнего findById + save (read-then-write).
 */
export async function confirmPrintResult(
  orderId: string,
  printed: boolean,
  opts: ClaimOptions = {}
): Promise<any | null> {
  const model = (opts.model as any) ?? Order;
  const log = opts.log ?? ((msg: string) => console.log(msg));
  const agent = opts.agentId || 'unknown';
  const status = printed ? 'completed' : 'failed';

  const order = await model.findOneAndUpdate(
    { _id: orderId },
    { $set: { kitchenPrintStatus: status } }
  );
  if (order) {
    const { num } = orderRef(order);
    log(
      `[print-queue] decision=${printed ? 'confirmed_printed' : 'confirmed_failed'} ` +
        `order=${num} order_id=${orderId} agent=${agent}`
    );
  }
  return order;
}
