"use client";

/**
 * Диалог конфликта «Angebot vs Promo-Code».
 *
 * Денежная акция (Rabatt %, Rabatt €, Zweite Pizza zum halben Preis / gratis)
 * не может комбинироваться с купоном. Когда возникает конфликт, пользователь
 * выбирает: оставить акцию или применить промокод.
 */
export const PROMO_CONFLICT_MESSAGE =
  'Dieser Promo-Code kann nicht zusammen mit dem aktuellen Angebot verwendet werden. ' +
  'Bitte wählen Sie, ob Sie das Angebot behalten oder den Promo-Code anwenden möchten.';

interface PromoConflictDialogProps {
  open: boolean;
  /** Название конфликтующей акции (необязательно — для наглядности). */
  angebotName?: string;
  /** Код промокода (необязательно). */
  promoCode?: string;
  onKeepAngebot: () => void;
  onApplyPromoCode: () => void;
}

export default function PromoConflictDialog({
  open,
  angebotName,
  promoCode,
  onKeepAngebot,
  onApplyPromoCode,
}: PromoConflictDialogProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Angebot oder Promo-Code"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 className="mb-3 text-lg font-bold text-gray-900">Angebot oder Promo-Code?</h3>
        <p className="mb-5 text-sm text-gray-700">{PROMO_CONFLICT_MESSAGE}</p>

        {(angebotName || promoCode) && (
          <div className="mb-5 space-y-1 text-xs text-gray-500">
            {angebotName && (
              <p>
                Aktuelles Angebot: <span className="font-medium text-gray-700">{angebotName}</span>
              </p>
            )}
            {promoCode && (
              <p>
                Promo-Code: <span className="font-medium text-gray-700">{promoCode}</span>
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onKeepAngebot}
            className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Angebot behalten
          </button>
          <button
            type="button"
            onClick={onApplyPromoCode}
            className="flex-1 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
          >
            Promo-Code anwenden
          </button>
        </div>
      </div>
    </div>
  );
}
