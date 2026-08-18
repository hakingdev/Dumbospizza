'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  PosActionBar,
  PosButton,
  PosCard,
  PosDivider,
  PosRow,
  PosStatusBar,
} from '../../../../components/pos/primitives';
import { PosScreenState } from '../../../../components/pos/screen-state';
import {
  posClock,
  posCountdown,
  posFetch,
  usePosNow,
  usePosOrder,
} from '../../../../components/pos/data';
import { usePosBoardContext } from '../../../../components/pos/board-context';
import { toOrderStatus } from '../../../../lib/pos/board';

/**
 * 01 · Neue Bestellung (Figma 9:2).
 *
 * Экран-тревога: он перекрывает всё и требует решения. Отсюда шапка акцентным
 * цветом и счётчик — заказ нельзя оставить висеть, гость ждёт ответа.
 *
 * Показывает САМЫЙ СТАРЫЙ непринятый заказ, а не «тот, что открыли»: если их
 * пришло три, решать надо с того, который ждёт дольше всех.
 *
 * Счётчик считает не «сколько осталось», а сколько заказ уже ждёт: жёсткого
 * срока у ресторана нет, а вот забытый на десять минут заказ — это остывший
 * гость, и увидеть это надо цифрой.
 */

export default function NewOrderPage() {
  const router = useRouter();
  const { state: boardState, refresh: refreshBoard, skewRef } = usePosBoardContext();
  const nowMs = usePosNow(skewRef);
  const [busy, setBusy] = useState(false);

  const board = boardState.status === 'ready' ? boardState.data : null;
  const incoming = board?.orders.find((order) => order.status === 'new') ?? null;
  const { state } = usePosOrder(incoming?.id ?? null);
  const order = state.status === 'ready' ? state.data : null;

  const waiting = order && nowMs != null ? posCountdown(nowMs - order.createdMs) : '—';

  const decline = async () => {
    if (!order || busy) return;
    setBusy(true);
    await posFetch(`/api/orders/${order.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: toOrderStatus('cancelled') }),
    });
    await refreshBoard();
    setBusy(false);
  };

  return (
    <>
      <PosStatusBar time={posClock(nowMs)} />

      {/* Шапка-тревога: акцентный фон и счётчик, который нельзя не заметить. */}
      <header className="flex w-full shrink-0 items-center gap-[12px] bg-[var(--pos-accent)] px-[16px] py-[14px]">
        <div className="flex min-w-px flex-1 flex-col gap-[3px] text-[var(--pos-text-on-accent)]">
          <span className="pos-overline opacity-85">NEUE BESTELLUNG</span>
          <span className="pos-title-m">
            {order ? `Bestellung #${order.number}` : 'Keine offene Bestellung'}
          </span>
        </div>
        {order && (
          <div className="flex size-[58px] shrink-0 items-center justify-center rounded-full bg-[var(--pos-bg-base)]">
            <span className="pos-number-m pos-num text-[var(--pos-text-primary)]">{waiting}</span>
          </div>
        )}
      </header>

      <div className="pos-scroll flex min-h-px w-full flex-1 flex-col gap-[12px] px-[16px] py-[14px]">
        <PosScreenState state={boardState} onRetry={refreshBoard} />

        {board && !incoming && (
          <p className="pos-body-m w-full pt-[24px] text-center text-[var(--pos-text-muted)]">
            Alle Bestellungen sind angenommen.
          </p>
        )}

        {order && (
          <>
            <PosCard>
              <div className="flex flex-col gap-[10px]">
                <PosRow label="Quelle" value={order.channel} />
                <PosDivider />
                <PosRow
                  label="Art"
                  value={order.deliveryType === 'pickup' ? 'Abholung' : 'Lieferung'}
                />
                <PosDivider />
                <PosRow label="Eingegangen" value={posClock(order.createdMs)} />
                <PosDivider />
                <PosRow
                  label="Zahlung"
                  value={order.paid ? 'bezahlt' : 'offen'}
                  tone={order.paid ? 'paid' : 'default'}
                />
              </div>
            </PosCard>

            <PosCard>
              <div className="flex flex-col gap-[4px]">
                <span className="pos-title-s text-[var(--pos-text-primary)]">
                  {order.customerName || 'Gast'}
                </span>
                <span className="pos-body-m text-[var(--pos-text-secondary)]">
                  {order.deliveryType === 'pickup'
                    ? 'Abholung an der Theke'
                    : order.address || '—'}
                </span>
                {/* Телефон — ссылка: на приборе это набор номера одним касанием. */}
                {order.phone && (
                  <a
                    href={`tel:${order.phone.replace(/\s/g, '')}`}
                    className="pos-label-m pos-num text-[var(--pos-status-delivering)]"
                  >
                    {order.phone}
                  </a>
                )}
              </div>
            </PosCard>

            <PosCard>
              <div className="flex flex-col gap-[10px]">
                {order.items.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="flex w-full items-start gap-[8px]">
                    <span className="pos-label-l pos-num shrink-0 text-[var(--pos-accent)]">
                      {item.qty}×
                    </span>
                    <span className="pos-body-m min-w-px flex-1 text-[var(--pos-text-primary)]">
                      {item.name}
                    </span>
                    <span className="pos-label-m pos-num shrink-0 text-[var(--pos-text-secondary)]">
                      {item.price}
                    </span>
                  </div>
                ))}
                {order.note && (
                  <span className="pos-body-s w-full text-[var(--pos-status-preparing)]">
                    Notiz: {order.note}
                  </span>
                )}
                <PosDivider />
                <div className="flex w-full items-center gap-[8px]">
                  <span className="pos-body-m shrink-0 text-[var(--pos-text-secondary)]">
                    Summe
                  </span>
                  <span className="h-px min-w-px flex-1" />
                  <span className="pos-number-m pos-num shrink-0 text-[var(--pos-text-primary)]">
                    {order.total}
                  </span>
                </div>
              </div>
            </PosCard>
          </>
        )}
      </div>

      <PosActionBar>
        {order ? (
          <>
            <PosButton label="Ablehnen" variant="ghost" disabled={busy} onClick={decline} />
            {/* Принять = назначить время: без него гость не узнает, когда ждать. */}
            <PosButton
              label="Annehmen"
              disabled={busy}
              onClick={() => router.push(`/pos/orders/new/time?id=${order.id}`)}
            />
          </>
        ) : (
          <PosButton
            label="Zur Bestellliste"
            variant="ghost"
            onClick={() => router.push('/pos/orders')}
          />
        )}
      </PosActionBar>
    </>
  );
}
