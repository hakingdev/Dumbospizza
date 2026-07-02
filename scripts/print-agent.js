try { require('dotenv').config(); } catch (_) {}

// List COM ports and exit (Windows):  node print-agent.js --list-ports
if (process.argv.includes('--list-ports')) {
  const { execSync } = require('child_process');
  console.log('COM ports on this PC:\n');
  let found = false;
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_SerialPort | Select-Object DeviceID, Description | Format-Table -AutoSize"',
      { encoding: 'utf8', timeout: 5000 }
    );
    if (out && out.trim()) {
      console.log(out);
      found = true;
    }
  } catch (_) {}
  if (!found) {
    try {
      const pnp = execSync(
        'powershell -NoProfile -Command "Get-PnpDevice -Class Ports | Where-Object { $_.Status -eq \'OK\' } | ForEach-Object { $_.FriendlyName }"',
        { encoding: 'utf8', timeout: 5000 }
      );
      if (pnp && pnp.trim()) {
        console.log('Ports (COM & LPT):');
        pnp.trim().split(/\r?\n/).forEach((line) => console.log(' ', line.trim()));
        found = true;
      }
    } catch (_) {}
  }
  if (!found) console.log('(none found)');
  console.log('');
  console.log('Also check: Device Manager -> Ports (COM & LPT)');
  process.exit(0);
}

// ВАЖНО: используйте www-домен (apex dumbospizza.de даёт 308-редирект — может дублировать печать).
const API_BASE_URL = process.env.API_BASE_URL || 'https://www.dumbospizza.de';
const PRINT_AGENT_SECRET = process.env.PRINT_AGENT_SECRET || '';
const PRINTER_RAW = process.env.KITCHEN_PRINTER_INTERFACE || process.env.PRINTER_INTERFACE || 'EPSON TM-P20 Receipt';
const POLL_INTERVAL_MS = parseInt(process.env.PRINT_AGENT_POLL_MS || '5000', 10);

// Windows: "COM3" -> "\\.\COM3". Network: "tcp://..." stays. Name: "printer:Name" or use as-is for driver.
const PRINTER_INTERFACE = /^COM\d+$/i.test(PRINTER_RAW)
  ? '\\\\.\\' + PRINTER_RAW.toUpperCase()
  : PRINTER_RAW;

const thermalPrinter = require('node-thermal-printer');
const { ThermalPrinter, PrinterTypes, CharacterSet } = thermalPrinter;

// Без characterSet при ü/ö/ß/€ библиотека падает: Encoding not recognized: 'undefined'
const CHARACTER_SET_BY_ENV = {
  PC858_EURO: CharacterSet.PC858_EURO,
  PC850_MULTILINGUAL: CharacterSet.PC850_MULTILINGUAL,
  WPC1252: CharacterSet.WPC1252,
  PC437_USA: CharacterSet.PC437_USA,
  SLOVENIA: CharacterSet.SLOVENIA,
};
const printerCharacterSet =
  CHARACTER_SET_BY_ENV[(process.env.PRINT_CHARACTER_SET || 'PC858_EURO').toUpperCase()] ||
  CharacterSet.PC858_EURO;

const printerNameHintsPortable =
  /^1|true|yes$/i.test(String(process.env.PRINT_PORTABLE || '')) ||
  /TM-P20|TMP20|TM\s*P20/i.test(PRINTER_RAW);
const envBool = (v, def) => {
  if (v === undefined || v === '') return def;
  return /^1|true|yes$/i.test(String(v));
};
const PRINT_LINE_WIDTH = Math.min(
  48,
  Math.max(
    24,
    parseInt(process.env.PRINT_LINE_WIDTH || (printerNameHintsPortable ? '32' : '48'), 10) ||
      (printerNameHintsPortable ? 32 : 48)
  )
);
const PRINT_PARTIAL_CUT =
  process.env.PRINT_PARTIAL_CUT !== undefined && process.env.PRINT_PARTIAL_CUT !== ''
    ? envBool(process.env.PRINT_PARTIAL_CUT, false)
    : printerNameHintsPortable;
const PRINT_FEED_BEFORE_CUT = Math.min(
  8,
  Math.max(0, parseInt(process.env.PRINT_FEED_BEFORE_CUT || '3', 10) || 3)
);
const PRINT_USE_DOUBLE_SIZE =
  process.env.PRINT_USE_DOUBLE_SIZE !== undefined && process.env.PRINT_USE_DOUBLE_SIZE !== ''
    ? envBool(process.env.PRINT_USE_DOUBLE_SIZE, false)
    : false; // компактный чек по умолчанию (мельче шрифт)

