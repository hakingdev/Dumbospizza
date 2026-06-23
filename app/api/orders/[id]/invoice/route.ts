import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { connectToDatabase } from '../../../../../lib/models'
import { Order } from '../../../../../lib/models/order.model'
import { User } from '../../../../../lib/models/user.model'
import { isStaff, authOptions } from '../../../../../lib/auth'
import { getCustomerSession } from '../../../../../lib/customer-auth'
import { isOnlinePaymentMethod } from '../../../../../lib/orders/tax'
import { buildInvoicePdf } from '../../../../../lib/orders/invoice-pdf'

// PDF — бинарные данные, нужен Node.js runtime (не Edge).
export const runtime = 'nodejs'

function normalizePhone(value?: string | null) {
  return String(value || '').replace(/[^\d+]/g, '')
}

function canReadOrderByPhone(order: any, phoneNumber?: string | null) {
  return Boolean(phoneNumber) && normalizePhone(order.phoneNumber) === normalizePhone(phoneNumber)
}

/**
 * GET /api/orders/[id]/invoice — PDF-счёт (Rechnung) онлайн-оплаченного заказа.
 *
 * Доступ (источник правды — backend, не frontend):
 *  - персонал (admin/staff) по NextAuth-сессии — любой заказ;
 *  - клиент с cookie-сессией (/account) — только свой заказ; владение
 *    проверяется по userId/телефону из подписанного cookie, НЕ из запроса;
 *  - клиент без аккаунта (/profile, страница подтверждения) — по совпадению
 *    phoneNumber из query с phoneNumber заказа в БД (как у GET /api/orders/[id]).
 *
 * Счёт выдаём только для ОНЛАЙН-оплаты (для cash/card при получении НДС-чек не
 * формируется) — иначе 403.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await connectToDatabase()

    const order = await Order.findById(params.id).exec()
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 })
    }

    const session = await getServerSession(authOptions)
    const phoneNumber = request.nextUrl.searchParams.get('phoneNumber')
    const isStaffUser = Boolean(session && isStaff(session))

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

    if (!isStaffUser && !isCustomerOwner && !canReadOrderByPhone(order, phoneNumber)) {
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
