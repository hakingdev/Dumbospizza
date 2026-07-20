"use client";

import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { ArrowRight, Clock, Truck, Star } from 'lucide-react';
import { useLanguage } from '../lib/contexts/LanguageContext';
import { loadTranslation } from '../lib/i18n';

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

  return (
    <section className="relative overflow-hidden">
      <div className="container mx-auto px-0 md:px-4 md:py-10">
        <div
          className="relative overflow-hidden shadow-2xl md:rounded-[28px]"
          style={{
            background:
              'radial-gradient(120% 140% at 85% 10%, rgba(212,42,71,.55) 0%, rgba(212,42,71,0) 55%), linear-gradient(135deg, #b8956b 0%, #7c6145 60%, #4a3826 100%)',
          }}
        >
          {/* grain */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,.7) 1px, transparent 1px)',
              backgroundSize: '4px 4px',
            }}
            aria-hidden="true"
          />

          <div className="relative grid grid-cols-1 lg:min-h-[520px] lg:grid-cols-[1.05fr_0.95fr]">
            {/* Оффер */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4 }}
              className="order-2 flex flex-col justify-center px-6 py-10 text-white md:px-10 md:py-14 lg:order-1 lg:px-12"
            >
              <span className="mb-5 inline-flex max-w-full items-center gap-2 self-start whitespace-nowrap rounded-full bg-yellow-400 px-3 py-2 text-xs font-bold tracking-[.02em] text-yellow-900 shadow-md sm:px-4 sm:text-sm">
                🍕 {t('hero.badge', 'Beste Pizza in der Stadt')}
              </span>

              <h1 className="mb-4 text-[34px] font-extrabold leading-[1.04] tracking-[-.02em] sm:text-[38px] md:text-[48px] lg:text-[56px]">
                {t('hero.title_line1', 'Leckere Pizza')}
                <br />
                <span className="bg-gradient-to-r from-pink-200 to-rose-300 bg-clip-text text-transparent">
                  {t('hero.title_line2', 'mit Lieferung')}
                </span>
              </h1>

              <p className="mb-7 max-w-[460px] text-base leading-relaxed text-white/90 md:text-lg">
                {t(
                  'hero.subtitle',
                  'Frisch zubereitete Pizza aus hochwertigen Zutaten. Lieferung in 30–60 Minuten, zu Stoßzeiten bis zu 90 Minuten!'
                )}
              </p>

              {/* CTA */}
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link
                  href="/menu"
                  className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-white px-6 py-3.5 text-base font-bold text-primary-700 shadow-xl transition-all hover:bg-gray-100 sm:w-auto"
                >
                  {t('hero.cta_order', 'Jetzt bestellen')}
                  <ArrowRight className="h-[18px] w-[18px] shrink-0" />
                </Link>
                <Link
                  href="/angebote"
                  className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl border-2 border-white bg-white/10 px-6 py-3.5 text-base font-bold text-white transition-all hover:bg-white/20 sm:w-auto"
                >
                  {t('hero.cta_offers', 'Angebote ansehen')}
                </Link>
              </div>

              {/* trust */}
              <div className="mt-6 flex flex-wrap gap-x-[22px] gap-y-3.5 text-sm text-white/85">
                <span className="inline-flex items-center gap-[7px]">
                  <Clock className="h-4 w-4" /> 30–60 {t('hero.minutes', 'Minuten')}
                </span>
                <span className="inline-flex items-center gap-[7px]">
                  <Truck className="h-4 w-4" /> {t('hero.badge_delivery', 'Lieferung')}{' '}
                  {t('hero.free_from', 'ab 30€')}
                </span>
                <span className="inline-flex items-center gap-[7px]">
                  <Star className="h-4 w-4" /> 4,8 {t('hero.rating', 'Bewertung')}
                </span>
              </div>
            </motion.div>

            {/* Картинка */}
            <div className="relative order-1 flex items-center justify-center px-6 py-10 md:px-10 md:py-12 lg:order-2 lg:px-11">
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.04), rgba(0,0,0,.22))' }}
                aria-hidden="true"
              />
              <div className="relative z-10 w-full max-w-[420px]">
                {/* Maße = echte Bildmaße (768×512): eine falsche Ratio reserviert
                    den falschen Platz und verschiebt den Hero beim Laden. */}
                <Image
                  src="/images/pizza-hero.png"
                  width={768}
                  height={512}
                  sizes="(max-width: 1024px) 100vw, 420px"
                  alt={t('hero.image_alt', 'Leckere Pizza mit Lieferung')}
                  className="relative w-full rounded-2xl drop-shadow-[0_18px_26px_rgba(0,0,0,.4)]"
                  priority
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
