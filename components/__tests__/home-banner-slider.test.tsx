import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

import { HomeBannerSlider } from '../home-banner-slider';

const BANNERS = [
  {
    _id: 'b1',
    title: '2+1 auf alle Pizzen',
    subtitle: 'Jeden Montag und Dienstag.',
    image: '/images/a.png',
    linkUrl: '/angebote',
    badgeText: 'NEU',
  },
  {
    _id: 'b2',
    title: 'Getränk GRATIS',
    subtitle: null,
    image: '/images/b.png',
    linkUrl: null,
    badgeText: null,
  },
];

function mockBanners(banners: unknown[]) {
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ success: true, banners }),
  }) as any;
}

beforeEach(() => {
  // jsdom kennt matchMedia nicht — der Slider fragt prefers-reduced-motion ab.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as any;
});

describe('HomeBannerSlider', () => {
  it('rendert jeden Banner als Slide', async () => {
    mockBanners(BANNERS);
    render(<HomeBannerSlider />);

    await waitFor(() => {
      expect(screen.getByText('2+1 auf alle Pizzen')).toBeInTheDocument();
    });
    expect(screen.getByText('Getränk GRATIS')).toBeInTheDocument();
    expect(screen.getAllByRole('group')).toHaveLength(2);
  });

  it('lädt nur den ersten Slide eager — er ist der LCP-Kandidat', async () => {
    mockBanners(BANNERS);
    const { container } = render(<HomeBannerSlider />);

    await waitFor(() => {
      expect(container.querySelectorAll('img')).toHaveLength(2);
    });
    const images = Array.from(container.querySelectorAll('img'));
    expect(images[0]).toHaveAttribute('loading', 'eager');
    expect(images[1]).toHaveAttribute('loading', 'lazy');
    // lowercase — React 18 reicht camelCase `fetchPriority` nicht ans DOM durch
    expect(images[0]).toHaveAttribute('fetchpriority', 'high');
    expect(images[1]).toHaveAttribute('fetchpriority', 'auto');
  });

  it('verlinkt nur Banner mit linkUrl', async () => {
    mockBanners(BANNERS);
    const { container } = render(<HomeBannerSlider />);

    await waitFor(() => {
      expect(screen.getByText('2+1 auf alle Pizzen')).toBeInTheDocument();
    });
    const links = Array.from(container.querySelectorAll('a'));
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/angebote');
  });

  it('blendet die Sektion ohne Banner komplett aus', async () => {
    mockBanners([]);
    const { container } = render(<HomeBannerSlider />);

    await waitFor(() => {
      expect(container.querySelector('section')).toBeNull();
    });
  });

  // Regression: iOS < 14 kennt MediaQueryList.addEventListener nicht, dort gibt es
  // nur das alte addListener. Der Slider rief ungeprüft addEventListener auf →
  // TypeError im Effect → React hängt den ganzen Baum ab → «Application error:
  // a client-side exception» statt Startseite. Desktop war nie betroffen, also sah
  // es exakt wie «lädt nur am PC, nicht am Handy» aus.
  // Der Mock oben in beforeEach hatte addEventListener — deshalb blieb das unentdeckt.
  it('läuft auf altem iOS ohne MediaQueryList.addEventListener weiter', async () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addListener,
      removeListener,
      // kein addEventListener/removeEventListener — genau die iOS-13-Form
    }) as any;
    mockBanners(BANNERS);

    const { container, unmount } = render(<HomeBannerSlider />);

    await waitFor(() => {
      expect(screen.getByText('2+1 auf alle Pizzen')).toBeInTheDocument();
    });
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(2);
    expect(addListener).toHaveBeenCalled();

    unmount();
    expect(removeListener).toHaveBeenCalled();
  });

  it('bricht bei kaputter API nicht — Sektion verschwindet still', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('500')) as any;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<HomeBannerSlider />);

    await waitFor(() => {
      expect(container.querySelector('section')).toBeNull();
    });
    spy.mockRestore();
  });
});
