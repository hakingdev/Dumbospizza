import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

import CookieConsent from '../CookieConsent';

const STORAGE_KEY = 'cookie-consent';
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

afterEach(() => {
  if (originalLocal) Object.defineProperty(window, 'localStorage', originalLocal);
  window.localStorage.clear();
});

describe('CookieConsent', () => {
  it('zeigt den Banner, solange keine Entscheidung gespeichert ist', () => {
    render(<CookieConsent />);
    expect(screen.getByText('Alle akzeptieren')).toBeInTheDocument();
  });

  it('bleibt verborgen, wenn bereits entschieden wurde', () => {
    window.localStorage.setItem(STORAGE_KEY, 'accepted');
    render(<CookieConsent />);
    expect(screen.queryByText('Alle akzeptieren')).not.toBeInTheDocument();
  });

  it('speichert die Zustimmung und schließt den Banner', async () => {
    render(<CookieConsent />);
    await userEvent.click(screen.getByText('Alle akzeptieren'));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('accepted');
    expect(screen.queryByText('Alle akzeptieren')).not.toBeInTheDocument();
  });

  it('speichert die Ablehnung und schließt den Banner', async () => {
    render(<CookieConsent />);
    await userEvent.click(screen.getByText('Ablehnen'));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('declined');
    expect(screen.queryByText('Ablehnen')).not.toBeInTheDocument();
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
