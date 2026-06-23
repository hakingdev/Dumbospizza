'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import OrderVatReceipt from './OrderVatReceipt'
import { buildOrderTax } from '../../lib/orders/tax'

interface OrderVatReceiptModalProps {
  order: React.ComponentProps<typeof OrderVatReceipt>['order']
  open: boolean
  onClose: () => void
}

/**
 * Модалка с НДС-чеком (Beleg), которая автоматически всплывает клиенту после
 * успешной онлайн-оплаты (карта / Apple Pay / Google Pay). Внутри рендерит ровно
 * один экземпляр OrderVatReceipt (важно: #vat-receipt должен быть в DOM в
 * единственном числе, иначе печать в PDF сработает некорректно).
 *
 * Для офлайн-оплаты (cash / card при получении) чек не формируется → модалка не
 * показывается (возвращает null), даже если open=true.
 */
export default function OrderVatReceiptModal({ order, open, onClose }: OrderVatReceiptModalProps) {
  // Esc закрывает модалку.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  // Не показываем пустую модалку, если НДС-чек неприменим (офлайн-оплата).
  const tax = buildOrderTax({
    paymentMethod: order?.paymentMethod,
    items: (order?.items || []).map((it) => ({
      name: it.name,
      quantity: it.quantity,
      totalPrice: it.totalPrice ?? (it.price ?? 0) * it.quantity,
      category: it.category,
      taxRate: it.taxRate,
    })),
  })
  if (!tax.applied || tax.breakdown.length === 0) return null

  return (
    <div
      data-testid="receipt-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Beleg"
      onClick={onClose}
      className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
    >
      <div className="relative my-8 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          data-testid="receipt-modal-close"
          className="no-print absolute -right-2 -top-2 z-10 rounded-full bg-white p-1.5 shadow hover:bg-gray-100"
        >
          <X className="h-5 w-5" />
        </button>
        <OrderVatReceipt order={order} />
      </div>
    </div>
  )
}
