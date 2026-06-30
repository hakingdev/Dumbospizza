'use client';

import { useEffect, useState } from 'react';
import { Star, TrendingUp, Clock, Gift, Loader2 } from 'lucide-react';
import { NoTranslate } from '../NoTranslate';

const TIER_LABEL: Record<string, string> = {
  bronze: 'Bronze',
  silver: 'Silber',
  gold: 'Gold',
};

const TIER_COLOR: Record<string, string> = {
  bronze: 'bg-amber-100 text-amber-800',
  silver: 'bg-gray-200 text-gray-800',
  gold: 'bg-yellow-100 text-yellow-800',
};

const TX_LABEL: Record<string, string> = {
  earn: 'Gutschrift',
  redeem: 'Eingelöst',
  expire: 'Verfallen',
  adjust: 'Korrektur',
  reverse: 'Storno',
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default function PointsTab() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch('/api/customer/loyalty')
      .then((r) => r.json())
      .then((d) => setData(d.success ? d : null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!data) {
    return (
      <p className="py-8 text-center text-gray-500">
        Konnte Treuepunkte nicht laden.
      </p>
    );
  }

  const { loyalty, rules } = data;
  const tier = loyalty.tier as string;
  const earnPercent = Math.round((rules.earnPercentByTier[tier] || 0) * 100);

  return (
    <div className="space-y-6">
      {/* Balance card */}
      <div className="rounded-lg bg-gradient-to-br from-primary-600 to-primary-700 p-4 text-white shadow-lg sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm opacity-90">Verfügbare Punkte</p>
            <p className="mt-1 truncate text-3xl font-bold leading-tight sm:text-4xl">
              <NoTranslate>{loyalty.balance.toFixed(2)}</NoTranslate>
            </p>
            <p className="mt-1 text-sm opacity-90">
              <NoTranslate className="whitespace-nowrap">1 Punkt = 1 €</NoTranslate> Rabatt
            </p>
          </div>
          <span
            className={`w-fit shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${TIER_COLOR[tier]}`}
          >
            {TIER_LABEL[tier] || tier}
          </span>
        </div>
        {loyalty.nextTier && loyalty.nextTier.ordersNeeded > 0 && (
          <p className="mt-4 flex min-w-0 items-start text-pretty text-sm leading-6 opacity-90">
            <TrendingUp className="mr-1 mt-1 h-4 w-4 shrink-0" />
            Noch <NoTranslate>{loyalty.nextTier.ordersNeeded}</NoTranslate> Bestellung(en) bis{' '}
            {TIER_LABEL[loyalty.nextTier.tier]}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg bg-white p-4 text-center shadow">
          <p className="text-xs leading-tight text-gray-500">
            Insgesamt gesammelt
          </p>
          <p className="mt-1 truncate text-xl font-semibold text-gray-900">
            <NoTranslate>{loyalty.totalEarned.toFixed(2)}</NoTranslate>
          </p>
        </div>
        <div className="rounded-lg bg-white p-4 text-center shadow">
          <p className="text-xs leading-tight text-gray-500">
            Insgesamt eingelöst
          </p>
          <p className="mt-1 truncate text-xl font-semibold text-gray-900">
            <NoTranslate>{loyalty.totalRedeemed.toFixed(2)}</NoTranslate>
          </p>
        </div>
      </div>

      {/* Rules */}
      <div className="rounded-lg bg-white p-4 shadow sm:p-5">
        <h3 className="mb-3 flex items-center font-semibold leading-tight text-gray-900">
          <Gift className="mr-2 h-5 w-5 shrink-0 text-primary-600" />
          So funktioniert es
        </h3>
        <ul className="list-disc space-y-2 pl-5 text-pretty text-sm leading-6 text-gray-600">
          <li>
            Sie erhalten <strong><NoTranslate>{earnPercent}%</NoTranslate></strong> des bezahlten Betrags
            als Punkte zurück (nach Abschluss der Bestellung).
          </li>
          <li>
            Mit Punkten zahlen Sie bis zu{' '}
            <strong><NoTranslate>{Math.round(rules.redeemMaxShare * 100)}%</NoTranslate></strong> Ihrer
            nächsten Bestellung (ab <NoTranslate>{rules.minOrderToRedeem} €</NoTranslate>).
          </li>
          <li>
            Punkte verfallen nach <strong><NoTranslate>{rules.expiryMonths}</NoTranslate> Monaten</strong>.
          </li>
          <li>
            Stufen: Bronze <NoTranslate>{Math.round(rules.earnPercentByTier.bronze * 100)}%</NoTranslate> ·
            Silber <NoTranslate>{Math.round(rules.earnPercentByTier.silver * 100)}%</NoTranslate> (ab{' '}
            <NoTranslate>{rules.tierThresholds.silver}</NoTranslate> Bestellungen) · Gold{' '}
            <NoTranslate>{Math.round(rules.earnPercentByTier.gold * 100)}%</NoTranslate> (ab{' '}
            <NoTranslate>{rules.tierThresholds.gold}</NoTranslate>).
          </li>
        </ul>
      </div>

      {/* History */}
      <div className="rounded-lg bg-white shadow">
        <h3 className="border-b p-4 font-semibold leading-tight text-gray-900 sm:p-5">
          Verlauf
        </h3>
        {loyalty.transactions.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">
            Noch keine Bewegungen.
          </p>
        ) : (
          <ul className="divide-y">
            {loyalty.transactions.map((t: any) => (
              <li
                key={t.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {TX_LABEL[t.type] || t.type}
                  </p>
                  <p className="mt-1 flex min-w-0 items-start text-xs leading-5 text-gray-500">
                    <Clock className="mr-1 mt-1 h-3 w-3 shrink-0" />
                    <span className="min-w-0 text-pretty">
                      {fmtDate(t.createdAt)}
                      {t.description ? ` · ${t.description}` : ''}
                    </span>
                  </p>
                </div>
                <span
                  className={`shrink-0 whitespace-nowrap text-sm font-semibold sm:text-right ${
                    t.delta >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {t.delta >= 0 ? '+' : ''}
                  <NoTranslate>{Number(t.delta).toFixed(2)}</NoTranslate>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
