"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '../../../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../../../lib/i18n';
import { getCouponById, updateCoupon } from '../../../../../lib/api-client';
import Link from 'next/link';
import { Save, ArrowLeft, Loader2 } from 'lucide-react';

export default function EditCouponPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { id } = params;
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string, fallback?: string) => fallback ?? k);
  
  const [coupon, setCoupon] = useState<any>({
    code: '',
    description: '',
    discountType: 'fixed',
    discountValue: 0,
    validFrom: '',
    validTo: '',
    minOrderAmount: 0,
    usageLimit: 0,
    active: true
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };
    
    loadTranslations();

    const fetchCoupon = async () => {
      try {
        setIsLoading(true);
        const result = await getCouponById(id);
        
        if (result.success) {
          // Форматирование дат для полей ввода
          const formattedCoupon = {
            ...result.coupon,
            validFrom: new Date(result.coupon.validFrom).toISOString().slice(0, 10),
            validTo: new Date(result.coupon.validTo).toISOString().slice(0, 10)
          };
          
          setCoupon(formattedCoupon);
        } else {
          setError(result.error || 'Не удалось загрузить купон');
        }
      } catch (err) {
        setError('Не удалось загрузить купон');
        console.error('Error fetching coupon:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCoupon();
  }, [language, id]);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    
    // Обработка числовых полей
    if (type === 'number') {
      setCoupon({ ...coupon, [name]: value === '' ? '' : Number(value) });
    } 
    // Обработка флажков
    else if (type === 'checkbox') {
      const checkbox = e.target as HTMLInputElement;
      setCoupon({ ...coupon, [name]: checkbox.checked });
    }
    // Обычные поля ввода
    else {
      setCoupon({ ...coupon, [name]: value });
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setIsSubmitting(true);
      setError(null);
      setSuccess(null);
      
      // Для полей, которые должны быть числами, но могут быть пустыми
      const formattedData = {
        ...coupon,
        minOrderAmount: coupon.minOrderAmount === '' ? undefined : Number(coupon.minOrderAmount),
        usageLimit: coupon.usageLimit === '' ? undefined : Number(coupon.usageLimit)
      };
      
      const result = await updateCoupon(id, formattedData);
      
      if (result.success) {
        setSuccess(t('admin.coupons.updated_success'));
        
        // Опционально перенаправление на список купонов
        // router.push('/admin/coupons');
      } else {
        setError(result.error || t('errors.general'));
      }
    } catch (err: any) {
      let errorMessage = t('errors.general');
      
      if (err.response && err.response.data) {
        errorMessage = err.response.data.error || errorMessage;
      }
      
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="animate-spin h-8 w-8 mx-auto text-primary-600" />
          <p className="mt-2">{t('loading')}</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center mb-6">
        <Link 
          href="/admin/coupons"
          className="mr-4 p-2 rounded-full hover:bg-gray-100"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">{t('admin.coupons.edit')}</h1>
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
      
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <form onSubmit={handleSubmit} className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Код купона */}
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
                {t('admin.coupons.code')} *
              </label>
              <input
                type="text"
                name="code"
                id="code"
                required
                value={coupon.code}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            
            {/* Описание */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                {t('description')}
              </label>
              <input
                type="text"
                name="description"
                id="description"
                value={coupon.description || ''}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            
            {/* Тип скидки */}
            <div>
              <label htmlFor="discountType" className="block text-sm font-medium text-gray-700 mb-1">
                {t('admin.coupons.discount_type')} *
              </label>
              <select
                name="discountType"
                id="discountType"
                required
                value={coupon.discountType}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="fixed">{t('admin.coupons.fixed')}</option>
                <option value="percentage">{t('admin.coupons.percentage')}</option>
              </select>
            </div>
            
            {/* Значение скидки */}
            <div>
              <label htmlFor="discountValue" className="block text-sm font-medium text-gray-700 mb-1">
                {t('admin.coupons.discount_value')} *
              </label>
              <div className="relative">
                <input
                  type="number"
                  name="discountValue"
                  id="discountValue"
                  required
                  min="0"
                  step={coupon.discountType === 'percentage' ? '1' : '0.01'}
                  value={coupon.discountValue}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  {coupon.discountType === 'fixed' ? '€' : '%'}
                </div>
              </div>
            </div>
            
            {/* Действует с */}
            <div>
              <label htmlFor="validFrom" className="block text-sm font-medium text-gray-700 mb-1">
                {t('admin.coupons.valid_from')} *
              </label>
              <input
                type="date"
                name="validFrom"
                id="validFrom"
                required
                value={coupon.validFrom}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            
            {/* Действует по */}
            <div>
              <label htmlFor="validTo" className="block text-sm font-medium text-gray-700 mb-1">
                {t('admin.coupons.valid_to')} *
              </label>
              <input
                type="date"
                name="validTo"
                id="validTo"
                required
                value={coupon.validTo}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            
            {/* Минимальная сумма заказа */}
            <div>
              <label htmlFor="minOrderAmount" className="block text-sm font-medium text-gray-700 mb-1">
                {t('admin.coupons.min_order_amount')}
              </label>
              <div className="relative">
                <input
                  type="number"
                  name="minOrderAmount"
                  id="minOrderAmount"
                  min="0"
                  step="0.01"
                  value={coupon.minOrderAmount || ''}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  €
                </div>
              </div>
            </div>
            
            {/* Лимит использования */}
            <div>
              <label htmlFor="usageLimit" className="block text-sm font-medium text-gray-700 mb-1">
                {t('admin.coupons.usage_limit')}
              </label>
              <input
                type="number"
                name="usageLimit"
                id="usageLimit"
                min="0"
                step="1"
                value={coupon.usageLimit || ''}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            
            {/* Активен */}
            <div>
              <div className="flex items-center h-full">
                <input
                  type="checkbox"
                  name="active"
                  id="active"
                  checked={coupon.active}
                  onChange={handleChange}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <label htmlFor="active" className="ml-2 block text-sm text-gray-900">
                  {t('admin.coupons.active')}
                </label>
              </div>
            </div>
          </div>
          
          <div className="mt-8 flex justify-end">
            <Link
              href="/admin/coupons"
              className="bg-gray-100 py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 mr-3"
            >
              {t('cancel')}
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center justify-center bg-primary-600 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:bg-gray-400"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                  {t('saving')}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {t('save')}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
