"use client";

import { useState, useEffect } from 'react';
import { Phone, User as UserIcon, Edit, Star, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../lib/i18n';
import OrderHistoryItem from '../../../components/profile/OrderHistoryItem';

export default function ProfilePage() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [step, setStep] = useState<'phone' | 'verification' | 'profile'>('phone');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [loyalty, setLoyalty] = useState<any>(null);
  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);
  
  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };
    
    loadTranslations();
  }, [language]);

  // Function to handle phone number submission
  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!phoneNumber || phoneNumber.length < 10) {
      setError(t('profile.errors.phone_invalid', 'Пожалуйста, введите корректный номер телефона'));
      return;
    }
    
    setIsLoading(true);
    
    // In a real app, we would send a verification code to the user's phone
    // For this demo, we'll simulate it with a timeout
    setTimeout(() => {
      setIsLoading(false);
      setStep('verification');
    }, 1500);
  };
  
  // Function to handle verification code submission
  const handleVerificationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!verificationCode || verificationCode.length !== 4) {
      setError(t('profile.errors.code_invalid', 'Пожалуйста, введите 4-значный код'));
      return;
    }
    
    setIsLoading(true);
    
    try {
      // Fetch user data by phone number
      const userResponse = await fetch(`/api/users?phoneNumber=${encodeURIComponent(phoneNumber)}`);
      const userData = await userResponse.json();
      
      if (userData.success && userData.users && userData.users.length > 0) {
        const user = userData.users[0];
        setUser(user);
        setName(user.name);
        setEmail(user.email || '');
        
        // Fetch user orders
        const ordersResponse = await fetch(`/api/orders?phoneNumber=${encodeURIComponent(phoneNumber)}`);
        const ordersData = await ordersResponse.json();
        
        if (ordersData.success) {
          setOrders(ordersData.orders || []);
        }
        
        // Fetch loyalty info
        const loyaltyResponse = await fetch(`/api/loyalty?phoneNumber=${encodeURIComponent(phoneNumber)}`);
        const loyaltyData = await loyaltyResponse.json();
        
        if (loyaltyData.success) {
          setLoyalty(loyaltyData.loyalty);
        }
        
        setStep('profile');
      } else {
        // Create a new user profile
        const newUser = {
          name: t('profile.new_user', 'Новый пользователь'),
          phoneNumber,
          role: 'customer'
        };
        
        const createResponse = await fetch('/api/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(newUser)
        });
        
        const createData = await createResponse.json();
        
        if (createData.success) {
          setUser(createData.user);
          setName(createData.user.name);
          setEmail('');
          setOrders([]);
          setLoyalty(null);
          setStep('profile');
          setEditMode(true); // Enable edit mode for new users
        } else {
          throw new Error(t('profile.errors.create_failed', 'Не удалось создать профиль'));
        }
      }
    } catch (err: any) {
      setError(err.message || t('profile.errors.login_failed', 'Произошла ошибка при входе'));
    } finally {
      setIsLoading(false);
    }
  };
  
  // Function to handle profile update
  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!name) {
      setError(t('profile.errors.name_required', 'Имя не может быть пустым'));
      return;
    }
    
    setIsLoading(true);
    
    try {
      // Update user profile
      const updateResponse = await fetch(`/api/users/${user._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          email: email || undefined
        })
      });
      
      const updateData = await updateResponse.json();
      
      if (updateData.success) {
        setUser(updateData.user);
        setEditMode(false);
      } else {
        throw new Error(t('profile.errors.update_failed', 'Не удалось обновить профиль'));
      }
    } catch (err: any) {
      setError(err.message || t('profile.errors.update_failed', 'Произошла ошибка при обновлении профиля'));
    } finally {
      setIsLoading(false);
    }
  };
  
  // Render authentication step (phone number input)
  if (step === 'phone') {
    return (
        <div className="container mx-auto px-4 py-12">
        <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-2xl font-bold text-center mb-6">{t('profile.login')}</h1>
          
          <form onSubmit={handlePhoneSubmit} className="space-y-6">
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                {t('checkout.phone')}
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                <input
                  id="phone"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="pl-10 w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
                  placeholder="+49 123 456789"
                  required
                />
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {t('profile.phone_verification_info')}
              </p>
            </div>
            
            {error && (
              <div className="p-3 bg-red-100 border border-red-200 text-red-700 rounded-md">
                {error}
              </div>
            )}
            
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? t('loading') : t('profile.get_code')}
            </button>
          </form>
        </div>
      </div>
    );
  }
  
  // Render verification step (code input)
  if (step === 'verification') {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-2xl font-bold text-center mb-6">{t('profile.verification_title', 'Подтверждение номера')}</h1>
          <p className="text-center mb-6">
            {t('profile.verification_sent', 'Мы отправили код подтверждения на номер')} {phoneNumber}
          </p>
          
          <form onSubmit={handleVerificationSubmit} className="space-y-6">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
                {t('profile.verification_code', 'Код подтверждения')}
              </label>
              <input
                id="code"
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 text-center text-2xl letter-spacing-wider"
                placeholder="••••"
                maxLength={4}
                autoComplete="one-time-code"
                required
              />
              <p className="mt-1 text-sm text-gray-500 text-center">
                {t('profile.verification_hint', 'Введите 4-значный код из SMS')}
              </p>
            </div>
            
            {error && (
              <div className="p-3 bg-red-100 border border-red-200 text-red-700 rounded-md">
                {error}
              </div>
            )}
            
            <div className="flex flex-col space-y-3">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? t('profile.verification_checking', 'Проверка...') : t('profile.verify', 'Подтвердить')}
              </button>
              
              <button
                type="button"
                onClick={() => setStep('phone')}
                className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                {t('profile.change_phone', 'Изменить номер телефона')}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }
  
  // Render user profile
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* User Profile Card */}
          <div className="md:col-span-1">
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold">{t('profile.personal_info')}</h2>
                  {!editMode && (
                    <button 
                      onClick={() => setEditMode(true)} 
                      className="text-primary-600 hover:text-primary-700"
                      title={t('profile.edit_profile')}
                    >
                      <Edit className="h-5 w-5" />
                    </button>
                  )}
                </div>
                
                {editMode ? (
                  <form onSubmit={handleProfileUpdate} className="space-y-4">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                        {t('profile.your_name', 'Ваше имя')}
                      </label>
                      <input
                        id="name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
                        required
                      />
                    </div>
                    
                    <div>
                      <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                        {t('profile.email_optional', 'Email (необязательно)')}
                      </label>
                      <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t('profile.phone_label', 'Номер телефона')}
                      </label>
                      <div className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-md">
                        {phoneNumber}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {t('profile.phone_readonly', 'Номер телефона нельзя изменить')}
                      </p>
                    </div>
                    
                    {error && (
                      <div className="p-3 bg-red-100 border border-red-200 text-red-700 rounded-md">
                        {error}
                      </div>
                    )}
                    
                    <div className="flex space-x-3">
                      <button
                        type="submit"
                        disabled={isLoading}
                        className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                      >
                        {isLoading ? t('saving') : t('profile.save')}
                      </button>
                      
                      <button
                        type="button"
                        onClick={() => {
                          setEditMode(false);
                          setName(user.name);
                          setEmail(user.email || '');
                        }}
                        className="flex-1 py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                      >
                        {t('profile.cancel')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center">
                      <UserIcon className="h-5 w-5 text-gray-400 mr-2" />
                      <span className="font-medium">{user?.name || t('common.not_specified', 'Не указано')}</span>
                    </div>
                    
                    <div className="flex items-center">
                      <Phone className="h-5 w-5 text-gray-400 mr-2" />
                      <span>{phoneNumber}</span>
                    </div>
                    
                    {user?.email && (
                      <div className="flex items-center">
                        <svg className="h-5 w-5 text-gray-400 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        <span>{user.email}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              {/* Loyalty Card */}
              <div className="border-t border-gray-200">
                <div className="p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">{t('profile.loyalty_program')}</h3>
                    <Star className="h-5 w-5 text-yellow-500" />
                  </div>
                  
                  {loyalty ? (
                    <div>
                      <div className="bg-yellow-50 rounded-lg p-4 mb-4">
                        <div className="text-center">
                          <div className="text-3xl font-bold text-yellow-700">{loyalty.balance}</div>
                          <div className="text-sm text-yellow-600">{t('profile.available_points')}</div>
                        </div>
                      </div>
                      
                      <p className="text-sm text-gray-600 mb-2">
                        {t('profile.points_explainer_1')}
                      </p>
                      <p className="text-sm text-gray-600">
                        {t('profile.points_explainer_2')}
                      </p>
                    </div>
                  ) : (
                    <div className="text-center py-3">
                      <p className="text-gray-500">
                        {t('profile.no_points')}
                        <br />
                        {t('profile.make_orders')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* Order History */}
          <div className="md:col-span-2">
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-xl font-semibold">{t('profile.orders_history')}</h2>
              </div>
              
              {orders.length === 0 ? (
                <div className="p-8 text-center">
                  <ShoppingBag className="h-12 w-12 mx-auto text-gray-300 mb-3" />
                  <h3 className="text-lg font-medium text-gray-900 mb-1">{t('profile.no_orders')}</h3>
                  <p className="text-gray-500">
                    {t('profile.all_orders_here')}
                  </p>
                  <Link href="/" className="mt-4 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700">
                    {t('profile.go_to_menu')}
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {orders.map((order) => (
                    <OrderHistoryItem key={order._id} order={order} showDetails={true} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
