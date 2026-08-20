'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  PosActionBar,
  PosAppBar,
  PosButton,
  PosSheet,
  PosStatusBar,
} from '../../../../components/pos/primitives';
import {
  PosCustomerCard,
  PosExtendSheet,
  PosExtendTimeCard,
  PosItemsCard,
  PosKitchenReceiptCard,
  PosPrintSheet,
  PosStatusTimeCard,
  type PosPrintState,
} from '../../../../components/pos/order-detail';
import { PosScreenState } from '../../../../components/pos/screen-state';
import {
  posClock,
  posCountdown,
  posFetch,
  posOrderMeta,
  usePosNow,
  usePosOrder,
  type PosOrderDetail,
} from '../../../../components/pos/data';
import { posDisplayStatus, toOrderStatus, type PosBoardStatus } from '../../../../lib/pos/board';
import {
  POS_CONFIRM_SHEET,
  POS_DETAIL_VIEW,
  posActionIntent,
  type PosAction,
} from '../../../../lib/pos/detail-actions';

/**
 * 07 · Bestelldetails, а также 16, 17 (состояния печати), 18–21 (по статусам)
 * и две шторки: 08 · Zeit verlängern, 15 · Küchenbon erneut drucken.
 * Figma: 12:417, 44:921, 44:1019, 48:990, 48:1120, 50:1069, 50:1211, 13:444, 42:892.
 *
 * В макете это девять кадров, но экран один: меняются шапка со временем, набор
 * кнопок внизу и состояние бона. Что показывать и что предлагать нажать —
 * в одном справочнике VIEW: статус, крупное число и кнопки обязаны меняться
 * вместе, иначе экран покажет «Geliefert» и кнопку «Fertig melden».
 *
 * Действия идут в СУЩЕСТВУЮЩИЕ маршруты персонала, а не в свои:
 *   смена статуса — PUT /api/orders/[id] (он же двигает карточку в Telegram и
 *     шлёт гостю WhatsApp),
 *   продление     — POST /api/orders/[id]/delay (сдвиг + сообщение о задержке),
 *   повтор печати — POST /api/orders/[id]/reprint (новое задание для агента).
 * Свои копии этих действий означали бы, что заказ, переведённый с прибора, не
 * доедет ни до Telegram, ни до гостя.
 */

// Набор кнопок по статусам и разбор нажатий переехали в lib/pos/detail-actions.ts:
// после заказа #260820002 (касание при выходе отправило заказ в «Unterwegs»)
// правило «что подтверждается» проверяется тестом, а тест не должен рендерить
// страницу.

/**
 * kitchenPrintStatus из базы → состояние карточки бона.
 *
 * `pending` и `printing` РАЗНЫЕ. В `pending` заказ лежит сколько угодно: пока
 * выключена автопечать или пока агент до него не дошёл. Сваливать их в одно
 * «в очереди» значило блокировать кнопку печати навсегда.
 */
function toPrintState(status: string): PosPrintState {
  if (status === 'completed') return 'printed';
  if (status === 'failed') return 'failed';
  if (status === 'printing') return 'queued';
  return 'pending';
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Barzahlung',
  card: 'Kartenzahlung',
  online: 'Online',
};

