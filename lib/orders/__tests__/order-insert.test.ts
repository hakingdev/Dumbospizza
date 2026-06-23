// @vitest-environment node
//
// Регрессия бага: insert в "orders" падал, потому что loyalty_points_used был
// объявлен как integer, а сервер пишет ДРОБНЫЕ баллы (1 балл = 1 €, центовая
// точность — см. lib/loyalty/config.ts computeMaxRedeemablePoints/roundPoints).
// Postgres отклонял значение вроде 1.68 для integer-колонки → весь заказ падал.
//
// Здесь два уровня проверки:
//  1) Быстрый guard типов схемы (без БД) — гоняется всегда, ловит регресс, если
//     кто-то снова поставит integer на баллы.
//  2) Интеграционный insert РЕАЛЬНОГО payload из бага против живого Postgres —
//     гейт RUN_DB_TESTS=1 (как в lib/loyalty/__tests__/service.integration.test.ts).
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { orders } from '../../db/schema';
import { genObjectId } from '../../db/object-id';

// =====================================================================
// 1. Guard типов схемы (без БД)
// =====================================================================
describe('orders schema — типы денежных/бонусных колонок', () => {
  it('loyalty_points_used допускает дробь (double precision, не integer)', () => {
    // Сервер пишет сюда дробные баллы (напр. 1.68). integer → insert падает.
    expect(orders.loyaltyPointsUsed.getSQLType()).toBe('double precision');
  });

  it('loyalty_points_earned допускает дробь (double precision, не integer)', () => {
    // Начисление = доля от суммы (3/5/7%) → почти всегда дробное.
    expect(orders.loyaltyPointsEarned.getSQLType()).toBe('double precision');
  });

  it('денежные поля total/subtotal/tax/promotion_discount — double precision', () => {
    expect(orders.total.getSQLType()).toBe('double precision');
    expect(orders.subtotal.getSQLType()).toBe('double precision');
    expect(orders.tax.getSQLType()).toBe('double precision');
    expect(orders.promotionDiscount.getSQLType()).toBe('double precision');
  });
});

// =====================================================================
// 2. Интеграционный insert реального payload (real DB, гейт RUN_DB_TESTS=1)
// =====================================================================
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return;
  for (const f of ['.env.local', '.env']) {
    try {
      const txt = readFileSync(resolve(process.cwd(), f), 'utf8');
      const line = txt.split('\n').find((l) => l.trim().startsWith('DATABASE_URL='));
      if (line) {
        process.env.DATABASE_URL = line
          .slice(line.indexOf('=') + 1)
          .trim()
          .replace(/^["']|["']$/g, '');
        return;
      }
    } catch {
      /* нет файла — пропускаем */
    }
  }
}

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

const stamp = Date.now();
const orderId = genObjectId();
const orderNumber = `T${stamp}`.slice(0, 12);

let db: any;

d('orders insert — payload из бага (real DB)', () => {
  beforeAll(async () => {
    loadDatabaseUrl();
    db = (await import('../../db/client')).default;
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(orders).where(eq(orders.id, orderId));
  });

  it('вставляет заказ с promotions/free gifts/дробными баллами без падения', async () => {
    // Точная форма из тикета: BOGO + gratis-артикул, бесплатные позиции (price 0),
    // немецкий адрес, payment_method=card, статусы pending/new, баллы 1.68.
    const inserted = await db
      .insert(orders)
      .values({
        id: orderId,
        orderNumber,
        user: genObjectId(),
        customerName: 'Yurii Buhir',
        phoneNumber: '01716286134',
        email: 'say.to.yurii@gmail.com',
        items: [
          {
            product: genObjectId(),
            name: 'BBQ Chicken',
            quantity: 1,
            price: 27.9,
            taxRate: 0.07,
            size: { id: '1769471716097', name: 'ca. 60x40', size: '', price: 27.9 },
            totalPrice: 27.9,
          },
          { product: genObjectId(), name: '[GRATIS] BBQ Chicken — ca. 20x20', quantity: 1, price: 0, totalPrice: 0 },
          { product: genObjectId(), name: '[GRATIS] Coca Cola Zero 0,33l', quantity: 1, price: 0, totalPrice: 0 },
        ],
        deliveryAddress: { street: 'Schurzstraße', houseNumber: '12', postalCode: '97688', city: 'Bad Kissingen' },
        deliveryType: 'delivery',
        deliveryFee: 0,
        subtotal: 27.9,
        tax: 0,
        promotionDiscount: 0,
        appliedPromotions: [
          { promotionId: genObjectId(), name: 'Die zweite Pizza nach Wahl gratis', type: 'bogo', savedAmount: 27.9 },
          { promotionId: genObjectId(), name: 'Getränk GRATIS', type: 'gratis_article', savedAmount: 0 },
        ],
        freeGifts: [
          {
            productId: genObjectId(),
            name: 'Coca Cola Zero 0,33l',
            quantity: 1,
            promotionId: genObjectId(),
            label: 'Gratis-Artikel — wählen Sie 1 aus',
          },
        ],
        loyaltyPointsUsed: 1.68, // ← дробное; раньше падало на integer-колонке
        total: 26.22,
        paymentMethod: 'card',
        paymentStatus: 'pending',
        status: 'new',
        kitchenPrintStatus: 'pending',
        customerPrintStatus: 'pending',
        statusUpdates: [{ status: 'new', timestamp: new Date().toISOString() }],
      })
      .returning();

    const row = inserted[0];
    expect(row.id).toBe(orderId);
    expect(row.loyaltyPointsUsed).toBeCloseTo(1.68, 2);
    expect(row.total).toBeCloseTo(26.22, 2);
    expect(row.promotionDiscount).toBe(0);
    expect(row.appliedPromotions).toHaveLength(2);
    expect(row.freeGifts).toHaveLength(1);
    expect(row.deliveryAddress?.street).toBe('Schurzstraße');
    expect(row.paymentStatus).toBe('pending');
    expect(row.status).toBe('new');
    expect(row.kitchenPrintStatus).toBe('pending');
  });

  it('order_number уникален — повторная вставка того же номера падает (защита от дубля)', async () => {
    // Уникальный индекс orders_order_number_uq не даёт создать второй заказ с тем
    // же номером (idempotency на уровне БД при ретрае/двойном submit).
    await expect(
      db.insert(orders).values({
        id: genObjectId(),
        orderNumber, // тот же номер, что и выше
        customerName: 'Dup',
        phoneNumber: '01716286134',
        deliveryType: 'pickup',
        subtotal: 1,
        total: 1,
        paymentMethod: 'cash',
      })
    ).rejects.toThrow();
  });
});
