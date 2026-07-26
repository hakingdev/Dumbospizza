"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ProductCard } from '../../../components/product-card';
import { useLanguage } from '../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../lib/i18n';
import {
  countBySubcategory,
  groupBySubcategory,
  readSubcategories,
  type Subcategory,
} from '../../../lib/categories/subcategories';
import SubcategoryFilter from '../../../components/SubcategoryFilter';

/**
 * Speisekarte: gruppiert nach Kategorie mit klebriger Kategorie-Leiste + Scroll-Spy.
 * Kein Backend-Change nötig — /api/products liefert je Produkt die populierte
 * Kategorie ({ name, slug, order, subcategories }), daraus bauen wir Reihenfolge,
 * Gruppen und — innerhalb einer Kategorie — die Unterkategorie-Blöcke.
 */

interface CategoryRef {
  _id?: string;
  id?: string;
  name?: string;
  slug?: string;
  order?: number;
  subcategories?: Subcategory[];
}

interface ApiProduct {
  _id: string;
  name: string;
  description: string;
  basePrice: number;
  image: string;
  category: CategoryRef | string | null;
  subcategoryId?: string | null;
  featured?: boolean;
  valentinePromo?: boolean;
}

interface Group {
  slug: string;
  name: string;
  order: number;
  subcategories: Subcategory[];
  products: ApiProduct[];
}

/** Kategorie eines Produkts robust auflösen (populiertes Objekt ODER slug-String). */
function readCategory(cat: ApiProduct['category']): {
  slug: string;
  name: string;
  order: number;
  subcategories: Subcategory[];
} {
  if (cat && typeof cat === 'object') {
    const slug = cat.slug || cat._id || cat.id || 'weitere';
    return {
      slug,
      name: cat.name || slug,
      order: typeof cat.order === 'number' ? cat.order : 9999,
      subcategories: readSubcategories(cat),
    };
  }
  if (typeof cat === 'string' && cat) return { slug: cat, name: cat, order: 9999, subcategories: [] };
  return { slug: 'weitere', name: 'Weitere', order: 100000, subcategories: [] };
}

function groupByCategory(products: ApiProduct[]): Group[] {
  const map = new Map<string, Group>();
  for (const p of products) {
    const { slug, name, order, subcategories } = readCategory(p.category);
    let g = map.get(slug);
    if (!g) {
      g = { slug, name, order, subcategories, products: [] };
      map.set(slug, g);
    }
    g.products.push(p);
  }
  const groups = Array.from(map.values());
  // Kategorien nach order, dann Name; innerhalb: featured zuerst, sonst API-Reihenfolge (Name).
  groups.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  for (const g of groups) {
    g.products.sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
  }
  return groups;
}

