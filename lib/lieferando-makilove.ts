/**
 * Очередь команд агенту Lieferando (Partner Hub) от стоп-бота.
 *
 * Сам Partner Hub с Vercel недостижим (нужен настоящий браузер с залогиненным
 * профилем), поэтому схема как у печати чеков: сервер только ХРАНИТ команды,
 * а выполняет их агент (scripts/lieferando/agent.mjs — на VDS или кассовом ПК),
 * который поллит /api/lieferando/agent и кликает переключатели в Hub через
 * Playwright.
 *
 * Команда = действие (off/on) + цель (LieferandoTarget):
 *   makilove — все позиции MakiLove (исторически единственная команда);
 *   size     — один размер у всех пицц/позиций вне MakiLove («30 cm», «ca. 27x37»);
 *   item     — конкретные позиции по именам сайта (агент матчит Hub-строки
 *              нормализованно: без «Pizza», «(rund)», регистра — выключает
 *              и Detroit-версию, и «(rund)»);
 *   catalog  — снимок всего каталога Hub (ничего не переключает); агент шлёт
 *              его на /api/lieferando/agent/catalog, сервер сверяет с сайтом
 *              (lib/lieferando/catalog). action у такой команды формальный ('on').
 *
 * Всё состояние — в одном ключе настроек (НЕ в storeSettings, чтобы не
 * пересекаться read-modify-write'ом с блокировками цехов):
 *   commands   — очередь команд агенту (FIFO). Повторное нажатие НЕ затирает
 *                чужие команды: заменяется только команда с той же целью
 *                (двойной тап = одна команда; «выключить, нет, включить» =
 *                последнее слово за пользователем);
 *   command    — ВЫЧИСЛЯЕМОЕ поле: первая ожидающая команда MakiLove — для
 *                панели «Lieferando MakiLove» (в БД не пишется). Старый формат
 *                состояния (одно поле command) читается совместимо;
 *   running    — агент забрал команду и выполняет (протухшая через
 *                RUNNING_TTL_MS отдаётся агенту заново);
 *   lastResult — итог последнего выполнения (для панели бота);
 *   itemsState — последнее известное состояние позиций MakiLove на Lieferando
 *                (меняют только команды makilove);
 *   agentSeenAt — heartbeat: когда агент последний раз поллил.
 *
 * ⚠️ Особенность Hub: выключение действует «до конца дня» — наутро
 * Lieferando сам возвращает позиции/размеры в продажу. Бессрочный стоп-лист
 * бота (lib/menu-stop) поэтому ПЕРЕВЫКЛЮЧАЕТСЯ утренним кроном: такие команды
 * помечены origin='reapply' и при успехе в группу не репортятся (сводку
 * присылает сам крон), origin='indefinite' — выключение кнопкой в режиме
 * «бессрочно» (отчёт говорит, что утром бот перевыключит сам).
 */
import { randomUUID } from 'crypto';
import { getSetting, setSetting } from './settings';

export const LIEFERANDO_MAKILOVE_KEY = 'lieferandoMakilove';

/** Забранная, но не завершённая команда старше этого — считаем агента умершим. */
export const RUNNING_TTL_MS = 5 * 60_000;
/** Агент молчит дольше этого — панель показывает «агент не на связи». */
export const AGENT_OFFLINE_MS = 2 * 60_000;
/** Страховка от мусора: целей в меню куда меньше, длиннее очередь не бывает. */
export const MAX_QUEUE = 50;

export type LieferandoAction = 'off' | 'on';

export type LieferandoTarget =
  | { kind: 'makilove' }
  | { kind: 'size'; label: string }
  | { kind: 'item'; names: string[] }
  | { kind: 'catalog' };

export const MAKILOVE_TARGET: LieferandoTarget = { kind: 'makilove' };
export const CATALOG_TARGET: LieferandoTarget = { kind: 'catalog' };

/**
 * Откуда команда: кнопка бота (по умолчанию, в БД не пишется), кнопка в режиме
 * «бессрочно» или утреннее перевыключение бессрочного стоп-листа кроном.
 */
export type LieferandoCommandOrigin = 'bot' | 'indefinite' | 'reapply';

const isOrigin = (v: unknown): v is LieferandoCommandOrigin =>
  v === 'bot' || v === 'indefinite' || v === 'reapply';

export interface LieferandoCommand {
  id: string;
  action: LieferandoAction;
  target: LieferandoTarget;
  requestedAt: string;
  /** отсутствует = 'bot' */
  origin?: LieferandoCommandOrigin;
}

export interface LieferandoRunning extends LieferandoCommand {
  startedAt: string;
  agentId: string;
}