let printerDriver = null;
try {
  printerDriver = require('printer');
} catch (_) {}

const isPrinterByName = !/^COM\d+$/i.test(PRINTER_RAW) && !/^tcp:\/\//i.test(PRINTER_RAW) && !/^[\\\/]/.test(PRINTER_RAW);
if (isPrinterByName && !printerDriver) {
  console.error('Printer by name needs the "printer" package (npm install printer --legacy-peer-deps).');
  console.error('Or use a COM port: set KITCHEN_PRINTER_INTERFACE=COM3 in .env');
  process.exit(1);
}

function getPrinter() {
  const iface = printerDriver && isPrinterByName
    ? 'printer:' + PRINTER_RAW
    : PRINTER_INTERFACE;
  const config = {
    type: PrinterTypes.EPSON,
    interface: iface,
    options: { timeout: 8000 },
    characterSet: printerCharacterSet,
    width: PRINT_LINE_WIDTH,
  };
  if (printerDriver && iface.startsWith('printer:')) config.driver = printerDriver;
  return new ThermalPrinter(config);
}

function buildCustomizations(item) {
  const parts = [];
  if (item.size && item.size.name) parts.push(`${item.size.name}`);
  (item.extras && item.extras.toppings || []).forEach(t => parts.push(`Topping: ${t.name}`));
  (item.extras && item.extras.sauces || []).forEach(s => parts.push(`Sauce: ${s.name}`));
  (item.extras && item.extras.sides || []).forEach(s => parts.push(`Side: ${s.name}`));
  // Допы из групп опций (соусы/топпинги/...) — печатаем под товаром
  (item.options || []).forEach(o => parts.push(o.group ? `${o.group}: ${o.name}` : o.name));
  return parts;
}

function orderToNotification(order) {
  const address = order.deliveryType === 'delivery' && order.deliveryAddress
    ? `${order.deliveryAddress.street || ''} ${order.deliveryAddress.houseNumber || ''}, ${order.deliveryAddress.postalCode || ''} ${order.deliveryAddress.city || ''}`.trim()
    : undefined;
  return {
    orderId: order.orderNumber,
    customerName: order.customerName,
    phoneNumber: order.phoneNumber,
    address,
    notes: order.notes,
    desiredDeliveryTime: order.desiredDeliveryTime,
    items: (order.items || []).map(item => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      category: item.category, // имя категории для группировки
      customizations: buildCustomizations(item)
    })),
    totalAmount: order.total,
    deliveryFee: order.deliveryFee,
    paymentMethod: order.paymentMethod,
    deliveryType: order.deliveryType
  };
}

// ---- Раскладка чека (зеркало lib/receipt/kitchen-receipt.ts) ----
const FALLBACK_CATEGORY = 'Sonstiges';

function formatPaymentMethod(method) {
  switch (String(method || '').toLowerCase()) {
    case 'cash': return 'BAR';
    case 'card': return 'KARTE';
    case 'online': return 'ONLINE (bezahlt)';
    default: return String(method || '-').toUpperCase();
  }
}

function formatEuro(value) {
  return 'EUR ' + (Number(value) || 0).toFixed(2).replace('.', ',');
}

// Aktions-/Gratis-Label am Zeilenanfang ([GRATIS], [AKTION], …) entfernen:
// auf dem Bon nur Produkt + Preis, keine Sonderkennzeichnung.
// Spiegelbild von lib/orders/gift-label.ts. (Präfix bleibt in der DB — dort
// wird es z. B. für Favoriten gebraucht.)
const LEADING_LABEL_RE = /^(?:\s*\[[^\]]*\]\s*)+/;
function stripPromoLabels(name) {
  return String(name == null ? '' : name).replace(LEADING_LABEL_RE, '');
}

function groupItemsByCategory(items) {
  const order = [];
  const map = new Map();
  for (const item of items || []) {
    const cat = (item.category && String(item.category).trim()) || FALLBACK_CATEGORY;
    if (!map.has(cat)) { map.set(cat, []); order.push(cat); }
    map.get(cat).push(item);
  }
  return order.map((category) => ({ category, items: map.get(category) }));
}

function formatDateTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const isComPort = /^\\\\\.\\/.test(PRINTER_INTERFACE); // \\.\COM3

