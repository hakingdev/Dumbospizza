'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

type ProviderId = 'google' | 'apple';

interface Provider {
  id: ProviderId;
  label: string;
}

/**
 * Причины, с которыми callback возвращает на /account?error=…
 * Текст пользовательский: технические подробности остаются в серверных логах.
 */
const ERROR_MESSAGES: Record<string, string> = {
  oauth_state: 'Die Anmeldung ist abgelaufen oder wurde unterbrochen. Bitte erneut versuchen.',
  oauth_denied: 'Die Anmeldung wurde abgebrochen.',
  oauth_code: 'Anmeldung beim Anbieter fehlgeschlagen. Bitte erneut versuchen.',
  oauth_exchange: 'Anmeldung beim Anbieter fehlgeschlagen. Bitte erneut versuchen.',
  provider_unavailable: 'Dieser Anmeldeweg ist derzeit nicht verfügbar.',
};

/**
 * Кнопки входа через Google/Apple.
 *
 * Рисуются только те провайдеры, для которых на сервере есть ключи — список
 * приходит из /api/customer/auth/providers. Если не настроен ни один, компонент
 * не рендерит ничего, и форма выглядит ровно как раньше.
 */
export default function OAuthButtons() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState('/account');

  useEffect(() => {
    // window вместо useSearchParams: иначе странице нужна Suspense-граница,
    // а это чисто клиентская мелочь.
    const params = new URLSearchParams(window.location.search);
    const code = params.get('error');
    if (code) setError(ERROR_MESSAGES[code] || ERROR_MESSAGES.oauth_exchange);
    setReturnTo(window.location.pathname || '/account');

    let cancelled = false;
    fetch('/api/customer/auth/providers')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.success) setProviders(data.providers || []);
      })
      .catch(() => {
        /* нет списка — просто не показываем кнопки */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (providers.length === 0 && !error) return null;

  return (
    <div className="mb-6">
      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="text-pretty">{error}</span>
        </div>
      )}

      {providers.length > 0 && (
        <>
          <div className="space-y-3">
            {providers.map((provider) => (
              <a
                key={provider.id}
                href={`/api/customer/auth/oauth/${provider.id}/start?returnTo=${encodeURIComponent(returnTo)}`}
                className={
                  provider.id === 'apple'
                    ? 'flex min-h-[42px] w-full items-center justify-center gap-2.5 rounded-md bg-black px-4 py-2 font-medium leading-none text-white transition-opacity hover:opacity-90'
                    : 'flex min-h-[42px] w-full items-center justify-center gap-2.5 rounded-md border border-gray-300 bg-white px-4 py-2 font-medium leading-none text-gray-700 transition-colors hover:bg-gray-50'
                }
              >
                {provider.id === 'apple' ? <AppleIcon /> : <GoogleIcon />}
                Mit {provider.label} anmelden
              </a>
            ))}
          </div>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-gray-200" />
            <span className="text-xs uppercase tracking-wide text-gray-400">oder</span>
            <span className="h-px flex-1 bg-gray-200" />
          </div>
        </>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.63h6.2a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.18-2 3.44-4.96 3.44-8.55Z"
      />
      <path
        fill="#34A853"
        d="M12 23.5c3.11 0 5.72-1.03 7.62-2.8l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.03-6.45-4.75H1.71v2.98A11.5 11.5 0 0 0 12 23.5Z"
      />
      <path
        fill="#FBBC05"
        d="M5.55 14.16a6.9 6.9 0 0 1 0-4.32V6.86H1.71a11.5 11.5 0 0 0 0 10.28l3.84-2.98Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.09c1.69 0 3.21.58 4.4 1.72l3.3-3.3C17.71 1.63 15.1.5 12 .5A11.5 11.5 0 0 0 1.71 6.86l3.84 2.98C6.46 7.12 9 5.09 12 5.09Z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.54c-.03-2.82 2.3-4.18 2.4-4.24-1.31-1.92-3.35-2.18-4.07-2.21-1.73-.18-3.38 1.02-4.26 1.02-.88 0-2.23-.99-3.67-.97-1.89.03-3.63 1.1-4.6 2.79-1.96 3.4-.5 8.43 1.41 11.19.93 1.35 2.04 2.87 3.5 2.81 1.4-.06 1.93-.9 3.63-.9s2.18.9 3.67.87c1.52-.02 2.48-1.37 3.41-2.73 1.07-1.56 1.51-3.08 1.54-3.16-.03-.01-2.96-1.13-2.99-4.49ZM14.3 4.07c.77-.94 1.29-2.24 1.15-3.54-1.11.05-2.46.74-3.26 1.67-.71.83-1.34 2.16-1.17 3.43 1.24.1 2.5-.63 3.28-1.56Z" />
    </svg>
  );
}
