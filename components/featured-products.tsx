"use client";

import { useState, useEffect, useMemo } from 'react';
import { ProductCard } from './product-card';
import { PromotionBadgesProvider, toBadgeItems } from './promotions/PromotionBadgesContext';
import { cachedJson } from '../lib/client-cache';
import { getProductDisplayPrice } from '../lib/product-pricing';

export function FeaturedProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const badgeItems = useMemo(() => toBadgeItems(products), [products]);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const data = await cachedJson('/api/products?available=true&featured=true&limit=8');
      if (data.success) {
        setProducts(data.products.slice(0, 8));
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card h-80 animate-pulse bg-gray-200"></div>
        ))}
      </div>
    );
  }

  return (
    <PromotionBadgesProvider items={badgeItems}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {products.map((product: any) => (
          <ProductCard key={product._id} product={{
            id: product._id,
            name: product.name,
            description: product.description,
            // «ab»-Preis aus den aktiven Größen — basePrice ist bei Größen-Produkten veraltet
            price: getProductDisplayPrice(product),
            image: product.image,
            category: product.category,
            valentinePromo: product.valentinePromo
          }} />
        ))}
      </div>
    </PromotionBadgesProvider>
  );
}
