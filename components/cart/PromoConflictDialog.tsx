"use client";

/**
 * Диалог выбора одной скидки из двух.
 *
 * На заказ действует ровно ОДНА денежная скидка, приоритет сверху вниз:
 *   Gutschein-/Aktionscode  >  Treuepunkte  >  automatisches Angebot
 * Поэтому возможны три конфликта — каждый решает клиент явным выбором:
 *   - 'coupon-vs-angebot' — код вместо денежной акции (Rabatt %, Rabatt €, 2+1);
 *   - 'coupon-vs-points'  — код вместо списанных Treuepunkte;
 *   - 'points-vs-angebot' — Treuepunkte вместо денежной акции.
 * Gratis-Artikel скидкой не считается и комбинируется со всем.
 */
export const PROMO_CONFLICT_MESSAGE =
  'Dieser Promo-Code kann nicht zusammen mit dem aktuellen Angebot verwendet werden. ' +
  'Bitte wählen Sie, ob Sie das Angebot behalten oder den Promo-Code anwenden möchten.';

export const POINTS_CONFLICT_MESSAGE =
  'Treuepunkte und ein Promo-Code können nicht zusammen eingelöst werden. ' +
  'Bitte wählen Sie, ob Sie Ihre Punkte behalten oder den Promo-Code anwenden möchten.';

export const ANGEBOT_POINTS_CONFLICT_MESSAGE =
  'Treuepunkte können nicht zusammen mit einem Angebot eingelöst werden. ' +
  'Bitte wählen Sie, ob Sie das Angebot behalten oder Ihre Punkte einlösen möchten.';

export type PromoConflictKind = 'coupon-vs-angebot' | 'coupon-vs-points' | 'points-vs-angebot';

const VARIANTS: Record<
  PromoConflictKind,
  { title: string; message: string; keepLabel: string; applyLabel: string }
> = {
  'coupon-vs-angebot': {
    title: 'Angebot oder Promo-Code?',
    message: PROMO_CONFLICT_MESSAGE,
    keepLabel: 'Angebot behalten',
    applyLabel: 'Promo-Code anwenden',
  },
  'coupon-vs-points': {
    title: 'Treuepunkte oder Promo-Code?',
    message: POINTS_CONFLICT_MESSAGE,
    keepLabel: 'Punkte behalten',
    applyLabel: 'Promo-Code anwenden',
  },
  'points-vs-angebot': {
    title: 'Angebot oder Treuepunkte?',
    message: ANGEBOT_POINTS_CONFLICT_MESSAGE,
    keepLabel: 'Angebot behalten',
    applyLabel: 'Punkte einlösen',
  },
};

interface PromoConflictDialogProps {
  open: boolean;
  /** Какой из трёх конфликтов решаем (по умолчанию — код против акции). */
  kind?: PromoConflictKind;
  /** Название конфликтующей акции (необязательно — для наглядности). */
  angebotName?: string;
  /** Сколько Treuepunkte участвует в конфликте. */
  appliedPoints?: number;
  /** Код промокода (необязательно). */
  promoCode?: string;
  /** Оставить то, что уже действует (акцию / баллы). */
  onKeep: () => void;
  /** Применить то, что клиент только что ввёл/выбрал (код / баллы). */
  onApply: () => void;
}

export default function PromoConflictDialog({
  open,
  kind = 'coupon-vs-angebot',
  angebotName,
  appliedPoints = 0,
  promoCode,
  onKeep,
  onApply,
}: PromoConflictDialogProps) {
  if (!open) return null;

  const variant = VARIANTS[kind];
  const details: Array<{ label: string; value: string }> = [];
  if (angebotName && kind !== 'coupon-vs-points') {
    details.push({ label: 'Aktuelles Angebot:', value: angebotName });
  }
  if (appliedPoints > 0 && kind !== 'coupon-vs-angebot') {
    details.push({ label: 'Treuepunkte:', value: `${appliedPoints.toFixed(2)} Punkte` });
  }
  if (promoCode) {
    details.push({ label: 'Promo-Code:', value: promoCode });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={variant.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 className="mb-3 text-lg font-bold text-gray-900">{variant.title}</h3>
        <p className="mb-5 text-sm text-gray-700">{variant.message}</p>

        {details.length > 0 && (
          <div className="mb-5 space-y-1 text-xs text-gray-500">
            {details.map((d) => (
              <p key={d.label}>
                {d.label} <span className="font-medium text-gray-700">{d.value}</span>
              </p>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onKeep}
            className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            {variant.keepLabel}
          </button>
          <button
            type="button"
            onClick={onApply}
            className="flex-1 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
          >
            {variant.applyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