export interface LieferandoResult {
  id: string;
  action: LieferandoAction;
  target: LieferandoTarget;
  ok: boolean;
  /** сколько позиций/вариантов реально переключили */
  count: number;
  /** сколько не удалось */
  failed: number;
  message: string;
  finishedAt: string;
  /** уже были в нужном состоянии (size/item) */
  already?: number;
  /** категории Hub, где нашлись цели (size/item) — для отчёта */
  categories?: string[];
  /** имена из target.names (или label размера), не найденные в Hub */
  notFound?: string[];
  /** откуда была команда (из running); отсутствует = кнопка бота */
  origin?: LieferandoCommandOrigin;
}

export interface LieferandoState {
  /** очередь команд агенту, FIFO */
  commands: LieferandoCommand[];
  /**
   * Первая ожидающая команда MakiLove — совместимость с панелью
   * «Lieferando MakiLove». Вычисляется из commands, в БД не пишется.
   */
  command: LieferandoCommand | null;
  running: LieferandoRunning | null;
  lastResult: LieferandoResult | null;
  itemsState: 'on' | 'off' | 'unknown';
  agentSeenAt: string | null;
  /** версия файлов агента (хэш манифеста самообновления) — видно в панели */
  agentVersion: string | null;
}

export const EMPTY_LIEFERANDO_STATE: LieferandoState = {
  commands: [],
  command: null,
  running: null,
  lastResult: null,
  itemsState: 'unknown',
  agentSeenAt: null,
  agentVersion: null,
};

const isAction = (v: unknown): v is LieferandoAction => v === 'off' || v === 'on';

const cleanNames = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .filter((n): n is string => typeof n === 'string')
        .map((n) => n.trim())
        .filter(Boolean)
    : [];

/** Цель из произвольного JSON (БД/тело запроса агента); мусор → null. */
export function readLieferandoTarget(raw: unknown): LieferandoTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (t.kind === 'makilove') return { kind: 'makilove' };
  if (t.kind === 'catalog') return { kind: 'catalog' };
  if (t.kind === 'size' && typeof t.label === 'string' && t.label.trim()) {
    return { kind: 'size', label: t.label.trim() };
  }
  if (t.kind === 'item') {
    const names = cleanNames(t.names);
    if (names.length) return { kind: 'item', names };
  }
  return null;
}

/**
 * Ключ цели для дедупликации очереди: «30 cm» и «30  CM» — один размер,
 * набор имён — без учёта порядка.
 */
export function lieferandoTargetKey(target: LieferandoTarget): string {
  const fold = (s: string) => s.toLowerCase().replace(/[×*]/g, 'x').replace(/\s+/g, ' ').trim();
  switch (target.kind) {
    case 'makilove':
      return 'makilove';
    case 'catalog':
      return 'catalog';
    case 'size':
      return `size:${fold(target.label)}`;
    case 'item':
      return `item:${Array.from(new Set(target.names.map(fold))).sort().join('|')}`;
  }
}

/** Больше имён в отчёте не перечисляем («включить всё в категории» шлёт одну команду на всю категорию). */
const MAX_LISTED_NAMES = 4;

/** Человекочитаемая цель для сообщений бота/отчётов. */
export function describeLieferandoTarget(target: LieferandoTarget): string {
  switch (target.kind) {
    case 'makilove':
      return 'MakiLove';
    case 'catalog':
      return 'снимок каталога';
    case 'size':
      return `размер «${target.label}»`;
    case 'item':
      if (target.names.length === 1) return `позиция «${target.names[0]}»`;
      if (target.names.length > MAX_LISTED_NAMES) return `позиции (${target.names.length} шт.)`;
      return `позиции: ${target.names.map((n) => `«${n}»`).join(', ')}`;
  }
}

/** Команда из JSON; без target — старый формат, значит MakiLove. */
function readCommand(raw: unknown): LieferandoCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== 'string' || !isAction(c.action)) return null;
  const target = c.target === undefined ? MAKILOVE_TARGET : readLieferandoTarget(c.target);
  if (!target) return null;
  const cmd: LieferandoCommand = {
    id: c.id,
    action: c.action,
    target,
    requestedAt: typeof c.requestedAt === 'string' ? c.requestedAt : '',
  };
  if (isOrigin(c.origin) && c.origin !== 'bot') cmd.origin = c.origin;
  return cmd;
}

function readRunning(raw: unknown): LieferandoRunning | null {
  const cmd = readCommand(raw);
  if (!cmd) return null;
  const r = raw as Record<string, unknown>;
  return {
    ...cmd,
    startedAt: typeof r.startedAt === 'string' ? r.startedAt : '',
    agentId: typeof r.agentId === 'string' ? r.agentId : '',
  };
}

