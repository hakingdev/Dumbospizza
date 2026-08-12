import { describe, expect, it, vi } from 'vitest';
import {
  buildPlanKeyboard,
  buildPlanMessageText,
  handlePlanUpdate,
  parsePlanCommand,
  PLAN_DELAY_PREFIX,
  PLAN_REFRESH,
  type PlanBotDeps,
} from '../telegram-plan';
import type { KitchenPlan } from '../eta/types';

const PLAN: KitchenPlan = {
  batches: [
    {
      step: 1,
      orderNumbers: ['260812001', '260812002'],
      area: 'Bad Kissingen Zentrum',
      cookTogether: true,
      courier: 'рейс №1: Bad Kissingen, 2 адреса',
      rationale: 'Один город — готовим вместе.',
    },
    {
      step: 2,
      orderNumbers: ['260812003'],
      area: 'Abholung',
      cookTogether: false,
      courier: null,
      rationale: 'Самовывоз.',
    },
  ],
  lateOrders: [],
  summary: 'Сначала суши-заказы, потом самовывоз.',
  advisory: null,
  loadLevel: 'normal',
  source: 'ai',
  model: 'claude-opus-5',
  queueSize: 3,
  onTheRoad: ['260812000'],
  generatedAt: '2026-08-12T15:08:00.000Z',
};

/** План с опозданиями: один заказ сайта с телефоном, один Lieferando без. */
const LATE_PLAN: KitchenPlan = {
  ...PLAN,
  lateOrders: [
    {
      orderId: 'abc123',
      orderNumber: '260812001',
      source: 'website',
      minutesLate: 12,
      promiseRemainingMinutes: -12,
      hasPhone: true,
    },
    {
      orderId: 'def456',
      orderNumber: 'L-XY7',
      source: 'lieferando',
      minutesLate: 0,
      promiseRemainingMinutes: 3,
      hasPhone: false,
    },
  ],
};

function makeDeps(overrides: Partial<PlanBotDeps> = {}): PlanBotDeps {
  return {
    answerCallbackQuery: vi.fn(async () => ({})),
    sendMessage: vi.fn(async () => ({})),
    editMessage: vi.fn(async () => ({})),
    buildPlan: vi.fn(async () => PLAN),
    importReceipt: vi.fn(async () => ({
      ok: true,
      orderId: 'oid1',
      orderNumber: 'L-ABC',
      order: {
        customerName: 'Max Mustermann',
        deliveryType: 'delivery' as const,
        city: 'Bad Kissingen',
        address: 'Kurhausstr. 30, 97688 Bad Kissingen',
        itemsCount: 3,
        total: 34.5,
        etaMinutes: 45,
        hasPhone: true,
      },
    })),
    applyDelay: vi.fn(async () => ({
      ok: true,
      orderId: 'abc123',
      orderNumber: '260812001',
      etaMinutes: 25,
      whatsappSent: true,
    })),
    allowedChatId: '-100123',
    log: () => {},
    ...overrides,
  };
}

describe('parsePlanCommand', () => {
  it('распознаёт /plan, /start, /help (в т.ч. с @botname)', () => {
    expect(parsePlanCommand('/plan')).toBe('plan');
    expect(parsePlanCommand('/plan@dumbo_plan_bot')).toBe('plan');
    expect(parsePlanCommand('/start')).toBe('help');
    expect(parsePlanCommand('/help')).toBe('help');
    expect(parsePlanCommand('привет')).toBeNull();
    expect(parsePlanCommand(undefined)).toBeNull();
  });
});

describe('buildPlanMessageText', () => {
  it('содержит шаги, рейс, «готовить вместе», в пути и время', () => {
    const text = buildPlanMessageText(PLAN);
    expect(text).toContain('#260812001 + #260812002');
    expect(text).toContain('Bad Kissingen Zentrum');
    expect(text).toContain('готовить вместе');
    expect(text).toContain('рейс №1');
    expect(text).toContain('Уже в пути: #260812000');
    expect(text).toContain('Claude');
    expect(text).toContain('нагрузка: норма');
    expect(text).not.toContain('Опаздывают');
  });

  it('пустая очередь и advisory', () => {
    const empty: KitchenPlan = { ...PLAN, batches: [], onTheRoad: [], advisory: 'Пауза 30 мин.' };
    const text = buildPlanMessageText(empty);
    expect(text).toContain('Активных заказов нет');
    expect(text).toContain('⚠️ Пауза 30 мин.');
  });

  it('опаздывающие заказы: просрочка, канал, отсутствие телефона', () => {
    const text = buildPlanMessageText(LATE_PLAN);
    expect(text).toContain('Опаздывают');
    expect(text).toContain('#260812001 (сайт) — просрочка 12 мин');
    expect(text).toContain('#L-XY7 (Lieferando) — впритык к обещанию · нет телефона гостя');
    expect(text).toContain('WhatsApp о задержке');
  });

  it('экранирует HTML в строках от модели', () => {
    const dirty: KitchenPlan = {
      ...PLAN,
      summary: 'a<b>&c',
      batches: [{ ...PLAN.batches[0], rationale: '<script>' }],
    };
    const text = buildPlanMessageText(dirty);
    expect(text).toContain('a&lt;b&gt;&amp;c');
    expect(text).toContain('&lt;script&gt;');
  });
});

