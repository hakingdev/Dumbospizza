"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Save, ArrowLeft, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import ImageUpload from '../../../../components/ImageUpload';
import StatusModal from '../../../../components/admin/StatusModal';
import ProductSizesEditor from '../../../../components/admin/ProductSizesEditor';
import ProductOptionGroupsEditor from '../../../../components/admin/ProductOptionGroupsEditor';
import VatRateSelector from '../../../../components/admin/VatRateSelector';
import { FOOD_VAT_RATE } from '../../../../lib/orders/tax';

export default function NewProductPage() {
  const router = useRouter();
  const [categories, setCategories] = useState([]);
  const [modal, setModal] = useState<{ open: boolean; title?: string; message: string }>({
    open: false,
    title: undefined,
    message: ''
  });
  const [product, setProduct] = useState({
    name: '',
    description: '',
    category: '',
    basePrice: 0,
    taxRate: FOOD_VAT_RATE,
    available: true,
    featured: false,
    valentinePromo: false,
    image: '',
    sizes: [],
    optionGroupIds: [] as string[],
    extras: {
      toppings: [],
      sauces: [],
      sides: []
    }
  });

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const response = await fetch('/api/categories?source=local');
        const data = await response.json();
        if (data.success) {
          const loaded = data.categories || [];
          setCategories(loaded);
          setProduct((prev) => (
            !prev.category && loaded.length > 0
              ? { ...prev, category: loaded[0]._id }
              : prev
          ));
        }
      } catch (error) {
        console.error('Error:', error);
      }
    };

    fetchCategories();
  }, []);

  const addExtra = (type: 'toppings' | 'sauces' | 'sides') => {
    const extras = { ...product.extras };
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

    if (!product.category) {
      setModal({ open: true, title: 'Ошибка', message: 'Выберите категорию' });
      return;
    }

    const cleanSizes = (product.sizes as any[])
      .filter((s: any) => s.name)
      .map((s: any) => ({
        id: s.id || s.variationId || Date.now().toString(),
        variationId: s.variationId,
        name: s.name,
        label: s.label || '',
        price: Number(s.price) || 0,
        active: s.active !== false
      }));

    const newProduct = {
      ...product,
      sizes: cleanSizes,
      basePrice:
        cleanSizes.length > 0
          ? Math.min(...cleanSizes.map((s: any) => s.price))
          : Number(product.basePrice) || 0,
      extras: {
        toppings: product.extras.toppings.filter((t: any) => t.name),
        sauces: product.extras.sauces.filter((s: any) => s.name),
        sides: product.extras.sides.filter((s: any) => s.name)
      }
    };

    try {
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProduct)
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.success !== false) {
        setModal({ open: true, title: 'Готово', message: 'Продукт создан!' });
        setTimeout(() => router.push('/admin/products'), 300);
      } else {
        setModal({
          open: true,
          title: 'Ошибка',
          message: data?.error || `Не удалось создать (код ${response.status})`,
        });
      }
    } catch (error) {
      setModal({
        open: true,
        title: 'Ошибка',
        message: 'Нет связи с сервером. Проверьте, что приложение запущено, и повторите.',
      });
    }
  };

  return (
    <div className="w-full">
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

      <h1 className="text-2xl font-bold mb-6">Новый продукт</h1>

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
                  required
                >
                  <option value="" disabled>
                    Выберите категорию
                  </option>
                  {categories.map((cat: any) => (
                    <option key={cat._id} value={cat._id}>
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

              {(product.sizes as any[]).length === 0 ? (
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
                    Задаётся в размерах ниже
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4">
              <VatRateSelector
                value={product.taxRate}
                onChange={(rate) => setProduct({ ...product, taxRate: rate })}
              />
            </div>

            {/* Sizes */}
            <div className="mt-6">
              <ProductSizesEditor
                sizes={product.sizes as any[]}
                onChange={(sizes) => setProduct({ ...product, sizes: sizes as any })}
              />
            </div>

            {/* Option Groups (Optionsgruppen) */}
            <div className="mt-6">
              <ProductOptionGroupsEditor
                value={(product as any).optionGroupIds || []}
                onChange={(ids) => setProduct({ ...product, optionGroupIds: ids } as any)}
              />
            </div>

            <div className="space-y-3 mt-6">
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
          </div>

          <div className="col-span-12 md:col-span-4">
            <ImageUpload
              value={product.image}
              onChange={(url) => setProduct({...product, image: url})}
              label="Изображение продукта"
              folder="products"
            />
          </div>
        </div>

        <button
          type="submit"
          className="w-full bg-primary-600 text-white py-3 rounded-lg hover:bg-primary-700 flex items-center justify-center"
        >
          <Save className="h-5 w-5 mr-2" />
          Создать продукт
        </button>
      </form>
    </div>
  );
}
