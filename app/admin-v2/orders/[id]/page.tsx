'use client';

/** Карточка заказа (мобильный экран 03; на десктопе — узкая колонка). */

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  AdminOrder,
  nextOrderAction,
  reprintOrder,
  updateOrderStatus,
  useJson,
} from '../../../../components/admin-v2/hooks';
import {
  CancelOrderModal,
  CustomerBlock,
  CustomerNote,
  OrderComposition,
  StatusProgress,
  promisedTimeLabel,
} from '../../../../components/admin-v2/order-shared';
import { timeHHmm } from '../../../../components/admin-v2/format';
import {
  Card,
  Icon,
  LoadError,
  Loading,
  StatusBadge,
  btnGhostDanger,
  btnOutline,
  btnPrimary,
  btnSoft,
  btnSuccess,
} from '../../../../components/admin-v2/ui';
import { ADMIN_V2_BASE } from '../../../../components/admin-v2/nav';

const PRINT_ICON =
  'M6 9V3h12v6 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v7H6Z';

export default function OrderCardPage() {
  const params = useParams<{ id: string }>();
  const orderId = decodeURIComponent(String(params?.id || ''));
  const router = useRouter();
  const state = useJson<{ order: AdminOrder }>(orderId ? `/api/orders/${orderId}` : null, 15_000);
  const order = state.data?.order || null;
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const action = order ? nextOrderAction(order.status) : null;

  const handleAction = async () => {
    if (!order || !action) return;
    setBusy(true);
    const ok = await updateOrderStatus(order._id, action.next);
    if (!ok) alert('Не удалось обновить статус заказа');
    state.reload();
    setBusy(false);
  };

  const handleReprint = async () => {
    if (!order) return;
    if (!confirm(`Напечатать чек заказа #${order.orderNumber} ещё раз?`)) return;
    const ok = await reprintOrder(order._id);
    if (!ok) alert('Не удалось поставить чек в очередь печати');
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4 lg:mx-0 lg:max-w-lg lg:p-0">
      {/* Навигация назад + печать */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Назад к заказам"
          title="Назад к заказам"
          onClick={() => router.push(`${ADMIN_V2_BASE}/orders`)}
          className="flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-gray-900 transition hover:bg-[#FAF7F2]"
        >
          <Icon d="m15 18-6-6 6-6" size={20} />
        </button>
        <span className="text-base font-bold leading-6 text-gray-600">Заказы</span>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Печать чека"
          title="Печать чека"
          onClick={handleReprint}
          className="flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-full border border-gray-200 bg-white text-[#9A7A56] transition hover:bg-[#FAF7F2]"
        >
          <Icon d={PRINT_ICON} size={20} />
        </button>
      </div>

      {state.loading && !order ? (
        <Loading />
      ) : !order && state.error && !/404|not found|не найден/i.test(state.error) ? (
        <LoadError title="Заказ не загрузился" detail={state.error} onRetry={state.reload} />
      ) : !order ? (
        <Card className="p-6 text-center text-gray-500">Заказ не найден</Card>
      ) : (
        <>
          {/* Номер + статус */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <h1 className="m-0 text-[32px] font-extrabold leading-[38px] tracking-[-.02em] text-gray-900 tabular-nums">
                #{order.orderNumber}
              </h1>
              <StatusBadge status={order.status} />
            </div>
            <p className="m-0 text-base leading-6 text-gray-600">
              Принят {timeHHmm(order.createdAt)}
              {promisedTimeLabel(order) ? ` · обещано к ${promisedTimeLabel(order)}` : ''} ·{' '}
              {order.deliveryType === 'pickup' ? 'самовывоз' : 'доставка'}
            </p>
          </div>

          {/* Прогресс */}
          {order.status !== 'cancelled' && (
            <Card className="p-4">
              <StatusProgress order={order} />
            </Card>
          )}

          {/* Состав */}
          <Card className="p-4">
            <OrderComposition order={order} title="Состав заказа" />
          </Card>

          {/* Клиент */}
          <Card className="p-4">
            <CustomerBlock order={order} title="Клиент" />
          </Card>

          <CustomerNote order={order} />

          {/* Действия */}
          <div className="flex flex-col gap-3">
            {action && (
              <button
                type="button"
                disabled={busy}
                onClick={handleAction}
                className={`${
                  action.tone === 'success' ? btnSuccess : action.tone === 'soft' ? btnSoft : btnPrimary
                } h-12 w-full text-lg`}
              >
                <Icon d="M20 6 9 17l-5-5" size={20} />
                {action.label}
              </button>
            )}
            <a
              href={`tel:${order.phoneNumber}`}
              className={`${btnOutline} h-12 w-full text-lg no-underline`}
            >
              <Icon
                d="M15.5 21A12.5 12.5 0 0 1 3 8.5 2.5 2.5 0 0 1 5.5 6h2L9 9.5l-2 1.5a10 10 0 0 0 4.5 4.5l1.5-2 3.5 1.5v2A2.5 2.5 0 0 1 15.5 21Z"
                size={20}
              />
              Позвонить клиенту
            </a>
            {!['cancelled', 'completed'].includes(order.status) && (
              <button
                type="button"
                onClick={() => setCancelOpen(true)}
                className={`${btnGhostDanger} h-10 w-full text-base`}
              >
                Отменить заказ
              </button>
            )}
          </div>

          <CancelOrderModal
            order={cancelOpen ? order : null}
            onClose={() => setCancelOpen(false)}
            onCancelled={() => state.reload()}
          />
        </>
      )}
    </div>
  );
}
