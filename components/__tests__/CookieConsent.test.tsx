import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

import CookieConsent from '../CookieConsent';
import {
  CONSENT_SETTINGS_EVENT,
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  resetConsentCacheForTests,
} from '../../lib/consent';

const originalLocal = Object.getOwnPropertyDescriptor(window, 'localStorage');

/** iOS mit «Alle Cookies blockieren»: schon der Property-Zugriff wirft. */
function blockStorage() {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
}

function storeDecision(analytics: boolean, marketing: boolean) {
  window.localStorage.setItem(
    CONSENT_STORAGE_KEY,
    JSON.stringify({ version: CONSENT_VERSION, analytics, marketing, decidedAt: '' })
  );
}

function storedDecision() {
  return JSON.parse(window.localStorage.getItem(CONSENT_STORAGE_KEY) as string);
}

afterEach(() => {
  if (originalLocal) Object.defineProperty(window, 'localStorage', originalLocal);
  window.localStorage.clear();
  resetConsentCacheForTests();
});

describe('CookieConsent', () => {
  it('zeigt den Banner, solange keine Entscheidung gespeichert ist', () => {
    render(<CookieConsent />);
    expect(screen.getByText('Alle akzeptieren')).toBeInTheDocument();
  });

  it('bleibt verborgen, wenn bereits entschieden wurde', () => {
    storeDecision(true, true);
    render(<CookieConsent />);
    expect(screen.queryByText('Alle akzeptieren')).not.toBeInTheDocument();
  });

  // Der alte Banner nannte weder Werbung noch Meta/TikTok/Google Ads — als
  // informierte Einwilligung fürs Marketing taugt er nicht, also neu fragen.
  it('fragt erneut, wenn nur die Alt-Einwilligung "accepted" vorliegt', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'accepted');
    render(<CookieConsent />);
    expect(screen.getByText('Alle akzeptieren')).toBeInTheDocument();
  });

  it('speichert die Zustimmung für alle Kategorien', async () => {
    render(<CookieConsent />);
    await userEvent.click(screen.getByText('Alle akzeptieren'));

    expect(storedDecision()).toMatchObject({ analytics: true, marketing: true });
    expect(screen.queryByText('Alle akzeptieren')).not.toBeInTheDocument();
  });

  it('speichert die Ablehnung für alle Kategorien', async () => {
    render(<CookieConsent />);
    await userEvent.click(screen.getByText('Alle ablehnen'));

    expect(storedDecision()).toMatchObject({ analytics: false, marketing: false });
    expect(screen.queryByText('Alle ablehnen')).not.toBeInTheDocument();
  });

  it('startet mit deaktivierten Kategorien — kein pre-ticked Consent', async () => {
    render(<CookieConsent />);
    await userEvent.click(screen.getByText('Einstellungen'));

    expect(screen.getByRole('checkbox', { name: /Statistik/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Marketing/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Notwendig/ })).toBeDisabled();
  });

  it('speichert eine granulare Auswahl', async () => {
    render(<CookieConsent />);
    await userEvent.click(screen.getByText('Einstellungen'));
    await userEvent.click(screen.getByRole('checkbox', { name: /Statistik/ }));
    await userEvent.click(screen.getByText('Auswahl speichern'));

    expect(storedDecision()).toMatchObject({ analytics: true, marketing: false });
  });

  it('lässt sich über den Footer erneut öffnen — mit gespeicherter Auswahl', async () => {
    storeDecision(true, false);
    render(<CookieConsent />);
    expect(screen.queryByText('Alle akzeptieren')).not.toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event(CONSENT_SETTINGS_EVENT));
    });

    expect(await screen.findByText('Alle akzeptieren')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Statistik/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Marketing/ })).not.toBeChecked();
  });

  // Regression: vorher warf window.localStorage.setItem VOR setVisible(false).
  // Auf dem iPhone mit blockierten Cookies ließ sich der Banner dadurch nie
  // schließen — er klebt `fixed bottom-0` über der Speisekarte.
  it('schließt sich auch bei blockiertem localStorage', async () => {
    blockStorage();
    render(<CookieConsent />);

    expect(screen.getByText('Alle akzeptieren')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Alle akzeptieren'));

    expect(screen.queryByText('Alle akzeptieren')).not.toBeInTheDocument();
  });
});
