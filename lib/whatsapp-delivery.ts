/**
 * Чистая логика дедупликации доставки WhatsApp-очереди (серверный обход скрипта
 * воркера). Вынесена из app/api/whatsapp/pending для модульного тестирования.
 *
 * Цель: одно и то же логическое сообщение (одинаковые orderId+text, либо
 * phone+text, если orderId нет) выдаётся воркеру не более одного раза за всё
 * время — даже если в очереди оказалось несколько дублей или воркер опрашивает
 * сайт повторно.
 */

export interface QueueCandidate {
  id: string;
  phone: string;
  text: string;
  orderId?: string | null;
}

/** Ключ логической идентичности сообщения. */
export function dedupKey(row: { orderId?: string | null; phone: string; text: string }): string {
  return row.orderId ? `o:${row.orderId} ${row.text}` : `p:${row.phone} ${row.text}`;
}

export interface DeliveryPlan {
  /** id строк, которые нужно атомарно захватить (pending → sending) и выдать. */
  toClaim: string[];
  /** id строк-дубликатов / уже занятых ключей — пометить 'skipped', не выдавать. */
  toSkip: string[];
}

/**
 * Разбить кандидатов на «выдать» и «пропустить».
 * @param candidates строки-кандидаты (eligible), отсортированные старые→новые.
 * @param occupiedKeys ключи сообщений, уже отправленных ('sent') или прямо сейчас
 *   отправляемых (свежий in-flight 'sending') — их выдавать повторно нельзя.
 */
export function planDelivery(
  candidates: QueueCandidate[],
  occupiedKeys: Set<string>
): DeliveryPlan {
  const seen = new Set<string>();
  const toClaim: string[] = [];
  const toSkip: string[] = [];

  for (const c of candidates) {
    const k = dedupKey(c);
    if (occupiedKeys.has(k) || seen.has(k)) {
      toSkip.push(c.id);
      continue;
    }
    seen.add(k);
    toClaim.push(c.id);
  }

  return { toClaim, toSkip };
}