/** Крупное число в шапке и две строки под ним — своё на каждый статус. */
function headline(order: PosOrderDetail, nowMs: number) {
  const left = order.dueMs == null ? null : order.dueMs - nowMs;

  // По экранному статусу: уехавшая доставка обязана показывать «Ankunft
  // geplant», а не «Wartet auf den Fahrer» — водитель уже с заказом.
  switch (posDisplayStatus(order)) {
    case 'new':
      return {
        bigValue: posClock(order.createdMs),
        subTop: 'Eingegangen',
        subBottom:
          order.desiredMs == null
            ? 'Zeit noch nicht gesetzt'
            : `Wunschzeit ${posClock(order.desiredMs)}`,
      };
    case 'preparing':
      if (left == null) {
        return { bigValue: '—', subTop: 'Ohne Zeit', subBottom: 'Zeit festlegen' };
      }
      return {
        bigValue: posCountdown(left),
        subTop: left >= 0 ? 'Minuten übrig' : 'Minuten überfällig',
        subBottom: `Fertig um ${posClock(order.dueMs)} Uhr`,
      };
    // Только самовывоз: доставка ушла в ветку 'delivering'.
    case 'ready': {
      const since = order.closedMs ? Math.round((nowMs - order.closedMs) / 60_000) : null;
      return {
        bigValue: posClock(order.closedMs ?? order.dueMs),
        subTop: since == null ? 'Fertig' : `Fertig seit ${since} Minuten`,
        subBottom: 'Wartet auf den Gast',
      };
    }
    case 'delivering':
      return {
        bigValue: posClock(order.dueMs),
        subTop: 'Ankunft geplant',
        subBottom: order.address || 'Unterwegs',
      };
    case 'delivered': {
      const total = order.closedMs
        ? Math.max(0, Math.round((order.closedMs - order.createdMs) / 60_000))
        : null;
      return {
        bigValue: posClock(order.closedMs),
        subTop: order.deliveryType === 'pickup' ? 'Abgeholt' : 'Zugestellt',
        subBottom: total == null ? '' : `Gesamtdauer ${total} Minuten`,
      };
    }
    case 'cancelled':
      return {
        bigValue: posClock(order.closedMs),
        subTop: 'Storniert',
        subBottom: order.paid ? 'Online bezahlt — Rückerstattung prüfen' : '',
      };
  }
}

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { state, refresh, skewRef } = usePosOrder(params.id);
  const nowMs = usePosNow(skewRef);

  const [sheet, setSheet] = useState<'extend' | 'print' | null>(null);
  const [confirming, setConfirming] = useState<PosAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const order = state.status === 'ready' ? state.data : null;
  const view = order ? POS_DETAIL_VIEW[posDisplayStatus(order)] : null;

  const say = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  /** Общая обёртка действий: блокировка кнопок, перечитывание, сообщение. */
  const run = async (
    url: string,
    body: Record<string, unknown>,
    okMessage: string,
    method: 'PUT' | 'POST' = 'POST'
  ) => {
    if (busy) return;
    setBusy(true);
    const result = await posFetch(url, { method, body: JSON.stringify(body) });
    await refresh();
    setBusy(false);
    setSheet(null);
    setConfirming(null);
    say(result.ok ? okMessage : `Fehlgeschlagen: ${result.error ?? 'Unbekannt'}`);
  };

  const changeStatus = (next: PosBoardStatus) =>
    run(`/api/orders/${params.id}`, { status: toOrderStatus(next) }, 'Status aktualisiert', 'PUT');

  const act = (action: PosAction) => {
    const intent = posActionIntent(action);
    if (intent.kind === 'confirm') setConfirming(action);
    else if (intent.kind === 'status') changeStatus(intent.next);
    // Кнопки без статуса ведут дальше по потоку: приём — на выбор времени,
    // «Zurück» — обратно в ленту.
    else if (intent.kind === 'accept-flow') router.push(`/pos/orders/new/time?id=${params.id}`);
    else router.push('/pos/orders');
  };

  // Текст шторки подтверждения — по целевому статусу нажатого действия.
  const confirmSheet = confirming?.next ? POS_CONFIRM_SHEET[confirming.next] : undefined;

  return (
    <>
      <PosStatusBar time={posClock(nowMs)} />
      <PosAppBar
        title={order ? `Bestellung #${order.number}` : 'Bestellung'}
        onBack={() => router.push('/pos/orders')}
        action={{
          icon: 'printer',
          label: 'Küchenbon drucken',
          onClick: () => order && setSheet('print'),
        }}
      />

      <div className="pos-scroll flex min-h-px w-full flex-1 flex-col gap-[12px] px-[16px] py-[8px]">
        <PosScreenState state={state} onRetry={refresh} />

        {order && view && nowMs != null && (
          <>
            <PosStatusTimeCard
              status={posDisplayStatus(order)}
              asideLabel={`Angenommen ${posClock(order.createdMs)}`}
              {...headline(order, nowMs)}
              progressPercent={
                order.status === 'preparing' && order.dueMs != null && order.etaMinutes
                  ? 100 - ((order.dueMs - nowMs) / (order.etaMinutes * 60_000)) * 100
                  : undefined
              }
              step={view.step}
              pickup={order.deliveryType === 'pickup'}
            />

            <PosKitchenReceiptCard
              state={toPrintState(order.print.status)}
              lineOne={posOrderMeta(order)}
              lineTwo={`Druckauftrag Nr. ${order.print.seq + 1}`}
              onPrint={() => setSheet('print')}
            />

            {view.canExtend && (
              <PosExtendTimeCard
                onExtend={(minutes) =>
                  run(
                    `/api/orders/${params.id}/delay`,
                    { delayMinutes: minutes },
                    `Neue Zeit gesetzt · +${minutes} Min`
                  )
                }
                onOther={() => setSheet('extend')}
              />
            )}

            <PosCustomerCard
              name={order.customerName || 'Gast'}
              address={
                order.deliveryType === 'pickup' ? 'Abholung an der Theke' : order.address || '—'
              }
              phone={order.phone}
            />

            <PosItemsCard
              items={order.items}
              note={order.note ? `Notiz: ${order.note}` : undefined}
              totalLabel={`Summe · ${PAYMENT_LABEL[order.paymentMethod] ?? 'Zahlung'}${
                order.paid ? ' bezahlt' : ' offen'
              }`}
              total={order.total}
            />
          </>
        )}
      </div>

      {/* Тост живёт над панелью действий: он сообщает о фоновом событии и не
          должен перекрывать кнопку, которую человек в этот момент ищет. */}
      {toast && (
        <div className="pointer-events-none px-[16px] pb-[8px]">
          <div className="pos-body-s w-full rounded-[12px] bg-[var(--pos-text-primary)] px-[14px] py-[12px] text-[var(--pos-text-on-accent)]">
            {toast}
          </div>
        </div>
      )}

      {view && (
        <PosActionBar>
          {view.actions.map((action) => (
            <PosButton
              key={action.label}
              label={action.label}
              variant={action.variant}
              disabled={busy}
              onClick={() => act(action)}
            />
          ))}
        </PosActionBar>
      )}

      {order && (
        <PosExtendSheet
          open={sheet === 'extend'}
          finishAt={posClock(order.dueMs)}
          onClose={() => setSheet(null)}
          onConfirm={(minutes) =>
            run(
              `/api/orders/${params.id}/delay`,
              { delayMinutes: minutes },
              `Neue Zeit gesetzt · +${minutes} Min`
            )
          }
        />
      )}

      {order && (
        <PosPrintSheet
          open={sheet === 'print'}
          lines={order.receiptLines}
          lastPrintedAt={posClock(order.createdMs)}
          printSeq={order.print.seq}
          onClose={() => setSheet(null)}
          onConfirm={() =>
            run(`/api/orders/${params.id}/reprint`, {}, 'Bon in die Warteschlange gestellt')
          }
        />
      )}

      {/*
        Подтверждений в макете нет, но последствия этих действий необратимы:
        заказ уходит гостю сообщением (отмена вдобавок откатывает баллы).
        Нажатие мимо кнопки не должно этого делать — см. lib/pos/detail-actions.ts
        и заказ #260820002.
      */}
      <PosSheet
        open={confirming !== null && confirmSheet !== undefined}
        align="center"
        title={confirmSheet?.title ?? ''}
        subtitle={confirmSheet?.subtitle}
        onClose={() => setConfirming(null)}
        actions={
          <>
            <PosButton label="Zurück" variant="ghost" onClick={() => setConfirming(null)} />
            <PosButton
              label={confirmSheet?.confirmLabel ?? ''}
              variant={confirmSheet?.danger ? 'danger' : 'primary'}
              disabled={busy}
              onClick={() => confirming?.next && changeStatus(confirming.next)}
            />
          </>
        }
      />
    </>
  );
}
