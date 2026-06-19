"use client";

import { useState, useEffect } from 'react';
import { ProductCard } from './product-card';

export function FeaturedProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const response = await fetch('/api/products?available=true&featured=true&limit=8');
      const data = await response.json();
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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {products.map((product: any) => (
        <ProductCard key={product._id} product={{
          id: product._id,
          name: product.name,
          description: product.description,
          price: product.basePrice,
          image: product.image,
          category: product.category,
          valentinePromo: product.valentinePromo
        }} />
      ))}
    </div>
  );
}
