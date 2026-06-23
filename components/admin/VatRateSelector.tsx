"use client";

import { FOOD_VAT_RATE, BEVERAGE_VAT_RATE } from '../../lib/orders/tax';

interface VatRateSelectorProps {
  /** Текущая ставка как доля: 0.07 или 0.19. */
  value?: number;
  onChange: (rate: number) => void;
}

const OPTIONS = [
  { rate: FOOD_VAT_RATE, label: '7 %', hint: 'Speisen / еда' },
  { rate: BEVERAGE_VAT_RATE, label: '19 %', hint: 'Wasser & Alkohol' },
];

/**
 * Тулбар выбора ставки НДС (USt.) для карточки товара: 7 % или 19 %.
 * Ставка используется в чеке/налоговой разбивке онлайн-заказов
 * (см. lib/orders/tax.ts). По умолчанию — 7 % (еда).
 */
export default function VatRateSelector({ value = FOOD_VAT_RATE, onChange }: VatRateSelectorProps) {
  const active = value === BEVERAGE_VAT_RATE ? BEVERAGE_VAT_RATE : FOOD_VAT_RATE;

  return (
    <div data-testid="vat-rate-selector">
      <label className="block text-sm font-medium mb-2">USt. / НДС (для онлайн-оплаты)</label>
      <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden" role="group">
        {OPTIONS.map((opt) => {
          const isActive = active === opt.rate;
          return (
            <button
              key={opt.rate}
              type="button"
              aria-pressed={isActive}
              data-testid={`vat-rate-${Math.round(opt.rate * 100)}`}
              onClick={() => onChange(opt.rate)}
              className={`px-4 py-2 text-sm font-semibold transition-colors ${
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              } ${opt.rate === BEVERAGE_VAT_RATE ? 'border-l border-gray-300' : ''}`}
            >
              {opt.label}
              <span className={`block text-[11px] font-normal ${isActive ? 'text-white/80' : 'text-gray-400'}`}>
                {opt.hint}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-500 mt-1">
        7 % — еда; 19 % — вода и алкоголь. Применяется в налоговой разбивке чека онлайн-заказов.
      </p>
    </div>
  );
}
