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

const os = require('os');
const path = require('path');
const { createPrintAgent, createPrintedStore } = require('./print-agent-core');

// Идентификатор экземпляра — в логах агента и сервера (decision=claimed/printed).
const AGENT_ID = `${os.hostname()}#${process.pid}`;
// Persistent-хранилище напечатанных ключей: переживает рестарт, защищает от
// второго чека при потерянном подтверждении/reclaim'е зависшего заказа.
const STATE_FILE =
  process.env.PRINT_AGENT_STATE_FILE || path.join(__dirname, 'printed-orders.json');

// Несколько принтеров через запятую (переходный режим при замене железа):
//   KITCHEN_PRINTER_INTERFACE=COM3,tcp://192.168.192.168:9100
// Чек печатается на ВСЕХ; задание успешно, если напечатал хотя бы один —
// отказ одного принтера не блокирует очередь и не дублирует чек на втором.
const PRINTER_RAW_LIST = PRINTER_RAW.split(',').map((s) => s.trim()).filter(Boolean);

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

const envBool = (v, def) => {
  if (v === undefined || v === '') return def;
  return /^1|true|yes$/i.test(String(v));
};

// Настройки конкретного принтера можно переопределить суффиксом его номера в
// списке (нумерация с 1): PRINT_LINE_WIDTH_2=48, PRINT_PARTIAL_CUT_2=0.
// Без суффикса переменная действует на все принтеры (обратная совместимость).
function buildPrinterEntry(raw, index) {
  const isCom = /^COM\d+$/i.test(raw);
  const isTcp = /^tcp:\/\//i.test(raw);
  const isByName = !isCom && !isTcp && !/^[\\\/]/.test(raw);
  const hintsPortable =
    /^1|true|yes$/i.test(String(process.env.PRINT_PORTABLE || '')) ||
    /TM-P20|TMP20|TM\s*P20/i.test(raw);
  const suffix = index > 0 ? '_' + (index + 1) : '';
  const widthEnv = process.env['PRINT_LINE_WIDTH' + suffix] || process.env.PRINT_LINE_WIDTH;
  const cutEnvRaw =
    process.env['PRINT_PARTIAL_CUT' + suffix] !== undefined &&
    process.env['PRINT_PARTIAL_CUT' + suffix] !== ''
      ? process.env['PRINT_PARTIAL_CUT' + suffix]
      : process.env.PRINT_PARTIAL_CUT;
  const defWidth = hintsPortable ? 32 : 48;
  return {
    raw,
    // Windows: "COM3" -> "\\.\COM3". Network: "tcp://..." stays. Name: as-is for driver.
    iface: isCom ? '\\\\.\\' + raw.toUpperCase() : raw,
    isCom,
    isByName,
    width: Math.min(48, Math.max(24, parseInt(widthEnv || '', 10) || defWidth)),
    partialCut:
      cutEnvRaw !== undefined && cutEnvRaw !== '' ? envBool(cutEnvRaw, false) : hintsPortable,
  };
}
const PRINTERS = PRINTER_RAW_LIST.map(buildPrinterEntry);

const PRINT_FEED_BEFORE_CUT = Math.min(
  8,
  Math.max(0, parseInt(process.env.PRINT_FEED_BEFORE_CUT || '3', 10) || 3)
);
let printerDriver = null;
try {
  printerDriver = require('printer');
} catch (_) {}

if (PRINTERS.some((p) => p.isByName) && !printerDriver) {
  console.error('Printer by name needs the "printer" package (npm install printer --legacy-peer-deps).');
  console.error('Or use a COM port: set KITCHEN_PRINTER_INTERFACE=COM3 in .env');
  process.exit(1);
}

