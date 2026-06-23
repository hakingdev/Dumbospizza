/**
 * Серверная генерация PDF-счёта (Rechnung / Beleg) для онлайн-оплаченного заказа.
 *
 * Содержимое 1:1 повторяет экранный Beleg (см. components/checkout/OrderVatReceipt):
 * реквизиты продавца, № и дата, данные клиента, адрес доставки, способ оплаты,
 * позиции, скидки, итог, налоговая разбивка (USt. 7 % / 19 %) и пометка
 * «Online bezahlt». Числа берём из общей логики buildOrderTax, поэтому суммы в
 * PDF и на экране всегда совпадают.
 *
 * Используем pdf-lib (чистый JS, без нативных зависимостей) — работает в
 * serverless-окружении Vercel без дополнительной настройки.
 */

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib'
import { SELLER } from '../company'
import { buildOrderTax, formatAmount, formatVatRate, FOOD_VAT_RATE } from './tax'

export interface InvoiceOrder {
  orderNumber: string | number
  createdAt: string | Date
  paymentMethod?: string | null
  paymentStatus?: string | null
  customerName?: string
  phoneNumber?: string
  email?: string
  deliveryType?: 'delivery' | 'pickup' | string
  deliveryAddress?: {
    street?: string
    houseNumber?: string
    postalCode?: string
    city?: string
    floor?: string
    notes?: string
  }
  subtotal?: number
  deliveryFee?: number
  loyaltyPointsUsed?: number
  discount?: { code?: string; amount?: number; type?: string } | null
  promotionDiscount?: number
  total: number
  items?: Array<{
    name: string
    quantity: number
    price?: number
    totalPrice?: number
    category?: string
    taxRate?: number | null
  }>
}

// Геометрия страницы A4 (в пунктах) и поля.
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 50
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN
const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.4, 0.4, 0.4)
const LINE = rgb(0.8, 0.8, 0.8)

/**
 * pdf-lib StandardFonts кодирует текст в WinAnsi. Немецкие умляуты (ä ö ü ß) и
 * «€» в WinAnsi есть, но на всякий случай заменяем символы вне набора, чтобы
 * генерация не падала на неожиданных данных (эмодзи в названии товара и т.п.).
 */
function sanitize(text: string): string {
  return String(text ?? '').replace(/[^\x20-\x7E -ÿ€]/g, '')
}

class PdfCursor {
  page: PDFPage
  y: number
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont) {
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.y = PAGE_HEIGHT - MARGIN
  }

  private ensureSpace(height: number) {
    if (this.y - height < MARGIN) {
      this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      this.y = PAGE_HEIGHT - MARGIN
    }
  }

  text(value: string, opts: { size?: number; bold?: boolean; color?: typeof INK; x?: number } = {}) {
    const size = opts.size ?? 10
    this.ensureSpace(size + 4)
    this.y -= size
    this.page.drawText(sanitize(value), {
      x: opts.x ?? MARGIN,
      y: this.y,
      size,
      font: opts.bold ? this.bold : this.font,
      color: opts.color ?? INK,
    })
    this.y -= 4
  }

  /** Строка «слева … справа» с правым выравниванием суммы. */
  row(left: string, right: string, opts: { size?: number; bold?: boolean; color?: typeof INK } = {}) {
    const size = opts.size ?? 10
    const font = opts.bold ? this.bold : this.font
    this.ensureSpace(size + 4)
    this.y -= size
    this.page.drawText(sanitize(left), { x: MARGIN, y: this.y, size, font, color: opts.color ?? INK })
    const rightText = sanitize(right)
    const w = font.widthOfTextAtSize(rightText, size)
    this.page.drawText(rightText, { x: CONTENT_RIGHT - w, y: this.y, size, font, color: opts.color ?? INK })
    this.y -= 4
  }

  /** Произвольная строка из ячеек с заданным x и выравниванием (для таблиц). */
  cols(
    cells: Array<{ text: string; x: number; align?: 'left' | 'right' }>,
    opts: { size?: number; bold?: boolean; color?: typeof INK } = {}
  ) {
    const size = opts.size ?? 10
    const font = opts.bold ? this.bold : this.font
    this.ensureSpace(size + 4)
    this.y -= size
    for (const cell of cells) {
      const text = sanitize(cell.text)
      const x =
        cell.align === 'right' ? cell.x - font.widthOfTextAtSize(text, size) : cell.x
      this.page.drawText(text, { x, y: this.y, size, font, color: opts.color ?? INK })
    }
    this.y -= 4
  }

  hr(gapBefore = 6, gapAfter = 6) {
    this.y -= gapBefore
    this.ensureSpace(1)
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: CONTENT_RIGHT, y: this.y },
      thickness: 0.7,
      color: LINE,
    })
    this.y -= gapAfter
  }

  space(h = 8) {
    this.y -= h
  }
}

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function paymentLabel(method?: string | null): string {
  switch (method) {
    case 'cash':
      return 'Bar bei Lieferung'
    case 'card':
      return 'Karte bei Lieferung'
    case 'online':
      return 'Online-Zahlung'
    default:
      return method || 'Online-Zahlung'
  }
}

/**
 * Строит PDF счёта и возвращает байты документа. Налоговая логика — общая
 * (buildOrderTax), поэтому работает только для онлайн-оплаты; вызывающий код
 * обязан заранее проверить applied (см. эндпоинт invoice).
 */
