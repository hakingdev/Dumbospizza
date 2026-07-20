'use client';

import { useState } from 'react';
import {
  Mail,
  Lock,
  User as UserIcon,
  Phone,
  Loader2,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';
import OAuthButtons from './OAuthButtons';

interface AccountAuthProps {
  onAuthenticated: () => void;
}

type Mode = 'login' | 'register' | 'forgot';

const TITLES: Record<Mode, { heading: string; subtitle: string; submit: string }> = {
  login: {
    heading: 'Anmelden',
    subtitle: 'Melden Sie sich in Ihrem Konto an',
    submit: 'Anmelden',
  },
  register: {
    heading: 'Konto erstellen',
    subtitle: 'Sammeln Sie Treuepunkte und sehen Sie Ihre Bestellungen',
    submit: 'Registrieren',
  },
  forgot: {
    heading: 'Passwort vergessen',
    subtitle: 'Wir senden Ihnen einen Link zum Zurücksetzen Ihres Passworts',
    submit: 'Link senden',
  },
};

export default function AccountAuth({ onAuthenticated }: AccountAuthProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setSent(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const url =
        mode === 'login'
          ? '/api/customer/auth/login'
          : mode === 'register'
            ? '/api/customer/auth/register'
            : '/api/customer/auth/forgot-password';
      const body =
        mode === 'login'
          ? { email, password }
          : mode === 'register'
            ? { name, email, phoneNumber, password }
            : { email };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Fehler');
      }
      // Ответ на «забыл пароль» намеренно нейтральный — показываем его как есть,
      // он не раскрывает, существует ли аккаунт.
      if (mode === 'forgot') {
        setSent(data.message || 'Bitte prüfen Sie Ihr E-Mail-Postfach.');
      } else {
        onAuthenticated();
      }
    } catch (err: any) {
      setError(err.message || 'Etwas ist schiefgelaufen');
    } finally {
      setLoading(false);
    }
  };

  const { heading, subtitle, submit: submitLabel } = TITLES[mode];

  return (
    <div className="container mx-auto px-3 py-8 sm:px-4 sm:py-12">
      <div className="mx-auto max-w-md rounded-lg bg-white p-5 shadow-lg sm:p-8">
        <h1 className="mb-2 text-center text-2xl font-bold leading-tight">{heading}</h1>
        <p className="mb-6 text-pretty text-center text-sm leading-6 text-gray-500">
          {subtitle}
        </p>

        {sent ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm leading-6 text-green-800">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <span className="text-pretty">{sent}</span>
            </div>
            <button
              onClick={() => switchMode('login')}
              className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-md border border-gray-300 px-4 py-2 font-medium leading-none text-gray-700 transition-colors hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Zurück zur Anmeldung
            </button>
          </div>
        ) : (
          <>
            {mode !== 'forgot' && <OAuthButtons />}

            <form onSubmit={submit} className="space-y-4">
              {mode === 'register' && (
                <div className="relative">
                  <UserIcon className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name"
                    className="w-full min-w-0 rounded-md border border-gray-300 py-2 pl-10 pr-4 focus:border-primary-500 focus:ring-primary-500"
                    required
                  />
                </div>
              )}

              <div className="relative">
                <Mail className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="E-Mail"
                  autoComplete="email"
                  className="w-full min-w-0 rounded-md border border-gray-300 py-2 pl-10 pr-4 focus:border-primary-500 focus:ring-primary-500"
                  required
                />
              </div>

              {mode === 'register' && (
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
              )}

              {mode !== 'forgot' && (
                <div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Passwort"
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      className="w-full min-w-0 rounded-md border border-gray-300 py-2 pl-10 pr-4 focus:border-primary-500 focus:ring-primary-500"
                      minLength={6}
                      required
                    />
                  </div>
                  {mode === 'login' && (
                    <div className="mt-2 text-right">
                      <button
                        type="button"
                        onClick={() => switchMode('forgot')}
                        className="text-sm font-medium text-primary-600 hover:underline"
                      >
                        Passwort vergessen?
                      </button>
                    </div>
                  )}
                </div>
              )}

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
                {submitLabel}
              </button>
            </form>
          </>
        )}

        {!sent && (
          <div className="mt-6 text-pretty text-center text-sm leading-6 text-gray-600">
            {mode === 'login' && (
              <>
                Noch kein Konto?{' '}
                <button
                  onClick={() => switchMode('register')}
                  className="whitespace-nowrap font-medium text-primary-600 hover:underline"
                >
                  Registrieren
                </button>
              </>
            )}
            {mode === 'register' && (
              <>
                Bereits registriert?{' '}
                <button
                  onClick={() => switchMode('login')}
                  className="whitespace-nowrap font-medium text-primary-600 hover:underline"
                >
                  Anmelden
                </button>
              </>
            )}
            {mode === 'forgot' && (
              <button
                onClick={() => switchMode('login')}
                className="inline-flex items-center gap-1.5 font-medium text-primary-600 hover:underline"
              >
                <ArrowLeft className="h-4 w-4" />
                Zurück zur Anmeldung
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
