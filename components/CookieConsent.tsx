"use client";

/**
 * Cookie-Banner. Ничего не трекает сам — только записывает решение через
 * lib/consent, а загрузкой тегов занимается components/ConsentScripts.tsx.
 *
 * Требования, которые здесь закодированы:
 *   • «Ablehnen» такой же заметный, как «Alle akzeptieren» (равнозначность
 *     выбора — иначе согласие считается невалидным);
 *   • переключатели категорий по умолчанию ВЫКЛЮЧЕНЫ (никаких pre-ticked);
 *   • вендоры названы поимённо — согласие должно быть информированным;
 *   • баннер переоткрывается из футера (Art. 7 Abs. 3 DSGVO — отзыв так же
 *     легко, как согласие).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CONSENT_SETTINGS_EVENT,
  DENY_ALL,
  GRANT_ALL,
  readConsent,
  writeConsent,
} from '../lib/consent';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    if (!readConsent()) setVisible(true);

    // Переоткрытие из футера: подставляем уже сохранённый выбор.
    const reopen = () => {
      const current = readConsent();
      setAnalytics(current?.analytics ?? false);
      setMarketing(current?.marketing ?? false);
      setShowDetails(true);
      setVisible(true);
    };

    window.addEventListener(CONSENT_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_SETTINGS_EVENT, reopen);
  }, []);

  // Баннер закрываем ВСЕГДА, даже если запись не удалась (заблокированные cookies
  // на iOS): иначе бросок происходил до setVisible(false), и на телефоне плашка
  // намертво висела внизу экрана, перекрывая витрину.
  const decide = (choice: { analytics: boolean; marketing: boolean }) => {
    writeConsent(choice);
    setVisible(false);
    setShowDetails(false);
  };

  if (!visible) return null;

  return (
    /*
      z-[200]: выше промо-модалок (z-[90]/z-[100]) — их backdrop `fixed inset-0`
      перекрывал баннер и глотал клики по «Ablehnen»/«Akzeptieren».
    */
    <div
      role="dialog"
      aria-label="Cookie-Einstellungen"
      className="fixed inset-x-0 bottom-0 z-[200] max-h-[85vh] overflow-y-auto border-t border-gray-200 bg-white shadow-lg"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4">
        <div className="min-w-0 text-sm leading-relaxed text-gray-700">
          Wir verwenden Cookies und ähnliche Technologien. Technisch notwendige Cookies setzen wir
          immer; Statistik- und Marketing-Cookies nur mit Ihrer Einwilligung. Sie können Ihre
          Auswahl jederzeit im Footer unter „Cookie-Einstellungen“ ändern oder widerrufen. Mehr
          Informationen finden Sie in unserer{' '}
          <Link href="/datenschutz" className="text-primary-600 underline">
            Datenschutzerklärung
          </Link>{' '}
          und im{' '}
          <Link href="/impressum" className="text-primary-600 underline">
            Impressum
          </Link>
          .
        </div>

        {showDetails && (
          <div className="flex flex-col gap-3 rounded-md border border-gray-200 bg-gray-50 p-3">
            <ConsentCategory
              title="Notwendig"
              description="Warenkorb, Anmeldung, Spracheinstellung und Sicherheit. Ohne diese Cookies funktioniert die Bestellung nicht."
              checked
              disabled
            />
            <ConsentCategory
              title="Statistik"
              description="Google Analytics — anonymisierte Auswertung, welche Seiten besucht werden."
              checked={analytics}
              onChange={setAnalytics}
            />
            <ConsentCategory
              title="Marketing"
              description="Google Ads, Meta-Pixel (Facebook/Instagram) und TikTok-Pixel — Messung von Werbeerfolg und Remarketing."
              checked={marketing}
              onChange={setMarketing}
            />
          </div>
        )}

        <div className="grid w-full grid-cols-1 items-center gap-2 sm:flex sm:justify-end">
          <button
            type="button"
            onClick={() => setShowDetails((open) => !open)}
            className="inline-flex min-h-[42px] items-center justify-center whitespace-nowrap rounded-md px-4 py-2 text-center text-sm font-medium leading-tight text-gray-700 underline hover:text-gray-900 sm:min-w-[112px]"
          >
            Einstellungen
          </button>
          {showDetails && (
            <button
              type="button"
              onClick={() => decide({ analytics, marketing })}
              className="inline-flex min-h-[42px] items-center justify-center whitespace-nowrap rounded-md border border-gray-300 bg-white px-4 py-2 text-center text-sm font-medium leading-tight text-gray-700 hover:bg-gray-50 sm:min-w-[142px]"
            >
              Auswahl speichern
            </button>
          )}
          {/* Gleichwertig zu „Alle akzeptieren“: gleiche Größe, gleicher Kontrast. */}
          <button
            type="button"
            onClick={() => decide(DENY_ALL)}
            className="inline-flex min-h-[42px] items-center justify-center whitespace-nowrap rounded-md bg-gray-700 px-4 py-2 text-center text-sm font-medium leading-tight text-white hover:bg-gray-800 sm:min-w-[142px]"
          >
            Alle ablehnen
          </button>
          <button
            type="button"
            onClick={() => decide(GRANT_ALL)}
            className="inline-flex min-h-[42px] items-center justify-center whitespace-nowrap rounded-md bg-primary-600 px-4 py-2 text-center text-sm font-medium leading-tight text-white hover:bg-primary-700 sm:min-w-[142px]"
          >
            Alle akzeptieren
          </button>
        </div>
      </div>
    </div>
  );
}

function ConsentCategory({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-primary-600 disabled:opacity-60"
      />
      <span className="min-w-0">
        <span className="font-medium text-gray-900">
          {title}
          {disabled && <span className="ml-1 font-normal text-gray-500">(immer aktiv)</span>}
        </span>
        <span className="block text-gray-600">{description}</span>
      </span>
    </label>
  );
}
