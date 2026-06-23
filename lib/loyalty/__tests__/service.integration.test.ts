// @vitest-environment node
//
// Интеграционные тесты бонусного сервиса ПРОТИВ РЕАЛЬНОЙ БД (Supabase).
//
// Зачем: чистые unit-тесты (config.test.ts) проверяют математику, но НЕ проверяют
// атомарность списания, идемпотентность и реальные SQL-транзакции. Эти тесты
// гоняют функции earn/redeem/reverse/expire на живом Postgres и проверяют, что
// баланс меняется корректно и нельзя списать больше, чем есть.
//
// Безопасность: всё пишется под одного временного пользователя со случайным
// телефоном и удаляется в afterAll. Тест ВЫКЛЮЧЕН по умолчанию (не трогает прод
// на обычном `npm test`); включается флагом:  RUN_DB_TESTS=1 npx vitest run ...
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { genObjectId } from '../../db/object-id';
import { users, orders, loyaltyPrograms, loyaltyTransactions } from '../../db/schema';

// db-клиент (lib/db/client.ts) фиксирует process.env.DATABASE_URL на этапе импорта,
// поэтому переменную надо выставить ДО его загрузки. Статический import захватил бы
// её слишком рано (ESM поднимает импорты) → db-клиент и сервис грузим динамически
// в beforeAll, уже после установки DATABASE_URL.
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return;
  for (const f of ['.env.local', '.env']) {
    try {
      const txt = readFileSync(resolve(process.cwd(), f), 'utf8');
      const line = txt.split('\n').find((l) => l.trim().startsWith('DATABASE_URL='));
      if (line) {
        process.env.DATABASE_URL = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
        return;
      }
    } catch {
      /* нет файла — пропускаем */
    }
  }
}

// Гейт: тесты пишут в реальную БД → запускаем только по явному флагу.
const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

// Уникальные идентификаторы временного клиента (чтобы не конфликтовать с прод-данными).
const stamp = Date.now();
const userId = genObjectId();
const phone = `+49TEST${stamp}`;
const orderA = genObjectId(); // заказ для начисления
const orderB = genObjectId(); // заказ для списания
const orderC = genObjectId(); // заказ для сгорания

function fakeOrder(id: string, total: number) {
  // Минимальный «документ заказа», какой ждут функции сервиса.
  return { _id: id, user: userId, phoneNumber: phone, total, orderNumber: id.slice(-6), createdAt: new Date() };
}

// Заполняются динамически в beforeAll.
let db: any;
let svc: typeof import('../service');

