'use client';

import type { PosLoad } from './data';

/**
 * Состояние загрузки одной полосой над содержимым.
 *
 * Отдельным компонентом, потому что на кухне «ничего не происходит» — худший
 * из возможных ответов: человек не отличит пустую смену от отвалившегося Wi-Fi
 * и будет ждать заказ, которого экран уже не получает.
 *
 * Ошибку показываем ПОВЕРХ старых данных, а не вместо них: список, устаревший
 * на десять секунд, всё равно полезнее пустого экрана.
 */
export function PosScreenState({
  state,
  onRetry,
}: {
  state: PosLoad<unknown>;
  onRetry?: () => void;
}) {
  if (state.status === 'ready') return null;

  if (state.status === 'loading') {
    return (
      <p className="pos-body-s w-full py-[8px] text-center text-[var(--pos-text-muted)]">
        Wird geladen …
      </p>
    );
  }

  if (state.status === 'unauthorized') {
    return (
      <div className="flex w-full flex-col gap-[8px] rounded-[12px] bg-[var(--pos-tint-cancelled)] px-[12px] py-[10px]">
        <span className="pos-title-s text-[var(--pos-status-cancelled)]">Nicht angemeldet</span>
        <span className="pos-body-s text-[var(--pos-text-secondary)]">
          Das Gerät muss einmalig mit einem Mitarbeiter-Konto angemeldet werden.
        </span>
        {/* Обычная ссылка, а не router.push: после входа NextAuth возвращает
            на callbackUrl, и терминал открывается сразу на нужном экране. */}
        <a
          href="/admin/login?callbackUrl=/pos/orders"
          className="pos-label-m flex h-[44px] w-full items-center justify-center rounded-[12px] bg-[var(--pos-accent)] text-[var(--pos-text-on-accent)]"
        >
          Anmelden
        </a>
      </div>
    );
  }

  return (
    <div className="flex w-full items-center gap-[8px] rounded-[12px] bg-[var(--pos-tint-preparing)] px-[12px] py-[10px]">
      <span className="pos-body-s min-w-px flex-1 text-[var(--pos-status-preparing)]">
        Keine Verbindung: {state.message}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="pos-label-s shrink-0 rounded-[10px] border border-[var(--pos-status-preparing)] px-[10px] py-[6px] text-[var(--pos-status-preparing)]"
        >
          Erneut
        </button>
      )}
    </div>
  );
}
