"use client";

import type { BogoSecondOffer } from '../../lib/promotions/types';
import { Gift, Percent } from 'lucide-react';
import { SafeImage } from '../SafeImage';
import { NoTranslate } from '../NoTranslate';

interface BogoSecondPickerModalProps {
  offers: BogoSecondOffer[];
  selections: Record<string, string>;
  onSelect: (promotionId: string, productId: string) => void;
  onConfirm: () => void;
  onClose?: () => void;
  t?: (key: string, fallback?: string) => string;
}

export default function BogoSecondPickerModal({
  offers,
  selections,
  onSelect,
  onConfirm,
  onClose,
  t = (_k, fb) => fb || '',
}: BogoSecondPickerModalProps) {
  const allSelected = offers.every((offer) => Boolean(selections[offer.promotionId]));
  // 2+1 с фиксированной наградой: у каждого оффера ровно 1 позиция (выбрал ресторан) —
  // попап становится подтверждением («Ja, gerne» / «Nein, danke») вместо выбора.
  const fixedReward = offers.every((offer) => offer.options.length === 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bogo-second-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-full">
              {offers[0]?.bogoMode === 'free' ? (
                <Gift className="h-6 w-6 text-emerald-600" />
              ) : (
                <Percent className="h-6 w-6 text-orange-600" />
              )}
            </div>
            <div>
              <h2 id="bogo-second-title" className="text-xl font-bold text-gray-900">
                {offers[0]?.bogoMode === 'free'
                  ? t('checkout.bogo_free_title', '2+1 Aktion: Ihr 3. Artikel gratis')
                  : t('checkout.bogo_half_title', '2+1 Aktion: Ihr 3. Artikel zum halben Preis')}
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                {fixedReward
                  ? t(
                      'checkout.bogo_fixed_subtitle',
                      'Sie haben 2 Aktionsartikel im Warenkorb — diese Belohnung legen wir Ihnen dazu.'
                    )
                  : t(
                      'checkout.bogo_second_subtitle',
                      'Wählen Sie einen Artikel aus der Aktionsliste.'
                    )}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {offers.map((offer) => (
            <div key={offer.promotionId}>
              <h3 className="font-semibold text-gray-900 mb-1"><NoTranslate>{offer.promotionName}</NoTranslate></h3>
              <p className="text-sm text-gray-500 mb-1">{offer.label}</p>
              {(offer.remaining ?? 0) > 1 && (
                <p className="text-xs font-semibold text-orange-600 mb-3">
                  {t('checkout.bogo_remaining', 'Noch {{n}} Artikel zur Auswahl').replace(
                    '{{n}}',
                    String(offer.remaining)
                  )}
                </p>
              )}
              <div className="space-y-2">
                {offer.options.map((option) => {
                  const optKey = option.id || option.productId;
                  const selected = selections[offer.promotionId] === optKey;
                  const isFree = offer.bogoMode === 'free';
                  const priceLabel = isFree
                    ? '0,00 €'
                    : `${option.effectivePrice.toFixed(2)} €`;

                  return (
                    <label
                      key={optKey}
                      className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                        selected
                          ? isFree
                            ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                            : 'border-orange-500 bg-orange-50 ring-1 ring-orange-500'
                          : 'border-gray-200 hover:border-orange-300 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`bogo-${offer.promotionId}`}
                        value={optKey}
                        checked={selected}
                        onChange={() => onSelect(offer.promotionId, optKey)}
                        className={isFree ? 'text-emerald-600 focus:ring-emerald-500' : 'text-orange-600 focus:ring-orange-500'}
                      />
                      {option.image && (
                        <SafeImage
                          src={option.image}
                          alt=""
                          className="w-12 h-12 rounded object-cover shrink-0"
                        />
                      )}
                      <NoTranslate className="font-medium text-gray-900 flex-1">{option.name}</NoTranslate>
                      <span
                        className={`text-sm font-semibold shrink-0 ${
                          isFree ? 'text-emerald-600' : 'text-orange-600'
                        }`}
                      >
                        <NoTranslate>{priceLabel}</NoTranslate>
                        {!isFree && option.unitPrice > option.effectivePrice && (
                          <span className="block text-xs text-gray-400 line-through text-right">
                            <NoTranslate>{option.unitPrice.toFixed(2)} €</NoTranslate>
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="p-6 border-t bg-gray-50 rounded-b-xl flex gap-3">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition-colors"
            >
              {t('checkout.bogo_skip', 'Nein, danke')}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={!allSelected}
            className="flex-1 py-3 px-4 bg-orange-600 text-white font-semibold rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {fixedReward
              ? t('checkout.bogo_confirm_yes', 'Ja, gerne!')
              : t('checkout.bogo_second_confirm', 'Auswahl übernehmen')}
          </button>
        </div>
      </div>
    </div>
  );
}
