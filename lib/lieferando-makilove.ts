/**
 * Очередь команд «выключить/включить MakiLove на Lieferando».
 *
 * Сам Partner Hub с Vercel недостижим (нужен настоящий браузер с залогиненным
 * профилем), поэтому схема как у печати чеков: сервер только ХРАНИТ команду,
 * а выполняет её агент на кассовом ПК (scripts/lieferando/agent.mjs), который
 * поллит /api/lieferando/agent и кликает переключатели в Hub через Playwright.
 *
 * Всё состояние — в одном ключе настроек (НЕ в storeSettings, чтобы не
 * пересекаться read-modify-write'ом с блокировками цехов):
 *   command    — команда ждёт агента (новая кнопка перезаписывает старую);
 *   running    — агент забрал команду и выполняет (protухшая через
 *                RUNNING_TTL_MS отдаётся агенту заново);
 *   lastResult — итог последнего выполнения (для панели бота);
 *   itemsState — последнее известное состояние позиций на Lieferando;
 *   agentSeenAt — heartbeat: когда агент последний раз поллил.
 *
 * ⚠️ Особенность Hub: выключение позиции действует «до конца дня» — наутро
 * Lieferando сам возвращает её в продажу. Панель бота об этом предупреждает.
 */
import { randomUUID } from 'crypto';
import { getSetting, setSetting } from './settings';

export const LIEFERANDO_MAKILOVE_KEY = 'lieferandoMakilove';

/** Забранная, но не завершённая команда старше этого — считаем агента умершим. */
export const RUNNING_TTL_MS = 5 * 60_000;
/** Агент молчит дольше этого — панель показывает «агент не на связи». */
export const AGENT_OFFLINE_MS = 2 * 60_000;

export type LieferandoAction = 'off' | 'on';

export interface LieferandoCommand {
  id: string;
  action: LieferandoAction;
  requestedAt: string;
}

export interface LieferandoRunning extends LieferandoCommand {
  startedAt: string;
  agentId: string;
}

export interface LieferandoResult {
  id: string;
  action: LieferandoAction;
  ok: boolean;
  /** сколько позиций реально переключили */
  count: number;
  /** сколько не удалось */
  failed: number;
  message: string;
  finishedAt: string;
}

export interface LieferandoState {
  command: LieferandoCommand | null;
  running: LieferandoRunning | null;
  lastResult: LieferandoResult | null;
  itemsState: 'on' | 'off' | 'unknown';
  agentSeenAt: string | null;
}

export const EMPTY_LIEFERANDO_STATE: LieferandoState = {
  command: null,
  running: null,
  lastResult: null,
  itemsState: 'unknown',
  agentSeenAt: null,
};

const isAction = (v: unknown): v is LieferandoAction => v === 'off' || v === 'on';

/** Мусор из БД не должен ронять ни бота, ни агента. */
export function readLieferandoState(raw: unknown): LieferandoState {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const cmd =
    s.command && typeof s.command.id === 'string' && isAction(s.command.action)
      ? (s.command as LieferandoCommand)
      : null;
  const run =
    s.running && typeof s.running.id === 'string' && isAction(s.running.action)
      ? (s.running as LieferandoRunning)
      : null;
  const res =
    s.lastResult && typeof s.lastResult.id === 'string' && isAction(s.lastResult.action)
      ? (s.lastResult as LieferandoResult)
      : null;
  return {
    command: cmd,
    running: run,
    lastResult: res,
    itemsState: s.itemsState === 'on' || s.itemsState === 'off' ? s.itemsState : 'unknown',
    agentSeenAt: typeof s.agentSeenAt === 'string' ? s.agentSeenAt : null,
  };
}

export async function getLieferandoState(): Promise<LieferandoState> {
  return readLieferandoState(await getSetting(LIEFERANDO_MAKILOVE_KEY, null));
}

async function writeState(state: LieferandoState): Promise<LieferandoState> {
  await setSetting(LIEFERANDO_MAKILOVE_KEY, state);
  return state;
}

/** Кнопка бота: ставит команду в очередь (повторное нажатие перезаписывает). */
export async function requestLieferandoToggle(
  action: LieferandoAction,
  now: Date = new Date()
): Promise<LieferandoState> {
  const state = await getLieferandoState();
  return writeState({
    ...state,
    command: { id: randomUUID(), action, requestedAt: now.toISOString() },
  });
}

/**
 * Поллинг агента: отдаёт команду и помечает её выполняемой. Всегда обновляет
 * heartbeat. Если предыдущий запуск завис (агент перезапустился) — отдаёт
 * протухшую running-команду заново.
 */
export async function claimLieferandoCommand(
  agentId: string,
  now: Date = new Date()
): Promise<{ command: LieferandoCommand | null; state: LieferandoState }> {
  const state = await getLieferandoState();
  const nowIso = now.toISOString();

  let claimed: LieferandoCommand | null = null;
  let next: LieferandoState = { ...state, agentSeenAt: nowIso };

  if (state.command) {
    claimed = state.command;
  } else if (
    state.running &&
    now.getTime() - new Date(state.running.startedAt).getTime() > RUNNING_TTL_MS
  ) {
    claimed = { id: state.running.id, action: state.running.action, requestedAt: state.running.requestedAt };
  }

  if (claimed) {
    next = {
      ...next,
      command: null,
      running: { ...claimed, startedAt: nowIso, agentId },
    };
  }

  await writeState(next);
  return { command: claimed, state: next };
}

/** Отчёт агента о выполнении. */
export async function reportLieferandoResult(
  result: Omit<LieferandoResult, 'finishedAt'>,
  now: Date = new Date()
): Promise<LieferandoState> {
  const state = await getLieferandoState();
  const full: LieferandoResult = { ...result, finishedAt: now.toISOString() };
  return writeState({
    ...state,
    // чистим running только если отчёт о нём (не о протухшем предке)
    running: state.running && state.running.id === result.id ? null : state.running,
    lastResult: full,
    itemsState: result.ok ? (result.action === 'off' ? 'off' : 'on') : state.itemsState,
    agentSeenAt: now.toISOString(),
  });
}
