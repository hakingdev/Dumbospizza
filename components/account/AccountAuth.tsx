'use client';

import { useState } from 'react';
import { Mail, Lock, User as UserIcon, Phone, Loader2 } from 'lucide-react';

interface AccountAuthProps {
  onAuthenticated: () => void;
}

type Mode = 'login' | 'register';

export default function AccountAuth({ onAuthenticated }: AccountAuthProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const url =
        mode === 'login'
          ? '/api/customer/auth/login'
          : '/api/customer/auth/register';
      const body =
        mode === 'login'
          ? { email, password }
          : { name, email, phoneNumber, password };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Fehler');
      }
      onAuthenticated();
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
          {mode === 'login' ? 'Anmelden' : 'Konto erstellen'}
        </h1>
        <p className="mb-6 text-pretty text-center text-sm leading-6 text-gray-500">
          {mode === 'login'
            ? 'Melden Sie sich in Ihrem Konto an'
            : 'Sammeln Sie Treuepunkte und sehen Sie Ihre Bestellungen'}
        </p>

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

          <div className="relative">
            <Lock className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Passwort"
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
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
            {mode === 'login' ? 'Anmelden' : 'Registrieren'}
          </button>
        </form>

        <div className="mt-6 text-pretty text-center text-sm leading-6 text-gray-600">
          {mode === 'login' ? (
            <>
              Noch kein Konto?{' '}
              <button
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className="whitespace-nowrap font-medium text-primary-600 hover:underline"
              >
                Registrieren
              </button>
            </>
          ) : (
            <>
              Bereits registriert?{' '}
              <button
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className="whitespace-nowrap font-medium text-primary-600 hover:underline"
              >
                Anmelden
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
