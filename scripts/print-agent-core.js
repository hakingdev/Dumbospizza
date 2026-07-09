'use strict';
/**
 * Ядро принт-агента: логика одного тика polling'а + persistent-хранилище
 * напечатанных ключей. Вынесено из print-agent.js ради тестируемости —
 * все зависимости (API, принтер, хранилище, логи) инъецируются.
 *
 * Гарантия «один заказ = один чек»:
 *  1) сервер отдаёт заказ через атомарный claim (pending→printing,
 *     lib/orders/print-queue.ts) — два тика/экземпляра агента один и тот же
 *     заказ не получат;
 *  2) идемпотентный ключ: перед печатью агент проверяет persistent-хранилище
 *     (переживает рестарт). Уже напечатанный ключ → печать пропускается,
 *     подтверждение (mark-printed) повторяется. Закрывает потерянный ACK,
 *     падение агента между печатью и подтверждением и reclaim зависших заказов;
 *  3) runOnce нереентрантен: тик не стартует, пока предыдущий не завершён
 *     (печать дольше интервала polling'а не даёт наложения циклов).
 */
const fs = require('fs');
const path = require('path');

/** Стабильный идемпотентный ключ задания печати: заказ + тип чека. */
function printIdempotencyKey(orderId, receiptType = 'kitchen') {
  return `${orderId}:${receiptType}`;
}

/**
 * Persistent-хранилище напечатанных ключей (JSON-файл `key → ISO-время печати`).
 * Не in-memory: обязано переживать рестарт агента. Запись атомарная
 * (tmp + rename), чтобы падение на записи не теряло файл. Старые ключи
 * вычищаются при загрузке, чтобы файл не рос бесконечно.
 */
function createPrintedStore(filePath, opts = {}) {
  const maxAgeDays = opts.maxAgeDays || 14;
  const nowFn = opts.now || (() => new Date());

  let map = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) map = parsed;
  } catch (_) {
    map = {};
  }
  const cutoff = nowFn().getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const [key, printedAt] of Object.entries(map)) {
    const t = Date.parse(printedAt);
    if (!Number.isFinite(t) || t < cutoff) delete map[key];
  }

  function persist() {
    const tmp = filePath + '.tmp';
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(map));
    fs.renameSync(tmp, filePath);
  }

  return {
    has(key) {
      return Object.prototype.hasOwnProperty.call(map, key);
    },
    add(key) {
      map[key] = nowFn().toISOString();
      persist();
    },
    size() {
      return Object.keys(map).length;
    },
  };
}

/**
 * @param {object} deps
 * @param {() => Promise<any[]>} deps.fetchPendingOrders заказы, атомарно выданные сервером этому агенту
 * @param {(order: any) => Promise<void>} deps.printReceipt физическая печать чека
 * @param {(orderId: string) => Promise<void>} deps.markPrinted подтверждение печати (идемпотентное)
 * @param {{has(k:string):boolean, add(k:string):void}} deps.store persistent-хранилище напечатанных ключей
 * @param {string} deps.agentId идентификатор экземпляра агента (для логов сервера и агента)
 * @param {(msg: string) => void} [deps.log]
 * @param {(msg: string) => void} [deps.logError]
 * @param {(err: Error, order: any) => void} [deps.onOrderError] хук для подсказок оператору (COM-порт и т.п.)
 */
function createPrintAgent(deps) {
  const {
    fetchPendingOrders,
    printReceipt,
    markPrinted,
    store,
    agentId,
    log = (msg) => console.log(msg),
    logError = (msg) => console.error(msg),
    onOrderError,
  } = deps;

  let running = false;

  async function runOnce() {
    if (running) {
      log(`[print] decision=tick_skipped_overlap agent=${agentId}`);
      return { skipped: true, count: 0, printed: 0, confirmed: 0 };
    }
    running = true;
    try {
      const orders = await fetchPendingOrders();
      let printed = 0;
      let confirmed = 0;
      for (const order of orders) {
        const orderId = String(order._id || order.id);
        const orderNumber = String(order.orderNumber || orderId);
        const key = printIdempotencyKey(orderId);
        try {
          if (store.has(key)) {
            // Чек уже выходил из принтера (reclaim после потерянного ACK,
            // рестарт агента) → печать НЕ повторяем, только подтверждаем.
            log(
              `[print] decision=already_printed order=${orderNumber} order_id=${orderId} key=${key} agent=${agentId}`
            );
            await markPrinted(orderId);
            confirmed++;
            continue;
          }

          await printReceipt(order);
          // Ключ фиксируем сразу ПОСЛЕ печати и ДО подтверждения: если
          // mark-printed упадёт или агент умрёт — после рестарта/reclaim
          // будет повторное подтверждение, а не второй чек.
          store.add(key);
          printed++;

          await markPrinted(orderId);
          confirmed++;
          log(
            `[print] decision=printed order=${orderNumber} order_id=${orderId} key=${key} agent=${agentId}`
          );
        } catch (err) {
          logError(
            `[print] decision=error order=${orderNumber} order_id=${orderId} key=${key} agent=${agentId} error=${
              err && err.message
            }`
          );
          if (onOrderError) onOrderError(err, order);
        }
      }
      return { skipped: false, count: orders.length, printed, confirmed };
    } finally {
      running = false;
    }
  }

  return { runOnce };
}

module.exports = { createPrintAgent, createPrintedStore, printIdempotencyKey };