export default function MenuPage() {
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string, fallback?: string) => fallback ?? k);

  const [activeSlug, setActiveSlug] = useState<string>('');
  // выбранная подкатегория внутри каждой категории: null — все, '' — без метки
  const [activeSubs, setActiveSubs] = useState<Record<string, string | null>>({});
  const [headerH, setHeaderH] = useState(0);   // Höhe der klebrigen Site-Header
  const [offset, setOffset] = useState(120);   // Header + Leiste (Anker-Versatz)

  const barScrollRef = useRef<HTMLDivElement | null>(null);
  const barWrapRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/products?available=true');
        const data = await res.json();
        if (data.success) setProducts(data.products || []);
      } catch (e) {
        console.error('Error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    })();
  }, [language]);

  const groups = useMemo(() => groupByCategory(products), [products]);

  // Header- + Leistenhöhe messen → Sticky-top der Leiste und scroll-margin der Sektionen.
  const measure = () => {
    const header = document.querySelector('header');
    const h = header ? Math.round(header.getBoundingClientRect().height) : 0;
    const barH = barWrapRef.current ? Math.round(barWrapRef.current.getBoundingClientRect().height) : 0;
    setHeaderH(h);
    setOffset(h + barH + 12);
  };

  useLayoutEffect(() => {
    if (loading || groups.length === 0) return;
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, groups.length]);

  // Scroll-Spy: aktive Kategorie = die Sektion, die gerade unter der Leiste liegt.
  // Bewusst per Scroll-Rechnung (nicht IntersectionObserver): so greift auch der
  // Seitenanfang (→ erste Kategorie) und das Seitenende (→ letzte) sauber.
  useEffect(() => {
    if (loading || groups.length === 0) return;
    let raf = 0;

    const compute = () => {
      raf = 0;
      const line = offset + 1;
      let current = groups[0].slug;
      for (const g of groups) {
        const el = sectionRefs.current.get(g.slug);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = g.slug;
        else break;
      }
      setActiveSlug(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };

    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, groups, offset]);

  // Aktiven Chip in der horizontalen Leiste zentrieren.
  useEffect(() => {
    const bar = barScrollRef.current;
    const chip = activeSlug ? chipRefs.current.get(activeSlug) : null;
    if (!bar || !chip) return;
    const target = chip.offsetLeft - bar.clientWidth / 2 + chip.clientWidth / 2;
    bar.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [activeSlug]);

  // Deep-Link (#slug) beim Laden anspringen.
  useEffect(() => {
    if (loading || groups.length === 0) return;
    const hash = decodeURIComponent(window.location.hash.replace('#', ''));
    if (hash && sectionRefs.current.has(hash)) {
      requestAnimationFrame(() => scrollToSlug(hash, false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, groups.length]);

  const scrollToSlug = (slug: string, smooth = true) => {
    const el = sectionRefs.current.get(slug);
    if (!el) return;
    setActiveSlug(slug);
    const y = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'auto' });
    history.replaceState(null, '', `#${slug}`);
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">{t('menu.loading', 'Speisekarte wird geladen...')}</p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-8">{t('menu.title', 'Unsere Speisekarte')}</h1>
        <div className="text-center py-20">
          <p className="text-xl text-gray-600 mb-6">{t('menu.empty', 'Die Speisekarte ist noch leer')}</p>
          <p className="text-gray-500">{t('menu.empty_hint', 'Hier erscheinen bald Gerichte.')}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="container mx-auto px-4 pt-10 pb-4">
        <h1 className="text-4xl font-bold">{t('menu.title', 'Unsere Speisekarte')}</h1>
      </div>

      {/* Klebrige Kategorie-Leiste — top wird per JS auf die Header-Höhe gesetzt */}
      <div
        ref={barWrapRef}
        className="sticky z-40 border-b border-gray-200 bg-white/95 backdrop-blur-sm"
        style={{ top: headerH }}
      >
        <div className="container mx-auto px-4">
          <div
            ref={barScrollRef}
            className="scrollbar-hide flex gap-2 overflow-x-auto py-3"
            role="tablist"
            aria-label={t('menu.categories', 'Kategorien')}
          >
            {groups.map((g) => {
              const active = g.slug === activeSlug;
              return (
                <button
                  key={g.slug}
                  ref={(el) => { if (el) chipRefs.current.set(g.slug, el); }}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => scrollToSlug(g.slug)}
                  className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                    active
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {g.name}
                  <span className={`ml-1.5 ${active ? 'text-white/70' : 'text-gray-400'}`}>{g.products.length}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {groups.map((g) => (
          <section
            key={g.slug}
            id={g.slug}
            data-slug={g.slug}
            ref={(el) => { if (el) sectionRefs.current.set(g.slug, el); }}
            style={{ scrollMarginTop: offset }}
            className="mb-12"
          >
            <h2 className="mb-4 text-2xl font-bold md:text-3xl">{g.name}</h2>

            <SubcategoryFilter
              subcategories={g.subcategories}
              counts={countBySubcategory(g.products, g.subcategories, (p) => p.subcategoryId)}
              value={activeSubs[g.slug] ?? null}
              onChange={(id) => setActiveSubs((prev) => ({ ...prev, [g.slug]: id }))}
              allLabel={t('category.all', 'Alle')}
              restLabel={t('category.other', 'Weitere')}
            />

            {groupBySubcategory(g.products, g.subcategories, (p) => p.subcategoryId)
              .filter((sub) => {
                const active = activeSubs[g.slug] ?? null;
                return active === null || (sub.id ?? '') === active;
              })
              .map((sub) => (
                <div key={sub.id || 'ohne'} className="mb-8 last:mb-0">
                  {sub.name && (
                    <h3 className="mb-4 text-lg font-semibold text-gray-700 md:text-xl">{sub.name}</h3>
                  )}
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                    {sub.products.map((product) => (
                      <ProductCard
                        key={product._id}
                        product={{
                          id: product._id,
                          name: product.name,
                          description: product.description,
                          price: product.basePrice,
                          image: product.image,
                          category: product.category,
                          valentinePromo: product.valentinePromo,
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
