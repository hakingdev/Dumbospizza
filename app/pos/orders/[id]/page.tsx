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
import { toOrderStatus, type PosBoardStatus } from '../../../../lib/pos/board';

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

/** Кнопка панели действий: подпись, вид и то, во что она переводит заказ. */
interface PosAction {
  label: string;
  variant?: 'primary' | 'ghost';
  /** Куда переводим заказ. Пусто — действие не про статус. */
  next?: PosBoardStatus;
  /** Отмена спрашивает подтверждение: она уведомляет гостя и её не отменить. */
  confirm?: boolean;
}

const CANCEL: PosAction = { label: 'Stornieren', variant: 'ghost', next: 'cancelled', confirm: true };
const BACK: PosAction = { label: 'Zurück zur Liste', variant: 'ghost' };

const VIEW: Record<
  PosBoardStatus,
  { step?: 1 | 2 | 3 | 4; canExtend: boolean; actions: PosAction[] }
> = {
  new: {
    step: 1,
    canExtend: false,
    // Принять заказ = назначить время. Отдельной кнопки «принять без времени»
    // нет: гость всё равно спросит, когда, а кухня уже забыла.
    actions: [CANCEL, { label: 'Annehmen' }],
  },
  preparing: {
    step: 2,
    canExtend: true,
    // Сразу в «Unterwegs», минуя «Bereit zur Lieferung». Для ресторана это один
    // шаг: заказ снимают с кухни и отдают курьеру, промежуточного состояния
    // «стоит готовый на полке» в реальной смене нет — а лишняя кнопка означала
    // лишнее касание и заказ, забытый в статусе, которого никто не ведёт.
    actions: [CANCEL, { label: 'Ist unterwegs', next: 'delivering' }],
  },
  // Статус остаётся живым: его ставят из Telegram и админки, и такой заказ
  // терминал обязан показать и уметь довести до конца.
  ready: {
    step: 3,
    canExtend: false,
    actions: [CANCEL, { label: 'Ist unterwegs', next: 'delivering' }],
  },
  delivering: {
    step: 3,
    canExtend: false,
    actions: [{ label: 'Zurück', variant: 'ghost' }, { label: 'Zugestellt', next: 'delivered' }],
  },
  delivered: { step: 4, canExtend: false, actions: [BACK] },
  // Отменённый заказ прогресс не показывает: ему некуда двигаться.
  cancelled: { canExtend: false, actions: [BACK] },
};

/** kitchenPrintStatus из базы → три состояния карточки бона. */
function toPrintState(status: string): PosPrintState {
  if (status === 'completed') return 'printed';
  if (status === 'failed') return 'failed';
  return 'queued';
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Barzahlung',
  card: 'Kartenzahlung',
  online: 'Online',
};

/** Крупное число в шапке и две строки под ним — своё на каждый статус. */
function headline(order: PosOrderDetail, nowMs: number) {
  const left = order.dueMs == null ? null : order.dueMs - nowMs;

  switch (order.status) {
    case 'new':
      return {
        bigValue: posClock(order.createdMs),
        subTop: 'Eingegangen',
        subBottom: 'Zeit noch nicht gesetzt',
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
    case 'ready': {
      const since = order.closedMs ? Math.round((nowMs - order.closedMs) / 60_000) : null;
      return {
        bigValue: posClock(order.closedMs ?? order.dueMs),
        subTop: since == null ? 'Fertig' : `Fertig seit ${since} Minuten`,
        subBottom:
          order.deliveryType === 'pickup' ? 'Wartet auf den Gast' : 'Wartet auf den Fahrer',
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
  const view = order ? VIEW[order.status] : null;

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
    if (action.confirm) {
      setConfirming(action);
      return;
    }
    if (action.next) {
      changeStatus(action.next);
      return;
    }
    // Кнопки без статуса ведут дальше по потоку: приём — на выбор времени,
    // «Zurück» — обратно в ленту.
    if (action.label === 'Annehmen') router.push(`/pos/orders/new/time?id=${params.id}`);
    else router.push('/pos/orders');
  };

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
              status={order.status}
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
        Отмены в макете нет, но её последствия необратимы: заказ уходит гостю
        сообщением, а начисленные баллы откатываются. Нажатие мимо кнопки не
        должно этого делать.
      */}
      <PosSheet
        open={confirming !== null}
        align="center"
        title="Bestellung stornieren?"
        subtitle="Der Gast bekommt eine Nachricht. Das lässt sich nicht zurücknehmen."
        onClose={() => setConfirming(null)}
        actions={
          <>
            <PosButton label="Zurück" variant="ghost" onClick={() => setConfirming(null)} />
            <PosButton
              label="Stornieren"
              variant="danger"
              disabled={busy}
              onClick={() => confirming?.next && changeStatus(confirming.next)}
            />
          </>
        }
      />
    </>
  );
}
