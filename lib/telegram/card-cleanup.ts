/**
 * Уборка карточек прошедших смен из группы заказов.
 *
 * Карточка живёт в теме своего статуса и никогда не удалялась сама: заказ
 * доезжал до «✅ Доставлен» и оставался там навсегда. Через неделю в темах
 * лежит неделя работы, и вчерашний заказ ничем не отличается от сегодняшнего.
 *
 * Граница — РАБОЧИЙ день (lib/orders/working-day.ts), тот же, по которому живёт
 * лента прибора: сутки с 01:00 по Берлину. Календарная полночь не подходит —
 * смена заканчивается позже неё, и заказ, принятый в 23:50, принадлежит
 * уходящему дню. Одна арифметика на оба потребителя: две копии разошлись бы на
 * переводе часов, и разошлись бы молча.
 *
 * Куда девается старое — решает тема «🗂 Архив» (ForumConfig.archiveTopicId):
 *   - тема задана: карточка ПЕРЕЕЗЖАЕТ в архив — copyMessage в тему архива
 *     (клавиатуру copyMessage не переносит, и это правильно: архив — записи,
 *     а не рабочие кнопки), затем удаление оригинала. Копия строго ПЕРВАЯ:
 *     пока архивная копия не подтверждена, оригинал трогать нельзя;
 *   - темы нет: старое просто удаляется (историческое поведение) — история
 *     заказов и так живёт в админке.
 *
 * Убираем ВСЁ старое, включая незакрытые карточки: группа — это рабочий стол
 * смены. Незакрытые считаем отдельно и пишем в лог: заказ, забытый в
 * «Готовится», — повод разобраться, а не тихо стереть.
 *
 * Строку в order_cards удаляем ТОЛЬКО когда сообщения в Telegram точно нет.
 * Иначе карточка осталась бы висеть с кнопками, за которыми уже нет записи —
 * клик по такой кнопке не находит заказ и выглядит как поломка бота. Не
 * удалилось — оставляем строку, следующий заход попробует снова (в режиме
 * архива это может дать вторую копию в архиве — терпимо и видно в логе).
 *
 * ВАЖНО (ограничение Telegram): бот не может удалять сообщения старше 48 часов.
 * Если уборка не отработала двое суток, карточки останутся в группе навсегда —
 * убрать их сможет только человек руками. Поэтому пропуск запуска логируется
 * отдельным предупреждением, а не растворяется в счётчиках.
 */
import { createCardApi, type CardTelegramApi } from './card-mover';
import { getOrderCardStore, type OrderCardRow, type OrderCardStore } from './card-store';
import { getForumConfig, isTerminalCardStatus, type ForumConfig } from './forum';
import { isTopicClosedError } from './bot-api';
import { workingDayStart } from '../orders/working-day';

/** После этого возраста Telegram уже отказывается удалять сообщение. */
export const TELEGRAM_DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Сколько карточек берём за один заход: защита от разросшейся таблицы. */
const DEFAULT_LIMIT = 300;

/**
 * Сколько времени себе отводим. Очередь исходящих держит ~1 действие в
 * секунду (лимит группы у Telegram), поэтому упереться в потолок функции
 * реально — лучше остановиться самим и честно сказать, сколько осталось.
 * В режиме архива карточка стоит ДВА действия (копия + удаление).
 */
const DEFAULT_BUDGET_MS = 240_000;

export interface CleanupDeps {
  /** undefined — прочитать конфиг; null — форум выключен (для тестов). */
  config?: ForumConfig | null;
  store?: OrderCardStore;
  api?: CardTelegramApi;
  now?: () => Date;
  log?: (...args: any[]) => void;
  limit?: number;
  budgetMs?: number;
}

export interface CleanupResult {
  /** false — режим форума выключен, убирать нечего и нечем. */
  enabled: boolean;
  /** Граница смены: всё, что старше, считается прошедшей работой. */
  cutoff: string | null;
  /** Сколько карточек прошлых смен нашлось. */
  scanned: number;
  /** Скопировано в тему «Архив» (0, если тема архива не настроена). */
  archived: number;
  /** Сообщений удалено нами. */
  deleted: number;
  /** Сообщений уже не было (удалили руками или Telegram отказал по возрасту). */
  missing: number;
  /** Не удалось убрать — строка осталась, попробуем в следующий заход. */
  failed: number;
  /** Сколько из убранных были НЕ закрыты (застряли в работе). */
  unfinished: number;
  /** Не успели за отведённое время — доберём в следующий заход. */
  remaining: number;
  /** Выборка упёрлась в лимит: старого больше, чем мы взяли за раз. */
  truncated: boolean;
}

