"use client";

import {
  buildOrderTax,
  formatVatRate,
  formatAmount,
  FOOD_VAT_RATE,
} from '../../lib/orders/tax';

interface OrderTaxSummaryProps {
  order: {
    items?: Array<{
      name: string;
      quantity: number;
      totalPrice?: number;
      price?: number;
      category?: string;
      taxRate?: number | null;
    }>;
    paymentMethod?: string | null;
  };
}

/**
 * Налоговая разбивка заказа для админки (Aufschlüsselung der Steuern, inkl. MwSt.).
 *
 * Показывается ТОЛЬКО для онлайн-оплаты — для cash / card at door возвращает null
 * (поведение офлайн-заказов не меняется). Ставки 7 % / 19 % выводятся как
 * бейджи-«кнопки», суммы Netto/USt./Brutto извлекаются из Brutto (НДС включён).
 */
export default function OrderTaxSummary({ order }: OrderTaxSummaryProps) {
  const tax = buildOrderTax({
    paymentMethod: order.paymentMethod,
    items: (order.items || []).map((it) => ({
      name: it.name,
      quantity: it.quantity,
      totalPrice: it.totalPrice ?? (it.price ?? 0) * it.quantity,
      category: it.category,
      taxRate: it.taxRate,
    })),
  });

  // Офлайн-оплата (cash / card at door): налоговую разбивку не показываем.
  if (!tax.applied || tax.breakdown.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 pt-4 border-t" data-testid="order-tax-summary">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="font-semibold">Aufschlüsselung der Steuern</h4>
        <span className="text-xs text-gray-500">(inkl. MwSt. — только онлайн-оплата)</span>
      </div>
      <div className="space-y-1">
        {tax.breakdown.map((row) => {
          const isFood = row.rate === FOOD_VAT_RATE;
          return (
            <div
              key={row.rate}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
              data-testid={`tax-row-${Math.round(row.rate * 100)}`}
            >
              <span
                className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                  isFood ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                }`}
              >
                USt. {formatVatRate(row.rate)}
              </span>
              <span className="text-gray-600">
                Netto {formatAmount(row.net)} € · USt. {formatAmount(row.vat)} € · Brutto{' '}
                {formatAmount(row.gross)} €
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
