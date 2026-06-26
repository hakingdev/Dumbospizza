/**
 * Печать чеков на термопринтер (EPSON ESC/POS).
 * Поддерживается TM-P20 и другие принтеры Epson.
 *
 * Настройка:
 * - Если приложение крутится на том же ПК, где подключён принтер:
 *   В .env задайте KITCHEN_PRINTER_INTERFACE.
 *   Windows: имя принтера, например "EPSON TM-P20" или "TM-P20".
 *   Сеть: IP:порт, например "192.168.1.100:9100".
 * - Один принтер на заказ: задайте только KITCHEN_PRINTER_INTERFACE —
 *   будет печататься один чек (заказ для кухни).
 * - Если принтер не настроен или сервер не на этом ПК — заказ всё равно создаётся,
 *   печать можно делать через print-agent на офисном ноутбуке.
 */

import { OrderNotification } from './telegram';
import {
  buildKitchenReceiptOps,
  type ReceiptOp,
  type ReceiptOrder,
} from './receipt/kitchen-receipt';

// node-thermal-printer exports differ across versions; use require to avoid TS export mismatch
const thermalPrinter = require('node-thermal-printer') as any;
const { ThermalPrinter, PrinterTypes } = thermalPrinter;

/** OrderNotification → модель чека для группировки по категориям. */
function toReceiptOrder(order: OrderNotification): ReceiptOrder {
  return {
    orderId: order.orderId,
    createdAt: new Date(),
    deliveryType: order.deliveryType,
    customerName: order.customerName,
    phoneNumber: order.phoneNumber,
    address: order.address,
    desiredDeliveryTime: order.desiredDeliveryTime,
    notes: order.notes,
    items: order.items,
    deliveryFee: order.deliveryFee,
    totalAmount: order.totalAmount,
    paymentMethod: order.paymentMethod,
  };
}

/** Рендер ops чека в команды термопринтера. */
function renderOpsToPrinter(printer: any, ops: ReceiptOp[]): void {
  for (const op of ops) {
    switch (op.type) {
      case 'align':
        if (op.value === 'center') printer.alignCenter();
        else printer.alignLeft();
        break;
      case 'line':
        printer.drawLine();
        break;
      case 'blank':
        printer.newLine();
        break;
      case 'text':
        if (op.bold) printer.bold(true);
        printer.println(op.text);
        if (op.bold) printer.bold(false);
        break;
      case 'lr':
        if (op.bold) printer.bold(true);
        if (op.right) printer.leftRight(op.left, op.right);
        else printer.println(op.left);
        if (op.bold) printer.bold(false);
        break;
      case 'cut':
        printer.cut();
        break;
    }
  }
}

interface PrinterConfig {
  type: any;
  interface: string;
  options?: { timeout?: number };
}

function getKitchenInterface(): string | null {
  const iface = process.env.KITCHEN_PRINTER_INTERFACE || process.env.PRINTER_INTERFACE || '';
  return iface.trim() || null;
}

function getCustomerInterface(): string | null {
  const iface = process.env.CUSTOMER_PRINTER_INTERFACE || '';
  return iface.trim() || null;
}

function getPrinterConfig(interfaceName: string): PrinterConfig {
  return {
    type: PrinterTypes.EPSON,
    interface: interfaceName,
    options: { timeout: 8000 }
  };
}

async function initializePrinter(config: PrinterConfig): Promise<any> {
  const printer = new ThermalPrinter(config);
  const isConnected = await printer.isPrinterConnected();
  if (!isConnected) {
    throw new Error(`Printer not connected: ${config.interface}`);
  }
  return printer;
}

/**
 * Print kitchen receipt (order details only)
 * @param order Order information to print
 * @returns Promise resolving to true if printing was successful
 */
export async function printKitchenReceipt(order: OrderNotification): Promise<boolean> {
  const iface = getKitchenInterface();
  if (!iface) {
    return false;
  }
  try {
    const printer = await initializePrinter(getPrinterConfig(iface));

    // Компактный чек, сгруппированный ПО КАТЕГОРИЯМ (Lieferando-стиль).
    // Обычный (не двойной) размер шрифта — мельче и компактнее.
    printer.setTextNormal();
    renderOpsToPrinter(printer, buildKitchenReceiptOps(toReceiptOrder(order)));

    // Execute print job
    await printer.execute();
    return true;
  } catch (error) {
    console.error('Error printing kitchen receipt:', error);
    return false;
  }
}

