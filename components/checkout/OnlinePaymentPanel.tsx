'use client'

import SumUpPaymentWidget from './SumUpPaymentWidget'
import PayPalPaymentButtons from './PayPalPaymentButtons'
import { NoTranslate } from '../NoTranslate'
import { METHOD_GROUPS, type OnlineMethodId } from '../../lib/payments/method-groups'

/** Состояние начатой онлайн-оплаты (draft-заказ создан, платёж не подтверждён). */
export interface OnlinePaymentState {
  orderId: string
  amount: number
  method: OnlineMethodId
  /** Whitelist SumUp-виджета (effectiveSumupIds группы); пуст у PayPal. */
  sumupIds: string[]
  sumupCheckoutId: string | null
  accessToken: string | null
}

interface OnlinePaymentPanelProps {
  pay: OnlinePaymentState
  /** Язык интерфейса ('de' | 'ru' | …) — прокидывается в локали виджетов. */
  language: string
  errorMessage?: string
  t: (key: string, fallback?: string) => string
  onSumUpPaid: () => void
  onSumUpError: (message: string) => void
  onPayPalPaid: () => void
  onPayPalPending: () => void
  onPayPalCancel: () => void
  onPayPalError: (message: string) => void
  /** «Zurück zur Zahlungsart»: корзина и форма целы, draft бросается (TTL-джоба). */
  onBack: () => void
}

/**
 * Инлайн-панель оплаты шага 2 (модалки нет): РОВНО ОДИН виджет метода,
 * выбранного в плоском списке, — SumUp-виджет с whitelist группы
 * (Karte/Apple/Google Pay) или standalone PayPal-кнопка нужного
 * funding-источника (PayPal / SEPA-Lastschrift). Повторного выбора между
 * группами здесь нет.
 */
export default function OnlinePaymentPanel({
  pay,
  language,
  errorMessage,
  t,
  onSumUpPaid,
  onSumUpError,
  onPayPalPaid,
  onPayPalPending,
  onPayPalCancel,
  onPayPalError,
  onBack,
}: OnlinePaymentPanelProps) {
  const group = METHOD_GROUPS.find((g) => g.id === pay.method)

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold mb-1">{t('checkout.payments.pay_title', 'Bezahlung')}</h2>
      <p className="mb-4 text-sm text-gray-500">
        {t('checkout.payments.online_amount', 'Zu zahlen')}: <NoTranslate>{pay.amount.toFixed(2)} €</NoTranslate>
      </p>

      {errorMessage && <p className="mb-3 text-sm text-red-600">{errorMessage}</p>}

      {group?.provider === 'sumup' && pay.sumupCheckoutId && (
        <SumUpPaymentWidget
          checkoutId={pay.sumupCheckoutId}
          amount={pay.amount}
          paymentMethods={pay.sumupIds}
          locale={language === 'de' ? 'de-DE' : 'en-GB'}
          onPaid={onSumUpPaid}
          onError={onSumUpError}
        />
      )}

      {group?.provider === 'paypal' && (
        <PayPalPaymentButtons
          orderId={pay.orderId}
          accessToken={pay.accessToken}
          locale={language === 'de' ? 'de_DE' : 'en_GB'}
          fundingSource={group.paypalFundingSource || 'paypal'}
          onPaid={onPayPalPaid}
          onPending={onPayPalPending}
          onCancel={onPayPalCancel}
          onError={onPayPalError}
        />
      )}

      <button
        type="button"
        className="mt-4 w-full rounded-md border border-gray-300 bg-white py-2 px-4 text-gray-700 transition-colors hover:bg-gray-50"
        onClick={onBack}
      >
        {t('checkout.payments.back_to_methods', 'Zurück zur Zahlungsart')}
      </button>
    </div>
  )
}
