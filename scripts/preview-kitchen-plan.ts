/**
 * Локальный предпросмотр AI-плана кухни (lib/eta/kitchen-plan.ts) без админки.
 *
 * Запуск:
 *   npx tsx scripts/preview-kitchen-plan.ts              — синтетическая очередь
 *     (2x Oerlenbach + Bad Kissingen + Bad Bocklet + самовывоз), реальный вызов Claude
 *   npx tsx scripts/preview-kitchen-plan.ts --heuristic  — только эвристика, без AI
 *   npx tsx scripts/preview-kitchen-plan.ts --live       — реальная очередь из БД
 *   COURIERS=2 npx tsx scripts/preview-kitchen-plan.ts   — синтетика с 2 курьерами
 *
 * Читает ANTHROPIC_API_KEY / DATABASE_URL из .env.local (или окружения).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
  const {
    analyzeKitchenPlanWithClaude,
    heuristicKitchenPlan,
    buildKitchenPlanContext,
    planFromContext,
  } = await import('../lib/eta/kitchen-plan');

  const mode = process.argv[2] || '';

  const couriers = Math.max(1, Math.min(6, Number(process.env.COURIERS) || 1));
  const context =
    mode === '--live'
      ? await buildKitchenPlanContext()
      : {
          nowBerlin: 'Mo., 18:05',
          restaurantAddress: 'Kurhausstr. 11A, 97688 Bad Kissingen',
          courierCount: couriers,
          staffing: { pizzaCooks: 1, fryerHelpers: 1, sushiChefs: 2 },
          onTheRoad: [],
          orders: [
            {
              orderNumber: '260811001',
              status: 'preparing',
              minutesAgo: 12,
              deliveryType: 'delivery' as const,
              address: 'Hauptstraße 5, 97714 Oerlenbach',
              city: 'Oerlenbach',
              items: ['2x Pizza Salami', '1x Cola 1L'],
              units: { pizza: 2, fryer: 0, sushi: 0 },
              prepMinutesEstimate: 16,
              promisedEtaMinutes: 45,
              promiseRemainingMinutes: 33,
              distanceKm: 8.4,
              driveMinutesEstimate: 18,
              coordinates: { lat: 50.15, lng: 10.13 },
            },
            {
              orderNumber: '260811002',
              status: 'new',
              minutesAgo: 6,
              deliveryType: 'delivery' as const,
              address: 'Schulweg 2, 97714 Oerlenbach',
              city: 'Oerlenbach',
              items: ['1x Pizza Margherita', '1x Chicken Wings'],
              units: { pizza: 1, fryer: 1, sushi: 0 },
              prepMinutesEstimate: 10,
              promisedEtaMinutes: 50,
              promiseRemainingMinutes: 44,
              distanceKm: 8.9,
              driveMinutesEstimate: 19,
              coordinates: { lat: 50.152, lng: 10.135 },
            },
            {
              orderNumber: '260811003',
              status: 'new',
              minutesAgo: 4,
              deliveryType: 'delivery' as const,
              address: 'Kurhausstr. 30, 97688 Bad Kissingen',
              city: 'Bad Kissingen',
              items: ['1x Pizza Funghi'],
              units: { pizza: 1, fryer: 0, sushi: 0 },
              prepMinutesEstimate: 10,
              promisedEtaMinutes: 40,
              promiseRemainingMinutes: 36,
              distanceKm: 1.2,
              driveMinutesEstimate: 6,
              coordinates: { lat: 50.198, lng: 10.077 },
            },
            {
              orderNumber: '260811004',
              status: 'new',
              minutesAgo: 2,
              deliveryType: 'delivery' as const,
              address: 'Von-Hutten-Str. 1, 97708 Bad Bocklet',
              city: 'Bad Bocklet',
              items: ['1x Pizza Diavolo', '4x California Roll'],
              units: { pizza: 1, fryer: 0, sushi: 4 },
              prepMinutesEstimate: 16,
              promisedEtaMinutes: 55,
              promiseRemainingMinutes: 53,
              distanceKm: 9.8,
              driveMinutesEstimate: 21,
              coordinates: { lat: 50.27, lng: 10.08 },
            },
            {
              orderNumber: '260811005',
              status: 'new',
              minutesAgo: 1,
              deliveryType: 'pickup' as const,
              items: ['1x Pizza Hawaii'],
              units: { pizza: 1, fryer: 0, sushi: 0 },
              prepMinutesEstimate: 10,
              promisedEtaMinutes: 25,
              promiseRemainingMinutes: 24,
            },
          ],
        };

  console.log(
    `Очередь: ${context.orders.length} заказов, в пути: ${context.onTheRoad.length}, ` +
      `курьеров: ${context.courierCount}\n`
  );

  const plan =
    mode === '--heuristic'
      ? heuristicKitchenPlan(context)
      : mode === '--live'
        ? await planFromContext(context)
        : await analyzeKitchenPlanWithClaude(context);

  console.log(`Источник: ${plan.source}${plan.model ? ` (${plan.model})` : ''}`);
  console.log(`Нагрузка: ${plan.loadLevel}`);
  console.log(`Итог: ${plan.summary}`);
  if (plan.advisory) console.log(`⚠ Совет: ${plan.advisory}`);
  console.log('');
  for (const b of plan.batches) {
    console.log(
      `Шаг ${b.step}: ${b.orderNumbers.map((n) => `#${n}`).join(' + ')} [${b.area}]` +
        (b.cookTogether ? ' · готовить вместе' : '')
    );
    if (b.courier) console.log(`   🚴 ${b.courier}`);
    if (b.rationale) console.log(`   — ${b.rationale}`);
  }
  if (plan.onTheRoad.length) console.log(`\nВ пути: ${plan.onTheRoad.join(', ')}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('Ошибка:', e);
    process.exit(1);
  }
);
