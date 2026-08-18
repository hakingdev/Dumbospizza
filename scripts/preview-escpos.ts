/**
 * Предпросмотр чека в ESC/POS: текстом в консоль и байтами в файл.
 *
 * Файл затем уходит на прибор и печатается — это единственный способ убедиться,
 * что серверный рендер даёт на бумаге то же самое, что даёт проба на Kotlin:
 *
 *   npx tsx scripts/preview-escpos.ts
 *   adb -s <устройство> push .tmp/receipt-sunmi.bin \
 *       /sdcard/Android/data/de.dumbospizza.pos.debug/files/receipt.bin
 *
 * Дополняет preview-receipt.ts: тот показывает раскладку текстом, этот проверяет
 * сами байты.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { buildKitchenReceiptOps, type ReceiptOrder } from '../lib/receipt/kitchen-receipt';
import {
  renderOpsToEscPos,
  renderOpsToPaperLines,
  PROFILE_SUNMI_V2S,
  PROFILE_EPSON_80MM,
} from '../lib/receipt/escpos';

// Заказ нарочно неудобный: длинное название (проверка переноса), умляуты
// (проверка кодировки), подкатегории (группировка), комментарий (крупный блок).
const order: ReceiptOrder = {
  orderId: '260818001',
  createdAt: new Date('2026-08-18T00:20:00'),
  deliveryType: 'delivery',
  customerName: 'Nicole Schröder',
  phoneNumber: '+49 157 35984469',
  address: 'Ümpfingstraße 11B, 97720 Nüdlingen',
  desiredDeliveryTime: '18:15',
  deliveryFee: 3,
  totalAmount: 54.2,
  paymentMethod: 'cash',
  notes: 'Bitte klingeln bei Schröder, 2. Stock. Ohne Zwiebeln!',
  items: [
    { name: 'Margherita', quantity: 1, price: 7.9, category: 'Pizza', customizations: ['Solo ca. 20x20'] },
    {
      name: 'Quattro Stagioni mit Extra Käse und Peperoni',
      quantity: 2,
      price: 12.9,
      category: 'Pizza',
      customizations: ['Topping: Rucola', 'Sauce: Aioli'],
    },
    { name: 'Philadelphia Lachs', quantity: 1, price: 8.5, category: 'MakiLove', subcategory: 'Philadelphia' },
    { name: 'California Ebi', quantity: 1, price: 9.0, category: 'MakiLove', subcategory: 'California' },
    { name: 'Cola Zero 0,33l', quantity: 1, price: 3, category: 'Alkoholfreie Getränke' },
  ],
};

const ops = buildKitchenReceiptOps(order);

// Предпросмотр восстановлен из самих байт, поэтому переносы здесь ровно те же,
// что выйдут на бумаге. Линейка сверху — чтобы сразу видеть выход за 32 колонки.
console.log('=== Как выйдет на бумаге Sunmi (32 колонки) ===\n');
console.log('....|....1....|....2....|....3..');
for (const line of renderOpsToPaperLines(ops, PROFILE_SUNMI_V2S)) {
  const overflow = line.length > PROFILE_SUNMI_V2S.width ? `  <-- ${line.length}!` : '';
  console.log(line + overflow);
}

const targets = [
  { name: 'sunmi', profile: PROFILE_SUNMI_V2S },
  { name: 'epson', profile: PROFILE_EPSON_80MM },
];

console.log('\n=== Байты ===');
for (const { name, profile } of targets) {
  const bytes = renderOpsToEscPos(ops, profile);
  const out = resolve(process.cwd(), '.tmp', `receipt-${name}.bin`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  console.log(
    `${name.padEnd(6)} ширина=${String(profile.width).padEnd(3)} ` +
      `нож=${profile.hasCutter ? 'да ' : 'нет'} ` +
      `${String(bytes.length).padStart(5)} байт → ${out}`
  );
}
