import { describe, expect, it } from 'vitest';
import { orderChannelBadge, parseOrderClient } from '../order-client';
import { buildOrderMessageText } from '../../telegram/order-message';

function headers(map: Record<string, string>) {
  const h = new Headers(map);
  return { get: (name: string) => h.get(name) };
}

describe('parseOrderClient', () => {
  it('без заголовков — сайт', () => {
    expect(parseOrderClient(headers({}))).toEqual({ source: 'website', clientInfo: null });
  });

  it('приложение с платформой и версией', () => {
    expect(
      parseOrderClient(
        headers({ 'X-Client': 'dumbos-app', 'X-App-Platform': 'iOS', 'X-App-Version': '1.4.2' })
      )
    ).toEqual({ source: 'app', clientInfo: { platform: 'ios', version: '1.4.2' } });
  });

  it('чужой X-Client не делает заказ «приложением»', () => {
    expect(parseOrderClient(headers({ 'X-Client': 'curl', 'X-App-Platform': 'ios' })).source).toBe(
      'website'
    );
  });

  it('неизвестную платформу и мусорную версию отбрасывает', () => {
    expect(
      parseOrderClient(
        headers({ 'X-Client': 'dumbos-app', 'X-App-Platform': 'windows', 'X-App-Version': '<b>1</b>' })
      )
    ).toEqual({ source: 'app', clientInfo: null });
  });
});

describe('orderChannelBadge', () => {
  it('помечает только приложение', () => {
    expect(orderChannelBadge({ source: 'app', clientInfo: { platform: 'android' } })).toBe(
      '📲 App · Android'
    );
    expect(orderChannelBadge({ source: 'app', clientInfo: null })).toBe('📲 App');
    expect(orderChannelBadge({ source: 'website' })).toBe('');
    expect(orderChannelBadge({ source: 'lieferando' })).toBe('');
    expect(orderChannelBadge({})).toBe('');
  });
});

describe('Telegram: обычное сообщение о заказе', () => {
  const base = {
    orderId: '261126001',
    customerName: 'Anna',
    phoneNumber: '0151 000000',
    items: [{ name: 'Margherita', quantity: 1 }],
    totalAmount: 12.5,
    paymentMethod: 'cash',
    deliveryType: 'pickup' as const,
  };

  it('в шапке «📲 App · iOS» для заказа из приложения', () => {
    const text = buildOrderMessageText({ ...base, source: 'app', clientInfo: { platform: 'ios' } });
    expect(text.split('\n')[0]).toBe('🔔 <b>НОВЫЙ ЗАКАЗ #261126001</b> · 📲 App · iOS');
  });

  it('заказ с сайта без пометки', () => {
    const text = buildOrderMessageText({ ...base, source: 'website' });
    expect(text.split('\n')[0]).toBe('🔔 <b>НОВЫЙ ЗАКАЗ #261126001</b>');
  });
});
