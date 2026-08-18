/**
 * Авторизация POS-прибора.
 *
 * Заход 1: один прибор, общий секрет `PRINT_AGENT_SECRET` — тот же, которым уже
 * живёт LAN-агент. Отдельной таблицы устройств пока нет, заводить её ради одного
 * прибора рано.
 *
 * Заход 2 (когда приборов станет больше): свой токен на прибор из `pos_devices`,
 * отзываемый из админки. Заголовок и форма проверки не изменятся — поменяется
 * только источник истины внутри этой функции, вызовы в маршрутах останутся теми же.
 */
import type { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../auth';

export const POS_KEY_HEADER = 'X-Pos-Key';
export const POS_DEVICE_HEADER = 'X-Pos-Device';

export interface PosDeviceIdentity {
  /** Идентификатор прибора из заголовка. Пока только для логов и мониторинга. */
  deviceId: string;
}

export type PosAuthResult =
  | { ok: true; device: PosDeviceIdentity }
  | { ok: false; reason: 'not-configured' | 'bad-key' };

/**
 * Ключ прибора из заголовка.
 *
 * X-Print-Agent-Key принимается тоже: LAN-агент шлёт именно его, и когда он
 * переедет на этот же API, менять его заголовок не придётся.
 */
export function readPosKey(request: NextRequest): string | null {
  return request.headers.get(POS_KEY_HEADER) ?? request.headers.get('X-Print-Agent-Key');
}

export function authorizePosDevice(request: NextRequest): PosAuthResult {
  const secret = process.env.PRINT_AGENT_SECRET?.trim();
  // Секрет не задан — считаем, что POS-канал выключен. Пускать всех подряд
  // при незаданной переменной нельзя: на проде это открыло бы очередь заказов.
  if (!secret) return { ok: false, reason: 'not-configured' };

  const key = readPosKey(request);
  if (!key || key !== secret) return { ok: false, reason: 'bad-key' };

  const deviceId = (request.headers.get(POS_DEVICE_HEADER) || 'unknown').slice(0, 64);
  return { ok: true, device: { deviceId } };
}

/**
 * Кто обратился к POS-API.
 *
 * Их двое, и оба законные:
 *   - `device` — служба печати в Android-приложении, ключом в заголовке;
 *   - `staff`  — терминал, открытый в WebView, обычной сессией персонала.
 *
 * Терминал ключом не пользуется НАМЕРЕННО: страница живёт в браузере, и любой
 * секрет в её коде утёк бы вместе с исходником. Вход один раз на приборе,
 * дальше кука живёт 30 дней — это ровно то же, чем защищена админка.
 */
export type PosCaller =
  | { kind: 'device'; deviceId: string }
  | { kind: 'staff'; userId: string; name: string };

export type PosRequestAuth =
  | { ok: true; caller: PosCaller }
  | { ok: false; reason: 'not-configured' | 'bad-key' | 'no-session' };

/**
 * Пускает прибор по ключу ИЛИ персонал по сессии.
 *
 * Порядок важен: ключ проверяется первым и без обращения к базе, поэтому опрос
 * очереди печати (несколько раз в минуту, круглые сутки) не поднимает сессию.
 */
export async function authorizePos(request: NextRequest): Promise<PosRequestAuth> {
  const device = authorizePosDevice(request);
  if (device.ok) return { ok: true, caller: { kind: 'device', deviceId: device.device.deviceId } };

  const session = await getServerSession(authOptions);
  if (session && isStaff(session)) {
    const user = session.user as { id?: string; name?: string | null; email?: string | null };
    return {
      ok: true,
      caller: {
        kind: 'staff',
        userId: user?.id || '',
        name: user?.name || user?.email || 'staff',
      },
    };
  }

  // Ключ был, но не подошёл — это ошибка настройки прибора, и лечится она не
  // тем же, чем «страницу открыли без входа». Различаем по наличию заголовка.
  return { ok: false, reason: readPosKey(request) ? 'bad-key' : 'no-session' };
}

/** Подпись действия для истории заказа: кто нажал кнопку. */
export function posActorLabel(caller: PosCaller): string {
  return caller.kind === 'staff' ? caller.name : `pos:${caller.deviceId}`;
}
