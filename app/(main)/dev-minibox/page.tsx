"use client";

/**
 * TEMPORÄRER Dev-Stand für die 4er Mini Pizza Box — NUR im `next dev` erreichbar,
 * im Prod-Build → 404. Nach der Aktivierung (seed-mini-pizza-box.mjs --activate)
 * kann die Datei gelöscht werden.
 *
 * Simuliert den Zustand nach der Aktivierung, ohne die geteilte (Prod-)DB
 * anzufassen: echte Menüdaten, Mini-Größe wird client-seitig in die API-Antwort
 * injiziert (Preis = kleinste Größe − 2 €, wie im Seed-Default).
 */

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MiniPizzaBoxBuilder } from '../../../components/mini-pizza-box/MiniPizzaBoxBuilder';

export default function DevMiniboxPreview() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <DevMiniboxStand />;
}

function DevMiniboxStand() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const orig = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await orig(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/api/products?category=pizza')) return res;
      const data = await res.json();
      const products = (data.products || []).map((p: any) => {
        const prices = (p.sizes || []).map((s: any) => Number(s.price)).filter((n: number) => n > 0);
        const smallest = prices.length ? Math.min(...prices) : Number(p.basePrice) || 0;
        const mini = Math.max(3.9, Math.round((smallest - 2) * 100) / 100);
        return {
          ...p,
          sizes: [
            ...(p.sizes || []),
            { id: 'dev-mini', name: 'Mini 18cm', label: 'Mini ≈ Ø 18 cm', price: mini },
          ],
        };
      });
      return new Response(JSON.stringify({ ...data, products }), {
        headers: { 'Content-Type': 'application/json' },
      });
    };
    setReady(true);
    return () => {
      window.fetch = orig;
    };
  }, []);

  if (!ready) return null;

  return (
    <MiniPizzaBoxBuilder
      isOpen
      onClose={() => window.history.back()}
      product={{
        id: '1b2f42ee8c5081dfe7adfdb6',
        name: '4er Mini Pizza Box',
        image: '/images/mini-pizza-box.svg',
        categoryId: '9bdabf37f0a2139b80511498',
      }}
    />
  );
}