function readResult(raw: unknown): LieferandoResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !isAction(r.action)) return null;
  const target = r.target === undefined ? MAKILOVE_TARGET : readLieferandoTarget(r.target);
  if (!target) return null;
  const result: LieferandoResult = {
    id: r.id,
    action: r.action,
    target,
    ok: Boolean(r.ok),
    count: Number(r.count) || 0,
    failed: Number(r.failed) || 0,
    message: typeof r.message === 'string' ? r.message : '',
    finishedAt: typeof r.finishedAt === 'string' ? r.finishedAt : '',
  };
  if (typeof r.already === 'number') result.already = r.already;
  if (Array.isArray(r.categories)) result.categories = cleanNames(r.categories);
  if (Array.isArray(r.notFound)) result.notFound = cleanNames(r.notFound);
  if (isOrigin(r.origin) && r.origin !== 'bot') result.origin = r.origin;
  return result;
}

/** Вычисляемое поле command — первая ожидающая команда MakiLove. */
function withDerived(state: Omit<LieferandoState, 'command'>): LieferandoState {
  return {
    ...state,
    command: state.commands.find((c) => c.target.kind === 'makilove') ?? null,
  };
}

/** Мусор из БД не должен ронять ни бота, ни агента. */
export function readLieferandoState(raw: unknown): LieferandoState {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const commands: LieferandoCommand[] = [];
  const push = (v: unknown) => {
    const cmd = readCommand(v);
    if (cmd && !commands.some((c) => c.id === cmd.id)) commands.push(cmd);
  };
  // старый формат — одно поле command (написано ещё прошлой версией → первым)
  push(s.command);
  if (Array.isArray(s.commands)) s.commands.forEach(push);

  return withDerived({
    commands: commands.slice(0, MAX_QUEUE),
    running: readRunning(s.running),
    lastResult: readResult(s.lastResult),
    itemsState: s.itemsState === 'on' || s.itemsState === 'off' ? s.itemsState : 'unknown',
    agentSeenAt: typeof s.agentSeenAt === 'string' ? s.agentSeenAt : null,
    agentVersion: typeof s.agentVersion === 'string' ? s.agentVersion : null,
  });
}

export async function getLieferandoState(): Promise<LieferandoState> {
  return readLieferandoState(await getSetting(LIEFERANDO_MAKILOVE_KEY, null));
}

async function writeState(state: Omit<LieferandoState, 'command'> & { command?: unknown }): Promise<LieferandoState> {
  // command — вычисляемое, в БД только очередь (иначе при чтении задвоится)
  const { command: _derived, ...persisted } = state;
  void _derived;
  await setSetting(LIEFERANDO_MAKILOVE_KEY, persisted);
  return withDerived(persisted);
}

export interface RequestOptions {
  /** откуда команда; 'bot' (по умолчанию) в БД не пишется */
  origin?: LieferandoCommandOrigin;
}

/**
 * Кнопка бота (или утренний крон): ставит команду в очередь. Команда с той же
 * целью (если ещё не забрана агентом) заменяется новой — чужие цели остаются
 * на месте.
 */
export async function requestLieferandoCommand(
  action: LieferandoAction,
  target: LieferandoTarget,
  now: Date = new Date(),
  options: RequestOptions = {}
): Promise<LieferandoState> {
  const state = await getLieferandoState();
  const key = lieferandoTargetKey(target);
  const kept = state.commands.filter((c) => lieferandoTargetKey(c.target) !== key);
  const command: LieferandoCommand = { id: randomUUID(), action, target, requestedAt: now.toISOString() };
  if (options.origin && options.origin !== 'bot') command.origin = options.origin;
  const commands = [...kept, command].slice(-MAX_QUEUE);
  return writeState({ ...state, commands });
}

/** Кнопка «Lieferando MakiLove»: та же очередь, цель — все позиции MakiLove. */
export async function requestLieferandoToggle(
  action: LieferandoAction,
  now: Date = new Date()
): Promise<LieferandoState> {
  return requestLieferandoCommand(action, MAKILOVE_TARGET, now);
}

/** Кнопка «Сверить с Lieferando» (или ручной запуск): снимок каталога агентом. */
export async function requestLieferandoCatalog(
  now: Date = new Date(),
  options: RequestOptions = {}
): Promise<LieferandoState> {
  return requestLieferandoCommand('on', CATALOG_TARGET, now, options);
}

