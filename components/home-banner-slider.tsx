"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SafeImage } from './SafeImage';

export interface HomeBanner {
  _id: string;
  title: string;
  subtitle: string | null;
  image: string;
  linkUrl: string | null;
  badgeText: string | null;
}

const AUTOPLAY_DELAY_MS = 6000;

/** Карточка баннера. Первая грузится eager — она попадает в LCP. */
function BannerCard({ banner, isFirst }: { banner: HomeBanner; isFirst: boolean }) {
  const content = (
    <>
      <SafeImage
        src={banner.image}
        alt={banner.title}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        loading={isFirst ? 'eager' : 'lazy'}
        // React 18 mappt camelCase `fetchPriority` nicht auf das DOM-Attribut —
        // lowercase, sonst landet die Priorität gar nicht im HTML.
        {...({ fetchpriority: isFirst ? 'high' : 'auto' } as any)}
      />
      {/* затемнение снизу — чтобы текст читался на любой картинке */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent"
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 bottom-0 p-4 text-white sm:p-6">
        {banner.badgeText && (
          <span className="mb-2 inline-block rounded-full bg-yellow-400 px-3 py-1 text-xs font-bold text-yellow-900">
            {banner.badgeText}
          </span>
        )}
        <h3 className="text-lg font-extrabold leading-tight drop-shadow sm:text-2xl">
          {banner.title}
        </h3>
        {banner.subtitle && (
          <p className="mt-1 line-clamp-2 text-sm text-white/90 sm:text-base">{banner.subtitle}</p>
        )}
      </div>
    </>
  );

  const shell =
    'group relative block h-full w-full overflow-hidden rounded-2xl bg-gray-200 shadow-lg';

  return banner.linkUrl ? (
    <Link href={banner.linkUrl} className={shell}>
      {content}
    </Link>
  ) : (
    <div className={shell}>{content}</div>
  );
}

export function HomeBannerSlider() {
  const [banners, setBanners] = useState<HomeBanner[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [snaps, setSnaps] = useState<number[]>([]);

  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: 'start' }, [
    Autoplay({ delay: AUTOPLAY_DELAY_MS, stopOnInteraction: false, stopOnMouseEnter: true }),
  ]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/banners');
        const data = await res.json();
        if (!cancelled) setBanners(data.success ? data.banners || [] : []);
      } catch (e) {
        console.error('Error loading banners:', e);
        if (!cancelled) setBanners([]);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // точки и активный слайд
  useEffect(() => {
    if (!emblaApi) return;
    const sync = () => {
      setSnaps(emblaApi.scrollSnapList());
      setSelected(emblaApi.selectedScrollSnap());
    };
    sync();
    emblaApi.on('select', sync).on('reInit', sync);
    return () => {
      emblaApi.off('select', sync).off('reInit', sync);
    };
  }, [emblaApi, banners]);

  // уважение к prefers-reduced-motion: автопрокрутка выключается, свайп остаётся
  useEffect(() => {
    if (!emblaApi) return;
    const autoplay: any = emblaApi.plugins()?.autoplay;
    if (!autoplay) return;

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => (mq.matches ? autoplay.stop() : autoplay.play());
    apply();

    // MediaQueryList.addEventListener есть только с Safari 14 / iOS 14; раньше
    // существовал лишь устаревший addListener. На старом iOS прямой вызов бросал
    // «TypeError: mq.addEventListener is not a function» прямо в эффекте — React
    // размонтировал всё дерево, и вместо главной посетитель видел
    // «Application error: a client-side exception». На десктопе метод есть везде,
    // поэтому баг выглядел как «не грузит только с телефона».
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, [emblaApi, banners]);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);
  const scrollTo = useCallback((i: number) => emblaApi?.scrollTo(i), [emblaApi]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        scrollPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        scrollNext();
      }
    },
    [scrollPrev, scrollNext]
  );

  // Пока грузим — держим высоту: баннеры есть почти всегда, и появление
  // ленты после фетча иначе сдвигало бы всё, что ниже (CLS).
  if (banners === null) {
    return (
      <section className="py-6">
        <div className="container mx-auto px-4">
          <div className="aspect-video w-[88%] animate-pulse rounded-2xl bg-gray-200 sm:w-[70%] lg:w-[55%]" />
        </div>
      </section>
    );
  }

  if (banners.length === 0) return null;

  return (
    <section className="py-6">
      <div className="container mx-auto px-4">
        <div
          className="relative"
          role="region"
          aria-roledescription="carousel"
          aria-label="Aktuelle Angebote"
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          <div className="overflow-hidden" ref={emblaRef}>
            <div className="flex gap-4">
              {banners.map((banner, i) => (
                <div
                  key={banner._id}
                  // 16:9 на всех брейкпоинтах — ровно в том формате, в котором
                  // баннеры и рисуются (1600×900). Раньше слайд был 3:2 на
                  // мобильном и 2:1 от sm: object-cover подгонял картинку под
                  // чужую пропорцию и срезал по 7.8% слева и справа — вместе с
                  // вёрстанным в макет заголовком («AB 25 €» терял начало).
                  className="aspect-video min-w-0 flex-[0_0_88%] sm:flex-[0_0_70%] lg:flex-[0_0_55%]"
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${i + 1} von ${banners.length}`}
                >
                  <BannerCard banner={banner} isFirst={i === 0} />
                </div>
              ))}
            </div>
          </div>

          {/* стрелки — только там, где есть мышь; на тач-устройствах свайп */}
          {banners.length > 1 && (
            <>
              <button
                type="button"
                onClick={scrollPrev}
                aria-label="Vorheriges Angebot"
                className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/90 p-2 shadow-lg transition hover:bg-white lg:block"
              >
                <ChevronLeft className="h-5 w-5 text-gray-800" />
              </button>
              <button
                type="button"
                onClick={scrollNext}
                aria-label="Nächstes Angebot"
                className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/90 p-2 shadow-lg transition hover:bg-white lg:block"
              >
                <ChevronRight className="h-5 w-5 text-gray-800" />
              </button>
            </>
          )}
        </div>

        {snaps.length > 1 && (
          <div className="mt-4 flex justify-center gap-2">
            {snaps.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => scrollTo(i)}
                aria-label={`Zu Angebot ${i + 1}`}
                aria-current={i === selected}
                className={`h-2 rounded-full transition-all ${
                  i === selected ? 'w-6 bg-primary-600' : 'w-2 bg-gray-300 hover:bg-gray-400'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