function getPrinter(entry) {
  const iface = printerDriver && entry.isByName
    ? 'printer:' + entry.raw
    : entry.iface;
  const config = {
    type: PrinterTypes.EPSON,
    interface: iface,
    options: { timeout: 8000 },
    characterSet: printerCharacterSet,
    width: entry.width,
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

// Цена позиции без «EUR » — экономит 4 знака строки под длинные названия.
function formatPrice(value) {
  return (Number(value) || 0).toFixed(2).replace('.', ',');
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

async function printKitchenReceiptTo(entry, n) {
  const printer = getPrinter(entry);
  if (!entry.isCom) {
    const connected = await printer.isPrinterConnected();
    if (!connected) throw new Error('Printer not connected: ' + entry.iface);
  }

  // Шапка. ВНИМАНИЕ: в node-thermal-printer аргументы setTextSize(a, b)
  // физически означают (ШИРИНА, ВЫСОТА), вопреки её же документации: байт
  // GS ! n собирается как hex `${a}${b}`, а старший полубайт n — множитель
  // ширины. 0 = обычный, 1 = двойной, 2 = тройной.
  // Двойная ширина халвирует символы в строке, поэтому все leftRight-строки
  // (цена справа) печатаются setTextSize(0, 1) — выше, но колонки на месте.
  printer.alignCenter();
  printer.setTextSize(1, 1);
  printer.bold(true);
  printer.println('DUMBO SLICE PIZZA');
  printer.bold(false);
  printer.setTextNormal();
  printer.println('Kurhausstr. 11A - Bad Kissingen');
  printer.println('Tel: +49 163 2165979');
  printer.drawLine();

  // Заказ
  printer.alignLeft();
  printer.setTextSize(0, 1);
  printer.bold(true);
  printer.leftRight('#' + n.orderId, formatDateTime(new Date()));
  printer.println(n.deliveryType === 'pickup' ? 'ABHOLUNG' : 'LIEFERUNG');
  printer.bold(false);
  if (n.desiredDeliveryTime) printer.println('Zeit: ' + n.desiredDeliveryTime);
  if (n.customerName) printer.println('Kunde: ' + n.customerName);
  if (n.phoneNumber) printer.println('Tel: ' + n.phoneNumber);
  if (n.deliveryType === 'delivery' && n.address) printer.println(n.address);
  printer.setTextNormal();
  printer.drawLine();

  // Позиции по категориям
  for (const group of groupItemsByCategory(n.items)) {
    printer.setTextSize(1, 1); // КАТЕГОРИЯ — крупно, двойная высота и ширина
    printer.bold(true);
    printer.println(group.category);
    printer.bold(false);
    printer.setTextSize(0, 1); // позиции — двойная высота, полная ширина колонок
    for (const item of group.items) {
      const displayName = stripPromoLabels(item.name);
      const lineTotal = (item.price != null ? item.price : 0) * item.quantity;
      const right = item.price != null ? formatPrice(lineTotal) : '';
      const left = item.quantity + 'x ' + displayName;
      if (!right) {
        printer.println(left);
      } else if (left.length + right.length + 1 <= entry.width) {
        printer.leftRight(left, right);
      } else {
        // Название длиннее строки: не рвём его посреди слова впритык к цене,
        // а печатаем цену отдельной строкой, прижатой вправо.
        printer.println(left);
        printer.leftRight('', right);
      }
      (item.customizations || []).forEach((c) => printer.println('   - ' + c));
    }
  }
  printer.setTextNormal();
  printer.drawLine();

  // Итоги
  printer.setTextSize(0, 1);
  if (n.deliveryType === 'delivery' && (n.deliveryFee || 0) > 0) {
    printer.leftRight('Lieferung:', formatEuro(n.deliveryFee || 0));
  }
  printer.setTextSize(1, 1);
  printer.bold(true);
  // Не leftRight: при двойной ширине его паддинг до полной строки переносится.
  printer.println('GESAMT: ' + formatEuro(n.totalAmount));
  printer.bold(false);
  printer.setTextNormal();
  printer.drawLine();

  // Оплата
  printer.setTextSize(0, 1);
  printer.bold(true);
  printer.println('ZAHLUNG: ' + formatPaymentMethod(n.paymentMethod));
  printer.bold(false);
  printer.setTextNormal();

  // Комментарий клиента — самый крупный блок чека: инвертированный заголовок
  // (белым по чёрному) + текст выше всех остальных строк и подчёркнут.
  if (n.notes && String(n.notes).trim()) {
    printer.drawLine();
    printer.setTextSize(1, 1);
    printer.invert(true);
    printer.bold(true);
    printer.println(' HINWEIS: ');
    printer.invert(false);
    printer.setTextSize(0, 2); // тройная высота, обычная ширина: полные колонки
    printer.underline(true);
    printer.println(String(n.notes).trim());
    printer.underline(false);
    printer.bold(false);
    printer.setTextNormal();
  }

  // Подвал + отрез
  printer.drawLine();
  printer.alignCenter();
  printer.println('Kein Kassenbon');
  for (let i = 0; i < PRINT_FEED_BEFORE_CUT; i++) printer.newLine();
  if (entry.partialCut) printer.partialCut();
  else printer.cut();
  await printer.execute();
}

// Печать на все настроенные принтеры. Успех = хотя бы один напечатал: чек
// физически существует, поэтому заказ подтверждаем — иначе retry продублировал
// бы чек на работающем принтере. Отказы остальных — в лог.
async function printKitchenReceipt(n) {
  const errors = [];
  let printedOn = 0;
  for (const entry of PRINTERS) {
    try {
      await printKitchenReceiptTo(entry, n);
      printedOn++;
    } catch (err) {
      errors.push(entry.raw + ': ' + (err && err.message));
    }
  }
  if (printedOn === 0) {
    throw new Error('All printers failed: ' + errors.join(' | '));
  }
  if (errors.length) {
    console.error(
      '[print] decision=partial printed_on=' + printedOn + '/' + PRINTERS.length +
      ' failed=' + errors.join(' | ')
    );
  }
}

async function fetchPendingOrders() {
  const url = `${API_BASE_URL.replace(/\/$/, '')}/api/orders?kitchenPrintStatus=pending&limit=10`;
  const res = await fetch(url, {
    headers: { 'X-Print-Agent-Key': PRINT_AGENT_SECRET, 'X-Print-Agent-Id': AGENT_ID }
  });
  if (!res.ok) throw new Error('API ' + res.status);
  const data = await res.json();
  return data.orders || [];
}

// printSeq — номер отработанного задания печати. Сервер подтверждает статус
// только если он не изменился: если пока шла печать оператор нажал «Напечатать
// ещё раз», заказ должен остаться в очереди, а не уехать в 'completed'.
async function markPrinted(orderId, printSeq) {
  const url = `${API_BASE_URL.replace(/\/$/, '')}/api/orders/${orderId}/mark-printed`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Print-Agent-Key': PRINT_AGENT_SECRET,
      'X-Print-Agent-Id': AGENT_ID,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ success: true, printSeq: Number(printSeq) || 0 })
  });
  if (!res.ok) throw new Error('mark-printed ' + res.status);
}

