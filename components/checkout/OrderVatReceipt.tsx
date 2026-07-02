'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import {
  buildOrderTax,
  formatAmount,
  formatVatRate,
  FOOD_VAT_RATE,
} from '../../lib/orders/tax'
import { downloadOrderInvoice } from '../../lib/orders/download-invoice'
import { SELLER } from '../../lib/company'

interface OrderVatReceiptProps {
  order: {
    _id?: string
    id?: string
    orderNumber: string | number
    createdAt: string | Date
    paymentMethod?: string | null
    phoneNumber?: string
    subtotal?: number
    deliveryFee?: number
    total: number
    customerName?: string
    items?: Array<{
      name: string
      quantity: number
      price?: number
      totalPrice?: number
      category?: string
      taxRate?: number | null
    }>
  }
  /** Подписанный токен доступа к заказу — для скачивания PDF-счёта без сессии. */
  accessToken?: string | null
}

/**
 * Клиентский НДС-чек (Beleg / Kleinbetragsrechnung) для онлайн-оплаты.
 * Провайдер-независим: НДС берётся из нашей логики buildOrderTax (7 % еда /
 * 19 % вода+алкоголь), а не из чека Stripe/SumUp. Для офлайн-оплаты (cash/card
 * при получении) НДС не выделяется — компонент возвращает null.
 *
 * Кнопка «Beleg als PDF speichern» открывает системный диалог печати
 * (window.print) — пользователь сохраняет PDF без серверных зависимостей.
 * Печатается только этот блок (#vat-receipt), см. @media print в globals.css.
 */
export default function OrderVatReceipt({ order, accessToken }: OrderVatReceiptProps) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const handleDownload = async () => {
    const orderId = order._id || order.id
    if (!orderId || downloading) return
    setDownloading(true)
    setDownloadError(null)
    try {
      await downloadOrderInvoice(String(orderId), {
        token: accessToken,
        orderNumber: order.orderNumber,
      })
    } catch (err: any) {
      setDownloadError(err?.message || 'Die Rechnung konnte nicht erstellt werden.')
    } finally {
      setDownloading(false)
    }
  }

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

  // Только онлайн-оплата: для cash/card при получении НДС-чек не формируем.
  if (!tax.applied || tax.breakdown.length === 0) {
    return null
  }

  const orderDate = new Date(order.createdAt)

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-gray-100 p-4 no-print sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-semibold">Beleg (inkl. MwSt.)</h3>
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-primary-600 px-3 py-1.5 text-sm text-primary-600 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {downloading ? 'Rechnung wird erstellt…' : 'Rechnung als PDF speichern'}
          </button>
          {downloadError && <span className="text-xs text-red-600">{downloadError}</span>}
        </div>
      </div>

      {/* Печатаемая область */}
      <div id="vat-receipt" className="notranslate p-6 text-sm text-gray-800" translate="no">
        {/* Реквизиты продавца */}
        <div className="mb-4">
          <p className="text-base font-bold">{SELLER.legalName}</p>
          <p>{SELLER.brand}</p>
          <p>
            {SELLER.street}, {SELLER.postalCode} {SELLER.city}
          </p>
          <p>USt-IdNr.: {SELLER.vatId}</p>
          <p>Steuernummer: {SELLER.taxNumber}</p>
        </div>

        <div className="mb-4 border-t border-gray-200 pt-3">
          <div className="flex justify-between">
            <span className="font-semibold">Beleg-Nr.</span>
            <span>#{order.orderNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold">Datum</span>
            <span>
              {orderDate.toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              Uhr
            </span>
          </div>
          {order.customerName && (
            <div className="flex justify-between">
              <span className="font-semibold">Kunde</span>
              <span>{order.customerName}</span>
            </div>
          )}
        </div>

        {/* Позиции */}
        <table className="mb-4 w-full border-t border-gray-200 pt-2 text-left">
          <thead>
            <tr className="border-b border-gray-200 text-xs text-gray-500">
              <th className="py-2 font-medium">Artikel</th>
              <th className="py-2 text-center font-medium">MwSt.</th>
              <th className="py-2 text-right font-medium">Brutto</th>
            </tr>
          </thead>
          <tbody>
            {tax.lineItems.map((line, i) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="py-1.5">
                  {line.quantity}× {line.name}
                </td>
                <td className="py-1.5 text-center">{formatVatRate(line.vatRate)}</td>
                <td className="py-1.5 text-right">{formatAmount(line.gross)} €</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Итоги заказа */}
        <div className="mb-4 space-y-1">
          {typeof order.subtotal === 'number' && (
            <div className="flex justify-between">
              <span className="text-gray-600">Zwischensumme</span>
              <span>{formatAmount(order.subtotal)} €</span>
            </div>
          )}
          {typeof order.deliveryFee === 'number' && order.deliveryFee > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-600">Lieferung</span>
              <span>{formatAmount(order.deliveryFee)} €</span>
            </div>
          )}
          <div className="flex justify-between border-t border-gray-200 pt-1 font-bold">
            <span>Gesamt (inkl. MwSt.)</span>
            <span>{formatAmount(order.total)} €</span>
          </div>
        </div>

        {/* Налоговая разбивка по ставкам */}
        <div className="border-t border-gray-200 pt-3">
          <p className="mb-2 font-semibold">Aufschlüsselung der Steuern</p>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500">
                <th className="py-1 font-medium">Satz</th>
                <th className="py-1 text-right font-medium">Netto</th>
                <th className="py-1 text-right font-medium">USt.</th>
                <th className="py-1 text-right font-medium">Brutto</th>
              </tr>
            </thead>
            <tbody>
              {tax.breakdown.map((row) => (
                <tr key={row.rate} className="border-b border-gray-50">
                  <td className="py-1.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.rate === FOOD_VAT_RATE
                          ? 'bg-green-100 text-green-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}
                    >
                      {formatVatRate(row.rate)}
                    </span>
                  </td>
                  <td className="py-1.5 text-right">{formatAmount(row.net)} €</td>
                  <td className="py-1.5 text-right">{formatAmount(row.vat)} €</td>
                  <td className="py-1.5 text-right">{formatAmount(row.gross)} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-gray-500">
          Online bezahlt. Alle Preise inkl. gesetzlicher MwSt. {SELLER.legalName},{' '}
          {SELLER.street}, {SELLER.postalCode} {SELLER.city}.
        </p>
      </div>
    </div>
  )
}
