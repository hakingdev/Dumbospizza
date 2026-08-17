/**
 * Единая очередь исходящих действий в группу заказов.
 *
 * Зачем: Telegram лимитирует ~20 сообщений в минуту на группу, а переезд
 * карточки — это 2–3 действия (send + delete, иногда reopen темы). Пачка
 * переездов без очереди мгновенно ловит 429 и рассыпается.
 *
 * Гарантии:
 *  - не чаще одного действия в MIN_INTERVAL_MS (по умолчанию 1 с);
 *  - 429 → ждём ровно retry_after из ответа Telegram и повторяем;
 *  - сеть/5xx → экспоненциальный backoff с потолком;
 *  - ПРИОРИТЕТЫ: новый заказ обгоняет переезды. Переезд опаздывающей карточки
 *    не имеет права задержать доставку нового заказа на кухню.
 *
 * ВАЖНО (Vercel serverless): очередь живёт в памяти инстанса функции, поэтому
 * ограничение частоты — «на инстанс», а не глобальное. Этого достаточно: пики
 * идут внутри одного вебхук-вызова (переезд = 2–3 действия подряд), а 429
 * между инстансами всё равно ловится и переигрывается retry_after'ом.
 * Очередь НЕ переживает завершение функции — все задачи обязаны быть
 * дожданы (await) вызывающим кодом до ответа на webhook.
 */

/** Чем меньше число — тем раньше выполняется. */
export const OUTBOX_PRIORITY = {
  /** Новый заказ на кухню — всегда первым. */
  newOrder: 0,
  /** Правка карточки на месте (ETA, клавиатура). */
  edit: 5,
  /** Переезд карточки между темами. */
  move: 10,
  /** Уборка (удаление старой карточки) — последней. */
  cleanup: 20,
} as const;

export interface RetryHint {
  /** 429: сколько ждать по требованию Telegram, сек. */
  retryAfterSeconds?: number;
  /** Сеть/5xx: повторять с backoff. */
  retryable?: boolean;
}

export interface OutboxOptions {
  minIntervalMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (...args: any[]) => void;
}

interface QueueItem<T = unknown> {
  task: () => Promise<T>;
  priority: number;
  seq: number;
  label: string;
  maxAttempts: number;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** Достаём подсказку о повторе из ошибки (TelegramApiError или что угодно с полями). */
function retryHint(error: unknown): RetryHint {
  const e = error as RetryHint | null;
  if (!e || typeof e !== 'object') return {};
  return { retryAfterSeconds: e.retryAfterSeconds, retryable: e.retryable };
}

export class TelegramOutbox {
  private readonly queue: QueueItem<any>[] = [];
  private draining = false;
  private lastActionAt = 0;
  private seq = 0;

  private readonly minIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (...args: any[]) => void;

  constructor(opts: OutboxOptions = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 1000;
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.baseBackoffMs = opts.baseBackoffMs ?? 1000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? defaultSleep;
    this.log = opts.log ?? ((...a: any[]) => console.log('[telegram-outbox]', ...a));
  }

  /** Сколько задач ждёт очереди (для тестов и диагностики). */
  get pending(): number {
    return this.queue.length;
  }

  enqueue<T>(
    task: () => Promise<T>,
    opts: { priority?: number; label?: string; maxAttempts?: number } = {}
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task,
        priority: opts.priority ?? OUTBOX_PRIORITY.move,
        seq: this.seq++,
        label: opts.label || 'task',
        maxAttempts: opts.maxAttempts ?? this.maxAttempts,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        // Приоритет, при равенстве — FIFO. Пересортировка на каждом шаге:
        // пока выполнялось предыдущее действие, мог прийти новый заказ.
        this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
        const item = this.queue.shift()!;
        await this.runItem(item);
      }
    } finally {
      this.draining = false;
      // Пока мы выходили, кто-то мог встать в очередь — не оставляем её висеть.
      if (this.queue.length) void this.drain();
    }
  }

  private async runItem(item: QueueItem): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const wait = this.minIntervalMs - (this.now() - this.lastActionAt);
      if (wait > 0) await this.sleep(wait);
      this.lastActionAt = this.now();

      try {
        item.resolve(await item.task());
        return;
      } catch (error) {
        const hint = retryHint(error);
        const canRetry = hint.retryAfterSeconds != null || hint.retryable === true;
        if (!canRetry || attempt >= item.maxAttempts) {
          item.reject(error);
          return;
        }
        const delay =
          hint.retryAfterSeconds != null
            ? hint.retryAfterSeconds * 1000
            : Math.min(this.baseBackoffMs * 2 ** (attempt - 1), this.maxBackoffMs);
        this.log(
          `${item.label}: попытка ${attempt}/${item.maxAttempts} не удалась, повтор через ${delay} мс`,
          (error as Error)?.message
        );
        await this.sleep(delay);
      }
    }
  }
}

let sharedOutbox: TelegramOutbox | null = null;

/** Общая очередь бота заказов (одна на инстанс функции). */
export function getTelegramOutbox(): TelegramOutbox {
  if (!sharedOutbox) {
    const interval = parseInt(process.env.TELEGRAM_OUTBOX_INTERVAL_MS || '', 10);
    sharedOutbox = new TelegramOutbox({
      minIntervalMs: Number.isFinite(interval) && interval >= 0 ? interval : 1000,
    });
  }
  return sharedOutbox;
}

/** Подмена очереди в тестах (мгновенный sleep, детерминированные часы). */
export function setTelegramOutboxForTests(outbox: TelegramOutbox | null): void {
  sharedOutbox = outbox;
}
