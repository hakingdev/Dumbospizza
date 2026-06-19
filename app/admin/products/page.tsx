"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Search, Edit, Eye, EyeOff, Trash2, Loader2 } from 'lucide-react';

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchProducts();
    fetchCategories();
  }, []);

  const fetchProducts = async () => {
    try {
      const response = await fetch('/api/products?source=local');
      const data = await response.json();
      if (data.success) {
        setProducts(data.products);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await fetch('/api/categories?source=local');
      const data = await response.json();
      if (data.success) {
        setCategories(data.categories || []);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const toggleAvailability = async (productId: string, currentStatus: boolean) => {
    try {
      await fetch(`/api/products/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ available: !currentStatus })
      });
      fetchProducts();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const deleteProduct = async (productId: string) => {
    if (!confirm('Удалить этот продукт?')) return;
    
    try {
      await fetch(`/api/products/${productId}`, {
        method: 'DELETE'
      });
      fetchProducts();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const filteredProducts = products.filter((product: any) => {
    let productCategory = '';

    if (typeof product.category === 'string') {
      productCategory = product.category.toLowerCase();
    } else if (product.category) {
      productCategory = (product.category.slug || product.category.name || '').toLowerCase();
    }

    const matchesCategory = activeCategory === 'all' || productCategory === activeCategory.toLowerCase();
    
    const matchesSearch = (product.name || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesCategory && matchesSearch;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <h1 className="text-2xl font-bold">Продукты</h1>
        <Link 
          href="/admin/products/new" 
          className="bg-primary-600 text-white px-4 py-2 rounded-md flex items-center justify-center hover:bg-primary-700 w-full sm:w-auto"
        >
          <Plus className="w-5 h-5 mr-2" />
          Добавить продукт
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="md:w-1/3">
            <div className="relative">
              <input
                type="text"
                className="w-full pl-10 pr-4 py-2 rounded-md border"
                placeholder="Поиск..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-4 py-2 rounded-md ${activeCategory === 'all' ? 'bg-primary-600 text-white' : 'bg-gray-100'}`}
            >
              Все
            </button>
            {categories.map((category: any) => (
              <button
                key={category._id}
                onClick={() => setActiveCategory(category.slug)}
                className={`px-4 py-2 rounded-md ${
                  activeCategory === category.slug ? 'bg-primary-600 text-white' : 'bg-gray-100'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        <table className="min-w-[720px] w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Название</th>
              <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Категория</th>
              <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Цена</th>
              <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Статус</th>
              <th className="px-4 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredProducts.map((product: any) => {
              const productId = product._id?.toString() || product.id?.toString() || '';
              const productName = product.name || 'Без названия';
              const productDesc = product.description || '';
              const productCategory = typeof product.category === 'string' ? product.category : (product.category?.name || 'N/A');
              const productPrice = typeof product.basePrice === 'number' ? product.basePrice : 0;
              const isAvailable = product.available === true;
              
              return (
                <tr key={productId} className="hover:bg-gray-50">
                  <td className="px-4 sm:px-6 py-4">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 bg-gray-100 rounded flex items-center justify-center">
                        🍕
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{productName}</div>
                        <div className="text-sm text-gray-500">{productDesc.substring(0, 50)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 sm:px-6 py-4">
                    <span className="px-2 py-1 text-xs rounded bg-gray-100">
                      {productCategory}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4 text-sm text-gray-900">
                    €{productPrice.toFixed(2)}
                  </td>
                  <td className="px-4 sm:px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded ${
                      isAvailable ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {isAvailable ? 'Активен' : 'Скрыт'}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4 text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => toggleAvailability(productId, isAvailable)}
                        className="text-gray-600 hover:text-primary-600"
                        title={isAvailable ? 'Скрыть' : 'Показать'}
                      >
                        {isAvailable ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                      </button>
                      <Link
                        href={`/admin/products/${productId}/edit`}
                        className="text-gray-600 hover:text-primary-600"
                      >
                        <Edit className="h-5 w-5" />
                      </Link>
                      <button
                        onClick={() => deleteProduct(productId)}
                        className="text-gray-600 hover:text-red-600"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredProducts.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            Продукты не найдены
          </div>
        )}
      </div>
    </>
  );
}
