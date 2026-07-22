import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  trackGoogleAdsPurchase,
  trackGoogleAdsPreOrderLead,
  trackGoogleAdsPhoneCall,
  GOOGLE_ADS_PHONE_CALL_LABEL,
} from '../google-ads';

afterEach(() => {
  delete (window as any).gtag;
});

/**
 * Hintergrund: Das Kauf-Conversion-Tag feuerte früher bei JEDEM Seitenaufruf
 * (auch auf 404). Im Google-Ads-Konto ergab das 2 000 Fake-Conversions und eine
 * Conversion-Rate von 107,78 % — mehr Conversions als Klicks. Diese Tests
 * halten das korrigierte Verhalten fest.
 */
describe('trackGoogleAdsPurchase', () => {
  it('sendet Wert, Währung und transaction_id', () => {
    const gtag = vi.fn();
    (window as any).gtag = gtag;

    trackGoogleAdsPurchase({ value: 42.5, transactionId: '260623008' });

    expect(gtag).toHaveBeenCalledWith(
      'event',
      'conversion',
      expect.objectContaining({
        value: 42.5,
        currency: 'EUR',
        transaction_id: '260623008',
      })
    );
  });

  it('normalisiert E-Mail und Telefon für Enhanced Conversions', () => {
    const gtag = vi.fn();
    (window as any).gtag = gtag;

    trackGoogleAdsPurchase({
      value: 30,
      transactionId: '1',
      email: '  Max.Mustermann@Example.DE ',
      phone: '0163 2165979',
    });

    expect(gtag).toHaveBeenCalledWith('set', 'user_data', {
      email: 'max.mustermann@example.de',
      phone_number: '+491632165979',
    });
  });

  it('setzt user_data vor der Conversion — sonst ignoriert Google die Daten', () => {
    const calls: string[] = [];
    (window as any).gtag = vi.fn((...args: any[]) => {
      calls.push(String(args[1]));
    });

    trackGoogleAdsPurchase({ value: 30, transactionId: '1', email: 'a@b.de' });

    expect(calls).toEqual(['user_data', 'conversion']);
  });

  it('sendet kein user_data, wenn E-Mail und Telefon fehlen', () => {
    const gtag = vi.fn();
    (window as any).gtag = gtag;

    trackGoogleAdsPurchase({ value: 30, transactionId: '1' });

    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith('event', 'conversion', expect.anything());
  });

  it('überspringt unbrauchbare Telefonnummern, behält aber die E-Mail', () => {
    const gtag = vi.fn();
    (window as any).gtag = gtag;

    trackGoogleAdsPurchase({ value: 30, transactionId: '1', email: 'a@b.de', phone: 'keine' });

    expect(gtag).toHaveBeenCalledWith('set', 'user_data', { email: 'a@b.de' });
  });

  it('tut nichts, wenn das Google-Tag nicht geladen ist', () => {
    expect(() => trackGoogleAdsPurchase({ value: 30, transactionId: '1' })).not.toThrow();
  });
});

describe('trackGoogleAdsPreOrderLead', () => {
  /**
   * Die Vorbestellung ist ein Lead, kein Kauf. Solange in google-ads.ts kein
   * eigenes Lead-Label hinterlegt ist, darf gar nichts gesendet werden — früher
   * lief hier das KAUF-Label und machte aus jeder Anfrage eine Bestellung.
   */
  it('sendet nichts, solange kein eigenes Lead-Label gesetzt ist', () => {
    const gtag = vi.fn();
    (window as any).gtag = gtag;

    trackGoogleAdsPreOrderLead();

    expect(gtag).not.toHaveBeenCalled();
  });
});

describe('trackGoogleAdsPhoneCall', () => {
  /**
   * Hängt an jedem tel:-Link (Header, mobiles Menü, Footer). Zählt Klicks auf
   * die Nummer — der Wert (15 €) ist fest in Google Ads hinterlegt und wird
   * bewusst NICHT aus dem Code geschickt.
   */
  it('sendet die Anruf-Conversion mit eigenem Label', () => {
    const gtag = vi.fn();
    (window as any).gtag = gtag;

    trackGoogleAdsPhoneCall();

    expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
      send_to: GOOGLE_ADS_PHONE_CALL_LABEL,
    });
  });

  it('verwendet nicht das Kauf-Label', () => {
    const gtag = vi.fn();
    (window as any).gtag = gtag;

    trackGoogleAdsPhoneCall();

    const [, , payload] = gtag.mock.calls[0];
    expect(payload.send_to).not.toContain('vRhYCL2izdQcEMrMvLQq');
  });

  it('schickt keinen Wert mit — der Wert liegt in Google Ads', () => {
    const gtag = vi.fn();
    (window as any).gtag = gtag;

    trackGoogleAdsPhoneCall();

    const [, , payload] = gtag.mock.calls[0];
    expect(payload).not.toHaveProperty('value');
  });

  it('tut nichts, wenn das Google-Tag nicht geladen ist', () => {
    expect(() => trackGoogleAdsPhoneCall()).not.toThrow();
  });
});
