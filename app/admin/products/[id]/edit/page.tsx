"use client";

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Save, ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import ImageUpload from '../../../../../components/ImageUpload';
import StatusModal from '../../../../../components/admin/StatusModal';
import ProductSizesEditor from '../../../../../components/admin/ProductSizesEditor';
import ProductOptionGroupsEditor from '../../../../../components/admin/ProductOptionGroupsEditor';

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<any>(null);
  const [categories, setCategories] = useState([]);
  const [modal, setModal] = useState<{ open: boolean; title?: string; message: string }>({
    open: false,
    title: undefined,
    message: ''
  });

  useEffect(() => {
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

    const fetchProduct = async () => {
      try {
        const response = await fetch(`/api/products/${productId}?source=local`);
        const data = await response.json();
        if (data.success) {
          setProduct({
            ...data.product,
            sizes: data.product.sizes || [],
            extras: data.product.extras || { toppings: [], sauces: [], sides: [] }
          });
        }
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
    fetchCategories();
  }, [productId]);

  const addExtra = (type: 'toppings' | 'sauces' | 'sides') => {
    const extras = product.extras || { toppings: [], sauces: [], sides: [] };
    extras[type] = [...(extras[type] || []), { name: '', price: 0 }];
    setProduct({ ...product, extras });
  };

  const removeExtra = (type: 'toppings' | 'sauces' | 'sides', index: number) => {
    const extras = { ...product.extras };
    extras[type] = extras[type].filter((_: any, i: number) => i !== index);
    setProduct({ ...product, extras });
  };

  const updateExtra = (type: 'toppings' | 'sauces' | 'sides', index: number, field: string, value: any) => {
    const extras = { ...product.extras };
    extras[type][index] = { ...extras[type][index], [field]: value };
    setProduct({ ...product, extras });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const cleanSizes = (product.sizes || [])
      .filter((s: any) => s.name)
      .map((s: any) => ({
        id: s.id || s.variationId || Date.now().toString(),
        variationId: s.variationId,
        name: s.name,
        label: s.label || '',
        price: Number(s.price) || 0
      }));

    const optionGroupIds = (product.optionGroupIds || []).map((g: any) =>
      typeof g === 'string' ? g : g._id
    );

    const updatedProduct = {
      ...product,
      optionGroupIds,
      sizes: cleanSizes,
      // для товаров с размерами базовая цена = минимальная цена размера (для меню/акций)
      basePrice:
        cleanSizes.length > 0
          ? Math.min(...cleanSizes.map((s: any) => s.price))
          : Number(product.basePrice) || 0,
      extras: {
        toppings: product.extras?.toppings?.filter((t: any) => t.name) || [],
        sauces: product.extras?.sauces?.filter((s: any) => s.name) || [],
        sides: product.extras?.sides?.filter((s: any) => s.name) || []
      }
    };

    try {
      const response = await fetch(`/api/products/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedProduct)
      });

      if (response.ok) {
        setModal({ open: true, title: 'Готово', message: 'Продукт обновлен!' });
        setTimeout(() => router.push('/admin/products'), 300);
      }
    } catch (error) {
      setModal({ open: true, title: 'Ошибка', message: 'Ошибка обновления продукта' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!product) {
    return <div>Продукт не найден</div>;
  }

  return (
    <div className="max-w-4xl">
      <StatusModal
        open={modal.open}
        title={modal.title}
        message={modal.message}
        onClose={() => setModal({ open: false, title: undefined, message: '' })}
      />
      <Link href="/admin/products" className="inline-flex items-center text-primary-600 mb-6 hover:text-primary-700">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Назад к продуктам
      </Link>

      <h1 className="text-2xl font-bold mb-6">Редактировать: {product.name}</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm p-6 space-y-6">
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 md:col-span-8">
            <div>
              <label className="block text-sm font-medium mb-2">Название *</label>
              <input
                type="text"
                required
                value={product.name}
                onChange={(e) => setProduct({...product, name: e.target.value})}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium mb-2">Описание</label>
              <textarea
                value={product.description}
                onChange={(e) => setProduct({...product, description: e.target.value})}
                className="w-full px-4 py-2 border rounded-lg"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium mb-2">Категория</label>
                <select
                  value={product.category}
                  onChange={(e) => setProduct({...product, category: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg"
                >
                  {categories.map((cat: any) => (
                    <option key={cat._id} value={cat.slug || cat.name?.toLowerCase()}>
                      {cat.name}
                    </option>
                  ))}
                  {categories.length === 0 && (
                    <>
                      <option value="pizza">Пицца</option>
                      <option value="beverages">Напитки</option>
                      <option value="appetizers">Закуски</option>
                    </>
                  )}
                </select>
              </div>

              {(!product.sizes || product.sizes.length === 0) ? (
                <div>
                  <label className="block text-sm font-medium mb-2">Цена (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={product.basePrice}
                    onChange={(e) => setProduct({...product, basePrice: parseFloat(e.target.value)})}
                    className="w-full px-4 py-2 border rounded-lg"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Для товаров без размеров. Если добавить размеры — цена берётся из них.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-2">Цена</label>
                  <div className="px-4 py-2 border rounded-lg bg-gray-50 text-gray-500 text-sm">
                    Задаётся в размерах ниже (от {Math.min(...product.sizes.map((s: any) => Number(s.price) || 0)).toFixed(2)} €)
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="col-span-12 md:col-span-4">
            <ImageUpload
              value={product.image || ''}
              onChange={(url) => setProduct({...product, image: url})}
              label="Изображение продукта"
              folder="products"
            />
          </div>
        </div>

        {/* Sizes */}
        <ProductSizesEditor
          sizes={product.sizes || []}
          onChange={(sizes) => setProduct({ ...product, sizes })}
        />

        {/* Option Groups (Optionsgruppen) */}
        <ProductOptionGroupsEditor
          value={product.optionGroupIds || []}
          onChange={(ids) => setProduct({ ...product, optionGroupIds: ids })}
        />

        <div className="space-y-3">
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={product.available}
              onChange={(e) => setProduct({...product, available: e.target.checked})}
              className="mr-2"
            />
            <label className="text-sm font-medium">Доступен для заказа</label>
          </div>
          
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={product.featured || false}
              onChange={(e) => setProduct({...product, featured: e.target.checked})}
              className="mr-2"
            />
            <label className="text-sm font-medium">Популярное блюдо (отображается на главной)</label>
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={product.valentinePromo || false}
              onChange={(e) => setProduct({...product, valentinePromo: e.target.checked})}
              className="mr-2"
            />
            <label className="text-sm font-medium">Valentinstag Special (акция День святого Валентина — розовая подложка)</label>
          </div>
        </div>

        <button
          type="submit"
          className="w-full bg-primary-600 text-white py-3 rounded-lg hover:bg-primary-700 flex items-center justify-center"
        >
          <Save className="h-5 w-5 mr-2" />
          Сохранить изменения
        </button>
      </form>
    </div>
  );
}
