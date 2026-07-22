import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  consentBootstrapScript,
  pageReloader,
  readConsent,
  resetConsentCacheForTests,
  subscribeConsent,
  writeConsent,
} from '../consent';

const realReload = pageReloader.reload;

beforeEach(() => {
  // jsdom kennt keine Navigation — Reload wird für alle Tests gestubbt.
  pageReloader.reload = vi.fn();
});

afterEach(() => {
  pageReloader.reload = realReload;
  window.localStorage.clear();
  resetConsentCacheForTests();
  delete (window as any).gtag;
  delete (window as any).fbq;
  delete (window as any).ttq;
});

describe('consentBootstrapScript', () => {
  it('setzt alle vier Consent-Mode-v2-Signale auf denied', () => {
    const script = consentBootstrapScript();

    for (const key of ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage']) {
      expect(script).toMatch(new RegExp(`${key}: 'denied'`));
    }
    expect(script).toContain('wait_for_update');
  });

  it('liest die gespeicherte Entscheidung unter demselben Key wie readConsent', () => {
    expect(consentBootstrapScript()).toContain(`getItem('${CONSENT_STORAGE_KEY}')`);
    expect(consentBootstrapScript()).toContain(`saved.version === ${CONSENT_VERSION}`);
  });

  // Ohne try/catch reißt das Skript auf einem iPhone mit blockierten Cookies
  // die ganze Seite mit — der Zugriff auf localStorage wirft dort.
  it('kapselt den Storage-Zugriff in try/catch', () => {
    const script = consentBootstrapScript();
    expect(script.indexOf('try {')).toBeLessThan(script.indexOf('localStorage'));
    expect(script).toContain('catch');
  });
});

describe('readConsent', () => {
  it('gibt null zurück, wenn nichts gespeichert ist', () => {
    expect(readConsent()).toBeNull();
  });

  it('verwirft eine Entscheidung mit veralteter Version', () => {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ version: CONSENT_VERSION - 1, analytics: true, marketing: true })
    );
    expect(readConsent()).toBeNull();
  });

  it('verwirft die Alt-Werte "accepted" / "declined"', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'accepted');
    expect(readConsent()).toBeNull();
  });
});

describe('writeConsent', () => {
  beforeEach(() => {
    (window as any).gtag = vi.fn();
  });

  it('meldet die Zustimmung als Consent-Mode-Update an gtag', () => {
    writeConsent({ analytics: true, marketing: true });

    expect(window.gtag).toHaveBeenCalledWith('consent', 'update', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      personalization_storage: 'granted',
      analytics_storage: 'granted',
    });
    expect(window.gtag).toHaveBeenCalledWith('set', 'ads_data_redaction', false);
  });

  it('meldet die Ablehnung als denied und hält ad_data_redaction aktiv', () => {
    writeConsent({ analytics: false, marketing: false });

    expect(window.gtag).toHaveBeenCalledWith(
      'consent',
      'update',
      expect.objectContaining({ ad_storage: 'denied', analytics_storage: 'denied' })
    );
    expect(window.gtag).toHaveBeenCalledWith('set', 'ads_data_redaction', true);
  });

  it('widerruft die Einwilligung bei den Pixeln der Vendoren', () => {
    (window as any).fbq = vi.fn();
    (window as any).ttq = { holdConsent: vi.fn(), grantConsent: vi.fn() };

    writeConsent({ analytics: false, marketing: false });

    expect(window.fbq).toHaveBeenCalledWith('consent', 'revoke');
    expect((window as any).ttq.holdConsent).toHaveBeenCalled();
  });

  it('löscht gesetzte Tracking-Cookies beim Widerruf', () => {
    document.cookie = '_fbp=fb.1.123';
    document.cookie = '_ga=GA1.1.456';
    writeConsent({ analytics: true, marketing: true });

    writeConsent({ analytics: false, marketing: false });

    expect(document.cookie).not.toContain('_fbp');
    expect(document.cookie).not.toContain('_ga=');
  });

  // Ohne Reload bleibt das Meta-SDK im Speicher und sammelt weiter (Klicks
  // landen in der Queue), und next/script führt den Pixel-Snippet wegen des
  // LoadCache kein zweites Mal aus.
  it('lädt die Seite neu, wenn eine bestehende Entscheidung geändert wird', () => {
    writeConsent({ analytics: true, marketing: true });
    expect(pageReloader.reload).not.toHaveBeenCalled();

    writeConsent({ analytics: false, marketing: false });
    expect(pageReloader.reload).toHaveBeenCalledTimes(1);
  });

  it('lädt bei der ERSTEN Entscheidung nicht neu', () => {
    writeConsent({ analytics: true, marketing: true });
    expect(pageReloader.reload).not.toHaveBeenCalled();
  });

  it('lädt nicht neu, wenn dieselbe Auswahl erneut gespeichert wird', () => {
    writeConsent({ analytics: true, marketing: false });
    writeConsent({ analytics: true, marketing: false });
    expect(pageReloader.reload).not.toHaveBeenCalled();
  });

  it('benachrichtigt Abonnenten', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConsent(listener);

    writeConsent({ analytics: true, marketing: false });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ analytics: true }));

    unsubscribe();
    writeConsent({ analytics: false, marketing: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
