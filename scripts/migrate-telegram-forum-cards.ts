/**
 * Разовая миграция на режим форума: разложить АКТИВНЫЕ заказы по темам и
 * заполнить order_cards.
 *
 * Что делает:
 *   - берёт заказы в работе (new / preparing / ready_for_delivery / delivering),
 *     у которых ещё нет карточки в order_cards;
 *   - отправляет карточку в тему текущего статуса и запоминает её;
 *   - удаляет старое сообщение заказа (orders.telegram_message_id), чтобы в
 *     ленте не осталось дубля с неактуальными кнопками.
 *
 * Чего НЕ делает: не трогает completed/cancelled и драфты pending_payment —
 * закрытые заказы остаются в истории группы как есть.
 *
 * По умолчанию берутся заказы за последние 2 суток. Это не перестраховка: в
 * базе висят заказы месячной давности со статусом `new` — их просто забыли
 * закрыть, и переносить их в тему «Готовится» значит превратить её в свалку.
 * `--days=0` снимает ограничение (осознанно, если реально нужно всё).
 *
 * Запуск (сначала ОБЯЗАТЕЛЬНО --dry-run):
 *   npx tsx scripts/migrate-telegram-forum-cards.ts --dry-run
 *   npx tsx scripts/migrate-telegram-forum-cards.ts
 *   npx tsx scripts/migrate-telegram-forum-cards.ts --days=7 --limit=10 --keep-old
 *
 * Требования: применена миграция 0015 (scripts/apply-order-cards-migration.mjs),
 * созданы темы (scripts/telegram-topics.mjs create) и включён telegramForumEnabled.
 * Темп отправки держит общая очередь (~1 действие в секунду).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

/** Статусы, которые считаем «в работе» — только их и переносим. */
const ACTIVE_STATUSES = ['new', 'preparing', 'ready_for_delivery', 'delivering'];

function loadEnvLocal() {
  for (const file of ['.env.local', '.env']) {
    try {
      const txt = readFileSync(resolve(process.cwd(), file), 'utf8');
      for (const line of txt.split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !process.env[m[1]]) {
          process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
        }
      }
    } catch {
      /* файла может не быть */
    }
  }
}

async function main() {
  loadEnvLocal();

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const keepOld = args.includes('--keep-old');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 100;
  const daysArg = args.find((a) => a.startsWith('--days='));
  const days = daysArg ? Number(daysArg.split('=')[1]) : 2;

  const { getForumConfig, CARD_STATUS_LABELS, cardStatusForOrderStatus } = await import(
    '../lib/telegram/forum'
  );
  const { createOrderCard } = await import('../lib/telegram/card-mover');
  const { getOrderCardStore } = await import('../lib/telegram/card-store');
  const { callBotApi, isDeleteMissingError } = await import('../lib/telegram/bot-api');
  const { toCardOrderInput } = await import('../lib/telegram');
  const { Order } = await import('../lib/models/order.model');

  const config = await getForumConfig();
  if (!config) {
    console.error(
      'Режим форума не настроен: включи telegramForumEnabled и задай id тем ' +
        '(node scripts/telegram-topics.mjs check).'
    );
    process.exit(1);
  }

  console.log('Темы:', config.topics);
  console.log(`Режим: ${dryRun ? 'DRY-RUN (ничего не отправляем)' : 'боевой'}\n`);

  // Забытые заказы (статус так и остался 'new' недельной давности) — не рабочая
  // очередь, а мусор в БД. В темы они попадать не должны.
  const query: Record<string, any> = { status: { $in: ACTIVE_STATUSES } };
  if (days > 0) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    query.createdAt = { $gte: cutoff };
    console.log(`Окно: заказы за последние ${days} сут (с ${cutoff.toLocaleString('ru-RU')})`);
  } else {
    console.log('Окно: без ограничения по дате (--days=0)');
  }

  const orders = await Order.find(query).sort({ createdAt: 1 }).limit(limit);

  console.log(`Подходящих заказов: ${orders.length}\n`);

  const store = getOrderCardStore();
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const order of orders) {
    const orderId = String(order._id ?? order.id);
    const target = cardStatusForOrderStatus(order.status);
    if (!target) {
      skipped++;
      continue;
    }

    const existing = await store.getByOrderId(orderId);
    if (existing) {
      console.log(`— #${order.orderNumber}: карточка уже есть (тема ${existing.topicId})`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(
        `→ #${order.orderNumber}: ${order.status} → ${CARD_STATUS_LABELS[target]} (тема ${config.topics[target]})`
      );
      created++;
      continue;
    }

    const result = await createOrderCard(toCardOrderInput(order), target, { config });
    if (!result) {
      console.error(`✗ #${order.orderNumber}: карточку отправить не удалось`);
      failed++;
      continue;
    }

    console.log(
      `✓ #${order.orderNumber}: ${CARD_STATUS_LABELS[target]} → message_id=${result.messageId}`
    );
    created++;

    // Старое сообщение (одно на весь чат) больше не актуально: у него кнопки
    // прошлого формата. Удаление best-effort — Telegram не даёт удалять
    // сообщения старше 48 часов, и это не повод останавливать миграцию.
    const oldMessageId = order.telegramMessageId;
    if (!keepOld && oldMessageId && oldMessageId !== result.messageId) {
      try {
        await callBotApi(config.botToken, 'deleteMessage', {
          chat_id: config.chatId,
          message_id: oldMessageId,
        });
        console.log(`  старое сообщение ${oldMessageId} удалено`);
      } catch (e) {
        const why = isDeleteMissingError(e) ? 'уже отсутствует' : (e as Error).message;
        console.log(`  старое сообщение ${oldMessageId} не удалено: ${why}`);
      }
    }
  }

  console.log(`\nИтого: создано ${created}, пропущено ${skipped}, ошибок ${failed}`);
  if (dryRun) console.log('Это был dry-run — перезапусти без --dry-run, чтобы применить.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('ОШИБКА:', e);
  process.exit(1);
});
