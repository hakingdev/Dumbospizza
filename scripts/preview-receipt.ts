/**
 * Локальный предпросмотр кухонного чека (без принтера).
 * Запуск:  npx tsx scripts/preview-receipt.ts [ширина]
 * Печатает в консоль то, как будет выглядеть чек (группировка по категориям).
 */
import { buildKitchenReceiptOps, renderOpsToText, type ReceiptOrder } from '../lib/receipt/kitchen-receipt';

const width = parseInt(process.argv[2] || '42', 10) || 42;

const order: ReceiptOrder = {
  orderId: '260626002',
  createdAt: new Date(),
  deliveryType: 'delivery',
  customerName: 'Nicole Schroeder',
  phoneNumber: '+4915735984469',
  address: 'Ümpfigstraße 11B, 97720 Nüdlingen',
  desiredDeliveryTime: '18:15',
  deliveryFee: 3,
  totalAmount: 42.7,
  paymentMethod: 'online',
  items: [
    { name: 'Margherita', quantity: 1, price: 7.9, category: 'Pizza', customizations: ['Solo ca. 20x20'] },
    { name: 'Creamy Mushrooms', quantity: 1, price: 10.9, category: 'Pizza', customizations: ['Solo ca. 20x20'] },
    { name: 'White Pizza (Veg)', quantity: 1, price: 8.9, category: 'Pizza' },
    { name: 'Spargel Slice', quantity: 1, price: 8.9, category: 'Pizza' },
    { name: 'Crispy Garnelen mit Spicy Mayo', quantity: 1, price: 11.5, category: 'Crispy Sides' },
    { name: 'Cola Zero 0,33l', quantity: 1, price: 3, category: 'Alkoholfreie Getränke' },
  ],
  notes: 'Bitte an der Garage klingeln.',
};

const sep = '#'.repeat(width);
console.log(`\n${sep}  (Breite ${width})`);
for (const line of renderOpsToText(buildKitchenReceiptOps(order), width)) {
  console.log(line);
}
console.log(sep + '\n');

// Второй пример: самовывоз, оплата наличными, одна категория
const pickup: ReceiptOrder = {
  orderId: '260626003',
  createdAt: new Date(),
  deliveryType: 'pickup',
  customerName: 'TEST DRUCK',
  phoneNumber: '01716286134',
  totalAmount: 13.9,
  paymentMethod: 'cash',
  items: [
    {
      name: 'BBQ Chicken',
      quantity: 1,
      price: 9.9,
      category: 'Pizza',
      customizations: ['Größe: ca. 30x40', 'Soße: Knoblauch', 'Extra: Käse', 'Extra: Jalapeños'],
    },
    { name: 'Coca Cola 0,33l', quantity: 2, price: 3, category: 'Alkoholfreie Getränke' },
  ],
};
console.log(sep);
for (const line of renderOpsToText(buildKitchenReceiptOps(pickup), width)) {
  console.log(line);
}
console.log(sep + '\n');
