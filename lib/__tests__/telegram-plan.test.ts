import { describe, expect, it, vi } from 'vitest';
import {
  buildPlanMessageText,
  handlePlanUpdate,
  parsePlanCommand,
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
  summary: 'Сначала суши-заказы, потом самовывоз.',
  advisory: null,
  loadLevel: 'normal',
  source: 'ai',
  model: 'claude-opus-5',
  queueSize: 3,
  onTheRoad: ['260812000'],
  generatedAt: '2026-08-12T15:08:00.000Z',
};

function makeDeps(overrides: Partial<PlanBotDeps> = {}): PlanBotDeps {
  return {
    answerCallbackQuery: vi.fn(async () => ({})),
    sendMessage: vi.fn(async () => ({})),
    editMessage: vi.fn(async () => ({})),
    buildPlan: vi.fn(async () => PLAN),
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
  });

  it('пустая очередь и advisory', () => {
    const empty: KitchenPlan = { ...PLAN, batches: [], onTheRoad: [], advisory: 'Пауза 30 мин.' };
    const text = buildPlanMessageText(empty);
    expect(text).toContain('Активных заказов нет');
    expect(text).toContain('⚠️ Пауза 30 мин.');
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

describe('handlePlanUpdate', () => {
  const chat = { id: -100123 };

  it('/plan из разрешённого чата — строит план и шлёт сообщение', async () => {
    const deps = makeDeps();
    const res = await handlePlanUpdate({ message: { chat, text: '/plan' } }, deps);
    expect(res).toEqual({ handled: true, reason: 'plan_sent' });
    expect(deps.buildPlan).toHaveBeenCalledOnce();
    expect(deps.sendMessage).toHaveBeenCalledWith(
      chat.id,
      expect.stringContaining('AI-план кухни'),
      true
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
      expect.stringContaining('AI-план кухни')
    );
  });

  it('фото — заглушка приёма чека Lieferando', async () => {
    const deps = makeDeps();
    const res = await handlePlanUpdate(
      { message: { chat, photo: [{ file_id: 'f1' }] } },
      deps
    );
    expect(res).toEqual({ handled: true, reason: 'receipt_stub' });
    expect(deps.sendMessage).toHaveBeenCalledWith(chat.id, expect.stringContaining('Чек получен'));
    expect(deps.buildPlan).not.toHaveBeenCalled();
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
      expect.stringContaining('Не удалось'),
      false
    );
  });

  it('/start — справка без вызова плана', async () => {
    const deps = makeDeps();
    const res = await handlePlanUpdate({ message: { chat, text: '/start' } }, deps);
    expect(res).toEqual({ handled: true, reason: 'help' });
    expect(deps.buildPlan).not.toHaveBeenCalled();
  });
});
