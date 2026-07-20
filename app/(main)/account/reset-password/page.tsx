'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Lock, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * Страница из письма восстановления: /account/reset-password?token=…
 *
 * Токен НЕ проверяется на клиенте — единственная проверка на сервере в
 * /api/customer/auth/reset-password. Здесь только форма и показ ошибки.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Die Passwörter stimmen nicht überein');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/customer/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Fehler');
      }
      // Сервер уже выдал cookie сессии — ведём прямо в кабинет.
      setDone(true);
      router.refresh();
      setTimeout(() => router.push('/account'), 1500);
    } catch (err: any) {
      setError(err.message || 'Etwas ist schiefgelaufen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-3 py-8 sm:px-4 sm:py-12">
      <div className="mx-auto max-w-md rounded-lg bg-white p-5 shadow-lg sm:p-8">
        <h1 className="mb-2 text-center text-2xl font-bold leading-tight">
          Neues Passwort
        </h1>
        <p className="mb-6 text-pretty text-center text-sm leading-6 text-gray-500">
          Vergeben Sie ein neues Passwort für Ihr Konto
        </p>

        {!token ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <span className="text-pretty">
                Der Link ist unvollständig. Bitte fordern Sie einen neuen Link an.
              </span>
            </div>
            <Link
              href="/account"
              className="flex min-h-[42px] w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2 font-medium leading-none text-white transition-colors hover:bg-primary-700"
            >
              Zur Anmeldung
            </Link>
          </div>
        ) : done ? (
          <div className="flex items-start gap-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm leading-6 text-green-800">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <span className="text-pretty">
              Passwort geändert. Sie werden zu Ihrem Konto weitergeleitet…
            </span>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Neues Passwort"
                autoComplete="new-password"
                className="w-full min-w-0 rounded-md border border-gray-300 py-2 pl-10 pr-4 focus:border-primary-500 focus:ring-primary-500"
                minLength={6}
                required
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Passwort wiederholen"
                autoComplete="new-password"
                className="w-full min-w-0 rounded-md border border-gray-300 py-2 pl-10 pr-4 focus:border-primary-500 focus:ring-primary-500"
                minLength={6}
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
              disabled={loading}
              className="flex min-h-[42px] w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2 font-medium leading-none text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Passwort speichern
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
