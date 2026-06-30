"use client";

import type { PromotionFreeGiftOffer } from '../../lib/promotions/types';
import { Gift } from 'lucide-react';
import { SafeImage } from '../SafeImage';
import { NoTranslate } from '../NoTranslate';

interface GratisGiftPickerModalProps {
  offers: PromotionFreeGiftOffer[];
  selections: Record<string, string>;
  onSelect: (promotionId: string, productId: string) => void;
  onConfirm: () => void;
  onClose?: () => void;
  t?: (key: string, fallback?: string) => string;
}

export default function GratisGiftPickerModal({
  offers,
  selections,
  onSelect,
  onConfirm,
  onClose,
  t = (_k, fb) => fb || '',
}: GratisGiftPickerModalProps) {
  const allSelected = offers.every((offer) => Boolean(selections[offer.promotionId]));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gratis-gift-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-full">
              <Gift className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <h2 id="gratis-gift-title" className="text-xl font-bold text-gray-900">
                {t('checkout.gratis_title', 'Wählen Sie Ihr Gratis-Produkt')}
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                {t('checkout.gratis_subtitle', 'Sie erhalten ein Gratis-Produkt — bitte wählen Sie eins aus.')}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {offers.map((offer) => (
            <div key={offer.promotionId}>
              <h3 className="font-semibold text-gray-900 mb-1"><NoTranslate>{offer.promotionName}</NoTranslate></h3>
              <p className="text-sm text-gray-500 mb-3">{offer.label}</p>
              <div className="space-y-2">
                {offer.options.map((option) => {
                  const selected = selections[offer.promotionId] === option.id;
                  return (
                    <label
                      key={option.id}
                      className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                        selected
                          ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                          : 'border-gray-200 hover:border-emerald-300 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`gratis-${offer.promotionId}`}
                        value={option.id}
                        checked={selected}
                        onChange={() => onSelect(offer.promotionId, option.id)}
                        className="text-emerald-600 focus:ring-emerald-500"
                      />
                      {option.image && (
                        <SafeImage
                          src={option.image}
                          alt=""
                          className="w-12 h-12 rounded object-cover shrink-0"
                        />
                      )}
                      <NoTranslate className="font-medium text-gray-900">{option.name}</NoTranslate>
                      <NoTranslate className="ml-auto text-sm font-semibold text-emerald-600">0,00 €</NoTranslate>
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
              {t('checkout.gratis_skip', 'Nein, danke')}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={!allSelected}
            className="flex-1 py-3 px-4 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('checkout.gratis_confirm', 'Gratis-Produkt übernehmen')}
          </button>
        </div>
      </div>
    </div>
  );
}
