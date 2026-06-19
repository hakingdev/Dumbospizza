"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../lib/i18n';
import { getCoupons, deleteCoupon } from '../../../lib/api-client';
import Link from 'next/link';
import { Pencil, Trash, PlusCircle, Calendar, Tag, Percent } from 'lucide-react';

export default function CouponsAdminPage() {
  const router = useRouter();
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  
  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };
    
    loadTranslations();

    const fetchCoupons = async () => {
      try {
        setIsLoading(true);
        const result = await getCoupons();
        
        if (result.success) {
          setCoupons(result.coupons);
        } else {
          setError(result.error || 'Не удалось загрузить купоны');
        }
      } catch (err) {
        setError('Не удалось загрузить купоны');
        console.error('Error fetching coupons:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCoupons();
  }, [language]);
  
  const handleDeleteConfirm = (id: string) => {
    setDeleteConfirm(id);
  };
  
  const handleDeleteCancel = () => {
    setDeleteConfirm(null);
  };
  
  const handleDeleteCoupon = async (id: string) => {
    try {
      const result = await deleteCoupon(id);
      
      if (result.success) {
        // Обновление списка купонов после удаления
        setCoupons(coupons.filter(coupon => coupon._id !== id));
        setDeleteConfirm(null);
      } else {
        setError(result.error || t('errors.general'));
      }
    } catch (err) {
      setError(t('errors.general'));
      console.error('Error deleting coupon:', err);
    }
  };
  
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat(language, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  };
  
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{t('admin.coupons.title')}</h1>
        <Link 
          href="/admin/coupons/new"
          className="flex items-center bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700"
        >
          <PlusCircle className="h-5 w-5 mr-2" />
          {t('admin.coupons.add_new')}
        </Link>
      </div>
      
      {error && (
        <div className="bg-red-100 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      {isLoading ? (
        <div className="text-center py-10">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent"></div>
          <p className="mt-2">{t('loading')}</p>
        </div>
      ) : coupons.length === 0 ? (
        <div className="text-center py-10 bg-gray-50 rounded-lg">
          <p className="text-gray-500">{t('admin.coupons.no_coupons')}</p>
          <Link 
            href="/admin/coupons/new"
            className="mt-4 inline-flex items-center text-primary-600 hover:text-primary-800"
          >
            <PlusCircle className="h-5 w-5 mr-1" />
            {t('admin.coupons.add_new')}
          </Link>
        </div>
      ) : (
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('admin.coupons.code')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('admin.coupons.discount_value')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('admin.coupons.valid_to')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('admin.coupons.usage_count')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('admin.coupons.active')}
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('actions')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {coupons.map(coupon => (
                <tr key={coupon._id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <Tag className="h-5 w-5 text-primary-500 mr-2" />
                      <span className="font-medium">{coupon.code}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {coupon.discountType === 'fixed' ? (
                        <span>{coupon.discountValue.toFixed(2)} €</span>
                      ) : (
                        <div className="flex items-center">
                          <span>{coupon.discountValue}</span>
                          <Percent className="h-4 w-4 ml-1" />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <Calendar className="h-4 w-4 text-gray-500 mr-2" />
                      {formatDate(coupon.validTo)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {coupon.usageCount} 
                    {coupon.usageLimit && <span className="text-gray-500"> / {coupon.usageLimit}</span>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${coupon.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {coupon.active ? t('active') : t('inactive')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    {deleteConfirm === coupon._id ? (
                      <div className="flex items-center justify-end space-x-2">
                        <button 
                          onClick={() => handleDeleteCoupon(coupon._id)}
                          className="text-white bg-red-600 hover:bg-red-700 px-3 py-1 rounded-md text-xs"
                        >
                          {t('confirm')}
                        </button>
                        <button 
                          onClick={handleDeleteCancel}
                          className="text-gray-700 bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded-md text-xs"
                        >
                          {t('cancel')}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end space-x-2">
                        <Link 
                          href={`/admin/coupons/edit/${coupon._id}`}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          <Pencil className="h-5 w-5" />
                        </Link>
                        <button 
                          onClick={() => handleDeleteConfirm(coupon._id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          <Trash className="h-5 w-5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
