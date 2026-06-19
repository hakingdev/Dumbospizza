"use client";

import { useState, useEffect } from 'react';
import { ProductCard } from './product-card';
import Link from 'next/link';

interface CategoryProductsProps {
  categorySlug: string;
  categoryTitle: string;
  limit?: number;
  onProductsLoaded?: (hasProducts: boolean) => void;
}

export function CategoryProducts({ categorySlug, categoryTitle, limit = 4, onProductsLoaded }: CategoryProductsProps) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await fetch(`/api/products?category=${categorySlug}&available=true&limit=${limit}`);
        const data = await response.json();
        if (data.success) {
          const productList = data.products.slice(0, limit);
          setProducts(productList);
          if (onProductsLoaded) {
            onProductsLoaded(productList.length > 0);
          }
        } else {
          if (onProductsLoaded) {
            onProductsLoaded(false);
          }
        }
      } catch (error) {
        console.error('Error:', error);
        if (onProductsLoaded) {
          onProductsLoaded(false);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [categorySlug, limit, onProductsLoaded]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card h-80 animate-pulse bg-gray-200 rounded-lg"></div>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return null;
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
