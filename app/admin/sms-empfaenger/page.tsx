"use client";

import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Copy, Download, RefreshCw, Check, Loader2 } from 'lucide-react';

export default function SmsEmpfaengerPage() {
  const [recipients, setRecipients] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/admin/sms-recipients', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setRecipients(data.recipients || []);
        else setError(data.error || 'Konnte Empfänger nicht laden');
      })
      .catch(() => setError('Konnte Empfänger nicht laden (Login?)'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const joined = recipients.join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joined);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Kopieren fehlgeschlagen — bitte manuell markieren.');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([recipients.map((p) => `${p}`).join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sms-empfaenger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="h-6 w-6 text-primary-600" />
        <h1 className="text-2xl font-bold">SMS-Empfänger (mit Einwilligung)</h1>
      </div>
      <p className="text-gray-600 mb-6 text-sm">
        Telefonnummern von Kunden, die beim Checkout der SMS-Werbung zugestimmt haben
        (UWG §7). Nur diese Nummern dürfen für Marketing-SMS verwendet werden. Format E.164
        (+49…), dedupliziert — zum Kopieren in die SMS-Rundsendung.
      </p>

      <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-lg">
            Empfänger: <strong>{loading ? '…' : recipients.length}</strong>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1 px-3 py-2 border rounded text-sm disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Aktualisieren
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={recipients.length === 0}
              className="inline-flex items-center gap-1 px-3 py-2 bg-primary-600 text-white rounded text-sm disabled:opacity-50"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Kopiert' : 'Alle kopieren'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={recipients.length === 0}
              className="inline-flex items-center gap-1 px-3 py-2 border rounded text-sm disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              CSV
            </button>
          </div>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <textarea
          readOnly
          value={loading ? '' : joined}
          placeholder={loading ? 'Laden…' : 'Noch keine Einwilligungen vorhanden.'}
          rows={16}
          className="w-full border rounded px-3 py-2 text-sm font-mono"
          onFocus={(e) => e.currentTarget.select()}
        />
        <p className="text-xs text-gray-500">
          Liste wächst erst ab Einführung der Checkout-Checkbox — Bestandsnummern ohne
          Einwilligung erscheinen hier nicht.
        </p>
      </div>
    </div>
  );
}