async function printKitchenReceipt(n) {
  const printer = getPrinter();
  if (!isComPort) {
    const connected = await printer.isPrinterConnected();
    if (!connected) throw new Error('Printer not connected: ' + PRINTER_INTERFACE);
  }

  // Шапка
  printer.alignCenter();
  if (PRINT_USE_DOUBLE_SIZE) printer.setTextSize(1, 1); else printer.setTextNormal();
  printer.bold(true);
  printer.println('DUMBO SLICE PIZZA');
  printer.bold(false);
  printer.setTextNormal();
  printer.println('Kurhausstr. 11A - Bad Kissingen');
  printer.println('Tel: +49 163 2165979');
  printer.drawLine();

  // Заказ
  printer.alignLeft();
  printer.bold(true);
  printer.leftRight('#' + n.orderId, formatDateTime(new Date()));
  printer.println((n.deliveryType === 'pickup' ? 'ABHOLUNG' : 'LIEFERUNG'));
  printer.bold(false);
  if (n.desiredDeliveryTime) printer.println('Zeit: ' + n.desiredDeliveryTime);
  if (n.customerName) printer.println('Kunde: ' + n.customerName);
  if (n.phoneNumber) printer.println('Tel: ' + n.phoneNumber);
  if (n.deliveryType === 'delivery' && n.address) printer.println(n.address);
  printer.drawLine();

  // Позиции по категориям
  for (const group of groupItemsByCategory(n.items)) {
    printer.bold(true);
    printer.println(group.category); // КАТЕГОРИЯ — жирная
    printer.bold(false);
    for (const item of group.items) {
      const displayName = stripPromoLabels(item.name);
      const lineTotal = (item.price != null ? item.price : 0) * item.quantity;
      const right = item.price != null ? formatEuro(lineTotal) : '';
      const left = item.quantity + 'x ' + displayName;
      if (right) printer.leftRight(left, right);
      else printer.println(left);
      (item.customizations || []).forEach((c) => printer.println('   - ' + c));
    }
  }
  printer.drawLine();

  // Итоги
  if (n.deliveryType === 'delivery' && (n.deliveryFee || 0) > 0) {
    printer.leftRight('Lieferung:', formatEuro(n.deliveryFee || 0));
  }
  printer.bold(true);
  printer.leftRight('GESAMT:', formatEuro(n.totalAmount));
  printer.bold(false);
  printer.drawLine();

  // Оплата
  printer.bold(true);
  printer.println('ZAHLUNG: ' + formatPaymentMethod(n.paymentMethod));
  printer.bold(false);

  // Комментарий
  if (n.notes && String(n.notes).trim()) {
    printer.drawLine();
    printer.bold(true);
    printer.println('HINWEIS:');
    printer.bold(false);
    printer.println(String(n.notes).trim());
  }

  // Подвал + отрез
  printer.drawLine();
  printer.alignCenter();
  printer.println('Kein Kassenbon');
  for (let i = 0; i < PRINT_FEED_BEFORE_CUT; i++) printer.newLine();
  if (PRINT_PARTIAL_CUT) printer.partialCut();
  else printer.cut();
  await printer.execute();
}

async function fetchPendingOrders() {
  const url = `${API_BASE_URL.replace(/\/$/, '')}/api/orders?kitchenPrintStatus=pending&limit=10`;
  const res = await fetch(url, { headers: { 'X-Print-Agent-Key': PRINT_AGENT_SECRET } });
  if (!res.ok) throw new Error('API ' + res.status);
  const data = await res.json();
  return data.orders || [];
}

async function markPrinted(orderId) {
  const url = `${API_BASE_URL.replace(/\/$/, '')}/api/orders/${orderId}/mark-printed`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-Print-Agent-Key': PRINT_AGENT_SECRET, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('mark-printed ' + res.status);
}

let notConnectedHintShown = false;

async function runOnce() {
  const orders = await fetchPendingOrders();
  if (orders.length === 0) {
    console.log('[poll]', new Date().toLocaleTimeString('de-DE'), '— no pending orders');
    return;
  }
  for (const order of orders) {
    try {
      await printKitchenReceipt(orderToNotification(order));
      await markPrinted(order._id);
      console.log('[OK] Printed order', order.orderNumber);
    } catch (err) {
      console.error('[ERR] Order', order.orderNumber, err.message);
      if (!notConnectedHintShown && err.message.includes('Printer not connected')) {
        notConnectedHintShown = true;
        console.error('>>> Run:  node print-agent.js --list-ports   and set KITCHEN_PRINTER_INTERFACE=COM3');
      }
    }
  }
}

async function loop() {
  if (!PRINT_AGENT_SECRET) {
    console.error('Set PRINT_AGENT_SECRET in .env or environment');
    process.exit(1);
  }
  console.log('Print agent: polling', API_BASE_URL, 'every', POLL_INTERVAL_MS, 'ms. Printer:', PRINTER_RAW);
  for (;;) {
    try {
      await runOnce();
    } catch (e) {
      console.error('Poll error:', e.message);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

loop();
