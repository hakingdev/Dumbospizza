/**
 * РУЧНОЙ ТЕСТ: заказ с ДОСТАВКОЙ (телефон+адрес) и акцией «Zweiter 50%»
 * (вторая пицца за полцены). Проверяет: заказ в Supabase → уведомление в Telegram
 * с акционной позицией → печать чека (агент печатает order.items, включая [AKTION]).
 *
 * ⚠️ Шлёт сообщение в БОЕВУЮ Telegram-группу и кладёт заказ в очередь печати.
 *
 * Dev-сервер (DATABASE_URL — Session pooler из .env подхватится автоматически):
 *   SKIP_NATIVE_MODULES=true npx next dev -p 3002
 * Затем:
 *   node scripts/test-order-bogo.mjs
 *   BASE_URL=http://127.0.0.1:3000 node scripts/test-order-bogo.mjs
 *
 * Часы приёма: storeSettings.ordersStartHour..ordersEndHour. Вне окна → 403.
 */

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3002';

const PROMO_ID = '6a351e59aa228e51ba211155'; // акция «Zweiter 50%» (half_price)
const PIZZA_CATEGORY_ID = '6977f688ed29bd1765bcfbed'; // категория pizza (на неё таргетирована акция)

// 1-я пицца (платная, квалифицирует акцию) — BBQ Chicken, ca. 20x20.
// ВАЖНО: categoryId обязателен — акция таргетирована на категорию pizza.
const pizza1 = {
  productId: '6977ff52516ecc1e5bb2a857',
  categoryId: PIZZA_CATEGORY_ID,
  name: 'BBQ Chicken',
  price: 7.9,
  quantity: 1,
  size: { id: '1769471715027', name: 'ca. 20x20', label: 'ca. 20x20', price: 7.9 },
};

// 2-я пицца за 50% (награда BOGO) — Bayern Pizza (8.90 → 4.45).
const SECOND_PIZZA_PRODUCT_ID = '6978952f516ecc1e5bb2c482';

const payload = {
  customerName: 'TEST Lieferung (можно удалить)',
  phoneNumber: '+491701234567',
  email: '',
  deliveryType: 'delivery',
  deliveryAddress: {
    street: 'Teststraße',
    houseNumber: '12',
    postalCode: '40210',
    city: 'Düsseldorf',
  },
  deliveryFee: 2.5,
  paymentMethod: 'cash',
  channel: 'web',
  items: [pizza1],
  selectedBogoSecond: [{ promotionId: PROMO_ID, productId: SECOND_PIZZA_PRODUCT_ID }],
  notes: 'Автотест: доставка + 2-я пицца 50% (Telegram + чек)',
};

async function main() {
  console.log(`POST ${BASE_URL}/api/orders`);
  console.log('Доставка. Корзина: 1× BBQ Chicken 7.90€ + 2-я Bayern Pizza 50% = 4.45€, доставка 2.50€\n');

  let res;
  try {
    res = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('Сервер недоступен. Подними dev-сервер (см. шапку).');
    console.error(String(e));
    process.exit(1);
  }

  const json = await res.json().catch(() => ({}));
  console.log('HTTP', res.status);
  console.log(JSON.stringify(json, null, 2));

  if (json.success) {
    console.log('\n✅ Заказ', json.order?.orderNumber, '— проверь:');
    console.log('  • Telegram-группа: в составе заказа строка «[AKTION] Bayern Pizza …»;');
    console.log('  • чек принт-агента: та же позиция со скидочной ценой 4.45€.');
  } else {
    console.log('\n❌ Не прошёл:', json.error);
  }
  process.exit(json.success ? 0 : 1);
}

main();
