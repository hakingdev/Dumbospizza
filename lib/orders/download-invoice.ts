/**
 * Клиентский helper: скачивает PDF-счёт через backend-эндпоинт
 * GET /api/orders/[id]/invoice и сохраняет файл (blob → ссылка с download).
 *
 * Заменяет прежний window.print() (который открывал пустое белое окно печати):
 * теперь пользователь получает именно файл invoice-order-{orderNumber}.pdf.
 *
 * Владение подтверждается подписанным токеном заказа (?token=, выдан при
 * оформлении) ИЛИ cookie-сессией клиента (credentials: include). Номер телефона
 * больше не является ключом доступа.
 *
 * Бросает Error с понятным сообщением, если скачивание не удалось — вызывающий
 * код показывает его пользователю.
 */
export async function downloadOrderInvoice(
  orderId: string,
  options: { token?: string | null; orderNumber?: string | number } = {}
): Promise<void> {
  const query = options.token
    ? `?token=${encodeURIComponent(options.token)}`
    : ''

  let response: Response
  try {
    response = await fetch(`/api/orders/${orderId}/invoice${query}`, {
      credentials: 'include',
    })
  } catch {
    throw new Error('Netzwerkfehler beim Erstellen der Rechnung.')
  }

  if (!response.ok) {
    let message = 'Die Rechnung konnte nicht erstellt werden.'
    try {
      const data = await response.json()
      if (data?.error) message = data.error
    } catch {
      // тело не JSON — оставляем дефолтное сообщение
    }
    throw new Error(message)
  }

  const blob = await response.blob()
  const filename = options.orderNumber
    ? `invoice-order-${options.orderNumber}.pdf`
    : 'invoice.pdf'

  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}
