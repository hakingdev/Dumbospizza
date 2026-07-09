'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Панель платежей и возвратов в админке заказов (только онлайн-заказы).
 * Показывает PayPal-платежи заказа (GET /api/admin/payments?orderId=) и даёт
 * полный/частичный возврат (POST /api/admin/payments/{id}/refund, роль admin).
 * Пустой ввод суммы = полный возврат остатка. Финальный статус возврата
 * подтверждается вебхуком PAYMENT.CAPTURE.REFUNDED.
 */

interface AdminRefund {
  id: string;
  status: string;
  amountMinor: number;
  reason?: string | null;
  createdBy?: string | null;
  createdAt?: string;
}

interface AdminPayment {
  id: string;
  provider: string;
  status: string;
  amountMinor: number;
  currency: string;
  providerOrderId: string;
  providerCaptureId?: string | null;
  remainingMinor: number;
  refunds: AdminRefund[];
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  created: 'создан',
  approved: 'подтверждён',
  captured: 'оплачен',
  failed: 'ошибка',
  refunded: 'возвращён',
  partially_refunded: 'частичный возврат',
  cancelled: 'отменён',
  reversed: 'реверс (диспут)',
};

function euro(minor: number): string {
  return `${(minor / 100).toFixed(2)} €`;
}

export default function PaymentRefundPanel({ orderId }: { orderId: string }) {
  const [payments, setPayments] = useState<AdminPayment[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/payments?orderId=${encodeURIComponent(orderId)}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Не удалось загрузить платежи');
      setPayments(data.payments || []);
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить платежи');
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const refund = async (payment: AdminPayment) => {
    setError('');
    const raw = (amounts[payment.id] || '').replace(',', '.').trim();
    let amountMinor: number | undefined;
    if (raw) {
      const parsed = Math.round(parseFloat(raw) * 100);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError('Некорректная сумма возврата');
        return;
      }
      amountMinor = parsed;
    }

    const label = amountMinor !== undefined ? euro(amountMinor) : `полный (${euro(payment.remainingMinor)})`;
    if (!window.confirm(`Вернуть ${label} через PayPal? Действие необратимо.`)) return;

    setBusyId(payment.id);
    try {
      const res = await fetch(`/api/admin/payments/${encodeURIComponent(payment.id)}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountMinor,
          reason: reasons[payment.id] || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Возврат не выполнен');
      setAmounts((prev) => ({ ...prev, [payment.id]: '' }));
      setReasons((prev) => ({ ...prev, [payment.id]: '' }));
      await load();
    } catch (e: any) {
      setError(e?.message || 'Возврат не выполнен');
    } finally {
      setBusyId(null);
    }
  };

  // Онлайн-заказы без записей в payments (SumUp) — панель не показываем.
  if (!payments || payments.length === 0) {
    return error ? <div className="text-sm text-red-600 mt-2">{error}</div> : null;
  }

  return (
    <div className="mt-4">
      <h4 className="font-semibold mb-2">Платежи</h4>
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
      <div className="space-y-3">
        {payments.map((p) => {
          const refundable =
            p.provider === 'paypal' &&
            ['captured', 'partially_refunded'].includes(p.status) &&
            p.remainingMinor > 0;
          return (
            <div key={p.id} className="rounded border border-gray-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium uppercase">{p.provider}</span>
                <span>{euro(p.amountMinor)}</span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
                  {PAYMENT_STATUS_LABELS[p.status] || p.status}
                </span>
              </div>
              {p.refunds.length > 0 && (
                <div className="mt-2 border-t pt-2 text-gray-600">
                  {p.refunds.map((r) => (
                    <div key={r.id} className="flex justify-between">
                      <span>
                        Возврат {euro(r.amountMinor)} ({r.status})
                        {r.createdBy ? ` — ${r.createdBy}` : ''}
                      </span>
                    </div>
                  ))}
                  <div className="mt-1">Остаток к возврату: {euro(p.remainingMinor)}</div>
                </div>
              )}
              {refundable && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={`Сумма € (пусто = ${euro(p.remainingMinor)})`}
                    value={amounts[p.id] || ''}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    className="w-44 rounded border border-gray-300 px-2 py-1"
                  />
                  <input
                    type="text"
                    placeholder="Причина (необязательно)"
                    value={reasons[p.id] || ''}
                    onChange={(e) => setReasons((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    className="flex-1 min-w-[160px] rounded border border-gray-300 px-2 py-1"
                  />
                  <button
                    type="button"
                    disabled={busyId === p.id}
                    onClick={() => refund(p)}
                    className="rounded bg-red-600 px-3 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {busyId === p.id ? 'Возврат…' : 'Вернуть'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
