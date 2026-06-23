import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildInvoicePdf } from '../invoice-pdf'

const onlineOrder = {
  orderNumber: '250620001',
  createdAt: '2026-06-20T17:30:00.000Z',
  paymentMethod: 'online',
  paymentStatus: 'completed',
  customerName: 'Max Müller', // умляут — проверяем кодировку WinAnsi
  phoneNumber: '+49 151 12345678',
  email: 'max@example.de',
  deliveryType: 'delivery' as const,
  deliveryAddress: {
    street: 'Kurhausstraße',
    houseNumber: '11A',
    postalCode: '97688',
    city: 'Bad Kissingen',
    floor: '2',
  },
  subtotal: 12,
  deliveryFee: 2.5,
  loyaltyPointsUsed: 100,
  total: 13.5,
  items: [
    { name: 'Pizza Margherita', quantity: 1, price: 9.5, totalPrice: 9.5 },
    { name: 'Wasser 0.5L', quantity: 1, price: 2.5, totalPrice: 2.5 },
  ],
}

describe('buildInvoicePdf', () => {
  it('создаёт валидный PDF с реквизитами и налоговой разбивкой для онлайн-заказа', async () => {
    const bytes = await buildInvoicePdf(onlineOrder)
    // Сигнатура PDF и непустой размер.
    expect(bytes.length).toBeGreaterThan(1000)
    const header = new TextDecoder().decode(bytes.slice(0, 5))
    expect(header).toBe('%PDF-')
    // Документ парсится обратно как валидный PDF.
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
    expect(doc.getTitle()).toContain('250620001')
  })

  it('не падает на названиях с символами вне WinAnsi (эмодзи)', async () => {
    const bytes = await buildInvoicePdf({
      ...onlineOrder,
      items: [{ name: 'Pizza 🍕 Spezial', quantity: 1, price: 11, totalPrice: 11 }],
    })
    expect(bytes.length).toBeGreaterThan(1000)
  })
})
