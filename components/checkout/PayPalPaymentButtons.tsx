'use client'

import { useRef, useState } from 'react'
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js'

/**
 * PayPal-кнопки для чекаута (Standard Checkout, Orders v2).
 *
 * Клиент знает только НЕсекретные вещи: NEXT_PUBLIC_PAYPAL_CLIENT_ID и id
 * заказа. Суммы считает сервер: createOrder → POST /api/payments/paypal/
 * create-order (отдаёт paypalOrderId), onApprove → POST /api/payments/paypal/
 * capture. Оба запроса несут HMAC-токен заказа (владение).
 *
 * INSTRUMENT_DECLINED: сервер отвечает { restart: true } → actions.restart()
 * даёт покупателю выбрать другой способ в том же PayPal-окне.
 * Pay Later / Venmo / карта отключены через disable-funding (ТЗ §3).
 * Рендерится standalone-кнопка ровно одного funding-источника (prop
 * fundingSource): 'paypal' или 'sepa' — SEPA-Lastschrift в чекауте идёт
 * отдельным пунктом списка, а не второй кнопкой в стеке.
 */

interface PayPalPaymentButtonsProps {
  orderId: string
  /** HMAC-токен доступа к заказу (из ответа POST /api/orders). */
  accessToken?: string | null
  locale?: string // 'de_DE' | 'en_GB'
  /**
   * Standalone-кнопка ровно одного funding-источника: 'paypal' (жёлтая) или
   * 'sepa' (SEPA-Lastschrift через PayPal). Плоский список чекаута ведёт эти
   * источники отдельными пунктами — стек из двух кнопок не рендерим.
   */
  fundingSource?: 'paypal' | 'sepa'
  /** Оплата подтверждена сервером (capture COMPLETED). */
  onPaid: () => void
  /** Capture в статусе PENDING — итог придёт вебхуком. */
  onPending: () => void
  /** Покупатель закрыл PayPal-окно: заказ остаётся pending, корзина цела. */
  onCancel: () => void
  onError: (message: string) => void
}

export default function PayPalPaymentButtons({
  orderId,
  accessToken,
  locale = 'de_DE',
  fundingSource = 'paypal',
  onPaid,
  onPending,
  onCancel,
  onError,
}: PayPalPaymentButtonsProps) {
  // Guard от двойного сабмита: пока capture в полёте, второй onApprove — no-op,
  // кнопки задизейблены.
  const captureInFlightRef = useRef(false)
  const [processing, setProcessing] = useState(false)

  // Колбэки в ref — не перемонтировать кнопки при ререндере родителя.
  const onPaidRef = useRef(onPaid)
  const onPendingRef = useRef(onPending)
  const onCancelRef = useRef(onCancel)
  const onErrorRef = useRef(onError)
  onPaidRef.current = onPaid
  onPendingRef.current = onPending
  onCancelRef.current = onCancel
  onErrorRef.current = onError

  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || ''
  const currency = process.env.NEXT_PUBLIC_PAYPAL_CURRENCY || 'EUR'

  if (!clientId) {
    return (
      <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
        PayPal ist derzeit nicht verfügbar.
      </div>
    )
  }

  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(accessToken ? { 'x-order-access-token': accessToken } : {}),
  }

  const createOrder = async (): Promise<string> => {
    const res = await fetch('/api/payments/paypal/create-order', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ orderId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.success || !data.paypalOrderId) {
      throw new Error(data.error || 'PayPal-Zahlung konnte nicht gestartet werden')
    }
    return data.paypalOrderId as string
  }

  const onApprove = async (
    data: { orderID: string },
    actions: { restart: () => void }
  ): Promise<void> => {
    if (captureInFlightRef.current) return
    captureInFlightRef.current = true
    setProcessing(true)
    try {
      const res = await fetch('/api/payments/paypal/capture', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ paypalOrderId: data.orderID }),
      })
      const json = await res.json().catch(() => ({}))

      if (json.restart === true) {
        // Инструмент отклонён — даём выбрать другой способ в том же окне.
        captureInFlightRef.current = false
        setProcessing(false)
        return actions.restart()
      }
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Zahlung konnte nicht abgeschlossen werden')
      }
      if (json.pending) {
        onPendingRef.current()
      } else {
        onPaidRef.current()
      }
    } catch (e: any) {
      captureInFlightRef.current = false
      setProcessing(false)
      onErrorRef.current(e?.message || 'Zahlung konnte nicht abgeschlossen werden')
    }
  }

  return (
    <PayPalScriptProvider
      options={{
        clientId,
        currency,
        intent: 'capture',
        components: 'buttons',
        disableFunding: 'paylater,venmo,card',
        // sepa включён ВСЕГДА, чтобы параметры SDK-скрипта были одинаковыми
        // для пунктов PayPal и SEPA: разные опции заставляют react-paypal-js
        // перезагружать скрипт при смене метода, и кнопка теряется в гонке.
        // Standalone-кнопка всё равно рендерит ровно свой fundingSource.
        enableFunding: 'sepa',
        locale,
      }}
    >
      <PayPalButtons
        // Ровно одна кнопка выбранного funding-источника — без стека.
        fundingSource={fundingSource}
        style={{ layout: 'vertical', ...(fundingSource === 'paypal' ? { label: 'paypal' as const } : {}) }}
        disabled={processing}
        createOrder={createOrder}
        onApprove={onApprove}
        onCancel={() => {
          if (!captureInFlightRef.current) onCancelRef.current()
        }}
        onError={(err) => {
          captureInFlightRef.current = false
          setProcessing(false)
          const message =
            err instanceof Error && err.message
              ? err.message
              : 'PayPal-Zahlung fehlgeschlagen. Bitte versuchen Sie es erneut.'
          onErrorRef.current(String(message))
        }}
      />
      {processing && (
        <p className="mt-2 text-center text-sm text-gray-500">Zahlung wird verarbeitet…</p>
      )}
    </PayPalScriptProvider>
  )
}
