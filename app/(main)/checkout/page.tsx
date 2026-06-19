"use client";

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, CreditCard, Truck, Check, Loader2 } from 'lucide-react'
import { useCart } from '../../../lib/contexts/CartContext'
import CouponInput from '../../../components/cart/CouponInput'
import { getConflictingPromotions } from '../../../lib/promotions/coupon-conflict'
import PromotionCartSummary from '../../../components/promotions/PromotionCartSummary'
import BogoRewardLines from '../../../components/promotions/BogoRewardLines'
import { validateCoupon } from '../../../lib/api-client'
import { useLanguage } from '../../../lib/contexts/LanguageContext'
import { loadTranslation } from '../../../lib/i18n'
import {
  formatMinutesAsHHmm,
  getNowMinutesInTimeZone,
  parseOrdersTimeToMinutes,
} from '../../../lib/order-acceptance-hours'

type DeliveryZone = {
  _id: string;
  name: string;
  minOrderAmount: number;
  deliveryFee?: number;
  active?: boolean;
  sortOrder?: number;
};

function getDeliveryTimeSlots(startHHmm: string, endHHmm: string, stepMinutes: number): string[] {
  const [sh, sm] = startHHmm.split(':').map(Number);
  const [eh, em] = endHHmm.split(':').map(Number);
  const startM = sh * 60 + (sm || 0);
  let endM = eh * 60 + (em || 0);
  if (endM <= startM) endM += 24 * 60;
  const slots: string[] = [];
  for (let m = startM; m <= endM; m += stepMinutes) {
    const h = Math.floor(m / 60) % 24;
    const min = m % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return slots;
}

function filterSlotsByCurrentTime(slots: string[], timeZone: string): string[] {
  if (!timeZone || typeof timeZone !== 'string') return slots;
  try {
    const now = new Date();
    const hm = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone
    }).formatToParts(now);
    const hour = parseInt(hm.find(p => p.type === 'hour')?.value ?? '0', 10);
    const minute = parseInt(hm.find(p => p.type === 'minute')?.value ?? '0', 10);
    const currentMinutes = hour * 60 + minute;
    return slots.filter((slot) => {
      const [h, m] = slot.split(':').map(Number);
      const slotMinutes = h * 60 + (m || 0);
      return slotMinutes > currentMinutes;
    });
  } catch {
    return slots;
  }
}

