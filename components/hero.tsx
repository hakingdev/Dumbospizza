"use client";

import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { ArrowRight, Clock, Truck, Star } from 'lucide-react';
import { useLanguage } from '../lib/contexts/LanguageContext';
import { loadTranslation } from '../lib/i18n';
import { MatchdayComboBuilder } from './matchday-combo-builder';

export function Hero() {
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string, d?: string) => d ?? k);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };
    loadTranslations();
  }, [language]);

  const isDe = language === 'de';

  return (
    <section className="relative overflow-hidden">
      <div className="container mx-auto px-0 md:px-4 md:py-10">
        <div
          className="relative overflow-hidden md:rounded-[28px] shadow-2xl"
          style={{
            background:
              'radial-gradient(120% 140% at 85% 10%, rgba(212,42,71,.55) 0%, rgba(212,42,71,0) 55%), linear-gradient(135deg, #b8956b 0%, #7c6145 60%, #4a3826 100%)',
          }}
        >
          {/* faint pitch markings */}
          <svg
            className="pointer-events-none absolute inset-0 hidden h-full w-full opacity-50 lg:block"
            viewBox="0 0 1180 600"
            preserveAspectRatio="none"
            fill="none"
            aria-hidden="true"
          >
            <line x1="590" y1="0" x2="590" y2="600" stroke="white" strokeWidth="2" />
            <rect x="0" y="180" width="120" height="240" stroke="white" strokeWidth="2" />
            <rect x="1060" y="180" width="120" height="240" stroke="white" strokeWidth="2" />
            <rect x="0" y="250" width="46" height="100" stroke="white" strokeWidth="2" />
            <rect x="1134" y="250" width="46" height="100" stroke="white" strokeWidth="2" />
          </svg>
          {/* grain */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage:
                'radial-gradient(rgba(255,255,255,.7) 1px, transparent 1px)',
              backgroundSize: '4px 4px',
            }}
            aria-hidden="true"
          />

          <div className="relative grid grid-cols-1 lg:min-h-[600px] lg:grid-cols-[1.05fr_0.95fr]">
            {/* RIGHT (story) — first on mobile, second on desktop */}
            <div className="relative order-1 flex flex-col items-center justify-center px-6 py-10 md:px-10 md:py-12 lg:order-2 lg:px-11">
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(0,0,0,.04), rgba(0,0,0,.22))',
                }}
                aria-hidden="true"
              />
              <div className="relative z-10 text-center">
                {/* emblem */}
                <div className="relative mx-auto mb-4 h-[250px] w-full max-w-[320px] md:mb-[18px] md:h-[296px] md:max-w-[380px]">
                  <div className="absolute left-1/2 top-1.5 h-[190px] w-[190px] -translate-x-1/2 rounded-full border-2 border-white/30 md:h-[230px] md:w-[230px]" />
                  <Image
                    className="absolute bottom-3.5 left-1.5 w-[60%] max-w-[196px] -rotate-[9deg] md:w-[232px] md:max-w-none"
                    style={{ filter: 'drop-shadow(0 18px 26px rgba(0,0,0,.4))' }}
                    src="/images/pizza-format.png"
                    width={840}
                    height={640}
                    alt="Pizza 30 × 40 cm"
                    priority
                  />
                  <motion.img
                    className="absolute right-1 top-1.5 w-[46%] max-w-[148px] md:w-[176px] md:max-w-none"
                    style={{ filter: 'drop-shadow(0 16px 24px rgba(0,0,0,.42))' }}
                    src="/images/soccer-ball.png"
                    alt="Fußball WM 2026"
                    animate={{ y: [0, -12, 0] }}
                    transition={{ duration: 5, ease: 'easeInOut', repeat: Infinity }}
                  />
                  <span className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-[13px] font-extrabold text-gray-900 shadow-lg sm:left-6" translate="no">
                    🍕 <b className="text-secondary-600">30×40</b> · Ø33 cm
                  </span>
                </div>

                {/* story card */}
                <div className="mx-auto mt-[18px] w-full max-w-[360px] rounded-2xl bg-white/95 p-6 text-left text-gray-800 shadow-xl">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-primary-100 px-[11px] py-[5px] text-xs font-bold text-primary-800">
                      11. Juni – 19. Juli 2026
                    </span>
                    <span className="rounded-full bg-secondary-100 px-[11px] py-[5px] text-xs font-bold text-secondary-700">
                      48 Teams · 104 Spiele
                    </span>
                  </div>
                  <h3 className="mb-2 text-xl font-extrabold text-gray-900">
                    {isDe
                      ? 'Hol dir das Stadiongefühl nach Hause'
                      : t('hero.story_title', 'Hol dir das Stadiongefühl nach Hause')}
                  </h3>
                  <p className="text-[14.5px] leading-relaxed text-gray-600">
                    {isDe
                      ? 'Die größte WM aller Zeiten kommt nach Nordamerika — und jedes Spiel schmeckt besser mit frischer Pizza und kaltem Bier vom Lieblings-Italiener in Bad Kissingen. Freunde einladen, Kombi bestellen, anfeuern. ⚽🍕'
                      : t(
                          'hero.story_text',
                          'Die größte WM kommt nach Nordamerika — und jedes Spiel schmeckt besser mit frischer Pizza und kaltem Bier. ⚽🍕'
                        )}
                  </p>
                  <div className="mt-3 text-[22px] tracking-[2px]">🇺🇸 🇨🇦 🇲🇽</div>
                </div>
              </div>
            </div>

            {/* LEFT — combo offer */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4 }}
              className="order-2 flex flex-col justify-center px-6 py-10 text-white md:px-10 md:py-14 lg:order-1 lg:px-12"
            >
              <span className="mb-5 inline-flex max-w-full items-center gap-2 self-start whitespace-nowrap rounded-full bg-yellow-400 px-3 py-2 text-xs font-bold tracking-[.02em] text-yellow-900 shadow-md sm:px-4 sm:text-sm">
                <span className="sm:hidden">
                  ⚽ {isDe ? 'WM 2026 · Aktion' : t('hero.kicker_short', 'WM 2026 · Aktion')}
                </span>
                <span className="hidden sm:inline">
                  ⚽ {isDe ? 'Fußball-WM 2026 · Anpfiff-Aktion' : t('hero.kicker', 'Fußball-WM 2026 · Anpfiff-Aktion')}
                </span>
              </span>

              <h1 className="mb-4 text-[34px] font-extrabold leading-[1.04] tracking-[-.02em] sm:text-[38px] md:text-[48px] lg:text-[56px]">
                {isDe ? (
                  <>
                    Matchday-Kombi
                    <br />
                    <span className="bg-gradient-to-r from-pink-200 to-rose-300 bg-clip-text text-transparent">
                      für die ganze Mannschaft
                    </span>
                  </>
                ) : (
                  t('hero.title', 'Matchday-Kombi für die ganze Mannschaft')
                )}
              </h1>

              <p className="mb-7 max-w-[460px] text-base leading-relaxed text-white/90 md:text-lg">
                {isDe
                  ? 'Stell dir deine Kombi zusammen: zwei Pizzen 30 × 40 cm nach Wahl, dazu Getränke gratis — und beim Anpfiff seid ihr startklar. Frisch geliefert, pünktlich zum Spiel.'
                  : t(
                      'hero.lede',
                      'Stell dir deine Kombi zusammen: zwei Pizzen 30 × 40 cm nach Wahl, dazu Getränke gratis.'
                    )}
              </p>

              {/* interaktiver Kombi-Builder (echte Menüdaten, Preise live) */}
              <MatchdayComboBuilder isDe={isDe} />

              {/* CTA */}
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link
                  href="/menu"
                  className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl border-2 border-white bg-white/10 px-6 py-3.5 text-base font-bold text-white transition-all hover:bg-white/20 sm:w-auto"
                >
                  {isDe ? 'Ganzes Menü ansehen' : t('hero.cta_menu', 'Ganzes Menü ansehen')}
                  <ArrowRight className="h-[18px] w-[18px] shrink-0" />
                </Link>
              </div>

              {/* trust */}
              <div className="mt-6 flex flex-wrap gap-x-[22px] gap-y-3.5 text-sm text-white/85">
                <span className="inline-flex items-center gap-[7px]">
                  <Clock className="h-4 w-4" /> {isDe ? '30–60 Min. Lieferung' : t('hero.trust_time', '30–60 Min. Lieferung')}
                </span>
                <span className="inline-flex items-center gap-[7px]">
                  <Truck className="h-4 w-4" /> {isDe ? 'Gratis ab 30 €' : t('hero.trust_free', 'Gratis ab 30 €')}
                </span>
                <span className="inline-flex items-center gap-[7px]">
                  <Star className="h-4 w-4" /> {isDe ? '4,8 Bewertung' : t('hero.trust_rating', '4,8 Bewertung')}
                </span>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
