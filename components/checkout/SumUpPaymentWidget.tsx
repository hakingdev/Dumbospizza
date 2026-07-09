'use client'

import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    SumUpCard?: {
      mount: (config: Record<string, unknown>) => {
        unmount?: () => void
        submit?: () => void
        update?: (config: Record<string, unknown>) => void
      }
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
  /**
   * Whitelist методов для рендера (id SumUp: 'card', 'apple_pay', …) — уходит
   * в onPaymentMethodsLoad. Виджет показывает ровно пересечение этого списка
   * с методами, которые SumUp сам считает доступными для checkout.
   */
  paymentMethods: string[]
  currency?: string
  locale?: string
  /** Виджет сообщил об успешной оплате. Обязательна серверная проверка после. */
  onPaid: () => void
  onError: (message: string) => void
}

/**
 * Встроенный платёжный виджет SumUp, отфильтрованный под одну группу методов
 * (paymentMethods) — повторного выбора между группами внутри виджета нет.
 * Кнопки Apple Pay / Google Pay внутри карточной группы виджет показывает сам
 * по возможностям устройства (домен должен быть верифицирован в SumUp
 * Dashboard → Payment wallets). Колбэк onResponse 'success' лишь сигнал —
 * подтверждать оплату нужно на сервере (/api/payments/sumup/confirm).
 *
 * Инвариант: живой виджет ровно один — mount()/unmount() парные (cleanup
 * эффекта), смена checkoutId или whitelist перемонтирует виджет заново.
 */
export default function SumUpPaymentWidget({
  checkoutId,
  amount,
  paymentMethods,
  currency = 'EUR',
  locale = 'de-DE',
  onPaid,
  onError,
}: SumUpPaymentWidgetProps) {
  // Колбэки храним в ref, чтобы не перемонтировать виджет при ререндере родителя.
  const onPaidRef = useRef(onPaid)
  const onErrorRef = useRef(onError)
  onPaidRef.current = onPaid
  onErrorRef.current = onError

  // Строковый ключ вместо массива в deps: перемонтируем только при
  // содержательной смене whitelist, а не при новой ссылке на тот же список.
  const methodsKey = paymentMethods.join(',')

  useEffect(() => {
    let cancelled = false
    let widget: { unmount?: () => void } | null = null
    const whitelist = methodsKey.split(',').filter(Boolean)

    loadSumUpSdk()
      .then((SumUpCard) => {
        if (cancelled) return
        widget = SumUpCard.mount({
          id: 'sumup-card',
          checkoutId,
          amount,
          currency,
          locale,
          showAmount: true,
          // Основной фильтр методов: возвращаемый массив — whitelist того, что
          // виджет отрендерит (CSS ниже — лишь страховка). available — allowlist
          // SumUp для этого checkout; без него отдаём whitelist группы как есть.
          onPaymentMethodsLoad: (available?: string[]) =>
            Array.isArray(available)
              ? whitelist.filter((id) => available.includes(id))
              : [...whitelist],
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
      try {
        widget?.unmount?.()
      } catch {
        // unmount() не должен ронять React-cleanup, даже если SDK уже убрал DOM.
      }
      widget = null
    }
  }, [checkoutId, amount, currency, locale, methodsKey])

  return (
    <div>
      {/* Страховка, не механизм фильтрации (механизм — onPaymentMethodsLoad):
          PayPal идёт нативной интеграцией, его строка в SumUp-виджете всегда лишняя. */}
      <style>{'[data-sumup-id="payment_option"][data-sumup-item="paypal"]{display:none !important;}'}</style>
      <div id="sumup-card" />
    </div>
  )
}
