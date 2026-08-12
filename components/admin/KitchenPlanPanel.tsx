"use client";

/**
 * Панель «AI-план кухни» на странице заказов админки: в какой
 * последовательности готовить активные заказы и какие доставки объединить
 * в один рейс курьера (например, 2 заказа в Oerlenbach — готовить вместе).
 *
 * Данные — GET /api/admin/kitchen-plan (Claude, fallback-эвристика).
 * Логика правится в lib/eta/kitchen-plan.ts: DISPATCH_RULES + PLAN_TUNING.
 */

import { useCallback, useEffect, useState } from 'react';
import { Bot, RefreshCw, Bike, ChefHat, AlertTriangle, Users } from 'lucide-react';
import type { KitchenPlan, KitchenStaffing } from '../../lib/eta/types';

const LOAD_BADGE: Record<string, { label: string; className: string }> = {
  normal: { label: 'нагрузка: норма', className: 'bg-green-100 text-green-700' },
  busy: { label: 'нагрузка: плотно', className: 'bg-yellow-100 text-yellow-800' },
  peak: { label: 'нагрузка: пик', className: 'bg-red-100 text-red-700' },
};

export default function KitchenPlanPanel() {
  const [plan, setPlan] = useState<KitchenPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courierCount, setCourierCount] = useState<number | null>(null);
  const [savingCouriers, setSavingCouriers] = useState(false);
  const [staffing, setStaffing] = useState<KitchenStaffing | null>(null);
  const [savingStaffing, setSavingStaffing] = useState(false);

  const fetchPlan = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/kitchen-plan${refresh ? '?refresh=1' : ''}`
      );
      const data = await response.json();
      if (data.success && data.plan) {
        setPlan(data.plan);
        if (typeof data.courierCount === 'number') setCourierCount(data.courierCount);
        if (data.staffing) setStaffing(data.staffing);
      } else {
        setError(data.error || 'Не удалось построить план');
      }
    } catch {
      setError('Не удалось построить план — проверь соединение');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlan(false);
  }, [fetchPlan]);

  /** Смена числа курьеров: сохранить в настройках и сразу пересчитать план. */
  const handleCourierChange = async (value: number) => {
    const previous = courierCount;
    setCourierCount(value);
    setSavingCouriers(true);
    try {
      const response = await fetch('/api/admin/kitchen-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courierCount: value }),
      });
      const data = await response.json();
      if (!data.success) {
        setCourierCount(previous);
        alert('Не удалось сохранить число курьеров: ' + (data.error || 'неизвестная ошибка'));
        return;
      }
      await fetchPlan(true);
    } catch {
      setCourierCount(previous);
      alert('Не удалось сохранить число курьеров — проверь соединение');
    } finally {
      setSavingCouriers(false);
    }
  };

  /**
   * Смена персонала кухни (повара/помощник/суши): сохранить и пересчитать план.
   * Настройка влияет и на AI-оценку времени НОВЫХ заказов.
   */
  const handleStaffingChange = async (patch: Partial<KitchenStaffing>) => {
    if (!staffing) return;
    const previous = staffing;
    const next = { ...staffing, ...patch };
    setStaffing(next);
    setSavingStaffing(true);
    try {
      const response = await fetch('/api/admin/kitchen-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffing: next }),
      });
      const data = await response.json();
      if (!data.success) {
        setStaffing(previous);
        alert('Не удалось сохранить персонал: ' + (data.error || 'неизвестная ошибка'));
        return;
      }
      await fetchPlan(true);
    } catch {
      setStaffing(previous);
      alert('Не удалось сохранить персонал — проверь соединение');
    } finally {
      setSavingStaffing(false);
    }
  };

  const staffingSelect = (
    label: string,
    title: string,
    field: keyof KitchenStaffing,
    options: number[]
  ) => (
    <label className="flex items-center gap-1 text-xs text-gray-600" title={title}>
      {label}
      <select
        value={staffing ? staffing[field] : ''}
        onChange={(e) => handleStaffingChange({ [field]: Number(e.target.value) })}
        disabled={savingStaffing || staffing == null}
        data-testid={`kitchen-plan-${field}`}
        className="px-1.5 py-0.5 border rounded text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {staffing == null && <option value="">…</option>}
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );

  const load = plan ? LOAD_BADGE[plan.loadLevel] ?? LOAD_BADGE.normal : null;

  return (
    <div className="mb-6 p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary-600" />
          <h2 className="text-sm font-semibold text-gray-800">
            AI-план кухни: что готовить и как везти
          </h2>
          {plan && load && (
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${load.className}`}>
              {load.label}
            </span>
          )}
          {plan && (
            <span className="text-xs text-gray-400">
              {plan.source === 'ai' ? 'Claude' : 'эвристика'}
              {' · '}
              {new Date(plan.generatedAt).toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="flex items-center gap-1 text-xs text-gray-400"
            title="Персонал на смене: влияет на AI-оценку времени новых заказов и на план кухни"
          >
            <ChefHat className="h-4 w-4" />
          </span>
          {staffingSelect(
            'Повара:',
            'Поваров на пицце сейчас (двое делают две пиццы параллельно)',
            'pizzaCooks',
            [1, 2, 3, 4]
          )}
          {staffingSelect(
            'Помощник:',
            'Помощников на фритюре/Beilagen; 0 — гарнир делает сам повар (время готовки растёт)',
            'fryerHelpers',
            [0, 1, 2, 3]
          )}
          {staffingSelect('Суши:', 'Людей на суши-станции MakiLove', 'sushiChefs', [1, 2, 3, 4])}
          <label
            className="flex items-center gap-1.5 text-xs text-gray-600"
            title="Сколько курьеров сейчас на смене — план строит столько параллельных рейсов"
          >
            <Users className="h-4 w-4 text-gray-400" />
            Курьеров:
            <select
              value={courierCount ?? ''}
              onChange={(e) => handleCourierChange(Number(e.target.value))}
              disabled={savingCouriers || courierCount == null}
              data-testid="kitchen-plan-couriers"
              className="px-1.5 py-0.5 border rounded text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {courierCount == null && <option value="">…</option>}
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => fetchPlan(true)}
            disabled={loading}
            className={`flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 ${
              loading ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            title="Пересчитать план"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>

      {loading && !plan && (
        <p className="text-sm text-gray-500">Анализирую очередь и маршруты…</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {plan && plan.batches.length === 0 && !loading && (
        <p className="text-sm text-gray-500">Активных заказов нет — планировать нечего.</p>
      )}

      {plan && plan.batches.length > 0 && (
        <>
          {plan.summary && <p className="text-sm text-gray-600 mb-3">{plan.summary}</p>}

          {plan.advisory && (
            <div className="flex items-start gap-2 mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{plan.advisory}</span>
            </div>
          )}

          <ol className="space-y-2">
            {plan.batches.map((batch) => (
              <li
                key={batch.step}
                className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
                data-testid={`kitchen-plan-step-${batch.step}`}
              >
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                  {batch.step}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">
                      {batch.orderNumbers.map((n) => `#${n}`).join(' + ')}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-gray-200 text-gray-700 text-xs">
                      {batch.area}
                    </span>
                    {batch.cookTogether && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-xs">
                        <ChefHat className="h-3 w-3" />
                        готовить вместе
                      </span>
                    )}
                  </div>
                  {batch.courier && (
                    <div className="flex items-center gap-1 text-xs text-gray-600 mt-1">
                      <Bike className="h-3.5 w-3.5 shrink-0" />
                      {batch.courier}
                    </div>
                  )}
                  {batch.rationale && (
                    <div className="text-xs text-gray-500 mt-1">{batch.rationale}</div>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {plan.onTheRoad.length > 0 && (
            <p className="text-xs text-gray-500 mt-3">
              Уже в пути (курьер занят): {plan.onTheRoad.map((n) => `#${n}`).join(', ')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
