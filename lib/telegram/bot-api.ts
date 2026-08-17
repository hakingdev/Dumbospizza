/**
 * Прямой доступ к Bot API для карточек в форуме — как у stop-бота и бота-плана
 * (lib/telegram-control.ts, lib/telegram-plan.ts), без node-telegram-bot-api.
 *
 * Своя обёртка нужна ради двух вещей, которых нет в библиотечной:
 *  - message_thread_id (тема форума) во всех вызовах;
 *  - РАЗБОР ошибки: 429 с retry_after, «message to delete not found», закрытая
 *    тема. Переезд карточки принимает решения именно по этим кодам, а не по
 *    строке исключения.
 */

export interface TelegramApiErrorInit {
  method: string;
  code?: number;
  description?: string;
  retryAfterSeconds?: number;
  retryable?: boolean;
}

export class TelegramApiError extends Error {
  readonly method: string;
  readonly code?: number;
  readonly description?: string;
  /** 429: пауза, которую требует Telegram (уважает очередь). */
  readonly retryAfterSeconds?: number;
  /** Сеть/5xx — имеет смысл повторить с backoff. */
  readonly retryable: boolean;

  constructor(init: TelegramApiErrorInit) {
    super(`${init.method}: ${init.description || `HTTP ${init.code ?? '???'}`}`);
    this.name = 'TelegramApiError';
    this.method = init.method;
    this.code = init.code;
    this.description = init.description;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.retryable = init.retryable ?? false;
  }
}

/**
 * Старой карточки уже нет: удалена вручную, «протухла» (Telegram не даёт
 * удалять сообщения старше 48 часов) или её удалил параллельный переезд.
 * Для нас это успех — цель «старого сообщения нет» достигнута.
 */
export function isDeleteMissingError(error: unknown): boolean {
  const d = (error as TelegramApiError)?.description?.toLowerCase() || '';
  return (
    d.includes('message to delete not found') ||
    d.includes("message can't be deleted") ||
    d.includes('message identifier is not specified') ||
    d.includes('message_id_invalid')
  );
}

/** Тема закрыта — надо открыть (reopenForumTopic) и повторить отправку. */
export function isTopicClosedError(error: unknown): boolean {
  const d = (error as TelegramApiError)?.description?.toLowerCase() || '';
  return d.includes('topic_closed') || d.includes('topic is closed');
}

/** Текст не изменился — правка карточки не нужна, это не ошибка. */
export function isNotModifiedError(error: unknown): boolean {
  const d = (error as TelegramApiError)?.description?.toLowerCase() || '';
  return d.includes('message is not modified');
}

/** Сообщение, которое мы правим, уже не существует. */
export function isMessageGoneError(error: unknown): boolean {
  const d = (error as TelegramApiError)?.description?.toLowerCase() || '';
  return d.includes('message to edit not found') || d.includes('message_id_invalid');
}

export type BotApiFetch = typeof fetch;

/**
 * Один вызов Bot API. Бросает TelegramApiError с уже разобранной причиной —
 * решение о повторе принимает очередь (lib/telegram/outbox.ts).
 */
export async function callBotApi<T = any>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  fetchImpl: BotApiFetch = fetch
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // Сеть не ответила — состояние неизвестно, но повтор безопаснее молчания.
    throw new TelegramApiError({
      method,
      description: `network error: ${(e as Error)?.message || e}`,
      retryable: true,
    });
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* Telegram всегда отвечает JSON'ом; пустое тело разберём ниже по HTTP-коду */
  }

  if (json?.ok) return json.result as T;

  const code: number = json?.error_code ?? res.status;
  const description: string = json?.description || `HTTP ${res.status}`;
  const retryAfter = json?.parameters?.retry_after;

  throw new TelegramApiError({
    method,
    code,
    description,
    retryAfterSeconds: typeof retryAfter === 'number' ? retryAfter : undefined,
    retryable: code === 429 || code >= 500,
  });
}
