'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import OnlinePaymentPanel, { type OnlinePaymentState } from './OnlinePaymentPanel'
import { buildAppReturnUrl, type AppPayResult } from '../../lib/payments/app-return'
import type { OnlineMethodId } from '../../lib/payments/method-groups'

/**
 * Клиент страницы /pay/[orderId] (оплата из приложения). Своей платёжной
 * логики нет: те же эндпоинты и тот же OnlinePaymentPanel, что у чекаута
 * сайта. Отличие одно — вместо страницы подтверждения возврат в приложение
 * (buildAppReturnUrl). Итог оплаты приложение всё равно сверяет с сервером.
 */
interface AppPayClientProps {
  orderId: string
  amount: number
  method: OnlineMethodId
  provider: 'sumup' | 'paypal'
  sumupIds: string[]
  accessToken: string
}

const t = (_key: string, fallback?: string) => fallback ?? _key

export default function AppPayClient({ orderId, amount, method, provider, sumupIds, accessToken }: AppPayClientProps) {
  const [pay, setPay] = useState<OnlinePaymentState | null>(
    provider === 'paypal'
      ? { orderId, amount, method, sumupIds: [], sumupCheckoutId: null, accessToken }
      : null
  )
  const [error, setError] = useState<string | undefined>()
  const hadErrorRef = useRef(false)
  const leftRef = useRef(false)

  const returnToApp = useCallback(
    (result: AppPayResult) => {
      if (leftRef.current) return
      leftRef.current = true
      window.location.assign(buildAppReturnUrl(orderId, result))
    },
    [orderId]
  )

  const showError = useCallback((message: string) => {
    hadErrorRef.current = true
    setError(message)
  }, [])

  // SumUp: checkout создаём сразу (как чекаут сайта после POST /api/orders).
  useEffect(() => {
    if (provider !== 'sumup') return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/payments/sumup/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.success) throw new Error(data.error || 'Online-Zahlung konnte nicht gestartet werden')
        if (!cancelled) {
          setPay({ orderId, amount: data.amount ?? amount, method, sumupIds, sumupCheckoutId: data.checkoutId, accessToken })
        }
      } catch (e: any) {
        if (!cancelled) showError(e?.message || 'Online-Zahlung konnte nicht gestartet werden')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [provider, orderId, amount, method, sumupIds, accessToken, showError])

  // Виджет SumUp сообщил об оплате → подтверждаем на сервере (источник истины).
  const handleSumUpPaid = useCallback(async () => {
    if (!pay?.sumupCheckoutId) return
    try {
      const res = await fetch('/api/payments/sumup/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, checkoutId: pay.sumupCheckoutId }),
      })
      const data = await res.json().catch(() => ({}))
      // PENDING (отложенный метод): деньги в обработке, промоутит вебхук —
      // приложение дождётся статуса опросом.
      if (res.ok && data.success) return returnToApp('success')
      if (res.status === 402 && data?.status === 'PENDING') return returnToApp('success')
      throw new Error(data.error || 'Zahlung konnte nicht bestätigt werden')
    } catch (e: any) {
      showError(e?.message || 'Zahlung konnte nicht bestätigt werden')
    }
  }, [pay, orderId, returnToApp, showError])

  return (
    <OnlinePaymentPanel
      pay={pay ?? { orderId, amount, method, sumupIds, sumupCheckoutId: null, accessToken }}
      language="de"
      errorMessage={error}
      t={t}
      onSumUpPaid={handleSumUpPaid}
      onSumUpError={showError}
      onPayPalPaid={() => returnToApp('success')}
      onPayPalPending={() => returnToApp('success')}
      onPayPalCancel={() => setError(undefined)}
      onPayPalError={showError}
      // «Zurück zur Zahlungsart» → в приложение. Была ошибка — 'failed' (приложение
      // покажет её причину), иначе покупатель передумал — 'cancel'.
      onBack={() => returnToApp(hadErrorRef.current ? 'failed' : 'cancel')}
    />
  )
}
