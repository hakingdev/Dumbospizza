import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import OAuthButtons from '../OAuthButtons';

/** Подменяем ответ /api/customer/auth/providers. */
function mockProviders(providers: { id: string; label: string }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({ success: true, providers }) }) as any)
  );
}

function setSearch(search: string) {
  window.history.replaceState({}, '', `/account${search}`);
}

describe('OAuthButtons', () => {
  beforeEach(() => setSearch(''));
  afterEach(() => vi.unstubAllGlobals());

  it('без настроенных провайдеров не рисует ничего — форма входа как раньше', async () => {
    mockProviders([]);
    const { container } = render(<OAuthButtons />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('рисует кнопку Google со ссылкой на start-роут', async () => {
    mockProviders([{ id: 'google', label: 'Google' }]);
    render(<OAuthButtons />);

    const link = await screen.findByRole('link', { name: /Mit Google anmelden/ });
    expect(link.getAttribute('href')).toContain('/api/customer/auth/oauth/google/start');
  });

  it('рисует обе кнопки, когда настроены оба провайдера', async () => {
    mockProviders([
      { id: 'google', label: 'Google' },
      { id: 'apple', label: 'Apple' },
    ]);
    render(<OAuthButtons />);

    expect(await screen.findByRole('link', { name: /Mit Google anmelden/ })).toBeTruthy();
    expect(await screen.findByRole('link', { name: /Mit Apple anmelden/ })).toBeTruthy();
  });

  it('прокидывает текущий путь в returnTo, чтобы вернуть клиента откуда пришёл', async () => {
    setSearch('');
    window.history.replaceState({}, '', '/checkout');
    mockProviders([{ id: 'google', label: 'Google' }]);
    render(<OAuthButtons />);

    const link = await screen.findByRole('link', { name: /Mit Google anmelden/ });
    expect(link.getAttribute('href')).toContain(`returnTo=${encodeURIComponent('/checkout')}`);
  });

  it('показывает понятную причину, с которой callback вернул на форму', async () => {
    setSearch('?error=oauth_state');
    mockProviders([{ id: 'google', label: 'Google' }]);
    render(<OAuthButtons />);

    expect(await screen.findByText(/abgelaufen oder wurde unterbrochen/)).toBeTruthy();
  });

  it('неизвестный код ошибки не оставляет пользователя без объяснения', async () => {
    setSearch('?error=völlig_unbekannt');
    mockProviders([]);
    render(<OAuthButtons />);

    expect(await screen.findByText(/Anmeldung beim Anbieter fehlgeschlagen/)).toBeTruthy();
  });
});