let notConnectedHintShown = false;

// Логика тика (идемпотентность по ключу заказа, нереентрантность) — в
// print-agent-core.js; здесь только реальные I/O-зависимости.
const agent = createPrintAgent({
  fetchPendingOrders,
  printReceipt: (order) => printKitchenReceipt(orderToNotification(order)),
  markPrinted,
  store: createPrintedStore(STATE_FILE),
  agentId: AGENT_ID,
  onOrderError: (err) => {
    if (!notConnectedHintShown && String(err && err.message).includes('Printer not connected')) {
      notConnectedHintShown = true;
      console.error('>>> Run:  node print-agent.js --list-ports   and set KITCHEN_PRINTER_INTERFACE=COM3');
    }
  },
});

async function loop() {
  if (!PRINT_AGENT_SECRET) {
    console.error('Set PRINT_AGENT_SECRET in .env or environment');
    process.exit(1);
  }
  console.log('Print agent: polling', API_BASE_URL, 'every', POLL_INTERVAL_MS, 'ms. Printer:', PRINTER_RAW);
  console.log('Agent id:', AGENT_ID, '| printed-keys store:', STATE_FILE);
  // Следующий тик стартует только после завершения предыдущего (никаких
  // наложений setInterval); печать дольше интервала просто сдвигает цикл.
  for (;;) {
    try {
      const res = await agent.runOnce();
      if (!res.skipped && res.count === 0) {
        console.log('[poll]', new Date().toLocaleTimeString('de-DE'), '— no pending orders');
      }
    } catch (e) {
      console.error('Poll error:', e.message);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

loop();
