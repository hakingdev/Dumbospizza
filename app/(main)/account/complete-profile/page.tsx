'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Phone, User as UserIcon, AlertTriangle } from 'lucide-react';

/**
 * Последний шаг входа через Google/Apple: телефон.
 *
 * Провайдеры телефон не отдают, а он обязателен (users.phone_number NOT NULL) и
 * служит ключом программы лояльности. До отправки этой формы аккаунта ещё нет —
 * личность лежит в подписанном талоне (см. lib/auth/oauth/ticket.ts).
 */
export default function CompleteProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      }
    >
      <CompleteProfileForm />
    </Suspense>
  );
}

/** Возврат только на свои относительные пути — иначе это открытый редирект. */
function safePath(raw: string | null): string {
  const value = String(raw || '');
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/account';
  }
  return value;
}

function CompleteProfileForm() {
  const router = useRouter();
  const returnTo = safePath(useSearchParams().get('returnTo'));

  const [status, setStatus] = useState<'loading' | 'ready' | 'expired'>('loading');
  const [provider, setProvider] = useState<string>('');
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/customer/auth/oauth/complete')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.success) {
          setStatus('expired');
          return;
        }
        setProvider(data.pending?.provider === 'apple' ? 'Apple' : 'Google');
        setEmail(data.pending?.email || null);
        setName(data.pending?.name || '');
        setStatus('ready');
      })
      .catch(() => setStatus('expired'));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/customer/auth/oauth/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Fehler');
      }
      router.replace(returnTo);
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Etwas ist schiefgelaufen');
    } finally {
      setSaving(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-3 py-8 sm:px-4 sm:py-12">
      <div className="mx-auto max-w-md rounded-lg bg-white p-5 shadow-lg sm:p-8">
        <h1 className="mb-2 text-center text-2xl font-bold leading-tight">
          Fast geschafft
        </h1>

        {status === 'expired' ? (
          <div className="mt-6 space-y-5">
            <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <span className="text-pretty">
                Die Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an.
              </span>
            </div>
            <Link
              href="/account"
              className="flex min-h-[42px] w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2 font-medium leading-none text-white transition-colors hover:bg-primary-700"
            >
              Zur Anmeldung
            </Link>
          </div>
        ) : (
          <>
            <p className="mb-6 text-pretty text-center text-sm leading-6 text-gray-500">
              {provider}-Anmeldung erfolgreich
              {email ? ` (${email})` : ''}. Für Bestellungen und Treuepunkte
              brauchen wir noch Ihre Telefonnummer.
            </p>

            <form onSubmit={submit} className="space-y-4">
              <div className="relative">
                <UserIcon className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name"
                  autoComplete="name"
                  className="w-full min-w-0 rounded-md border border-gray-300 py-2 pl-10 pr-4 focus:border-primary-500 focus:ring-primary-500"
                  required
                />
              </div>

              <div className="relative">
                <Phone className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="Telefonnummer"
                  autoComplete="tel"
                  className="w-full min-w-0 rounded-md border border-gray-300 py-2 pl-10 pr-4 focus:border-primary-500 focus:ring-primary-500"
                  required
                />
              </div>

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="flex min-h-[42px] w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2 font-medium leading-none text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Konto erstellen
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