/** Карточки старше 48 ч Telegram удалить уже не даст — про это надо кричать. */
function tooOldToDelete(card: OrderCardRow, now: Date): boolean {
  const createdAt = card.createdAt ? new Date(card.createdAt).getTime() : NaN;
  if (Number.isNaN(createdAt)) return false;
  return now.getTime() - createdAt > TELEGRAM_DELETE_WINDOW_MS;
}

/** Копия в архив с автолечением закрытой темы (как у отправки карточек). */
async function copyWithTopicRecovery(
  api: CardTelegramApi,
  input: { messageId: number; threadId: number },
  log: (...args: any[]) => void
): Promise<number | 'missing'> {
  try {
    return await api.copyTo(input);
  } catch (e) {
    if (!isTopicClosedError(e)) throw e;
    log('тема архива закрыта — открываю и повторяю копию', { threadId: input.threadId });
    await api.reopenTopic(input.threadId);
    return api.copyTo(input);
  }
}

/**
 * Убрать из группы всё, что относится к прошедшим сменам.
 * Идемпотентно: повторный запуск не находит уже убранного.
 */
export async function cleanupStaleOrderCards(deps: CleanupDeps = {}): Promise<CleanupResult> {
  const log = deps.log ?? ((...a: any[]) => console.log('[telegram-cleanup]', ...a));
  const now = deps.now ?? (() => new Date());

  const config = deps.config !== undefined ? deps.config : await getForumConfig();
  if (!config) {
    return {
      enabled: false,
      cutoff: null,
      scanned: 0,
      archived: 0,
      deleted: 0,
      missing: 0,
      failed: 0,
      unfinished: 0,
      remaining: 0,
      truncated: false,
    };
  }

  const store = deps.store ?? getOrderCardStore();
  const api = deps.api ?? createCardApi(config);
  const limit = deps.limit ?? DEFAULT_LIMIT;
  const budgetMs = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const archiveTopicId = config.archiveTopicId ?? null;

  const startedAt = now();
  const cutoff = workingDayStart(startedAt);
  const cards = await store.listOlderThan(cutoff, limit);

  const result: CleanupResult = {
    enabled: true,
    cutoff: cutoff.toISOString(),
    scanned: cards.length,
    archived: 0,
    deleted: 0,
    missing: 0,
    failed: 0,
    unfinished: 0,
    remaining: 0,
    truncated: cards.length === limit,
  };

  const overdue = cards.filter((card) => tooOldToDelete(card, startedAt)).length;
  if (overdue) {
    log(
      `${overdue} карточек старше 48 ч — Telegram их удалить уже не даст, убирать придётся руками`
    );
  }

  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];

    // Дедлайн проверяем ПЕРЕД действием, а не после: смысл в том, чтобы
    // успеть ответить, а не в том, чтобы узнать, что не успели.
    if (now().getTime() - startedAt.getTime() >= budgetMs) {
      result.remaining = cards.length - i;
      log(`остановился по времени: осталось ${result.remaining} карточек до следующего захода`);
      break;
    }

    // Сначала копия в архив (если он настроен). Оригинал не трогаем, пока
    // копия не подтверждена: провал копии = карточка остаётся на месте.
    let originalGone = false;
    if (archiveTopicId != null) {
      let copied: number | 'missing';
      try {
        copied = await copyWithTopicRecovery(
          api,
          { messageId: card.messageId, threadId: archiveTopicId },
          log
        );
      } catch (e) {
        result.failed += 1;
        log(
          'копия в архив не удалась — карточка остаётся до следующего захода',
          { order: card.orderNumber, messageId: card.messageId },
          (e as Error)?.message
        );
        continue;
      }
      if (copied === 'missing') originalGone = true;
      else result.archived += 1;
    }

    let outcome: 'deleted' | 'missing';
    if (originalGone) {
      outcome = 'missing';
    } else {
      try {
        outcome = await api.remove(card.messageId);
      } catch (e) {
        result.failed += 1;
        log(
          archiveTopicId != null
            ? 'копия в архиве есть, но оригинал не удалился — повтор даст дубль в архиве'
            : 'не удалось удалить карточку — оставляю строку до следующего захода',
          { order: card.orderNumber, messageId: card.messageId },
          (e as Error)?.message
        );
        continue;
      }
    }

    if (outcome === 'missing') result.missing += 1;
    else result.deleted += 1;
    if (!isTerminalCardStatus(card.status)) result.unfinished += 1;

    try {
      await store.forget(card.orderId);
    } catch (e) {
      // Сообщения уже нет, а строка осталась: следующий заход снова попробует
      // удалить несуществующее сообщение (это «missing», не ошибка) и удалит
      // строку. Хуже, чем ничего, не станет.
      log('карточка убрана, но строка не удалилась', { order: card.orderNumber }, (e as Error)?.message);
    }
  }

  if (result.unfinished) {
    log(`${result.unfinished} карточек прошлой смены были НЕ закрыты — проверьте заказы в админке`);
  }

  return result;
}
