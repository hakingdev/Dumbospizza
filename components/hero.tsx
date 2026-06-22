"use client";

import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { ArrowRight, Clock, Truck, Star, Heart, Package } from 'lucide-react';
import { useLanguage } from '../lib/contexts/LanguageContext';
import { loadTranslation } from '../lib/i18n';

export function Hero() {
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };
    loadTranslations();
  }, [language]);

  const isDe = language === 'de';

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-primary-600 to-primary-800">
      <div className="container mx-auto px-4 pt-16 pb-28 md:pb-32 relative z-10">
        <div className="grid md:grid-cols-2 gap-8 md:gap-10 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            className="order-2 md:order-1"
          >
            <div className="inline-flex items-center bg-yellow-400 rounded-full px-4 py-2 mb-4 shadow-sm">
              <Star className="h-4 w-4 text-yellow-800 mr-2 fill-yellow-800" />
              <span className="text-sm font-semibold text-yellow-900">
                {isDe ? 'Beste Pizza in der Stadt' : t('hero.badge', 'Лучшая пицца в городе')}
              </span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold mb-3 leading-tight">
              {isDe ? (
                <>
                  <span className="text-white">Leckere Pizza </span>
                  <span className="bg-gradient-to-r from-pink-200 via-pink-300 to-rose-300 bg-clip-text text-transparent">mit Lieferung</span>
                </>
              ) : (
                t('hero.title', 'Вкусная пицца с доставкой')
              )}
            </h1>

            <p className="text-base md:text-lg mb-5 text-white/95 leading-relaxed max-w-xl">
              {isDe
                ? 'Frisch zubereitet aus den feinsten Zutaten. Perfekt für deinen besonderen Abend!'
                : t('hero.subtitle_valentine', 'Свежеприготовленная из лучших ингредиентов. Идеально для вашего особенного вечера!')}
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <Link
                href="#menu"
                className="inline-flex items-center justify-center bg-white hover:bg-gray-100 text-gray-800 py-3.5 px-6 rounded-xl font-bold text-base shadow-md border border-gray-300 transition-all"
              >
                {isDe ? 'Jetzt bestellen' : t('hero.cta_order', 'Заказать сейчас')}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
              <Link
                href="/menu"
                className="inline-flex items-center justify-center border-2 border-white text-white bg-white/10 py-3.5 px-6 rounded-xl font-bold text-base hover:bg-white/20 transition-all"
              >
                {isDe ? 'Speisekarte ansehen' : t('hero.cta_menu', 'Посмотреть меню')}
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-3 max-w-md">
              <div className="flex items-center gap-2 bg-white/15 rounded-xl px-4 py-3 border border-white/25 backdrop-blur-sm">
                <Clock className="h-5 w-5 text-white" />
                <span className="font-bold text-white">30-60</span>
                {/* <Heart className="h-4 w-4 text-white fill-white" /> */}
                <span className="text-sm text-white">{isDe ? 'Minuten' : t('hero.minutes', 'минут')}</span>
              </div>
              <div className="flex items-center gap-2 bg-white/15 rounded-xl px-4 py-3 border border-white/25 backdrop-blur-sm">
                <Package className="h-5 w-5 text-white" />
                <span className="font-bold text-white">ab 20€</span>
                <span className="text-sm text-white">{isDe ? '' : t('hero.free_from', 'от 20€')}</span>
              </div>
              <div className="flex items-center gap-2 bg-white/15 rounded-xl px-4 py-3 border border-white/25 backdrop-blur-sm">
                {/* <Heart className="h-5 w-5 text-white fill-white" /> */}
                <span className="font-bold text-white">4.8</span>
                <span className="text-sm text-white">{isDe ? 'Bewertung' : t('hero.rating', 'рейтинг')}</span>
              </div>
              <div className="flex items-center gap-2 bg-white/15 rounded-xl px-4 py-3 border border-white/25 backdrop-blur-sm">
                <span className="font-bold text-white">17-21:30</span>
                <span className="text-sm text-white">{isDe ? 'Lieferung' : t('hero.badge_delivery', 'доставка')}</span>
              </div>
            </div>
          </motion.div>

          <motion.div
            className="relative hidden md:flex order-1 md:order-2 items-center justify-center min-h-[320px] md:min-h-[360px]"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <div className="relative w-full min-h-[320px] md:min-h-[360px] max-h-[420px] rounded-2xl overflow-hidden shadow-2xl bg-stone-300">
              <Image
                src="/images/pizza-hero.png"
                alt={isDe ? 'Pizza' : t('hero.image_alt', 'Пицца')}
                fill
                className="object-cover object-center"
                priority
                unoptimized
                sizes="(max-width: 768px) 100vw, 55vw"
              />
              {/* Светло-серый бейдж времени доставки слева внизу */}
              <div className="absolute bottom-4 left-4 bg-gray-300 text-gray-800 rounded-xl px-4 py-2.5 shadow-lg border border-gray-400/50">
                <div className="font-bold text-lg">17-21:30</div>
                <div className="text-xs text-gray-700">{isDe ? 'Lieferung' : t('hero.badge_delivery', 'доставка')}</div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
      {/* Плавная белая волна внизу */}
      <div className="absolute bottom-0 left-0 right-0 w-full pointer-events-none">
        <svg viewBox="0 0 1440 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full block">
          <path
            d="M0 50 C 240 10 480 90 720 50 C 960 10 1200 90 1440 50 L 1440 100 L 0 100 Z"
            fill="white"
          />
        </svg>
      </div>
    </div>
  );
}