export default function CheckoutPage() {
  const router = useRouter()
  const { state, setDeliveryType: setCartDeliveryType, setDeliveryZone: setCartDeliveryZone, setDeliveryFee, setContactInfo, setDeliveryAddress, setPaymentMethod: setCartPaymentMethod, clearCart, applyCoupon, removeCoupon } = useCart()
  const { language } = useLanguage()
  const [t, setT] = useState<any>(() => (k: string) => k)
  const [step, setStep] = useState(1)
  const [deliveryType, setDeliveryType] = useState(state.deliveryType || 'delivery')
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([])
  const [deliveryZone, setDeliveryZone] = useState(state.deliveryZone || '')
  const [paymentMethod, setPaymentMethod] = useState(state.paymentMethod || 'card')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [contactDetails, setContactDetails] = useState({
    name: '',
    phone: '',
    email: '',
    street: '',
    houseNumber: '',
    postalCode: '',
    city: 'Bad Kissingen',
    floor: '',
    notes: '',
    saveAddress: false,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [orderSettings, setOrderSettings] = useState<any>(null)
  const [orderBlocked, setOrderBlocked] = useState(false)
  const [orderBlockMessage, setOrderBlockMessage] = useState('')
  const [desiredDeliveryTime, setDesiredDeliveryTime] = useState<string>('')
  
  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language)
      setT(() => translation)
    }

    loadTranslations()
  }, [language])

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/settings/store', { cache: 'no-store' })
        const data = await response.json()
        if (data.success) {
          setOrderSettings(data.settings || {})
        }
      } catch (error) {
        console.error('Error loading order settings:', error)
      }
    }

    loadSettings()
  }, [deliveryZone])

  useEffect(() => {
    const loadZones = async () => {
      try {
        const response = await fetch('/api/delivery-zones')
        const data = await response.json()
        if (data.success) {
          const zones = data.zones || []
          setDeliveryZones(zones)
          if (!deliveryZone && zones.length > 0) {
            setDeliveryZone(zones[0]._id)
          }
        }
      } catch (error) {
        console.error('Error loading delivery zones:', error)
      }
    }

    loadZones()
  }, [deliveryZone])

  useEffect(() => {
    const evaluateOrderBlock = () => {
      const settings = orderSettings || {}
      const startMinutes = parseOrdersTimeToMinutes(settings.ordersStartHour, 16)
      const endMinutes = parseOrdersTimeToMinutes(settings.ordersEndHour, 22)
      const timeZone = settings.ordersTimeZone || 'Europe/Berlin'
      const blockedUntil = settings.ordersBlockedUntil ? new Date(settings.ordersBlockedUntil) : null
      const blockReason = settings.ordersBlockedReason || 'Кухня переполнена. Попробуйте позже.'
      const beforeOpenTemplate = settings.ordersClosedMessageBeforeOpen || 'Мы откроем в {time}'
      const afterCloseMessage = settings.ordersClosedMessageAfterClose || 'Мы закрыты, вернемся к вам завтра.'

      const now = new Date()
      const nowMinutes = getNowMinutesInTimeZone(timeZone, now)

      if (blockedUntil && blockedUntil.getTime() > now.getTime()) {
        setOrderBlocked(true)
        setOrderBlockMessage(blockReason)
        return
      }

      if (nowMinutes < startMinutes) {
        const timeLabel = formatMinutesAsHHmm(startMinutes)
        setOrderBlocked(true)
        setOrderBlockMessage(beforeOpenTemplate.replace('{time}', timeLabel))
        return
      }

      if (nowMinutes >= endMinutes) {
        setOrderBlocked(true)
        setOrderBlockMessage(afterCloseMessage)
        return
      }

      setOrderBlocked(false)
      setOrderBlockMessage('')
    }

    evaluateOrderBlock()
    const interval = setInterval(evaluateOrderBlock, 60 * 1000)
    return () => clearInterval(interval)
  }, [orderSettings])
  
  // Sync local state with cart context (only when values actually change)
  useEffect(() => {
    if (state.deliveryType !== deliveryType) {
      setCartDeliveryType(deliveryType as 'delivery' | 'pickup')
    }
  }, [deliveryType, setCartDeliveryType, state.deliveryType])

  useEffect(() => {
    const zone = deliveryZones.find(z => z._id === deliveryZone)
    if (zone && state.deliveryZone !== deliveryZone) {
      setCartDeliveryZone(deliveryZone, zone.minOrderAmount)
      // Free delivery for orders >= 30 euros
      const FREE_DELIVERY_THRESHOLD = 30;
      const effectiveDeliveryFee = state.subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : (zone.deliveryFee || 0);
      setDeliveryFee(effectiveDeliveryFee)
    }
  }, [deliveryZone, deliveryZones, setCartDeliveryZone, setDeliveryFee, state.deliveryZone, state.subtotal])
  
  // Recalculate delivery fee when subtotal changes
  useEffect(() => {
    if (deliveryType === 'delivery' && state.deliveryZone) {
      const zone = deliveryZones.find(z => z._id === state.deliveryZone)
      if (zone) {
        const FREE_DELIVERY_THRESHOLD = 30;
        const effectiveDeliveryFee = state.subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : (zone.deliveryFee || 0);
        if (state.deliveryFee !== effectiveDeliveryFee) {
          setDeliveryFee(effectiveDeliveryFee)
        }
      }
    }
  }, [state.subtotal, deliveryType, state.deliveryFee, state.deliveryZone, deliveryZones, setDeliveryFee])

  useEffect(() => {
    if (state.paymentMethod !== paymentMethod) {
      setCartPaymentMethod(paymentMethod as 'cash' | 'card')
    }
  }, [paymentMethod, setCartPaymentMethod, state.paymentMethod])

  const handleContactDetailChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target
    const checked = type === 'checkbox' ? (e.target as HTMLInputElement).checked : undefined
    
    setContactDetails(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))

    // Clear error for this field when user starts typing
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[name]
        return newErrors
      })
    }

    // Update cart context
    if (name === 'name' || name === 'phone' || name === 'email') {
      setContactInfo({ [name]: value })
    }
    
    if (deliveryType === 'delivery' && (name === 'street' || name === 'houseNumber' || name === 'postalCode' || name === 'city' || name === 'floor' || name === 'notes')) {
      setDeliveryAddress({ [name]: value })
    }
  }
  
  const validateStep1 = (): boolean => {
    const newErrors: Record<string, string> = {}
    
    // Validate required contact fields
    if (!contactDetails.name.trim()) {
      newErrors.name = t('checkout.errors.name_required', 'Имя обязательно для заполнения')
    }
    
    if (!contactDetails.phone.trim()) {
      newErrors.phone = t('checkout.errors.phone_required', 'Телефон обязателен для заполнения')
    } else if (!/^[\d\s\-\+\(\)]+$/.test(contactDetails.phone.trim())) {
      newErrors.phone = t('checkout.errors.phone_invalid', 'Введите корректный номер телефона')
    }
    
    // Validate delivery address if delivery is selected
    if (deliveryType === 'delivery') {
      if (!contactDetails.street.trim()) {
        newErrors.street = t('checkout.errors.street_required', 'Улица обязательна для заполнения')
      }
      
      if (!contactDetails.houseNumber.trim()) {
        newErrors.houseNumber = t('checkout.errors.house_required', 'Номер дома обязателен для заполнения')
      }
      
      if (!contactDetails.postalCode.trim()) {
        newErrors.postalCode = t('checkout.errors.postal_required', 'Почтовый индекс обязателен для заполнения')
      } else if (!/^\d{5}$/.test(contactDetails.postalCode.trim())) {
        newErrors.postalCode = t('checkout.errors.postal_invalid', 'Почтовый индекс должен содержать 5 цифр')
      }
      
      if (!contactDetails.city.trim()) {
        newErrors.city = t('checkout.errors.city_required', 'Город обязателен для заполнения')
      }
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }
  
  const validateStep2 = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!paymentMethod) {
      newErrors.paymentMethod = t('checkout.errors.payment_required', 'Выберите способ оплаты')
    }
    if (!termsAccepted) {
      newErrors.terms = t('checkout.errors.terms_required', 'Подтвердите согласие с AGB и Widerrufsbelehrung')
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }
  
  const handleNextStep = () => {
    if (step === 1) {
      if (!validateStep1()) {
        return
      }
      // Save contact info to cart context
      setContactInfo({
        name: contactDetails.name,
        phoneNumber: contactDetails.phone,
        email: contactDetails.email || undefined
      })
      if (deliveryType === 'delivery') {
        setDeliveryAddress({
          street: contactDetails.street,
          houseNumber: contactDetails.houseNumber,
          postalCode: contactDetails.postalCode,
          city: contactDetails.city,
          floor: contactDetails.floor || undefined,
          notes: contactDetails.notes || undefined
        })
      }
    } else if (step === 2) {
      if (!validateStep2()) {
        return
      }
    }
    
    setStep(prev => prev + 1)
  }
  
  const handlePreviousStep = () => {
    setStep(prev => prev - 1)
  }
  
  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (state.items.length === 0) {
      setErrors({ submit: t('checkout.errors.cart_empty', 'Корзина пуста. Добавьте товары перед оформлением заказа.') })
      return
    }

    if (orderBlocked) {
      setErrors({ submit: orderBlockMessage || t('checkout.errors.closed', 'Сейчас заказы не принимаются.') })
      return
    }

    if (!termsAccepted) {
      setErrors({ terms: t('checkout.errors.terms_required', 'Подтвердите согласие с AGB и Widerrufsbelehrung') })
      return
    }
    
    setIsSubmitting(true)
    setErrors({})
    
    try {
      // Prepare order data
      const orderData = {
        items: state.items,
        customerName: contactDetails.name,
        phoneNumber: contactDetails.phone,
        email: contactDetails.email || undefined,
        deliveryType: deliveryType,
        deliveryAddress: deliveryType === 'delivery' ? {
          street: contactDetails.street,
          houseNumber: contactDetails.houseNumber,
          postalCode: contactDetails.postalCode,
          city: contactDetails.city,
          floor: contactDetails.floor || undefined,
          notes: contactDetails.notes || undefined
        } : undefined,
        paymentMethod: paymentMethod,
        subtotal: state.subtotal,
        tax: 0,
        deliveryFee: state.deliveryFee,
        total: state.total,
        loyaltyPointsToRedeem: state.loyaltyPointsToRedeem || 0,
        couponCode: state.couponCode,
        discount: state.couponDiscount > 0 ? {
          code: state.couponCode,
          amount: state.couponDiscount,
          type: 'fixed' as const
        } : undefined,
        notes: contactDetails.notes || undefined,
        desiredDeliveryTime: deliveryType === 'delivery' ? (desiredDeliveryTime || undefined) : undefined,
        // выбор акций — чтобы заказ применил скидку и добавил BOGO/подарок (идёт в чек и Telegram)
        promotionPromoCode: state.promotionPromoCode || undefined,
        selectedBogoSecond: Object.entries(state.selectedBogoSecond || {}).flatMap(
          ([promotionId, ids]) => (Array.isArray(ids) ? ids : [ids]).map((productId) => ({ promotionId, productId }))
        ),
        selectedFreeGifts: Object.entries(state.selectedFreeGifts || {}).map(
          ([promotionId, productId]) => ({ promotionId, productId })
        ),
      }
      
      // Create order via API
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderData)
      })
      
      const data = await response.json()
      
      console.log('Order response:', data)
      
      if (!response.ok || !data.success) {
        const errorMessage = data.error || t('checkout.errors.order_failed', 'Не удалось создать заказ')
        console.error('Order creation failed:', errorMessage)
        throw new Error(errorMessage)
      }
      
      if (!data.order || !data.order.id) {
        console.error('Invalid order response:', data)
        throw new Error(t('checkout.errors.server_response', 'Неверный ответ от сервера'))
      }
      
      // Clear cart
      clearCart()

      sessionStorage.setItem(`order:${data.order.id}:phone`, contactDetails.phone)
      
      // Redirect to confirmation page
      console.log('Redirecting to:', `/checkout/confirmation/${data.order.id}`)
      window.location.href = `/checkout/confirmation/${data.order.id}`
    } catch (error: any) {
      console.error('Error submitting order:', error)
      setErrors({ submit: error.message || t('checkout.errors.submit_generic', 'Произошла ошибка при оформлении заказа. Попробуйте еще раз.') })
      setIsSubmitting(false)
    }
  }
  
  const selectedZone = deliveryZones.find(zone => zone._id === deliveryZone)
  const totalItems = state.items.reduce((sum, item) => sum + item.quantity, 0)
  
  return (
    <div className="container mx-auto px-4 py-8">
      <Link href="/cart" className="flex items-center text-primary-600 mb-6">
        <ChevronLeft className="w-5 h-5 mr-1" />
        {t('checkout.back_to_cart', 'Вернуться в корзину')}
      </Link>
      
      <h1 className="text-3xl font-bold mb-8">{t('checkout.title', 'Оформление заказа')}</h1>
      
      {/* Steps Progress */}
      <div className="flex mb-10">
        <div className="flex-1">
          <div className={`h-1 ${step >= 1 ? 'bg-primary-500' : 'bg-gray-200'}`}></div>
          <div className="mt-2 text-center">
            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${
              step >= 1 ? 'bg-primary-500 text-white' : 'bg-gray-200 text-gray-600'
            }`}>
              1
            </span>
            <p className="mt-1 text-sm">{t('checkout.steps.address', 'Адрес')}</p>
          </div>
        </div>
        
        <div className="flex-1">
          <div className={`h-1 ${step >= 2 ? 'bg-primary-500' : 'bg-gray-200'}`}></div>
          <div className="mt-2 text-center">
            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${
              step >= 2 ? 'bg-primary-500 text-white' : 'bg-gray-200 text-gray-600'
            }`}>
              2
            </span>
            <p className="mt-1 text-sm">{t('checkout.steps.payment', 'Оплата')}</p>
          </div>
        </div>
        
        <div className="flex-1">
          <div className={`h-1 ${step >= 3 ? 'bg-primary-500' : 'bg-gray-200'}`}></div>
          <div className="mt-2 text-center">
            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${
              step >= 3 ? 'bg-primary-500 text-white' : 'bg-gray-200 text-gray-600'
            }`}>
              3
            </span>
            <p className="mt-1 text-sm">{t('checkout.steps.confirmation', 'Подтверждение')}</p>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {/* Step 1: Delivery Info */}
          {step === 1 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4">{t('checkout.delivery_info', 'Информация о доставке')}</h2>
              
              <div className="mb-6">
                <label className="block text-gray-700 font-medium mb-2">{t('checkout.delivery_type_label', 'Выберите способ получения:')}</label>
                <div className="flex flex-col md:flex-row gap-4">
                  <label className={`flex items-center p-4 border rounded-lg cursor-pointer ${
                    deliveryType === 'delivery' 
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                    <input
                      type="radio"
                      name="deliveryType"
                      value="delivery"
                      checked={deliveryType === 'delivery'}
                      onChange={(e) => setDeliveryType(e.target.value as 'delivery' | 'pickup')}
                      className="sr-only"
                    />
                    <Truck className="h-6 w-6 mr-3 text-primary-600" />
                    <div>
                      <p className="font-medium">{t('checkout.delivery', 'Доставка')}</p>
                      <p className="text-sm text-gray-500">{t('checkout.delivery_time', '30-45 минут')}</p>
                    </div>
                    {deliveryType === 'delivery' && (
                      <Check className="h-5 w-5 ml-auto text-primary-600" />
                    )}
                  </label>
                  
                  <label className={`flex items-center p-4 border rounded-lg cursor-pointer ${
                    deliveryType === 'pickup' 
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                    <input
                      type="radio"
                      name="deliveryType"
                      value="pickup"
                      checked={deliveryType === 'pickup'}
                      onChange={(e) => setDeliveryType(e.target.value as 'delivery' | 'pickup')}
                      className="sr-only"
                    />
                    <div className="h-6 w-6 mr-3 text-primary-600 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium">{t('checkout.pickup', 'Самовывоз')}</p>
                      <p className="text-sm text-gray-500">{t('checkout.pickup_time', '15-20 минут')}</p>
                    </div>
                    {deliveryType === 'pickup' && (
                      <Check className="h-5 w-5 ml-auto text-primary-600" />
                    )}
                  </label>
                </div>
              </div>
              
              {deliveryType === 'delivery' && (
                <div className="mb-6">
                  <label className="block text-gray-700 font-medium mb-2">{t('checkout.zone_label', 'Выберите район доставки:')}</label>
                  <select
                    className="input"
                    value={deliveryZone}
                    onChange={(e) => setDeliveryZone(e.target.value)}
                  >
                    {deliveryZones.map(zone => (
                      <option key={zone._id} value={zone._id}>
                        {zone.name} ({t('checkout.min_order_short', 'мин. заказ')} {zone.minOrderAmount} €)
                      </option>
                    ))}
                  </select>
                  
                  {selectedZone && state.subtotal < selectedZone.minOrderAmount && (
                    <p className="mt-2 text-red-500 text-sm">
                      {t('checkout.min_order_zone', 'Минимальная сумма заказа для этой зоны')} {selectedZone.minOrderAmount} €. 
                      {t('checkout.min_order_missing', 'Вам не хватает')} {(selectedZone.minOrderAmount - state.subtotal).toFixed(2)} €.
                    </p>
                  )}

                  {(() => {
                    const start = orderSettings?.deliverySlotStart ?? '16:00'
                    const end = orderSettings?.deliverySlotEnd ?? '22:00'
                    const step = Number(orderSettings?.deliverySlotStepMinutes) || 5
                    const timeZone = orderSettings?.ordersTimeZone || 'Europe/Berlin'
                    const slots = getDeliveryTimeSlots(start, end, step)
                    const visibleSlots = filterSlotsByCurrentTime(slots, timeZone)
                    return (
                      <div className="mt-4">
                        <label className="block text-gray-700 font-medium mb-2">{t('checkout.desired_delivery_time', 'Желаемое время доставки')}</label>
                        <select
                          className="input"
                          value={visibleSlots.includes(desiredDeliveryTime) ? desiredDeliveryTime : ''}
                          onChange={(e) => setDesiredDeliveryTime(e.target.value)}
                        >
                          <option value="">{t('checkout.as_soon_as_possible', 'Как можно раньше')}</option>
                          {visibleSlots.map((slot) => (
                            <option key={slot} value={slot}>{slot}</option>
                          ))}
                        </select>
                      </div>
                    )
                  })()}
                </div>
              )}
              
              <h3 className="text-lg font-medium mb-4">{t('checkout.contact_info', 'Контактная информация')}</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label htmlFor="name" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.name', 'Имя')} *</label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    className={`input ${errors.name ? 'border-red-500' : ''}`}
                    value={contactDetails.name}
                    onChange={handleContactDetailChange}
                  />
                  {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
                </div>
                
                <div>
                  <label htmlFor="phone" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.phone', 'Телефон')} *</label>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    required
                    className={`input ${errors.phone ? 'border-red-500' : ''}`}
                    value={contactDetails.phone}
                    onChange={handleContactDetailChange}
                  />
                  {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
                </div>
              </div>
              
              <div className="mb-4">
                <label htmlFor="email" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.email', 'Email')}</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  className="input"
                  value={contactDetails.email}
                  onChange={handleContactDetailChange}
                />
                <p className="text-xs text-gray-500 mt-1">{t('checkout.email_hint', 'На этот адрес будет отправлен чек')}</p>
              </div>
              
              {deliveryType === 'delivery' && (
                <>
                  <h3 className="text-lg font-medium mb-4">{t('checkout.address_title', 'Адрес доставки')}</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label htmlFor="street" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.street', 'Улица')} *</label>
                      <input
                        id="street"
                        name="street"
                        type="text"
                        required
                        className={`input ${errors.street ? 'border-red-500' : ''}`}
                        value={contactDetails.street}
                        onChange={handleContactDetailChange}
                      />
                      {errors.street && <p className="text-red-500 text-xs mt-1">{errors.street}</p>}
                    </div>
                    
                    <div>
                      <label htmlFor="houseNumber" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.house_number', 'Номер дома')} *</label>
                      <input
                        id="houseNumber"
                        name="houseNumber"
                        type="text"
                        required
                        className={`input ${errors.houseNumber ? 'border-red-500' : ''}`}
                        value={contactDetails.houseNumber}
                        onChange={handleContactDetailChange}
                      />
                      {errors.houseNumber && <p className="text-red-500 text-xs mt-1">{errors.houseNumber}</p>}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label htmlFor="postalCode" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.postal_code', 'Почтовый индекс')} *</label>
                      <input
                        id="postalCode"
                        name="postalCode"
                        type="text"
                        required
                        className={`input ${errors.postalCode ? 'border-red-500' : ''}`}
                        placeholder="97688"
                        value={contactDetails.postalCode}
                        onChange={handleContactDetailChange}
                      />
                      {errors.postalCode && <p className="text-red-500 text-xs mt-1">{errors.postalCode}</p>}
                    </div>
                    
                    <div>
                      <label htmlFor="city" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.city', 'Город')} *</label>
                      <input
                        id="city"
                        name="city"
                        type="text"
                        required
                        className={`input ${errors.city ? 'border-red-500' : ''}`}
                        value={contactDetails.city}
                        onChange={handleContactDetailChange}
                      />
                      {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city}</p>}
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    <label htmlFor="floor" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.floor', 'Этаж / Квартира')}</label>
                    <input
                      id="floor"
                      name="floor"
                      type="text"
                      className="input"
                      value={contactDetails.floor}
                      onChange={handleContactDetailChange}
                    />
                  </div>
                </>
              )}
              
              <div className="mb-6">
                <label htmlFor="notes" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.notes', 'Примечания к заказу')}</label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  className="input resize-none"
                  placeholder={t('checkout.notes_placeholder', 'Особые пожелания или инструкции')}
                  value={contactDetails.notes}
                  onChange={handleContactDetailChange}
                ></textarea>
              </div>
              
              <div className="mb-6">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    name="saveAddress"
                    checked={contactDetails.saveAddress}
                    onChange={handleContactDetailChange}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-gray-700">{t('checkout.save_info', 'Сохранить информацию для следующих заказов')}</span>
                </label>
              </div>
              
              <div className="flex justify-end">
                <button 
                  type="button" 
                  className="btn-primary"
                  onClick={handleNextStep}
                >
                  {t('common.next', 'Далее')}
                </button>
              </div>
            </div>
          )}
          
          {/* Step 2: Payment Method */}
          {step === 2 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4">{t('checkout.payment_method', 'Способ оплаты')}</h2>
              
              {errors.paymentMethod && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm">{errors.paymentMethod}</p>
                </div>
              )}
              
              <div className="mb-6">
                <div className="flex flex-col gap-4">
                  <label className={`flex items-center p-4 border rounded-lg cursor-pointer ${
                    paymentMethod === 'cash' 
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="cash"
                      checked={paymentMethod === 'cash'}
                      onChange={(e) => {
                      setPaymentMethod(e.target.value as 'cash' | 'card')
                      if (errors.paymentMethod) {
                        setErrors(prev => {
                          const newErrors = { ...prev }
                          delete newErrors.paymentMethod
                          return newErrors
                        })
                      }
                    }}
                      className="sr-only"
                    />
                    <div className="h-6 w-6 mr-3 text-primary-600 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium">{t('checkout.payments.cash', 'Наличными при получении')}</p>
                    </div>
                    {paymentMethod === 'cash' && (
                      <Check className="h-5 w-5 ml-auto text-primary-600" />
                    )}
                  </label>
                  
                  <label className={`flex items-center p-4 border rounded-lg cursor-pointer ${
                    paymentMethod === 'card' 
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="card"
                      checked={paymentMethod === 'card'}
                      onChange={(e) => {
                      setPaymentMethod(e.target.value as 'cash' | 'card')
                      if (errors.paymentMethod) {
                        setErrors(prev => {
                          const newErrors = { ...prev }
                          delete newErrors.paymentMethod
                          return newErrors
                        })
                      }
                    }}
                      className="sr-only"
                    />
                    <CreditCard className="h-6 w-6 mr-3 text-primary-600" />
                    <div>
                      <p className="font-medium">{t('checkout.payments.card', 'Картой при получении')}</p>
                    </div>
                    {paymentMethod === 'card' && (
                      <Check className="h-5 w-5 ml-auto text-primary-600" />
                    )}
                  </label>
                </div>
              </div>

              <div className="mb-6">
                <label className="flex items-start">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => {
                      setTermsAccepted(e.target.checked)
                      if (errors.terms) {
                        setErrors(prev => {
                          const newErrors = { ...prev }
                          delete newErrors.terms
                          return newErrors
                        })
                      }
                    }}
                    className="h-4 w-4 mt-1 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-gray-700 text-sm">
                    {t('checkout.terms_prefix', 'Ich habe die')}{' '}
                    <Link href="/agb" className="text-primary-600 hover:underline" target="_blank" rel="noreferrer">
                      {t('checkout.terms_agb', 'AGB')}
                    </Link>{' '}
                    {t('checkout.terms_and', 'und die')}{' '}
                    <Link href="/widerrufsbelehrung" className="text-primary-600 hover:underline" target="_blank" rel="noreferrer">
                      {t('checkout.terms_withdrawal', 'Widerrufsbelehrung')}
                    </Link>{' '}
                    {t('checkout.terms_suffix', 'gelesen und bin mit deren Geltung einverstanden.')}
                  </span>
                </label>
                {errors.terms && (
                  <p className="text-red-600 text-sm mt-2">{errors.terms}</p>
                )}
              </div>
              
              {errors.submit && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm">{errors.submit}</p>
                </div>
              )}

              {orderBlocked && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-amber-800 text-sm">{orderBlockMessage}</p>
                </div>
              )}
              
              <div className="flex justify-between">
                <button 
                  type="button" 
                  className="border border-gray-300 bg-white text-gray-700 py-2 px-4 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
                  onClick={handlePreviousStep}
                  disabled={isSubmitting}
                >
                  {t('common.back', 'Назад')}
                </button>
                
                <button 
                  type="button" 
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                  onClick={handleSubmitOrder}
                  disabled={isSubmitting || orderBlocked}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {t('checkout.submitting', 'Оформление...')}
                    </>
                  ) : (
                    t('checkout.place_order', 'Оформить заказ')
                  )}
                </button>
              </div>
            </div>
          )}
          
        </div>
        
        {/* Order Summary */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow-md p-6 sticky top-24">
            <h2 className="text-xl font-bold mb-4">{t('checkout.summary_title', 'Ваш заказ')}</h2>
            
            {/* Cart Items List */}
            {state.items.length > 0 ? (
              <div className="border-b pb-4 mb-4 max-h-64 overflow-y-auto space-y-3">
                {state.items.map((item, index) => {
                  const hasExtras = item.extras && (
                    (item.extras.toppings && item.extras.toppings.length > 0) ||
                    (item.extras.sauces && item.extras.sauces.length > 0) ||
                    (item.extras.sides && item.extras.sides.length > 0)
                  );
                  
                  return (
                    <div key={`${item.id}-${item.size?.id || 'no-size'}-${index}`} className="bg-gray-50 rounded-lg p-3">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold text-gray-900">{item.name}</h4>
                            <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded">
                              ×{item.quantity}
                            </span>
                          </div>
                          
                          {item.size && item.size.name && (
                            <p className="text-sm text-gray-700 mb-1">
                              <span className="font-medium">{t('product.size', 'Размер')}:</span> {item.size.name}
                            </p>
                          )}

                          {item.options && item.options.length > 0 && (
                            <p className="text-sm text-gray-700 mb-1">
                              {item.options.map(o => o.name).join(', ')}
                            </p>
                          )}

                          {hasExtras && (
                            <div className="text-xs text-gray-600 mt-2 space-y-1">
                              {item.extras?.toppings && item.extras.toppings.length > 0 && (
                                <div>
                                  <span className="font-medium">{t('product.toppings', 'Топпинги')}:</span>{' '}
                                  {item.extras.toppings.map((t, i) => (
                                    <span key={i}>
                                      {t.name}
                                      {i < item.extras!.toppings!.length - 1 && ', '}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {item.extras?.sauces && item.extras.sauces.length > 0 && (
                                <div>
                                  <span className="font-medium">{t('product.sauces', 'Соусы')}:</span>{' '}
                                  {item.extras.sauces.map((s, i) => (
                                    <span key={i}>
                                      {s.name}
                                      {i < item.extras!.sauces!.length - 1 && ', '}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {item.extras?.sides && item.extras.sides.length > 0 && (
                                <div>
                                  <span className="font-medium">{t('product.sides', 'Дополнения')}:</span>{' '}
                                  {item.extras.sides.map((s, i) => (
                                    <span key={i}>
                                      {s.name}
                                      {i < item.extras!.sides!.length - 1 && ', '}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        
                        <div className="ml-4 text-right">
                          <p className="font-semibold text-gray-900">
                            {(item.price * item.quantity).toFixed(2)} €
                          </p>
                          {item.quantity > 1 && (
                            <p className="text-xs text-gray-500">
                              {item.price.toFixed(2)} € × {item.quantity}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="border-b pb-4 mb-4 text-center py-8 text-gray-500">
                <p>{t('cart.empty', 'Корзина пуста')}</p>
              </div>
            )}

            {/* Награды акции (2-й товар со скидкой) — строками рядом с товарами */}
            <div className="border-b pb-4 mb-4 space-y-2 empty:hidden">
              <BogoRewardLines calculation={state.promotionCalculation} selectedFreeGifts={state.selectedFreeGifts} variant="compact" />
            </div>

            {/* Скидки/подарки */}
            <PromotionCartSummary
              calculation={state.promotionCalculation}
              selectedFreeGifts={state.selectedFreeGifts}
              t={t}
            />

            {/* Coupon Input */}
            <div className="border-b pb-4 mb-4">
              <CouponInput
                orderAmount={state.subtotal}
                onCouponApplied={(coupon) => {
                  applyCoupon(coupon.code, coupon.discount || 0);
                }}
                onCouponRemoved={() => {
                  removeCoupon();
                }}
                angebotConflictActive={state.moneyPromotionAvailable}
                angebotName={getConflictingPromotions(state.promotionCalculation)[0]?.promotionName || undefined}
              />
            </div>
            
            <div className="border-b pb-4 mb-4">
              <div className="flex justify-between mb-2">
                <span>{t('checkout.items', 'Товары')} ({totalItems})</span>
                <span className="font-medium">{state.subtotal.toFixed(2)} €</span>
              </div>
              
              <div className="flex justify-between mb-2">
                <span>{t('checkout.delivery', 'Доставка')}</span>
                <span>{state.deliveryFee === 0 ? t('cart.free_delivery', 'Бесплатно') : `${state.deliveryFee.toFixed(2)} €`}</span>
              </div>
              
              {state.couponDiscount > 0 && (
                <div className="flex justify-between text-green-600 text-sm mb-2">
                  <span>{t('checkout.discount_coupon', 'Скидка по промокоду')} {state.couponCode}</span>
                  <span>-{state.couponDiscount.toFixed(2)} €</span>
                </div>
              )}
              
              {state.loyaltyPointsDiscount > 0 && (
                <div className="flex justify-between text-green-600 text-sm mb-2">
                  <span>{t('checkout.discount_points', 'Скидка (баллы)')}</span>
                  <span>-{state.loyaltyPointsDiscount.toFixed(2)} €</span>
                </div>
              )}
            </div>
            
            <div className="flex justify-between font-bold">
              <span>{t('cart.total', 'Итого')}</span>
              <span>{state.total.toFixed(2)} €</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