export interface ClaimOptions {
  /**
   * Агент умеет цели size/item (заголовок X-Agent-Caps: targets). Старому
   * агенту (до самообновления) такие команды не отдаём — он выполнил бы их
   * как «MakiLove off/on». Они ждут в очереди обновлённого агента.
   */
  supportsTargets?: boolean;
  /** Агент умеет снимок каталога (X-Agent-Caps: catalog) — иначе команда ждёт в очереди. */
  supportsCatalog?: boolean;
}

/** Какому агенту можно отдать команду (по его X-Agent-Caps). */
export function commandEligible(target: LieferandoTarget, options: ClaimOptions): boolean {
  switch (target.kind) {
    case 'makilove':
      return true;
    case 'catalog':
      return Boolean(options.supportsCatalog);
    default:
      return Boolean(options.supportsTargets);
  }
}

/**
 * Поллинг агента: отдаёт первую подходящую команду очереди (FIFO) и помечает
 * её выполняемой. Всегда обновляет heartbeat. Если очередь пуста, а
 * предыдущий запуск завис (агент перезапустился) — отдаёт протухшую
 * running-команду заново.
 */
export async function claimLieferandoCommand(
  agentId: string,
  now: Date = new Date(),
  agentVersion?: string | null,
  options: ClaimOptions = {}
): Promise<{ command: LieferandoCommand | null; state: LieferandoState }> {
  const state = await getLieferandoState();
  const nowIso = now.toISOString();
  const eligible = (c: LieferandoCommand) => commandEligible(c.target, options);

  let claimed: LieferandoCommand | null = null;
  let next: Omit<LieferandoState, 'command'> = {
    ...state,
    agentSeenAt: nowIso,
    agentVersion: agentVersion || state.agentVersion,
  };

  const idx = state.commands.findIndex(eligible);
  if (idx >= 0) {
    claimed = state.commands[idx];
    next = { ...next, commands: state.commands.filter((_, i) => i !== idx) };
  } else if (
    state.running &&
    eligible(state.running) &&
    now.getTime() - new Date(state.running.startedAt).getTime() > RUNNING_TTL_MS
  ) {
    const { id, action, target, requestedAt, origin } = state.running;
    claimed = { id, action, target, requestedAt, ...(origin ? { origin } : {}) };
  }

  if (claimed) {
    next = { ...next, running: { ...claimed, startedAt: nowIso, agentId } };
  }

  const written = await writeState(next);
  return { command: claimed, state: written };
}

export type LieferandoReport = Omit<LieferandoResult, 'finishedAt' | 'target'> & {
  /** старый агент цель не присылает — берём из running по id, иначе MakiLove */
  target?: LieferandoTarget | null;
};

/** Отчёт агента о выполнении. */
export async function reportLieferandoResult(
  result: LieferandoReport,
  now: Date = new Date()
): Promise<LieferandoState> {
  const state = await getLieferandoState();
  const running = state.running && state.running.id === result.id ? state.running : null;
  const target = result.target ?? running?.target ?? MAKILOVE_TARGET;
  const full: LieferandoResult = { ...result, target, finishedAt: now.toISOString() };
  // Агент origin не знает — он приходит из забранной команды.
  if (running?.origin) full.origin = running.origin;
  const touchesMakilove = result.ok && target.kind === 'makilove';
  return writeState({
    ...state,
    // чистим running только если отчёт о нём (не о протухшем предке)
    running: state.running && state.running.id === result.id ? null : state.running,
    lastResult: full,
    itemsState: touchesMakilove ? (result.action === 'off' ? 'off' : 'on') : state.itemsState,
    agentSeenAt: now.toISOString(),
  });
}

const quote = (names: string[]) => names.map((n) => `«${n}»`).join(', ');

/** Сколько строк Hub команда нашла (переключила или уже были в нужном состоянии). */
const foundRows = (r: LieferandoResult) => r.count + (r.already ?? 0);

/**
 * Слать ли отчёт агента в группу. Утреннее перевыключение (origin='reapply')
 * при полном успехе молчит — сводку персонал уже получил от крона; шумим
 * только если что-то не выключилось или не нашлось.
 */
export function lieferandoReportWanted(r: LieferandoResult): boolean {
  // Снимок каталога: сводку (и сообщение о сбое) шлёт сам эндпоинт каталога.
  if (r.target.kind === 'catalog') return false;
  if (r.origin !== 'reapply') return true;
  return !r.ok || r.failed > 0 || (r.notFound?.length ?? 0) > 0 || foundRows(r) === 0;
}

/**
 * Текст отчёта в группу стоп-бота. Для MakiLove — прежние формулировки,
 * для размеров/позиций — что переключили, где и чего не нашли.
 */
