"use client";

import { useState } from 'react';
import { CheckCircle2, Loader2, MessageSquare } from 'lucide-react';

/**
 * Публичная страница отписки от Werbe-SMS — на неё ведёт «Abmelden:»-ссылка
 * из каждой Rundsendung (Alphanumeric Sender не принимает ответы, STOP нет).
 */
export default function SmsAbmeldenPage() {
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/sms/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setDone(true);
      } else {
        setError(data.error || 'Die Abmeldung konnte nicht verarbeitet werden.');
      }
    } catch {
      setError('Die Abmeldung konnte nicht verarbeitet werden. Bitte später erneut versuchen.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-lg">
      <div className="bg-white rounded-lg shadow-md p-6 sm:p-8">
        {done ? (
          <div className="text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Abgemeldet ✓</h1>
            <p className="text-gray-700">
              Sie erhalten keine Werbe-SMS mehr von Dumbos Pizza.
            </p>
            <p className="text-gray-500 text-sm mt-3">
              Benachrichtigungen zu Ihren Bestellungen (z.&nbsp;B. Bestellstatus) sind davon
              nicht betroffen.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="h-6 w-6 text-primary-600" />
              <h1 className="text-2xl font-bold">SMS-Werbung abmelden</h1>
            </div>
            <p className="text-gray-600 text-sm mb-6">
              Geben Sie die Handynummer ein, die keine Angebote und Aktionen per SMS mehr
              erhalten soll. Die Abmeldung ist sofort wirksam und kostenlos.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Telefonnummer
                </label>
                <input
                  id="phone"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+49 151 23456789"
                  className="w-full border border-gray-300 rounded px-3 py-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              {error && <div className="text-sm text-red-600">{error}</div>}
              <button
                type="submit"
                disabled={submitting || !phone.trim()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded font-semibold disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Abmelden
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
