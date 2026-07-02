import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { connectToDatabase } from '../../../../../lib/models'
import { Order } from '../../../../../lib/models/order.model'
import { User } from '../../../../../lib/models/user.model'
import { isStaff, authOptions } from '../../../../../lib/auth'
import { getCustomerSession } from '../../../../../lib/customer-auth'
import { isOnlinePaymentMethod } from '../../../../../lib/orders/tax'
import { buildInvoicePdf } from '../../../../../lib/orders/invoice-pdf'
import { verifyOrderAccessToken } from '../../../../../lib/orders/access-token'
import { rateLimit, getClientIp, logSecurityEvent } from '../../../../../lib/security/rate-limit'

// PDF — бинарные данные, нужен Node.js runtime (не Edge).
export const runtime = 'nodejs'

function normalizePhone(value?: string | null) {
  return String(value || '').replace(/[^\d+]/g, '')
}

/**
 * GET /api/orders/[id]/invoice — PDF-счёт (Rechnung) онлайн-оплаченного заказа.
 *
 * Доступ (источник правды — backend, не frontend):
 *  - персонал (admin/staff) по NextAuth-сессии — любой заказ;
 *  - клиент с cookie-сессией (/account) — только свой заказ; владение
 *    проверяется по userId/телефону из подписанного cookie, НЕ из запроса;
 *  - клиент без аккаунта (страница подтверждения) — по подписанному токену
 *    заказа (?token=), выданному в ответе POST /api/orders. Номер телефона
 *    ключом доступа больше НЕ является.
 *
 * Счёт выдаём только для ОНЛАЙН-оплаты (для cash/card при получении НДС-чек не
 * формируется) — иначе 403.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await connectToDatabase()

    const session = await getServerSession(authOptions)
    const isStaffUser = Boolean(session && isStaff(session))

    if (!isStaffUser) {
      const ip = getClientIp(request)
      const rl = rateLimit(`invoice-get:${ip}`, 20, 60_000)
      if (!rl.allowed) {
        logSecurityEvent('invoice-get-rate-limited', { ip, orderId: params.id })
        return NextResponse.json(
          { success: false, error: 'Too many requests' },
          { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
        )
      }
    }

    const order = await Order.findById(params.id).exec()
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 })
    }

    const token = request.nextUrl.searchParams.get('token')

    // Владелец через cookie-сессию клиента (/account): userId из подписанного
    // cookie, телефон сверяем по БД — заказ может быть привязан к user или только
    // к phoneNumber (легаси-заказы без user), как в /api/customer/orders.
    let isCustomerOwner = false
    const customer = getCustomerSession(request)
    if (customer) {
      if (order.user && String(order.user) === customer.userId) {
        isCustomerOwner = true
      } else {
        const user = await User.findById(customer.userId)
        if (user && normalizePhone(user.phoneNumber) === normalizePhone(order.phoneNumber)) {
          isCustomerOwner = true
        }
      }
    }

    if (!isStaffUser && !isCustomerOwner && !verifyOrderAccessToken(params.id, token)) {
      logSecurityEvent('invoice-get-denied', {
        ip: getClientIp(request),
        orderId: params.id,
        hadToken: Boolean(token),
      })
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    // Счёт с выделением НДС — только для онлайн-оплаты.
    if (!isOnlinePaymentMethod(order.paymentMethod)) {
      return NextResponse.json(
        { success: false, error: 'Rechnung nur für online bezahlte Bestellungen verfügbar.' },
        { status: 403 }
      )
    }

    const pdfBytes = await buildInvoicePdf(order as any)
    const filename = `invoice-order-${order.orderNumber}.pdf`

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdfBytes.length),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error: any) {
    console.error('Error generating invoice PDF:', error)
    return NextResponse.json(
      { success: false, error: error?.message || 'PDF konnte nicht erstellt werden.' },
      { status: 500 }
    )
  }
}
