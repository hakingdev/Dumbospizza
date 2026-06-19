"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '../../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../../lib/i18n';
import Link from 'next/link';
import { Save, ArrowLeft, Loader2 } from 'lucide-react';

export default function NewCouponPage() {
  const router = useRouter();
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);
  
  const [coupon, setCoupon] = useState({
    code: '',
    description: '',
    discountType: 'fixed',
    discountValue: 0,
    validFrom: new Date().toISOString().slice(0, 10),
    validTo: '',
    minOrderAmount: '',
    usageLimit: '',
    active: true
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };
    
    loadTranslations();
  }, [language]);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    
    if (type === 'number') {
      setCoupon({ ...coupon, [name]: value === '' ? '' : Number(value) });
    } else if (type === 'checkbox') {
      const checkbox = e.target as HTMLInputElement;
      setCoupon({ ...coupon, [name]: checkbox.checked });
    } else {
      setCoupon({ ...coupon, [name]: value });
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setIsSubmitting(true);
      setError(null);
      setSuccess(null);
      
      // Валидация
      if (!coupon.code.trim()) {
        setError('Код промокода обязателен');
        return;
      }
      
      if (!coupon.validTo) {
        setError('Дата окончания действия обязательна');
        return;
      }
      
      if (coupon.discountValue <= 0) {
        setError('Значение скидки должно быть больше 0');
        return;
      }
      
      // Форматирование данных
      const formattedData = {
        ...coupon,
        code: coupon.code.toUpperCase().trim(),
        discountValue: Number(coupon.discountValue),
        validFrom: new Date(coupon.validFrom),
        validTo: new Date(coupon.validTo),
        minOrderAmount: coupon.minOrderAmount === '' ? undefined : Number(coupon.minOrderAmount),
        usageLimit: coupon.usageLimit === '' ? undefined : Number(coupon.usageLimit),
        description: coupon.description || undefined
      };
      
      const response = await fetch('/api/coupons', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formattedData)
      });
      
      const result = await response.json();
      
      if (result.success) {
        setSuccess('Промокод успешно создан!');
        setTimeout(() => {
          router.push('/admin/coupons');
        }, 1500);
      } else {
        setError(result.error || 'Ошибка при создании промокода');
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка при создании промокода');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link 
          href="/admin/coupons"
          className="flex items-center text-primary-600 hover:text-primary-700 mb-4"
        >
          <ArrowLeft className="h-5 w-5 mr-2" />
          Назад к списку промокодов
        </Link>
        <h1 className="text-2xl font-bold">Создать новый промокод</h1>
      </div>
      
      {error && (
        <div className="bg-red-100 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      {success && (
        <div className="bg-green-100 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
          {success}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
              Код промокода *
            </label>
            <input
              type="text"
              id="code"
              name="code"
              value={coupon.code}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              placeholder="PIZZA10"
            />
            <p className="mt-1 text-xs text-gray-500">Будет автоматически преобразован в верхний регистр</p>
          </div>
          
          <div>
            <label htmlFor="discountType" className="block text-sm font-medium text-gray-700 mb-1">
              Тип скидки *
            </label>
            <select
              id="discountType"
              name="discountType"
              value={coupon.discountType}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="fixed">Фиксированная сумма (€)</option>
              <option value="percentage">Процент (%)</option>
            </select>
          </div>
          
          <div>
            <label htmlFor="discountValue" className="block text-sm font-medium text-gray-700 mb-1">
              Значение скидки *
            </label>
            <input
              type="number"
              id="discountValue"
              name="discountValue"
              value={coupon.discountValue}
              onChange={handleChange}
              required
              min="0"
              step="0.01"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              placeholder={coupon.discountType === 'fixed' ? '10.00' : '10'}
            />
            <p className="mt-1 text-xs text-gray-500">
              {coupon.discountType === 'fixed' ? 'Сумма в евро' : 'Процент от суммы заказа'}
            </p>
          </div>
          
          <div>
            <label htmlFor="minOrderAmount" className="block text-sm font-medium text-gray-700 mb-1">
              Минимальная сумма заказа (€)
            </label>
            <input
              type="number"
              id="minOrderAmount"
              name="minOrderAmount"
              value={coupon.minOrderAmount}
              onChange={handleChange}
              min="0"
              step="0.01"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              placeholder="0.00"
            />
            <p className="mt-1 text-xs text-gray-500">Оставьте пустым, если нет ограничения</p>
          </div>
          
          <div>
            <label htmlFor="validFrom" className="block text-sm font-medium text-gray-700 mb-1">
              Действует с *
            </label>
            <input
              type="date"
              id="validFrom"
              name="validFrom"
              value={coupon.validFrom}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          
          <div>
            <label htmlFor="validTo" className="block text-sm font-medium text-gray-700 mb-1">
              Действует до *
            </label>
            <input
              type="date"
              id="validTo"
              name="validTo"
              value={coupon.validTo}
              onChange={handleChange}
              required
              min={coupon.validFrom}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          
          <div>
            <label htmlFor="usageLimit" className="block text-sm font-medium text-gray-700 mb-1">
              Лимит использований
            </label>
            <input
              type="number"
              id="usageLimit"
              name="usageLimit"
              value={coupon.usageLimit}
              onChange={handleChange}
              min="1"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              placeholder="Без ограничений"
            />
            <p className="mt-1 text-xs text-gray-500">Оставьте пустым для неограниченного использования</p>
          </div>
        </div>
        
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Описание
          </label>
          <textarea
            id="description"
            name="description"
            value={coupon.description}
            onChange={handleChange}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
            placeholder="Описание промокода (необязательно)"
          />
        </div>
        
        <div className="flex items-center">
          <input
            type="checkbox"
            id="active"
            name="active"
            checked={coupon.active}
            onChange={handleChange}
            className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
          />
          <label htmlFor="active" className="ml-2 block text-sm text-gray-700">
            Активен
          </label>
        </div>
        
        <div className="flex justify-end space-x-4 pt-4 border-t">
          <Link
            href="/admin/coupons"
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            Отмена
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 flex items-center"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Создание...
              </>
            ) : (
              <>
                <Save className="h-5 w-5 mr-2" />
                Создать промокод
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}