export async function buildInvoicePdf(order: InvoiceOrder): Promise<Uint8Array> {
  const tax = buildOrderTax({
    paymentMethod: order.paymentMethod,
    items: (order.items || []).map((it) => ({
      name: it.name,
      quantity: it.quantity,
      totalPrice: it.totalPrice ?? (it.price ?? 0) * it.quantity,
      category: it.category,
      taxRate: it.taxRate,
    })),
  })

  const doc = await PDFDocument.create()
  doc.setTitle(`Rechnung #${order.orderNumber}`)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const c = new PdfCursor(doc, font, bold)

  // Заголовок + реквизиты продавца.
  c.text('Rechnung / Beleg (inkl. MwSt.)', { size: 16, bold: true })
  c.space(4)
  c.text(SELLER.legalName, { size: 11, bold: true })
  c.text(SELLER.brand)
  c.text(`${SELLER.street}, ${SELLER.postalCode} ${SELLER.city}`)
  c.text(`USt-IdNr.: ${SELLER.vatId}`, { color: MUTED })
  c.text(`Steuernummer: ${SELLER.taxNumber}`, { color: MUTED })

  c.hr()

  // Номер, дата, клиент.
  c.row('Beleg-Nr.', `#${order.orderNumber}`, { bold: true })
  c.row('Datum', `${formatDate(order.createdAt)} Uhr`)
  if (order.customerName) c.row('Kunde', order.customerName)
  if (order.phoneNumber) c.row('Telefon', order.phoneNumber)
  if (order.email) c.row('E-Mail', order.email)

  // Адрес доставки / самовывоз.
  c.space(4)
  if (order.deliveryType === 'delivery' && order.deliveryAddress) {
    const a = order.deliveryAddress
    c.text('Lieferadresse', { bold: true })
    const streetLine = [a.street, a.houseNumber].filter(Boolean).join(' ')
    if (streetLine) c.text(streetLine, { color: MUTED })
    const cityLine = [a.postalCode, a.city].filter(Boolean).join(' ')
    if (cityLine) c.text(cityLine, { color: MUTED })
    if (a.floor) c.text(`Etage / Wohnung: ${a.floor}`, { color: MUTED })
  } else {
    c.text('Abholung', { bold: true })
    c.text(`${SELLER.street}, ${SELLER.postalCode} ${SELLER.city}`, { color: MUTED })
  }

  c.space(2)
  c.row('Zahlungsmethode', paymentLabel(order.paymentMethod), { bold: true })

  c.hr()

  // Позиции: Artikel | MwSt | Brutto.
  c.row('Artikel', 'Brutto', { size: 9, color: MUTED })
  tax.lineItems.forEach((line) => {
    const name = `${line.quantity}x ${line.name}  (${formatVatRate(line.vatRate)} MwSt.)`
    c.row(name, `${formatAmount(line.gross)} €`)
  })

  c.hr()

  // Итоги и скидки.
  if (typeof order.subtotal === 'number') {
    c.row('Zwischensumme', `${formatAmount(order.subtotal)} €`, { color: MUTED })
  }
  if (typeof order.deliveryFee === 'number' && order.deliveryFee > 0) {
    c.row('Lieferung', `${formatAmount(order.deliveryFee)} €`, { color: MUTED })
  }
  if (order.loyaltyPointsUsed && order.loyaltyPointsUsed > 0) {
    c.row('Rabatt (Punkte)', `-${formatAmount(order.loyaltyPointsUsed / 100)} €`, { color: MUTED })
  }
  if (order.discount && typeof order.discount.amount === 'number' && order.discount.amount > 0) {
    const label = order.discount.code ? `Gutschein (${order.discount.code})` : 'Gutschein'
    c.row(label, `-${formatAmount(order.discount.amount)} €`, { color: MUTED })
  }
  if (order.promotionDiscount && order.promotionDiscount > 0) {
    c.row('Aktionsrabatt', `-${formatAmount(order.promotionDiscount)} €`, { color: MUTED })
  }
  c.space(2)
  c.row('Gesamt (inkl. MwSt.)', `${formatAmount(order.total)} €`, { size: 12, bold: true })

  c.hr()

  // Налоговая разбивка: Satz | Netto | USt. | Brutto.
  c.text('Aufschlüsselung der Steuern', { bold: true })
  c.space(2)
  // Колонки таблицы налогов: Satz слева, остальные — выровнены по правому краю.
  const colNet = 300
  const colVat = 420
  const colGross = CONTENT_RIGHT
  c.cols(
    [
      { text: 'Satz', x: MARGIN },
      { text: 'Netto', x: colNet, align: 'right' },
      { text: 'USt.', x: colVat, align: 'right' },
      { text: 'Brutto', x: colGross, align: 'right' },
    ],
    { size: 9, bold: true, color: MUTED }
  )
  tax.breakdown.forEach((r) => {
    c.cols(
      [
        { text: formatVatRate(r.rate), x: MARGIN },
        { text: `${formatAmount(r.net)} €`, x: colNet, align: 'right' },
        { text: `${formatAmount(r.vat)} €`, x: colVat, align: 'right' },
        { text: `${formatAmount(r.gross)} €`, x: colGross, align: 'right' },
      ],
      { color: r.rate === FOOD_VAT_RATE ? rgb(0.13, 0.55, 0.33) : rgb(0.16, 0.4, 0.75) }
    )
  })

  c.hr()
  c.text('Online bezahlt. Alle Preise inkl. gesetzlicher MwSt.', { size: 9, color: MUTED })
  c.text(`${SELLER.legalName}, ${SELLER.street}, ${SELLER.postalCode} ${SELLER.city}.`, {
    size: 9,
    color: MUTED,
  })

  return doc.save()
}
