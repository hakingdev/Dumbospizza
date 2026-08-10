"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
} from 'lucide-react';
import { parsePhoneRecipients } from '../../../lib/sms/phone';
import { analyzeSmsText, composeSmsText } from '../../../lib/sms/segments';

/** Грубая оценка: Twilio-SMS nach Deutschland ≈ 0,09–0,12 € pro Segment. */
const EST_EUR_PER_SEGMENT = 0.11;

const fmtEur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

interface RecipientsInfo {
  recipients: string[];
  optOutCount: number;
  invalidCount: number;
  duplicateCount: number;
  smsConfigured: boolean;
  smsFrom: string | null;
}

interface CampaignReport {
  total: number;
  sent: number;
  failed: number;
  failures: Array<{ to: string; error: string }>;
  optOutSkipped: number;
  invalidCount: number;
  duplicateCount: number;
  segments: number;
  encoding: string;
  from: string;
}

export default function SmsRundsendungPage() {
  const [info, setInfo] = useState<RecipientsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [message, setMessage] = useState('');
  const [useCustomList, setUseCustomList] = useState(false);
  const [customText, setCustomText] = useState('');

  const [testTo, setTestTo] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [sending, setSending] = useState(false);
  const [report, setReport] = useState<CampaignReport | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/admin/sms-recipients', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setInfo({
            recipients: data.recipients || [],
            optOutCount: data.optOutCount || 0,
            invalidCount: data.invalidCount || 0,
            duplicateCount: data.duplicateCount || 0,
            smsConfigured: Boolean(data.smsConfigured),
            smsFrom: data.smsFrom ?? null,
          });
        } else setError(data.error || 'Konnte Empfänger nicht laden');
      })
      .catch(() => setError('Konnte Empfänger nicht laden (Login?)'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Финальный текст = сообщение + автоматический Abmelde-Hinweis (как на сервере).
  const finalText = useMemo(() => composeSmsText(message), [message]);
  const smsInfo = useMemo(() => analyzeSmsText(finalText), [finalText]);

  const customParsed = useMemo(() => parsePhoneRecipients(customText), [customText]);
  const recipientCount = useCustomList
    ? customParsed.recipients.length
    : info?.recipients.length ?? 0;

  const costEstimate = recipientCount * smsInfo.segments * EST_EUR_PER_SEGMENT;

  const consentList = info?.recipients ?? [];
  const joined = consentList.join('\n');

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
    const blob = new Blob([consentList.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sms-empfaenger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sendTest = async () => {
    if (sendingTest || !message.trim() || !testTo.trim()) return;
    setSendingTest(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/sms-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, testTo }),
      });
      const data = await res.json().catch(() => ({}));
      setTestResult(
        data.success
          ? { ok: true, text: `Test-SMS an ${data.to} gesendet.` }
          : { ok: false, text: data.error || 'Test-SMS fehlgeschlagen.' }
      );
    } catch {
      setTestResult({ ok: false, text: 'Test-SMS fehlgeschlagen (Netzwerk).' });
    } finally {
      setSendingTest(false);
    }
  };

  const sendCampaign = async () => {
    if (sending || !message.trim() || recipientCount === 0) return;
    const confirmed = window.confirm(
      `SMS-Rundsendung an ${recipientCount} Empfänger senden?\n\n` +
        `«${finalText}»\n\n` +
        `${smsInfo.segments} Segment(e) pro SMS · geschätzte Kosten ~${fmtEur(costEstimate)}.\n` +
        `Das kann nicht rückgängig gemacht werden.`
    );
    if (!confirmed) return;

    setSending(true);
    setReport(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/sms-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          ...(useCustomList ? { recipientsText: customText } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setReport(data as CampaignReport);
      } else {
        setError(data.error || 'Rundsendung fehlgeschlagen.');
      }
    } catch {
      setError('Rundsendung fehlgeschlagen (Netzwerk).');
    } finally {
      setSending(false);
    }
  };

  const smsConfigured = info?.smsConfigured ?? false;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="h-6 w-6 text-primary-600" />
        <h1 className="text-2xl font-bold">SMS-Rundsendung</h1>
      </div>
      <p className="text-gray-600 mb-6 text-sm">
        Werbe-SMS über Twilio an Kunden, die beim Checkout der SMS-Werbung zugestimmt haben
        (UWG §7). Abgemeldete Nummern (/sms-abmelden) werden automatisch ausgeschlossen, der
        Abmelde-Hinweis wird jeder SMS automatisch angehängt.
      </p>

      {!loading && !smsConfigured && (
        <div className="mb-6 flex items-start gap-2 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg p-4 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <strong>Twilio-SMS-Absender fehlt.</strong> In den Umgebungsvariablen{' '}
            <code className="font-mono">TWILIO_SMS_FROM</code> setzen (z.&nbsp;B.{' '}
            <code className="font-mono">DumboPizza</code>, max. 11 Zeichen) — lokal in{' '}
            <code className="font-mono">.env.local</code> und auf Vercel. Versand ist bis dahin
            deaktiviert.
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Empfänger */}
        <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="text-lg">
              Empfänger mit Einwilligung:{' '}
              <strong>{loading ? '…' : consentList.length}</strong>
              {!loading && (info?.optOutCount ?? 0) > 0 && (
                <span className="text-sm text-gray-500"> (+{info?.optOutCount} abgemeldet)</span>
              )}
            </div>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1 px-3 py-2 border rounded text-sm disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Aktualisieren
            </button>
          </div>

          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={useCustomList}
              onChange={(e) => setUseCustomList(e.target.checked)}
              className="h-4 w-4 mt-0.5 text-primary-600 border-gray-300 rounded"
            />
            <span>
              Eigene Nummernliste verwenden (eine Nummer pro Zeile) — <strong>nur Nummern mit
              Einwilligung!</strong> Abgemeldete werden trotzdem ausgeschlossen.
            </span>
          </label>

          {useCustomList && (
            <div>
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                rows={6}
                placeholder={'+4915112345678\n+4917612345678'}
                className="w-full border rounded px-3 py-2 text-sm font-mono"
              />
              <p className="text-xs text-gray-500 mt-1">
                {customParsed.recipients.length} gültige Nummern
                {customParsed.invalidEntries.length > 0 && `, ${customParsed.invalidEntries.length} ungültig`}
                {customParsed.duplicateCount > 0 && `, ${customParsed.duplicateCount} Duplikate`}
              </p>
            </div>
          )}

          <details>
            <summary className="text-sm text-primary-700 cursor-pointer select-none">
              Einwilligungsliste anzeigen / kopieren
            </summary>
            <div className="mt-3 space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={consentList.length === 0}
                  className="inline-flex items-center gap-1 px-3 py-2 bg-primary-600 text-white rounded text-sm disabled:opacity-50"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Kopiert' : 'Alle kopieren'}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={consentList.length === 0}
                  className="inline-flex items-center gap-1 px-3 py-2 border rounded text-sm disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  CSV
                </button>
              </div>
              <textarea
                readOnly
                value={loading ? '' : joined}
                placeholder={loading ? 'Laden…' : 'Noch keine Einwilligungen vorhanden.'}
                rows={10}
                className="w-full border rounded px-3 py-2 text-sm font-mono"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          </details>
        </div>

        {/* Nachricht */}
        <div className="bg-white rounded-lg shadow-md p-6 space-y-3">
          <label htmlFor="sms-message" className="block text-lg font-semibold">
            Nachricht
          </label>
          <textarea
            id="sms-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={800}
            placeholder={'Heute bei Dumbos Pizza: 2 Pizzen bestellen, 1 gratis dazu! Nur heute auf www.dumbospizza.de'}
            className="w-full border rounded px-3 py-2 text-sm"
          />
          <div className="text-xs text-gray-600">
            {smsInfo.units} Zeichen · {smsInfo.encoding} ·{' '}
            <strong>
              {smsInfo.segments} Segment{smsInfo.segments === 1 ? '' : 'e'}
            </strong>{' '}
            pro Empfänger
            {smsInfo.encoding === 'UCS-2' && (
              <span className="text-amber-700">
                {' '}
                — Emoji/Sonderzeichen: nur {smsInfo.perSegment} Zeichen pro Segment (teurer!)
              </span>
            )}
          </div>
          {finalText && (
            <div>
              <div className="text-xs text-gray-500 mb-1">
                Vorschau (Abmelde-Hinweis wird automatisch angehängt):
              </div>
              <div className="border rounded bg-gray-50 px-3 py-2 text-sm whitespace-pre-wrap">
                {finalText}
              </div>
            </div>
          )}
        </div>

        {/* Senden */}
        <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
          <div className="text-lg font-semibold">Senden</div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="grow max-w-xs">
              <label htmlFor="sms-test-to" className="block text-xs text-gray-600 mb-1">
                Test-Nummer (eigenes Handy)
              </label>
              <input
                id="sms-test-to"
                type="tel"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="+49 151 23456789"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={sendTest}
              disabled={sendingTest || !smsConfigured || !message.trim() || !testTo.trim()}
              className="inline-flex items-center gap-1 px-3 py-2 border rounded text-sm disabled:opacity-50"
            >
              {sendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Test-SMS senden
            </button>
          </div>
          {testResult && (
            <div className={`text-sm ${testResult.ok ? 'text-green-700' : 'text-red-600'}`}>
              {testResult.text}
            </div>
          )}

          <div className="border-t pt-4 space-y-2">
            <div className="text-sm text-gray-700">
              {recipientCount} Empfänger × {smsInfo.segments || '–'} Segment(e) — geschätzte
              Kosten: <strong>~{fmtEur(costEstimate)}</strong>{' '}
              <span className="text-gray-400">(Twilio ≈ 0,09–0,12 €/Segment)</span>
            </div>
            <button
              type="button"
              onClick={sendCampaign}
              disabled={sending || !smsConfigured || !message.trim() || recipientCount === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded font-semibold disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Rundsendung an {recipientCount} Empfänger starten
            </button>
            <p className="text-xs text-gray-500">
              Bitte nur tagsüber senden (ca. 10–20 Uhr) und sparsam einsetzen — jede SMS kostet
              Geld und Vertrauen.
            </p>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          {report && (
            <div
              className={`rounded-lg border p-4 text-sm space-y-2 ${
                report.failed === 0
                  ? 'bg-green-50 border-green-300 text-green-800'
                  : 'bg-amber-50 border-amber-300 text-amber-800'
              }`}
            >
              <div className="font-semibold">
                Gesendet: {report.sent} / {report.total}
                {report.failed > 0 && ` · Fehlgeschlagen: ${report.failed}`}
              </div>
              <div className="text-xs">
                {report.optOutSkipped > 0 && <>Abgemeldet übersprungen: {report.optOutSkipped} · </>}
                {report.invalidCount > 0 && <>Ungültig: {report.invalidCount} · </>}
                {report.duplicateCount > 0 && <>Duplikate: {report.duplicateCount} · </>}
                {report.segments} Segment(e), {report.encoding}, Absender {report.from}
              </div>
              {report.failures.length > 0 && (
                <div className="max-h-40 overflow-y-auto font-mono text-xs bg-white/60 rounded p-2">
                  {report.failures.map((f) => (
                    <div key={f.to}>
                      {f.to} — {f.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
