"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Mail, Bell, Send, Loader2, Upload, XCircle } from 'lucide-react';
import {
  getPromotionCampaignPreview,
  sendPromotionCampaign,
} from '../../lib/api-client';
import { parseEmailRecipients } from '../../lib/promotions/email-recipients';

const DAY_LABELS = [
  { v: 1, l: 'Mo' },
  { v: 2, l: 'Di' },
  { v: 3, l: 'Mi' },
  { v: 4, l: 'Do' },
  { v: 5, l: 'Fr' },
  { v: 6, l: 'Sa' },
  { v: 0, l: 'So' },
];

export type ScheduleCampaignFormSlice = {
  weekdayScheduleEnabled: boolean;
  happyHourEnabled: boolean;
  activeDaysOfWeek: number[];
  activeTimeStart: string;
  activeTimeEnd: string;
  scheduleTimeZone: string;
  autoNotifyOnStart: boolean;
  emailCampaignEnabled: boolean;
  emailSubject: string;
  emailBodyHtml: string;
  pushCampaignEnabled: boolean;
  pushTitle: string;
  pushBody: string;
};

export const defaultScheduleCampaignFields: ScheduleCampaignFormSlice = {
  weekdayScheduleEnabled: true,
  happyHourEnabled: false,
  activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  activeTimeStart: '16:00',
  activeTimeEnd: '18:00',
  scheduleTimeZone: 'Europe/Berlin',
  autoNotifyOnStart: false,
  emailCampaignEnabled: false,
  emailSubject: '',
  emailBodyHtml: '',
  pushCampaignEnabled: false,
  pushTitle: '',
  pushBody: '',
};

const EMAIL_FILE_MAX_BYTES = 5 * 1024 * 1024;

async function readRecipientFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return '';
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
    });
    return rows
      .flat()
      .map((cell) => String(cell ?? '').trim())
      .filter(Boolean)
      .join('\n');
  }

  return file.text();
}

