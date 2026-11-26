import type { Metadata } from 'next'
import AppPayClient from '../../../components/checkout/AppPayClient'
import { connectToDatabase } from '../../../lib/models'
import { Order } from '../../../lib/models/order.model'
import {
  buildAppReturnUrl,
  evaluateAppPayAccess,
  isPayPalConfigured,
  parseAppPayMethod,
  pickVisibleGroup,
  type AppPayOrder,
} from '../../../lib/payments/app-pay'
import { getMerchantPaymentMethodsCached } from '../../../lib/payments/sumup-allowlist'

/**
 * /pay/[orderId]?token=<HMAC заказа>&method=<online|paypal|sepa>
 *
 * Оплата draft-заказа из приложения Dumbo Slice (см. lib/payments/app-pay).
 * Доступ проверяется здесь, на сервере, до рендера виджета: без валидного
 * токена заказа страница ничего о заказе не показывает.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Bezahlung | Dumbos Pizza',
  robots: { index: false, follow: false },
  // Токен заказа лежит в query — не отдаём его SDK провайдеров через Referer.
  referrer: 'no-referrer',
}

interface PageProps {
  params: { orderId: string }
  searchParams: { token?: string | string[]; method?: string | string[] }
}

const MESSAGES: Record<string, string> = {
  forbidden: 'Dieser Zahlungslink ist ungültig.',
  not_found: 'Diese Bestellung wurde nicht gefunden.',
  not_online: 'Diese Bestellung wird nicht online bezahlt.',
  not_payable: 'Diese Bestellung kann nicht mehr bezahlt werden.',
  already_paid: 'Diese Bestellung ist bereits bezahlt.',
  bad_method: 'Diese Zahlungsart ist derzeit nicht verfügbar.',
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

async function loadOrder(orderId: string): Promise<(AppPayOrder & { total: number }) | null> {
  try {
    await connectToDatabase()
    const order: any = await Order.findById(orderId)
    if (!order) return null
    return {
      id: String(order._id ?? order.id),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      status: order.status,
      total: Number(order.total),
    }
  } catch (error) {
    console.error('[app-pay] order load failed:', error)
    return null
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-md">{children}</div>
    </main>
  )
}

function Notice({ message, href }: { message: string; href: string }) {
  return (
    <Shell>
      <div className="rounded-lg bg-white p-6 shadow-md">
        <p className="mb-4 text-gray-800">{message}</p>
        <a
          href={href}
          className="block w-full rounded-md bg-gray-900 px-4 py-2 text-center font-medium text-white"
        >
          Zurück zur App
        </a>
      </div>
    </Shell>
  )
}

export default async function AppPayPage({ params, searchParams }: PageProps) {
  const orderId = params.orderId
  const token = single(searchParams.token) ?? null
  const method = parseAppPayMethod(single(searchParams.method))

  // Токен — первым: без него заказ даже не читаем.
  const preliminary = evaluateAppPayAccess(orderId, null, token)
  if (preliminary.ok === false && preliminary.reason === 'forbidden') {
    return <Notice message={MESSAGES.forbidden} href={buildAppReturnUrl(orderId, 'failed')} />
  }

  const order = await loadOrder(orderId)
  const access = evaluateAppPayAccess(orderId, order, token)
  if (access.ok === false) {
    const result = access.reason === 'already_paid' ? 'success' : 'failed'
    return <Notice message={MESSAGES[access.reason]} href={buildAppReturnUrl(orderId, result)} />
  }

  // Та же видимость, что у чекаута сайта: allowlist SumUp × флаг PayPal.
  let available: string[] | null = null
  try {
    available = await getMerchantPaymentMethodsCached({ amount: order!.total, currency: 'EUR' })
  } catch (error) {
    console.error('[app-pay] SumUp allowlist unavailable:', error)
  }
  const group = method ? pickVisibleGroup(method, available, isPayPalConfigured()) : null
  if (!group) {
    return <Notice message={MESSAGES.bad_method} href={buildAppReturnUrl(orderId, 'failed')} />
  }

  return (
    <Shell>
      <p className="mb-3 text-center text-sm text-gray-500">
        Dumbos Pizza · Online-Zahlung
      </p>
      <AppPayClient
        orderId={orderId}
        amount={order!.total}
        method={group.id}
        provider={group.provider}
        sumupIds={group.effectiveSumupIds}
        accessToken={token!}
      />
    </Shell>
  )
}