describe('buildPlanKeyboard', () => {
  it('без плана — только «Пересчитать»', () => {
    const kb = buildPlanKeyboard();
    expect(kb.inline_keyboard).toHaveLength(1);
    expect(kb.inline_keyboard[0][0].callback_data).toBe(PLAN_REFRESH);
  });

  it('строка кнопок задержки на каждый опаздывающий заказ с телефоном и id', () => {
    const kb = buildPlanKeyboard(LATE_PLAN);
    // refresh + один ряд для #260812001; L-XY7 без телефона — кнопок нет.
    expect(kb.inline_keyboard).toHaveLength(2);
    const row = kb.inline_keyboard[1];
    expect(row).toHaveLength(4);
    expect(row[0].text).toContain('#260812001');
    expect(row[0].callback_data).toBe(`${PLAN_DELAY_PREFIX}abc123_10`);
    expect(row[3].callback_data).toBe(`${PLAN_DELAY_PREFIX}abc123_30`);
  });
});

describe('handlePlanUpdate', () => {
  const chat = { id: -100123 };

  it('/plan из разрешённого чата — строит план и шлёт сообщение с клавиатурой', async () => {
    const deps = makeDeps();
    const res = await handlePlanUpdate({ message: { chat, text: '/plan' } }, deps);
    expect(res).toEqual({ handled: true, reason: 'plan_sent' });
    expect(deps.buildPlan).toHaveBeenCalledOnce();
    expect(deps.sendMessage).toHaveBeenCalledWith(
      chat.id,
      expect.stringContaining('AI-план кухни'),
      expect.objectContaining({ inline_keyboard: expect.any(Array) })
    );
  });

  it('чужой чат — игнор без построения плана', async () => {
    const deps = makeDeps();
    const res = await handlePlanUpdate(
      { message: { chat: { id: 555 }, text: '/plan' } },
      deps
    );
    expect(res).toEqual({ handled: false, reason: 'wrong_chat' });
    expect(deps.buildPlan).not.toHaveBeenCalled();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('кнопка «Пересчитать» — ack + edit того же сообщения', async () => {
    const deps = makeDeps();
    const res = await handlePlanUpdate(
      {
        callback_query: {
          id: 'cb1',
          data: PLAN_REFRESH,
          message: { chat, message_id: 42 },
        },
      },
      deps
    );
    expect(res).toEqual({ handled: true, reason: 'plan_refreshed' });
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith('cb1', '🔄 План пересчитан');
    expect(deps.editMessage).toHaveBeenCalledWith(
      chat.id,
      42,
      expect.stringContaining('AI-план кухни'),
      expect.objectContaining({ inline_keyboard: expect.any(Array) })
    );
  });

  it('сбой построения плана — сообщение об ошибке, не падает', async () => {
    const deps = makeDeps({
      buildPlan: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const res = await handlePlanUpdate({ message: { chat, text: '/plan' } }, deps);
    expect(res).toEqual({ handled: false, reason: 'error' });
    expect(deps.sendMessage).toHaveBeenCalledWith(
      chat.id,
      expect.stringContaining('Не удалось')
    );
  });

  it('/start — справка без вызова плана', async () => {
    const deps = makeDeps();
    const res = await handlePlanUpdate({ message: { chat, text: '/start' } }, deps);
    expect(res).toEqual({ handled: true, reason: 'help' });
    expect(deps.buildPlan).not.toHaveBeenCalled();
  });
});

describe('handlePlanUpdate: чеки Lieferando', () => {
  const chat = { id: -100123 };

  it('фото → распознавание, создание заказа, подтверждение персоналу', async () => {
    const deps = makeDeps();
    const res = await handlePlanUpdate(
      { message: { chat, photo: [{ file_id: 'small' }, { file_id: 'big' }] } },
      deps
    );
    expect(res).toEqual({ handled: true, reason: 'receipt_imported' });
    // Берётся самый крупный размер фото (последний в массиве).
    expect(deps.importReceipt).toHaveBeenCalledWith('big');
    expect(deps.sendMessage).toHaveBeenCalledWith(chat.id, expect.stringContaining('Распознаю'));
    expect(deps.sendMessage).toHaveBeenCalledWith(
      chat.id,
      expect.stringContaining('Заказ <b>#L-ABC</b> добавлен в план'),
      expect.objectContaining({ inline_keyboard: expect.any(Array) })
    );
    const confirmation = (deps.sendMessage as any).mock.calls.at(-1)[1] as string;
    expect(confirmation).toContain('Max Mustermann');
    expect(confirmation).toContain('34,50 €');
    expect(confirmation).toContain('~45 мин');
  });

  it('дубль чека — «уже учтён», заказ не создаётся повторно', async () => {
    const deps = makeDeps({
      importReceipt: vi.fn(async () => ({ ok: false, reason: 'duplicate' as const, orderNumber: 'L-ABC' })),
    });
    const res = await handlePlanUpdate({ message: { chat, photo: [{ file_id: 'f1' }] } }, deps);
    expect(res).toEqual({ handled: true, reason: 'receipt_duplicate' });
    expect(deps.sendMessage).toHaveBeenCalledWith(chat.id, expect.stringContaining('уже учтён'));
  });

  it('не чек (например, фото меню) — вежливый отказ', async () => {
    const deps = makeDeps({
      importReceipt: vi.fn(async () => ({ ok: false, reason: 'not_receipt' as const })),
    });
    const res = await handlePlanUpdate({ message: { chat, photo: [{ file_id: 'f1' }] } }, deps);
    expect(res).toEqual({ handled: true, reason: 'receipt_rejected' });
    expect(deps.sendMessage).toHaveBeenCalledWith(
      chat.id,
      expect.stringContaining('Не похоже на чек')
    );
  });

  it('сбой распознавания — просьба переснять, не падает', async () => {
    const deps = makeDeps({
      importReceipt: vi.fn(async () => {
        throw new Error('vision down');
      }),
    });
    const res = await handlePlanUpdate({ message: { chat, photo: [{ file_id: 'f1' }] } }, deps);
    expect(res).toEqual({ handled: true, reason: 'receipt_error' });
    expect(deps.sendMessage).toHaveBeenCalledWith(
      chat.id,
      expect.stringContaining('Не удалось распознать чек')
    );
  });

  it('PDF из портала Lieferando — распознаётся как и фото', async () => {
    const deps = makeDeps();
    const res = await handlePlanUpdate(
      { message: { chat, document: { file_id: 'd1', mime_type: 'application/pdf' } } },
      deps
    );
    expect(res).toEqual({ handled: true, reason: 'receipt_imported' });
    expect(deps.importReceipt).toHaveBeenCalledWith('d1');
  });

  it('документ неподдерживаемого типа — отклоняется без распознавания', async () => {
    const deps = makeDeps();
    const res = await handlePlanUpdate(
      { message: { chat, document: { file_id: 'd2', mime_type: 'application/zip' } } },
      deps
    );
    expect(res).toEqual({ handled: true, reason: 'receipt_rejected' });
    expect(deps.importReceipt).not.toHaveBeenCalled();
  });
});

describe('handlePlanUpdate: «заказ опаздывает»', () => {
  const chat = { id: -100123 };

  it('кнопка +15 мин — задержка, ack с WhatsApp-статусом, обновление сообщения', async () => {
    const deps = makeDeps({ buildPlan: vi.fn(async () => LATE_PLAN) });
    const res = await handlePlanUpdate(
      {
        callback_query: {
          id: 'cb2',
          data: `${PLAN_DELAY_PREFIX}abc123_15`,
          message: { chat, message_id: 7 },
        },
      },
      deps
    );
    expect(res).toEqual({ handled: true, reason: 'delay_applied' });
    expect(deps.applyDelay).toHaveBeenCalledWith('abc123', 15);
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith(
      'cb2',
      expect.stringContaining('+15 мин')
    );
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith(
      'cb2',
      expect.stringContaining('WhatsApp')
    );
    expect(deps.editMessage).toHaveBeenCalled();
  });

  it('сбой задержки — ack с ошибкой, сообщение не редактируется', async () => {
    const deps = makeDeps({
      applyDelay: vi.fn(async () => ({
        ok: false as const,
        reason: 'not_found' as const,
        whatsappSent: false,
      })),
    });
    const res = await handlePlanUpdate(
      {
        callback_query: {
          id: 'cb3',
          data: `${PLAN_DELAY_PREFIX}missing_10`,
          message: { chat, message_id: 8 },
        },
      },
      deps
    );
    expect(res).toEqual({ handled: false, reason: 'delay_failed' });
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith(
      'cb3',
      expect.stringContaining('Не удалось')
    );
    expect(deps.editMessage).not.toHaveBeenCalled();
  });

  it('чужой чат не может слать задержки', async () => {
    const deps = makeDeps();
    const res = await handlePlanUpdate(
      {
        callback_query: {
          id: 'cb4',
          data: `${PLAN_DELAY_PREFIX}abc123_15`,
          message: { chat: { id: 999 }, message_id: 9 },
        },
      },
      deps
    );
    expect(res).toEqual({ handled: false, reason: 'wrong_chat' });
    expect(deps.applyDelay).not.toHaveBeenCalled();
  });
});