export function formatLieferandoReport(r: LieferandoResult): string {
  const text = formatLieferandoReportBody(r);
  return r.origin === 'reapply'
    ? `🌅 Утреннее перевыключение бессрочного стоп-листа:\n${text}`
    : text;
}

/** «Утром Lieferando включит их сам» — кроме бессрочного стопа: его бот перевыключит. */
function morningNote(r: LieferandoResult): string {
  return r.origin === 'indefinite' || r.origin === 'reapply'
    ? 'ℹ️ Бессрочно: утром Lieferando включит их, а бот тут же выключит снова.'
    : 'ℹ️ Утром Lieferando включит их сам.';
}

function formatLieferandoReportBody(r: LieferandoResult): string {
  const off = r.action === 'off';
  const verb = off ? 'выключить' : 'включить';

  if (r.target.kind === 'makilove') {
    if (!r.ok) {
      return `🛵❌ Lieferando: команда «${verb}» НЕ выполнена.\n${r.message || 'Причина неизвестна.'}`;
    }
    // count 0 при ok = всё уже было в нужном состоянии — «скрыто 0 позиций» пугает.
    return off
      ? (r.count
          ? `🛵 Lieferando: MakiLove <b>ВЫКЛЮЧЕН</b> — скрыто позиций: ${r.count}.`
          : '🛵 Lieferando: MakiLove <b>ВЫКЛЮЧЕН</b> — все позиции уже были скрыты.') +
          (r.failed ? `\n⚠️ Не удалось: ${r.failed}.` : '') +
          '\nℹ️ Утром Lieferando включит их сам.'
      : (r.count
          ? `🛵 Lieferando: MakiLove <b>включён</b> — позиций: ${r.count}.`
          : '🛵 Lieferando: MakiLove <b>включён</b> — скрытых скриптом позиций не было.') +
          (r.failed ? `\n⚠️ Не удалось: ${r.failed}.` : '');
  }

  if (r.target.kind === 'catalog') {
    return r.ok
      ? `🛵📋 Lieferando: снимок каталога снят — позиций: ${r.count}.` +
          (r.failed ? `\n⚠️ Не открылись категории: ${r.failed}. ${r.message}` : '')
      : `🛵❌ Lieferando: снимок каталога НЕ снят.\n${r.message || 'Причина неизвестна.'}`;
  }

  const what = describeLieferandoTarget(r.target);
  if (!r.ok) {
    return `🛵❌ Lieferando: команда «${verb}» (${what}) НЕ выполнена.\n${r.message || 'Причина неизвестна.'}`;
  }

  const where = r.categories?.length ? ` (${r.categories.join(', ')})` : '';
  const notFound = r.notFound ?? [];
  const lines: string[] = [];

  if (r.target.kind === 'size') {
    if (!r.count && !r.already) {
      lines.push(`🛵⚠️ Lieferando: ${what} не найден ни в одной категории — ничего не переключено.`);
    } else if (r.count) {
      lines.push(
        `🛵 Lieferando: ${what} <b>${off ? 'ВЫКЛЮЧЕН' : 'включён'}</b> у ${r.count} позиций${where}.` +
          (r.already ? ` Ещё ${r.already} уже были ${off ? 'выключены' : 'включены'}.` : '')
      );
    } else {
      lines.push(
        `🛵 Lieferando: ${what} — все ${r.already} позиций уже были ${off ? 'выключены' : 'включены'}${where}.`
      );
    }
  } else {
    const found = foundRows(r);
    if (!found) {
      lines.push(`🛵⚠️ Lieferando: ${what} — на Lieferando не найдено, ничего не переключено.`);
    } else if (r.count) {
      lines.push(
        `🛵 Lieferando: ${what} <b>${off ? 'выключен' : 'включен'}${r.target.names.length === 1 ? 'а' : 'ы'}</b>${where}` +
          ` — строк: ${r.count}.` +
          (r.already ? ` Ещё ${r.already} уже были ${off ? 'выключены' : 'включены'}.` : '')
      );
    } else {
      lines.push(`🛵 Lieferando: ${what} — уже ${off ? 'выключен' : 'включен'}${r.already === 1 ? 'а' : 'ы'}${where}.`);
    }
    // Когда не нашли НИЧЕГО, первая строка уже сказала это — не дублируем.
    if (found && notFound.length) lines.push(`⚠️ Не найдено на Lieferando: ${quote(notFound)}.`);
  }

  if (r.failed) lines.push(`⚠️ Не удалось: ${r.failed}.${r.message ? ` ${r.message}` : ''}`);
  if (off && r.count) lines.push(morningNote(r));
  return lines.join('\n');
}
