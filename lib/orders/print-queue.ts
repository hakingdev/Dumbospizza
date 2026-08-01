import { Order } from '../models/order.model';
import { PENDING_PAYMENT_STATUS } from './payment-draft';

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
 *
 * @param seq номер задания печати, который агент реально отработал. Если задан,
 *   UPDATE идёт с условием на kitchenPrintSeq: пока агент печатал, оператор мог
 *   нажать «Напечатать ещё раз» (seq++ и статус → 'pending') — устаревшее
 *   подтверждение НЕ должно затирать этот запрос обратно в 'completed'.
 *   Агенты старых версий seq не присылают → поведение прежнее (без условия).
 */
export async function confirmPrintResult(
  orderId: string,
  printed: boolean,
  opts: ClaimOptions & { seq?: number } = {}
): Promise<any | null> {
  const model = (opts.model as any) ?? Order;
  const log = opts.log ?? ((msg: string) => console.log(msg));
  const agent = opts.agentId || 'unknown';
  const status = printed ? 'completed' : 'failed';
  const guardSeq = Number.isFinite(opts.seq as number);

  const filter: AnyRecord = { _id: orderId };
  if (guardSeq) filter.kitchenPrintSeq = opts.seq;

  const order = await model.findOneAndUpdate(filter, { $set: { kitchenPrintStatus: status } });
  if (order) {
    const { num } = orderRef(order);
    log(
      `[print-queue] decision=${printed ? 'confirmed_printed' : 'confirmed_failed'} ` +
        `order=${num} order_id=${orderId} agent=${agent} seq=${guardSeq ? opts.seq : '-'}`
    );
  } else if (guardSeq) {
    log(
      `[print-queue] decision=confirm_ignored_stale_seq order_id=${orderId} agent=${agent} ` +
        `seq=${opts.seq} (за время печати запросили Nachdruck — заказ остаётся в очереди)`
    );
  }
  return order;
}

/**
 * Запрос повторной печати кухонного чека («Напечатать ещё раз» в админке).
 *
 * Возврата в очередь одним лишь статусом НЕ хватает: у агента есть persistent-
 * хранилище напечатанных ключей, и уже напечатанный заказ он пропустит, просто
 * повторив подтверждение. Поэтому вместе со статусом инкрементим kitchenPrintSeq —
 * ключ задания становится другим, и агент печатает чек как новое задание
 * (см. scripts/print-agent-core.js).
 *
 * Один атомарный UPDATE: из двух одновременных нажатий обе поднимут seq, но
 * заказ всё равно уйдёт в печать ровно один раз за тик claim'а.
 *
 * @returns null, если заказа нет или он не печатаемый (драфт/неоплаченный онлайн).
 */
export async function requestKitchenReprint(
  orderId: string,
  opts: ClaimOptions & { requestedBy?: string } = {}
): Promise<any | null> {
  const model = (opts.model as any) ?? Order;
  const log = opts.log ?? ((msg: string) => console.log(msg));
  const by = opts.requestedBy || 'unknown';

  const order = await model.findOneAndUpdate(
    {
      _id: orderId,
      // Те же условия, по которым заказ вообще может попасть к агенту
      // (см. GET /api/orders): драфты и неоплаченный онлайн в печать не идут —
      // иначе заказ навсегда завис бы в 'pending'.
      status: { $ne: PENDING_PAYMENT_STATUS },
      $or: [{ paymentMethod: { $ne: 'online' } }, { paymentStatus: 'completed' }],
    },
    {
      $set: { kitchenPrintStatus: 'pending' },
      $inc: { kitchenPrintSeq: 1 },
    }
  );

  if (order) {
    const { num } = orderRef(order);
    log(
      `[print-queue] decision=reprint_requested order=${num} order_id=${orderId} ` +
        `seq=${order.kitchenPrintSeq} by=${by}`
    );
  } else {
    log(`[print-queue] decision=reprint_rejected order_id=${orderId} by=${by}`);
  }
  return order;
}