d('loyalty service (integration, real DB)', () => {
  beforeAll(async () => {
    loadDatabaseUrl();
    db = (await import('../../db/client')).default;
    svc = await import('../service');

    // ШАГ 0 (подготовка): создаём временного клиента и три завершённых заказа.
    // Заказы нужны, потому что начисление идёт ТОЛЬКО по статусу completed, а
    // уровень (tier) считается по числу completed-заказов клиента.
    await db.insert(users).values({
      id: userId,
      name: 'E2E Test User',
      phoneNumber: phone,
      role: 'customer',
    });
    const baseOrder = {
      customerName: 'E2E Test User',
      phoneNumber: phone,
      user: userId,
      deliveryType: 'pickup',
      subtotal: 20,
      paymentMethod: 'cash',
      status: 'completed',
    };
    await db.insert(orders).values([
      { ...baseOrder, id: orderA, orderNumber: `T${stamp}A`, total: 20 },
      { ...baseOrder, id: orderB, orderNumber: `T${stamp}B`, total: 20 },
      { ...baseOrder, id: orderC, orderNumber: `T${stamp}C`, subtotal: 100, total: 100 },
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    // ОЧИСТКА: удаляем все строки временного клиента, чтобы не засорять прод.
    await db.delete(loyaltyTransactions).where(eq(loyaltyTransactions.user, userId));
    await db.delete(loyaltyPrograms).where(eq(loyaltyPrograms.user, userId));
    await db.delete(orders).where(eq(orders.user, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it('ШАГ 1 — начисляет 5% за завершённый заказ (20 € → 1.00 балл)', async () => {
    // Почему: проверяем базовое правило Bronze 5% и что баланс реально вырос в БД.
    const res = await svc.earnForCompletedOrder(fakeOrder(orderA, 20));
    expect(res?.earned).toBe(1);
    expect(await svc.getBalance(userId)).toBe(1);
  });

  it('ШАГ 2 — идемпотентность: повторное начисление за тот же заказ НЕ дублирует', async () => {
    // Почему: смена статуса/ретрай вебхука не должны начислять баллы дважды.
    const res = await svc.earnForCompletedOrder(fakeOrder(orderA, 20));
    expect(res).toBeNull(); // уже начислено → null
    expect(await svc.getBalance(userId)).toBe(1); // баланс не изменился
  });

  it('ШАГ 3 — нельзя списать больше, чем есть (атомарный guard)', async () => {
    // Почему: главная защита от двойного/избыточного списания. Баланс = 1, просим 2.
    const res = await svc.redeemPoints(userId, 2, orderB);
    expect(res.success).toBe(false);
    expect(await svc.getBalance(userId)).toBe(1); // баланс не тронут
  });

  it('ШАГ 4 — корректное списание уменьшает баланс', async () => {
    // Почему: списываем 1 балл на заказ B → баланс 0, в журнал пишется redeem.
    const res = await svc.redeemPoints(userId, 1, orderB);
    expect(res.success).toBe(true);
    expect(await svc.getBalance(userId)).toBe(0);
  });

  it('ШАГ 5 — отмена заказа возвращает списанные баллы (reverse)', async () => {
    // Почему: отмена заказа B (по нему было списание 1) должна вернуть 1 балл.
    await svc.reverseOrder(fakeOrder(orderB, 20));
    expect(await svc.getBalance(userId)).toBe(1);
  });

  it('ШАГ 6 — сгорание: истёкший earn-батч списывается с баланса', async () => {
    // Почему: начисляем по заказу C (100 € → 5 баллов, баланс 6), затем вручную
    // делаем этот earn-батч «просроченным» и проверяем, что expirePoints его сжёг.
    await svc.earnForCompletedOrder(fakeOrder(orderC, 100));
    expect(await svc.getBalance(userId)).toBe(6); // 1 (после reverse) + 5

    // Помечаем earn-батч заказа C истёкшим (expiresAt в прошлом).
    await db
      .update(loyaltyTransactions)
      .set({ expiresAt: new Date(Date.now() - 24 * 3600 * 1000) })
      .where(eq(loyaltyTransactions.order, orderC));

    const expired = await svc.expirePoints();
    expect(expired).toBeGreaterThanOrEqual(5);
    expect(await svc.getBalance(userId)).toBe(1); // 6 − 5 сгоревших
  });
});

// =====================================================================
// Регрессия тикета: «Verfügbare Punkte не уменьшаются».
// Отдельный временный клиент: ровно 1.68 балла, заказ из тикета (total 26.22),
// списание через redeemPointsForOrder (как из finalizeOrderPlacement).
// =====================================================================
const userId2 = genObjectId();
const phone2 = `+49TICKET${stamp}`;
const ticketOrderId = genObjectId();

let db2: any;
let svc2: typeof import('../service');

d('loyalty redeem — регрессия тикета (real DB)', () => {
  beforeAll(async () => {
    loadDatabaseUrl();
    db2 = (await import('../../db/client')).default;
    svc2 = await import('../service');
    await db2.insert(users).values({ id: userId2, name: 'Ticket User', phoneNumber: phone2, role: 'customer' });
    // Заказ-источник 1.68 балла (completed) — чтобы появилась программа и earn-батч.
    await db2.insert(orders).values({
      id: genObjectId(),
      orderNumber: `T${stamp}TE`,
      customerName: 'Ticket User',
      phoneNumber: phone2,
      user: userId2,
      deliveryType: 'pickup',
      subtotal: 56,
      total: 56,
      paymentMethod: 'cash',
      status: 'completed',
    });
  });

  afterAll(async () => {
    if (!db2) return;
    await db2.delete(loyaltyTransactions).where(eq(loyaltyTransactions.user, userId2));
    await db2.delete(loyaltyPrograms).where(eq(loyaltyPrograms.user, userId2));
    await db2.delete(orders).where(eq(orders.user, userId2));
    await db2.delete(users).where(eq(users.id, userId2));
  });

  it('подготовка: ровно 1.68 доступных баллов', async () => {
    // 56 € × 3% (Bronze) = 1.68. Это и есть «Verfügbare Punkte» = «Insgesamt gesammelt».
    await svc2.adjustPoints(userId2, 0, 'init', phone2); // гарантируем программу
    // Доводим баланс ровно до 1.68 через корректировку (детерминированно).
    const cur = await svc2.getBalance(userId2);
    if (cur !== 1.68) await svc2.adjustPoints(userId2, 1.68 - cur, 'set to 1.68', phone2);
    expect(await svc2.getBalance(userId2)).toBeCloseTo(1.68, 2);
  });

  it('РЕГРЕССИЯ: списание 1.68 на заказ → available=0, totalRedeemed=1.68', async () => {
    const order = {
      _id: ticketOrderId,
      user: userId2,
      phoneNumber: phone2,
      loyaltyPointsUsed: 1.68,
      total: 26.22,
      orderNumber: `T${stamp}TK`,
    };
    const res = await svc2.redeemPointsForOrder(order);
    expect(res.success).toBe(true);
    expect(res.redeemed).toBeCloseTo(1.68, 2);

    const sum = await svc2.getLoyaltySummary(userId2, phone2);
    expect(sum.balance).toBeCloseTo(0, 2); // Verfügbare Punkte = 0
    expect(sum.totalRedeemed).toBeCloseTo(1.68, 2); // Insgesamt eingelöst = 1.68
    // Profile-инвариант: доступные ≠ всего собрано, раз часть уже списана.
    expect(sum.balance).not.toBeCloseTo(sum.totalEarned, 2);
  });

  it('идемпотентность: повторное списание того же заказа НЕ уводит баланс в минус', async () => {
    const order = {
      _id: ticketOrderId, // тот же заказ
      user: userId2,
      phoneNumber: phone2,
      loyaltyPointsUsed: 1.68,
      total: 26.22,
      orderNumber: `T${stamp}TK`,
    };
    // 3 повторных вызова (ретраи confirm/вебхука/смены статуса).
    for (let i = 0; i < 3; i++) await svc2.redeemPointsForOrder(order);
    expect(await svc2.getBalance(userId2)).toBeCloseTo(0, 2); // не ушёл в минус, списано один раз
  });

  it('нельзя списать больше доступного: при балансе 0 запрос отклоняется', async () => {
    const res = await svc2.redeemPoints(userId2, 5, genObjectId(), 26.22, phone2);
    expect(res.success).toBe(false);
    expect(await svc2.getBalance(userId2)).toBeCloseTo(0, 2);
  });
});