/**
 * Print customer receipt with totals
 * @param order Order information to print
 * @returns Promise resolving to true if printing was successful
 */
export async function printCustomerReceipt(
  order: OrderNotification
): Promise<boolean> {
  const iface = getCustomerInterface();
  if (!iface) {
    return false;
  }
  try {
    const printer = await initializePrinter(getPrinterConfig(iface));
    
    // Restaurant info
    printer.alignCenter();
    printer.bold(true);
    printer.println('PIZZA DELIVERY');
    printer.setTextNormal();
    printer.println('Kurhausstr. 11A, 97688 Bad Kissingen');
    printer.println('Tel: +49 163 2165979');
    printer.println('info@dumbospizza.de');
    printer.drawLine();
    
    // Order info
    printer.alignLeft();
    printer.bold(true);
    printer.println(`ORDER #${order.orderId}`);
    printer.bold(false);
    printer.println(`Date: ${new Date().toLocaleString('de-DE')}`);
    printer.println(`Customer: ${order.customerName}`);
    printer.println(`Phone: ${order.phoneNumber}`);
    
    // Delivery info
    if (order.deliveryType === 'delivery' && order.address) {
      printer.println(`Delivery to: ${order.address}`);
    } else {
      printer.println('Pickup order');
    }
    if (order.desiredDeliveryTime) {
      printer.println(`Desired time: ${order.desiredDeliveryTime}`);
    }
    printer.drawLine();
    
    // Items
    printer.bold(true);
    printer.println('ITEMS:');
    printer.bold(false);
    
    let subtotal = 0;
    
    // Print each item
    order.items.forEach(item => {
      const itemTotal = (item.price ?? 0) * item.quantity;
      subtotal += itemTotal;
      
      // Print item details
      printer.leftRight(
        `${item.quantity}x ${item.name}`,
        `${itemTotal.toFixed(2)} €`
      );
      
      // Customizations
      if (item.customizations && item.customizations.length > 0) {
        item.customizations.forEach(customization => {
          printer.println(`  - ${customization}`);
        });
      }
    });
    
    // Delivery fee if applicable
    if (order.deliveryType === 'delivery' && order.deliveryFee > 0) {
      printer.leftRight('Delivery fee:', `${order.deliveryFee.toFixed(2)} €`);
      subtotal += order.deliveryFee;
    }
    
    // Totals and taxes
    printer.drawLine();
    printer.leftRight('Subtotal:', `${subtotal.toFixed(2)} €`);
    printer.bold(true);
    printer.leftRight('TOTAL:', `${order.totalAmount.toFixed(2)} €`);
    printer.bold(false);
    printer.drawLine();
    
    // Payment method
    printer.println(`Payment method: ${order.paymentMethod}`);
    
    // Footer
    printer.drawLine();
    printer.alignCenter();
    printer.println('Vielen Dank für Ihre Bestellung!');
    printer.println('Thank you for your order!');
    printer.println('');
    printer.println('www.dumbospizza.de');
    printer.cut();
    
    // Execute print job
    await printer.execute();
    return true;
  } catch (error) {
    console.error('Error printing customer receipt:', error);
    return false;
  }
}

/**
 * Print both receipts for an order
 * @param order Order information 
 * @returns Promise resolving to an object indicating success status of each receipt
 */
export async function printOrderReceipts(
  order: OrderNotification & { notes?: string; deliveryFee?: number }
): Promise<{ kitchen: boolean; customer: boolean }> {
  const hasKitchen = !!getKitchenInterface();
  const hasCustomer = !!getCustomerInterface();

  if (!hasKitchen && !hasCustomer) {
    return { kitchen: false, customer: false };
  }

  const kitchenPromise = hasKitchen ? printKitchenReceipt(order) : Promise.resolve(false);
  const customerPromise = hasCustomer ? printCustomerReceipt(order) : Promise.resolve(false);
  const [kitchenResult, customerResult] = await Promise.all([kitchenPromise, customerPromise]);

  return {
    kitchen: kitchenResult,
    customer: customerResult
  };
}