export function PromotionScheduleFields({
  form,
  setForm,
}: {
  form: ScheduleCampaignFormSlice;
  setForm: (patch: Partial<ScheduleCampaignFormSlice>) => void;
}) {
  const toggleDay = (d: number) => {
    const list = form.activeDaysOfWeek.includes(d)
      ? form.activeDaysOfWeek.filter((x) => x !== d)
      : [...form.activeDaysOfWeek, d];
    setForm({ activeDaysOfWeek: list.sort((a, b) => a - b) });
  };

  return (
    <div className="border rounded-lg p-4 bg-emerald-50/50 space-y-4">
      <div className="flex items-center gap-2 font-semibold text-emerald-900">
        <Clock className="h-5 w-5" />
        Wochentage (wie Lieferando)
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.weekdayScheduleEnabled}
          onChange={(e) => setForm({ weekdayScheduleEnabled: e.target.checked })}
        />
        Angebot nur an ausgewählten Tagen — jeden Monat wiederholbar
      </label>
      {form.weekdayScheduleEnabled && (
        <>
          <div className="flex flex-wrap gap-2">
            {DAY_LABELS.map((d) => (
              <button
                key={d.v}
                type="button"
                onClick={() => toggleDay(d.v)}
                className={`px-3 py-1 rounded text-sm border ${
                  form.activeDaysOfWeek.includes(d.v)
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white border-gray-300'
                }`}
              >
                {d.l}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-sm mb-1">Zeitzone</label>
            <input
              value={form.scheduleTimeZone}
              onChange={(e) => setForm({ scheduleTimeZone: e.target.value })}
              className="w-full border rounded-md px-3 py-2"
            />
          </div>
        </>
      )}

      <div className="border-t pt-4 mt-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.happyHourEnabled}
            onChange={(e) => setForm({ happyHourEnabled: e.target.checked })}
          />
          Zusätzlich: Rabatt nur in diesem Uhrzeit-Fenster (Happy Hour)
        </label>
        {form.happyHourEnabled && (
          <>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div>
                <label className="block text-sm mb-1">Von</label>
                <input
                  type="time"
                  value={form.activeTimeStart}
                  onChange={(e) => setForm({ activeTimeStart: e.target.value })}
                  className="w-full border rounded-md px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Bis</label>
                <input
                  type="time"
                  value={form.activeTimeEnd}
                  onChange={(e) => setForm({ activeTimeEnd: e.target.value })}
                  className="w-full border rounded-md px-3 py-2"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm mt-3">
              <input
                type="checkbox"
                checked={form.autoNotifyOnStart}
                onChange={(e) => setForm({ autoNotifyOnStart: e.target.checked })}
              />
              Automatisch E-Mail/Push beim Start der Happy Hour (Cron)
            </label>
          </>
        )}
      </div>
    </div>
  );
}

export function PromotionCampaignFields({
  form,
  setForm,
}: {
  form: ScheduleCampaignFormSlice;
  setForm: (patch: Partial<ScheduleCampaignFormSlice>) => void;
}) {
  return (
    <div className="border rounded-lg p-4 bg-blue-50/50 space-y-4">
      <div className="font-semibold text-blue-900">Marketing-Kampagne</div>

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Mail className="h-4 w-4" />
          <input
            type="checkbox"
            checked={form.emailCampaignEnabled}
            onChange={(e) => setForm({ emailCampaignEnabled: e.target.checked })}
          />
          E-Mail-Kampagne
        </label>
        {form.emailCampaignEnabled && (
          <>
            <input
              placeholder="Betreff"
              value={form.emailSubject}
              onChange={(e) => setForm({ emailSubject: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <textarea
              rows={5}
              placeholder="HTML-Inhalt (leer = automatische Vorlage)"
              value={form.emailBodyHtml}
              onChange={(e) => setForm({ emailBodyHtml: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm font-mono"
            />
          </>
        )}
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Bell className="h-4 w-4" />
          <input
            type="checkbox"
            checked={form.pushCampaignEnabled}
            onChange={(e) => setForm({ pushCampaignEnabled: e.target.checked })}
          />
          Push-Kampagne (App)
        </label>
        {form.pushCampaignEnabled && (
          <>
            <input
              placeholder="Push-Titel"
              value={form.pushTitle}
              onChange={(e) => setForm({ pushTitle: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <textarea
              rows={2}
              placeholder="Push-Text"
              value={form.pushBody}
              onChange={(e) => setForm({ pushBody: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </>
        )}
      </div>
    </div>
  );
}

export function PromotionCampaignActions({ promotionId }: { promotionId: string }) {
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [recipientText, setRecipientText] = useState('');
  const [recipientFileName, setRecipientFileName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<Array<{ email: string; error: string }>>([]);

  const parsedRecipients = useMemo(() => parseEmailRecipients(recipientText), [recipientText]);
  const hasManualRecipients = recipientText.trim().length > 0 || Boolean(recipientFileName);
  const emailRecipientCount = hasManualRecipients
    ? parsedRecipients.recipients.length
    : preview?.emailRecipients ?? 0;
  const emailSendDisabled =
    !!sending ||
    !preview?.emailConfigured ||
    emailRecipientCount === 0 ||
    (hasManualRecipients && parsedRecipients.recipients.length === 0);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getPromotionCampaignPreview(promotionId)
      .then((res) => {
        if (res.success) setPreview(res.preview);
        else setError(res.error || 'Kampagne konnte nicht geladen werden');
      })
      .catch(() => setError('Kampagne konnte nicht geladen werden (MongoDB / Login)'))
      .finally(() => setLoading(false));
  }, [promotionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRecipientFile = async (file?: File) => {
    if (!file) return;
    if (file.size > EMAIL_FILE_MAX_BYTES) {
      setError('Datei ist zu groß (max. 5 MB)');
      return;
    }

    setError(null);
    setMessage(null);
    try {
      const text = await readRecipientFile(file);
      setRecipientText(text);
      setRecipientFileName(file.name);
    } catch {
      setError('E-Mail-Datei konnte nicht gelesen werden');
    }
  };

  const clearManualRecipients = () => {
    setRecipientText('');
    setRecipientFileName(null);
  };

  const send = async (channel: 'email' | 'push' | 'both', opts?: { testEmail?: string }) => {
    const massEmail = !opts?.testEmail && (channel === 'email' || channel === 'both');

    if (massEmail) {
      if (hasManualRecipients && parsedRecipients.recipients.length === 0) {
        setError('Keine gültigen E-Mail-Adressen im Upload');
        return;
      }
      if (emailRecipientCount === 0) {
        setError('Keine E-Mail-Empfänger vorhanden');
        return;
      }
      if (!window.confirm(`E-Mail an ${emailRecipientCount} Empfänger senden?`)) {
        return;
      }
    }

    setSending(channel);
    setError(null);
    setMessage(null);
    setFailures([]);
    try {
      const res = await sendPromotionCampaign(
        promotionId,
        channel,
        opts?.testEmail,
        massEmail && hasManualRecipients ? parsedRecipients.recipients : undefined
      );
      if (res.success) {
        const emailResult = res.results?.email;
        const ignored =
          emailResult?.invalidCount || emailResult?.duplicateCount
            ? ` · ${emailResult.invalidCount || 0} ungültig, ${emailResult.duplicateCount || 0} doppelt ignoriert`
            : '';
        const emailReport = emailResult
          ? `E-Mail: ${emailResult.successCount ?? 0} gesendet, ${emailResult.failureCount ?? 0} fehlgeschlagen (von ${emailResult.recipientCount ?? 0})${ignored}`
          : '';
        setMessage(
          channel === 'email'
            ? emailReport
            : channel === 'push'
              ? `Push: ${res.results?.push?.successCount ?? 0} gesendet`
              : `${emailReport} · Push: ${res.results?.push?.successCount ?? 0} gesendet`
        );
        setFailures(Array.isArray(emailResult?.errors) ? emailResult.errors : []);
        load();
      } else setError(res.error || 'Fehler');
    } catch {
      setError('Senden fehlgeschlagen');
    } finally {
      setSending(null);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Kampagne laden…</p>;

  return (
    <div className="border rounded-lg p-4 bg-white space-y-4">
      <div className="font-semibold flex items-center gap-2">
        <Send className="h-4 w-4" />
        Versand
      </div>
      {preview && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            E-Mail-Empfänger: <strong>{emailRecipientCount}</strong>
            {!preview.emailConfigured && (
              <span className="block text-red-600 text-xs">SMTP nicht konfiguriert</span>
            )}
            {hasManualRecipients && (
              <span className="block text-gray-500 text-xs">Upload-Liste aktiv</span>
            )}
          </div>
          <div>
            Push-Geräte: <strong>{preview.pushDevices}</strong>
            {!preview.pushConfigured && (
              <span className="block text-red-600 text-xs">FCM_SERVER_KEY fehlt</span>
            )}
          </div>
        </div>
      )}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {message && <div className="text-sm text-green-700">{message}</div>}
      {failures.length > 0 && (
        <div className="text-xs text-red-600 space-y-1 max-h-32 overflow-y-auto rounded border border-red-200 bg-red-50 p-2">
          <div className="font-medium">Fehlgeschlagene Adressen ({failures.length})</div>
          {failures.map((f) => (
            <div key={f.email}>
              {f.email} — {f.error}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={emailSendDisabled}
          onClick={() => send('email')}
          className="px-3 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50 flex items-center gap-1"
        >
          {sending === 'email' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          E-Mail senden
        </button>
        <button
          type="button"
          disabled={!!sending || !preview?.pushConfigured}
          onClick={() => send('push')}
          className="px-3 py-2 bg-indigo-600 text-white rounded text-sm disabled:opacity-50 flex items-center gap-1"
        >
          {sending === 'push' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
          Push senden
        </button>
        <button
          type="button"
          disabled={emailSendDisabled || !preview?.pushConfigured}
          onClick={() => send('both')}
          className="px-3 py-2 border rounded text-sm disabled:opacity-50"
        >
          Beides senden
        </button>
      </div>
      <div className="space-y-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="campaign-email-upload"
            className="px-3 py-2 border rounded text-sm cursor-pointer flex items-center gap-1 bg-white"
          >
            <Upload className="h-4 w-4" />
            E-Mails hochladen
          </label>
          <input
            id="campaign-email-upload"
            type="file"
            accept=".csv,.txt,.xlsx,.xls,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              handleRecipientFile(e.target.files?.[0]);
              e.currentTarget.value = '';
            }}
          />
          {hasManualRecipients && (
            <button
              type="button"
              onClick={clearManualRecipients}
              className="px-3 py-2 border rounded text-sm flex items-center gap-1"
            >
              <XCircle className="h-4 w-4" />
              Liste leeren
            </button>
          )}
          {recipientFileName && <span className="text-xs text-gray-500">{recipientFileName}</span>}
        </div>
        <textarea
          rows={3}
          value={recipientText}
          onChange={(e) => {
            setRecipientText(e.target.value);
            setRecipientFileName(null);
          }}
          placeholder="E-Mails einfügen: eine pro Zeile, per Komma oder Semikolon getrennt"
          className="w-full border rounded px-2 py-2 text-sm"
        />
        <div className="text-xs text-gray-600">
          {hasManualRecipients
            ? `${parsedRecipients.recipients.length} gültig · ${parsedRecipients.invalidEntries.length} ungültig · ${parsedRecipients.duplicateCount} doppelt`
            : 'Ohne Upload werden die E-Mail-Adressen aus Bestellungen verwendet.'}
          {parsedRecipients.truncated && ' · Limit 5000 erreicht'}
        </div>
        {parsedRecipients.recipients.length > 0 && (
          <div className="flex flex-wrap gap-1 text-xs">
            {parsedRecipients.recipients.slice(0, 12).map((email) => (
              <span key={email} className="rounded border bg-gray-50 px-2 py-1">
                {email}
              </span>
            ))}
          </div>
        )}
        {parsedRecipients.invalidEntries.length > 0 && (
          <div className="text-xs text-red-600">
            Ungültig: {parsedRecipients.invalidEntries.slice(0, 5).join(', ')}
          </div>
        )}
      </div>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Test-E-Mail</label>
          <input
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="test@example.com"
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
        <button
          type="button"
          disabled={!!sending || !preview?.emailConfigured || !testEmail.trim()}
          onClick={() => send('email', { testEmail: testEmail.trim() })}
          className="px-3 py-1 border rounded text-sm"
        >
          Test
        </button>
      </div>
      {preview?.logs?.length > 0 && (
        <div className="text-xs text-gray-600 space-y-1 max-h-32 overflow-y-auto">
          <div className="font-medium">Letzte Sendungen</div>
          {preview.logs.map((l: any) => (
            <div key={l.id}>
              {new Date(l.createdAt).toLocaleString('de-DE')} · {l.channel} · OK {l.successCount}/
              {l.recipientCount}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
