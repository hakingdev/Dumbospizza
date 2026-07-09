import { vi } from 'vitest';

/**
 * Мок PayPal REST API поверх глобального fetch (реальные запросы в тестах
 * запрещены). Токен-эндпоинт отвечает всегда; остальные маршруты задаются
 * обработчиками per-test. Все вызовы записываются для ассертов
 * (PayPal-Request-Id, тела запросов, количество вызовов).
 *
 * Все «секреты» здесь — очевидные заглушки (test-*), не реальные ключи.
 */

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  json: unknown;
}

export type RouteHandler = (
  call: RecordedCall
) => { status?: number; json?: unknown } | undefined;

export interface PayPalFetchMock {
  fetchMock: ReturnType<typeof vi.fn>;
  calls: RecordedCall[];
  /** Вызовы по подстроке URL (без токен-эндпоинта). */
  callsTo: (urlPart: string) => RecordedCall[];
  /** Задать обработчик для подстроки URL (последний совпавший выигрывает). */
  route: (urlPart: string, handler: RouteHandler) => void;
}

export function installPayPalFetchMock(): PayPalFetchMock {
  const calls: RecordedCall[] = [];
  const routes: Array<{ urlPart: string; handler: RouteHandler }> = [];

  const fetchMock = vi.fn(async (input: any, init?: any) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init?.headers || {})) {
      headers[k.toLowerCase()] = String(v);
    }
    const body = typeof init?.body === 'string' ? init.body : null;
    let json: unknown = null;
    if (body) {
      try {
        json = JSON.parse(body);
      } catch {
        json = body;
      }
    }
    const call: RecordedCall = {
      url,
      method: String(init?.method || 'GET').toUpperCase(),
      headers,
      body,
      json,
    };
    calls.push(call);

    if (url.includes('/v1/oauth2/token')) {
      return jsonResponse(200, { access_token: 'test-access-token', expires_in: 3600 });
    }

    for (let i = routes.length - 1; i >= 0; i--) {
      if (url.includes(routes[i]!.urlPart)) {
        const result = routes[i]!.handler(call);
        if (result) return jsonResponse(result.status ?? 200, result.json ?? {});
      }
    }
    throw new Error(`PayPal fetch mock: kein Handler für ${call.method} ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);

  return {
    fetchMock,
    calls,
    callsTo: (urlPart: string) => calls.filter((c) => c.url.includes(urlPart)),
    route: (urlPart: string, handler: RouteHandler) => {
      routes.push({ urlPart, handler });
    },
  };
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Стандартные env-заглушки PayPal (очевидные фиктивные значения). */
export function stubPayPalEnv(): void {
  vi.stubEnv('PAYPAL_ENV', 'sandbox');
  vi.stubEnv('PAYPAL_CLIENT_ID', 'test-client-id');
  vi.stubEnv('PAYPAL_CLIENT_SECRET', 'test-client-secret');
  vi.stubEnv('PAYPAL_WEBHOOK_ID', 'test-webhook-id');
}

/** Тело ошибки PayPal с issue-кодом (INSTRUMENT_DECLINED и т.п.). */
export function paypalIssueBody(issue: string): unknown {
  return { name: 'UNPROCESSABLE_ENTITY', details: [{ issue }] };
}
