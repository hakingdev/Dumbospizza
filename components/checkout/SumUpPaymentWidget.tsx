'use client'

import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    SumUpCard?: {
      mount: (config: Record<string, unknown>) => { unmount?: () => void }
    }
  }
}

const SDK_URL = 'https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js'

/** Загружает SumUp SDK один раз и резолвит глобальный SumUpCard. */
function loadSumUpSdk(): Promise<NonNullable<Window['SumUpCard']>> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('SSR'))
    if (window.SumUpCard) return resolve(window.SumUpCard)

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(window.SumUpCard!))
      existing.addEventListener('error', () => reject(new Error('SumUp SDK failed to load')))
      return
    }

    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.onload = () => resolve(window.SumUpCard!)
    script.onerror = () => reject(new Error('SumUp SDK failed to load'))
    document.body.appendChild(script)
  })
}

interface SumUpPaymentWidgetProps {
  checkoutId: string
  amount: number
  currency?: string
  locale?: string
  /** Виджет сообщил об успешной оплате. Обязательна серверная проверка после. */
  onPaid: () => void
  onError: (message: string) => void
}

/**
 * Встроенный платёжный виджет SumUp. Сам показывает кнопки Apple Pay / Google Pay,
 * когда они доступны на устройстве/в регионе клиента (домен должен быть верифицирован
 * в SumUp Dashboard → Payment wallets). Колбэк onResponse 'success' лишь сигнал —
 * подтверждать оплату нужно на сервере (/api/payments/sumup/confirm).
 */
export default function SumUpPaymentWidget({
  checkoutId,
  amount,
  currency = 'EUR',
  locale = 'de-DE',
  onPaid,
  onError,
}: SumUpPaymentWidgetProps) {
  const mountedRef = useRef(false)
  // Колбэки храним в ref, чтобы не перемонтировать виджет при ререндере родителя.
  const onPaidRef = useRef(onPaid)
  const onErrorRef = useRef(onError)
  onPaidRef.current = onPaid
  onErrorRef.current = onError

  useEffect(() => {
    let cancelled = false

    loadSumUpSdk()
      .then((SumUpCard) => {
        if (cancelled || mountedRef.current) return
        mountedRef.current = true
        SumUpCard.mount({
          id: 'sumup-card',
          checkoutId,
          amount,
          currency,
          locale,
          showAmount: true,
          onResponse: (type: string, body: unknown) => {
            if (type === 'success') {
              onPaidRef.current()
            } else if (type === 'error' || type === 'fail') {
              const msg =
                typeof body === 'string'
                  ? body
                  : 'Zahlung fehlgeschlagen. Bitte versuchen Sie es erneut.'
              onErrorRef.current(msg)
            }
          },
        })
      })
      .catch((e: Error) => {
        if (!cancelled) onErrorRef.current(e?.message || 'SumUp konnte nicht geladen werden')
      })

    return () => {
      cancelled = true
    }
  }, [checkoutId, amount, currency, locale])

  return <div id="sumup-card" />
}
