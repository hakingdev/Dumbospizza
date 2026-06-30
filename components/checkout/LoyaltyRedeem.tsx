'use client';

import { useEffect, useMemo, useState } from 'react';
import { Star, Loader2 } from 'lucide-react';
import { NoTranslate } from '../NoTranslate';

interface LoyaltyRules {
  redeemMaxShare: number;
  minOrderToRedeem: number;
  pointValueEuro: number;
}

interface LoyaltyRedeemProps {
  /** Сумма заказа ДО списания баллов (subtotal+доставка−купон−акции). */
  orderAmountBeforePoints: number;
  /** Сколько баллов уже применено (state.loyaltyPointsToRedeem). */
  appliedPoints: number;
  /** Применить/убрать баллы. */
  onChange: (points: number) => void;
  /** Подпись (i18n) с фолбэками. */
  t: (key: string, fallback?: string) => string;
}

/** Максимум к списанию: cap по доле заказа, баланс и минимальная сумма. */
function maxRedeemable(balance: number, orderAmount: number, rules: LoyaltyRules): number {
  if (orderAmount < rules.minOrderToRedeem) return 0;
  const capEuro = orderAmount * rules.redeemMaxShare;
  const capPoints = capEuro / (rules.pointValueEuro || 1);
  return Math.max(0, Math.floor(Math.min(balance, capPoints) * 100) / 100);
}

export default function LoyaltyRedeem({
  orderAmountBeforePoints,
  appliedPoints,
  onChange,
  t,
}: LoyaltyRedeemProps) {
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [rules, setRules] = useState<LoyaltyRules | null>(null);
  const [input, setInput] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/customer/loyalty')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d?.success) return;
        setBalance(Number(d.loyalty.balance) || 0);
        setRules({
          redeemMaxShare: d.rules.redeemMaxShare,
          minOrderToRedeem: d.rules.minOrderToRedeem,
          pointValueEuro: d.rules.pointValueEuro,
        });
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const max = useMemo(
    () => (rules ? maxRedeemable(balance, orderAmountBeforePoints, rules) : 0),
    [balance, orderAmountBeforePoints, rules]
  );

  // Если корзина изменилась и применено больше, чем теперь допустимо — поджать.
  useEffect(() => {
    if (rules && appliedPoints > max) {
      onChange(max);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [max]);

  // Не залогинен / нет баллов / правила не загрузились — ничего не показываем.
  if (loading || !rules || balance <= 0) return null;

  const apply = () => {
    const raw = Number(input.replace(',', '.'));
    if (!raw || Number.isNaN(raw)) return;
    const clamped = Math.max(0, Math.min(raw, max));
    onChange(Math.floor(clamped * 100) / 100);
    setInput('');
  };

  const minNotReached = orderAmountBeforePoints < rules.minOrderToRedeem;

  return (
    <div className="mb-4 rounded-lg border border-primary-100 bg-primary-50/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center text-sm font-medium text-gray-800">
          <Star className="mr-1.5 h-4 w-4 text-yellow-500" />
          {t('checkout.loyalty_title', 'Treuepunkte einlösen')}
        </span>
        <span className="text-sm text-gray-600">
          <NoTranslate>{balance.toFixed(2)}</NoTranslate> {t('checkout.loyalty_points', 'Punkte')}
        </span>
      </div>

      {appliedPoints > 0 ? (
        <div className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm">
          <span className="text-green-700">
            <NoTranslate>−{appliedPoints.toFixed(2)}</NoTranslate> {t('checkout.loyalty_points', 'Punkte')} (
            <NoTranslate>{(appliedPoints * rules.pointValueEuro).toFixed(2)} €</NoTranslate>)
          </span>
          <button
            type="button"
            onClick={() => onChange(0)}
            className="text-sm font-medium text-red-600 hover:text-red-700"
          >
            {t('checkout.loyalty_remove', 'Entfernen')}
          </button>
        </div>
      ) : minNotReached ? (
        <p className="text-xs text-gray-500">
          {t('checkout.loyalty_min_order', 'Punkte einlösbar ab')} <NoTranslate>{rules.minOrderToRedeem} €</NoTranslate>.
        </p>
      ) : max <= 0 ? (
        <p className="text-xs text-gray-500">
          {t('checkout.loyalty_none_available', 'Aktuell keine Punkte einlösbar.')}
        </p>
      ) : (
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={max}
            step="0.01"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`max. ${max.toFixed(2)}`}
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-primary-500"
          />
          <button
            type="button"
            onClick={() => setInput(String(max))}
            className="whitespace-nowrap rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Max
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!input}
            className="whitespace-nowrap rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {t('checkout.loyalty_apply', 'Einlösen')}
          </button>
        </div>
      )}
      <p className="mt-1.5 text-xs text-gray-400">
        {t('checkout.loyalty_hint', 'Bis zu')} <NoTranslate>{Math.round(rules.redeemMaxShare * 100)}%</NoTranslate>{' '}
        {t('checkout.loyalty_hint_2', 'des Bestellwerts · 1 Punkt = 1 €')}
      </p>
    </div>
  );
}
