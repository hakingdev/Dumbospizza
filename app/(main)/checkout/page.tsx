"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, CreditCard, Truck, Check, Landmark, Loader2, Wallet } from 'lucide-react'
import { useCart } from '../../../lib/contexts/CartContext'
import { storageSet } from '../../../lib/safe-storage'
import CouponInput from '../../../components/cart/CouponInput'
import { getConflictingPromotions } from '../../../lib/promotions/coupon-conflict'
import PromotionCartSummary from '../../../components/promotions/PromotionCartSummary'
import BogoRewardLines from '../../../components/promotions/BogoRewardLines'
import LoyaltyRedeem from '../../../components/checkout/LoyaltyRedeem'
import { getBogoPickerMerchandise, getVisibleBogoSecondItems } from '../../../lib/promotions/discount-total'
import { useLanguage } from '../../../lib/contexts/LanguageContext'
import { loadTranslation } from '../../../lib/i18n'
import {
  formatMinutesAsHHmm,
  getNowMinutesInTimeZone,
  parseOrdersTimeToMinutes,
} from '../../../lib/order-acceptance-hours'
import { evaluateDeliveryGate } from '../../../lib/delivery/checkout-gate'
import { NoTranslate } from '../../../components/NoTranslate'
import { trackMetaEvent } from '../../../lib/analytics/meta-pixel'
import {
  isOnlineCheckoutMethod,
  resolveVisibleGroups,
  type CheckoutPaymentMethod,
  type OnlineMethodId,
} from '../../../lib/payments/method-groups'

// Панель онлайн-оплаты — только на клиенте (SumUp/PayPal SDK используют window).
const OnlinePaymentPanel = dynamic(
  () => import('../../../components/checkout/OnlinePaymentPanel'),
  { ssr: false }
)

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

/** Фирменный знак PayPal — в списке методов у PayPal свой логотип, не общая иконка кошелька. */
function PayPalMark() {
  return (
    <svg viewBox="0 0 384 512" className="h-6 w-6 mr-3 shrink-0" aria-hidden="true" focusable="false">
      <path
        fill="#003087"
        d="M111.4 295.9c-3.5 19.2-17.4 108.7-21.5 134-.3 1.8-1 2.5-3 2.5H12.3c-7.6 0-13.1-6.6-12.1-13.9L58.8 46.6c1.5-9.6 10.1-16.9 20-16.9 152.3 0 165.1-3.7 204 11.4 60.1 23.3 65.6 79.5 44 140.3-21.5 62.6-72.5 89.5-140.1 90.3-43.4.7-69.5-7-75.3 24.2z"
      />
      <path
        fill="#009cde"
        d="M357.1 152c-1.8-1.3-2.5-1.8-3 1.3-2 11.4-5.1 22.5-8.8 33.6-39.9 113.8-150.5 103.9-204.5 103.9-6.1 0-10.1 3.3-10.9 9.4-22.6 140.4-27.1 169.7-27.1 169.7-1 7.1 3.5 12.9 10.6 12.9h63.5c8.6 0 15.7-6.3 17.4-14.9.7-5.4-1.1 6.1 14.4-91.3 4.6-22 14.3-19.7 29.3-19.7 71 0 126.4-28.8 142.9-112.3 6.5-34.8 4.6-71.4-23.8-92.6z"
      />
    </svg>
  )
}

export default function CheckoutPage() {
  const router = useRouter()
  const { state, setDeliveryType: setCartDeliveryType, setDeliveryZone: setCartDeliveryZone, setDeliveryFee, setContactInfo, setDeliveryAddress, setPaymentMethod: setCartPaymentMethod, clearCart, applyCoupon, removeCoupon, setPromotionPromoCode, setLoyaltyPoints } = useCart()
  const { language } = useLanguage()
  const [t, setT] = useState<any>(() => (k: string, fallback?: string) => fallback ?? k)
  const [step, setStep] = useState(1)
  const [deliveryType, setDeliveryType] = useState(state.deliveryType || 'delivery')
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([])
  const [deliveryZone, setDeliveryZone] = useState(state.deliveryZone || '')
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>(
    (state.paymentMethod as CheckoutPaymentMethod) || 'card'
  )
  const [termsAccepted, setTermsAccepted] = useState(false)
  // SMS-Marketing-Einwilligung — отдельная, необязательная, по умолчанию НЕ отмечена.
  const [smsConsent, setSmsConsent] = useState(false)
  // Онлайн-оплата: после создания draft-заказа шаг 2 показывает инлайн-панель
  // с РОВНО ОДНИМ виджетом метода, выбранного в списке, — SumUp с whitelist
  // группы (Karte/Apple/Google Pay; позже SEPA) или нативные PayPal-кнопки.
  // Повторного выбора внутри панели нет; «Zurück» возвращает к списку.
  const [onlinePay, setOnlinePay] = useState<{
    orderId: string
    amount: number
    method: OnlineMethodId
    /** Whitelist SumUp-виджета (effectiveSumupIds группы); пуст у PayPal. */
    sumupIds: string[]
    sumupCheckoutId: string | null
    accessToken: string | null
  } | null>(null)
  // Merchant-level allowlist методов SumUp — гейтит видимость онлайн-групп
  // (пустая группа не рендерится). null = прокси недоступен → фолбэк в
  // resolveVisibleGroups (карточная группа остаётся, недоказанные прячутся).
  const [availableSumUpIds, setAvailableSumUpIds] = useState<string[] | null>(null)
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
  // Синхронный гард от двойного клика: state-версия (isSubmitting) в замыкании
  // второго клика того же тика ещё false — ref отсекает дубль немедленно.
  const submitInFlightRef = useRef(false)
  const [orderSettings, setOrderSettings] = useState<any>(null)
  const [orderBlocked, setOrderBlocked] = useState(false)
  const [orderBlockMessage, setOrderBlockMessage] = useState('')

  // Meta Pixel: начало оформления — один раз, когда корзина гидратирована и не пуста
  const initiateCheckoutSent = useRef(false)
  useEffect(() => {
    if (initiateCheckoutSent.current || state.items.length === 0) return
    initiateCheckoutSent.current = true
    trackMetaEvent('InitiateCheckout', {
      content_ids: state.items.map((i) => i.productId || i.id),
      content_type: 'product',
      num_items: state.items.reduce((n, i) => n + i.quantity, 0),
      value: state.total,
      currency: 'EUR',
    })
  }, [state.items, state.total])

  const bogoMerchandise = getBogoPickerMerchandise(state.promotionCalculation)
  const merchandiseSubtotal = state.subtotal + bogoMerchandise
  const bogoItemCount = getVisibleBogoSecondItems(state.promotionCalculation).reduce(
    (sum, item) => sum + item.quantity,
    0
  )
  const [desiredDeliveryTime, setDesiredDeliveryTime] = useState<string>('')
  // Проверка адреса доставки (зона определяется по адресу, не выбором из списка).
  const [zoneCheck, setZoneCheck] = useState<null | {
    canDeliver: boolean
    zone?: { id: string; name: string; minOrderAmount: number; deliveryFee: number; maxDistance: number }
    distance?: number
    message?: string
    reason?: string
  }>(null)
  const [checkingZone, setCheckingZone] = useState(false)

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
          // Зону не выбираем автоматически — она определяется проверкой адреса.
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
      const blockReason = settings.ordersBlockedReason || 'Die Küche ist gerade ausgelastet. Bitte versuchen Sie es später.'
      const beforeOpenTemplate = settings.ordersClosedMessageBeforeOpen || 'Wir öffnen um {time}'
      const afterCloseMessage = settings.ordersClosedMessageAfterClose || 'Wir sind geschlossen und morgen wieder für Sie da.'

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
      const effectiveDeliveryFee = merchandiseSubtotal >= FREE_DELIVERY_THRESHOLD ? 0 : (zone.deliveryFee || 0);
      setDeliveryFee(effectiveDeliveryFee)
    }
  }, [deliveryZone, deliveryZones, setCartDeliveryZone, setDeliveryFee, state.deliveryZone, merchandiseSubtotal])
  
  // Recalculate delivery fee when subtotal changes
  useEffect(() => {
    if (deliveryType === 'delivery' && state.deliveryZone) {
      const zone = deliveryZones.find(z => z._id === state.deliveryZone)
      if (zone) {
        const FREE_DELIVERY_THRESHOLD = 30;
        const effectiveDeliveryFee = merchandiseSubtotal >= FREE_DELIVERY_THRESHOLD ? 0 : (zone.deliveryFee || 0);
        if (state.deliveryFee !== effectiveDeliveryFee) {
          setDeliveryFee(effectiveDeliveryFee)
        }
      }
    }
  }, [merchandiseSubtotal, deliveryType, state.deliveryFee, state.deliveryZone, deliveryZones, setDeliveryFee])

  useEffect(() => {
    if (state.paymentMethod !== paymentMethod) {
      setCartPaymentMethod(paymentMethod)
    }
  }, [paymentMethod, setCartPaymentMethod, state.paymentMethod])

  // Allowlist методов SumUp — запрашиваем при входе на шаг оплаты. Сумму
  // передаём справочно; на пересчёты корзины не перезапрашиваем (allowlist
  // меняется настройками мерчант-аккаунта, прокси кэширует ответ).
  useEffect(() => {
    if (step !== 2) return
    let cancelled = false
    fetch(`/api/payments/sumup/payment-methods?amount=${encodeURIComponent(state.total.toFixed(2))}&currency=EUR`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        setAvailableSumUpIds(data?.success && Array.isArray(data.methods) ? data.methods : null)
      })
      .catch(() => {
        if (!cancelled) setAvailableSumUpIds(null)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // Видимые онлайн-группы: конфиг × allowlist SumUp (единственный источник
  // правды — lib/payments/method-groups). PayPal-пункт от SumUp не зависит.
  const visibleGroups = useMemo(
    () =>
      resolveVisibleGroups(availableSumUpIds, {
        paypalConfigured: Boolean(process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID),
      }),
    [availableSumUpIds]
  )

  // Выбранный онлайн-метод пропал из allowlist (например, сохранённый в
  // корзине из прошлой сессии) — тихо возвращаемся к дефолту, чтобы не
  // отправить заказ с невидимым методом.
  useEffect(() => {
    if (isOnlineCheckoutMethod(paymentMethod) && !visibleGroups.some((g) => g.id === paymentMethod)) {
      setPaymentMethod('card')
    }
  }, [paymentMethod, visibleGroups])

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

    // Изменение адреса сбрасывает предыдущую проверку зоны → Weiter снова блокируется.
    if (name === 'street' || name === 'houseNumber' || name === 'postalCode' || name === 'city') {
      if (zoneCheck) setZoneCheck(null)
      if (deliveryZone) setDeliveryZone('')
    }
  }
  
  const validateStep1 = (): boolean => {
    const newErrors: Record<string, string> = {}
    
    // Validate required contact fields
    if (!contactDetails.name.trim()) {
      newErrors.name = t('checkout.errors.name_required', 'Name ist erforderlich')
    }
    
    if (!contactDetails.phone.trim()) {
      newErrors.phone = t('checkout.errors.phone_required', 'Telefonnummer ist erforderlich')
    } else if (!/^[\d\s\-\+\(\)]+$/.test(contactDetails.phone.trim())) {
      newErrors.phone = t('checkout.errors.phone_invalid', 'Bitte geben Sie eine gültige Telefonnummer ein')
    }
    
    // Validate delivery address if delivery is selected
    if (deliveryType === 'delivery') {
      if (!contactDetails.street.trim()) {
        newErrors.street = t('checkout.errors.street_required', 'Straße ist erforderlich')
      }
      
      if (!contactDetails.houseNumber.trim()) {
        newErrors.houseNumber = t('checkout.errors.house_required', 'Hausnummer ist erforderlich')
      }
      
      if (!contactDetails.postalCode.trim()) {
        newErrors.postalCode = t('checkout.errors.postal_required', 'Postleitzahl ist erforderlich')
      } else if (!/^\d{5}$/.test(contactDetails.postalCode.trim())) {
        newErrors.postalCode = t('checkout.errors.postal_invalid', 'Die Postleitzahl muss 5 Ziffern enthalten')
      }
      
      if (!contactDetails.city.trim()) {
        newErrors.city = t('checkout.errors.city_required', 'Ort ist erforderlich')
      }
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }
  
  const validateStep2 = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!paymentMethod) {
      newErrors.paymentMethod = t('checkout.errors.payment_required', 'Bitte wählen Sie eine Zahlungsmethode')
    }
    if (!termsAccepted) {
      newErrors.terms = t('checkout.errors.terms_required', 'Bitte bestätigen Sie AGB und Widerrufsbelehrung')
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }
  
  // Проверка адреса доставки через /api/delivery/check-zone.
  const handleCheckZone = async () => {
    const { street, houseNumber, postalCode, city } = contactDetails
    if (!street.trim() || !houseNumber.trim() || !postalCode.trim() || !city.trim()) {
      setErrors(prev => ({ ...prev, zone: t('checkout.errors.address_for_check', 'Bitte zuerst die Lieferadresse ausfüllen.') }))
      return
    }
    setErrors(prev => { const n = { ...prev }; delete n.zone; return n })
    setCheckingZone(true)
    setZoneCheck(null)
    try {
      const address = `${street} ${houseNumber}, ${postalCode} ${city}`
      const res = await fetch('/api/delivery/check-zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      })
      const data = await res.json()
      if (data.success && data.canDeliver && data.zone) {
        setZoneCheck({ canDeliver: true, zone: data.zone, distance: data.distance, message: data.message })
        setDeliveryZone(String(data.zone.id)) // существующий effect запишет зону/fee в корзину
      } else {
        setZoneCheck({ canDeliver: false, message: data.message, reason: data.reason })
        setDeliveryZone('')
      }
    } catch (_err) {
      setZoneCheck({ canDeliver: false, message: t('checkout.zone_check_error', 'Fehler bei der Adressprüfung.') })
    } finally {
      setCheckingZone(false)
    }
  }

  // Правило перехода на шаге доставки (pickup — без проверки зоны).
  const deliveryGate = evaluateDeliveryGate({
    deliveryType: deliveryType as 'delivery' | 'pickup',
    addressChecked: !!zoneCheck,
    canDeliver: zoneCheck?.canDeliver ?? false,
    subtotal: merchandiseSubtotal,
    zoneMinOrderAmount: zoneCheck?.canDeliver ? (zoneCheck.zone?.minOrderAmount ?? null) : null,
  })

  const handleNextStep = () => {
    if (step === 1) {
      if (!validateStep1()) {
        return
      }
      // Доставка: не пускаем дальше без валидной зоны / при сумме ниже min-order.
      if (deliveryType === 'delivery' && !deliveryGate.allowed) {
        setErrors(prev => ({
          ...prev,
          zone:
            deliveryGate.reason === 'below_min_order'
              ? `Mindestbestellwert für diese Zone: ${(zoneCheck?.zone?.minOrderAmount ?? 0).toFixed(2)} €. Es fehlen noch ${(deliveryGate.shortfall ?? 0).toFixed(2)} €.`
              : deliveryGate.reason === 'outside_zone'
                ? t('checkout.zone_outside', 'Ihre Adresse liegt außerhalb des Liefergebiets.')
                : t('checkout.zone_check_required', 'Bitte prüfen Sie zuerst Ihre Lieferadresse.'),
        }))
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

    // Двойной клик по кнопке оплаты: пока сабмит в полёте — no-op
    // (ровно один draft-заказ, один SumUp-checkout, один mount виджета).
    if (isSubmitting || submitInFlightRef.current) return

    if (state.items.length === 0) {
      setErrors({ submit: t('checkout.errors.cart_empty', 'Ihr Warenkorb ist leer. Bitte legen Sie zuerst Artikel in den Warenkorb.') })
      return
    }

    if (orderBlocked) {
      setErrors({ submit: orderBlockMessage || t('checkout.errors.closed', 'Derzeit nehmen wir keine Bestellungen an.') })
      return
    }

    if (!termsAccepted) {
      setErrors({ terms: t('checkout.errors.terms_required', 'Bitte bestätigen Sie AGB und Widerrufsbelehrung') })
      return
    }

    // Онлайн-метод должен быть видимой группой (конфиг × allowlist SumUp);
    // иначе просим выбрать способ заново.
    const selectedGroup = isOnlineCheckoutMethod(paymentMethod)
      ? visibleGroups.find((g) => g.id === paymentMethod) || null
      : null
    if (isOnlineCheckoutMethod(paymentMethod) && !selectedGroup) {
      setErrors({ paymentMethod: t('checkout.errors.payment_required', 'Bitte wählen Sie eine Zahlungsmethode') })
      return
    }

    submitInFlightRef.current = true
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
        smsMarketingConsent: smsConsent,
        deliveryAddress: deliveryType === 'delivery' ? {
          street: contactDetails.street,
          houseNumber: contactDetails.houseNumber,
          postalCode: contactDetails.postalCode,
          city: contactDetails.city,
          floor: contactDetails.floor || undefined,
          notes: contactDetails.notes || undefined
        } : undefined,
        // Онлайн-методы (SumUp-группы и PayPal) — клиентский выбор; в БД заказ
        // остаётся 'online' (гейт принт-агента/чеки не меняются), провайдер
        // фиксируется в payments.
        paymentMethod: isOnlineCheckoutMethod(paymentMethod) ? 'online' : paymentMethod,
        subtotal: merchandiseSubtotal,
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
          ([promotionId, sels]) =>
            (Array.isArray(sels) ? sels : [sels]).map((s: any) => ({
              promotionId,
              // новый формат: {itemId, productId}; страховка для старого (строка)
              productId: typeof s === 'string' ? s : s?.productId,
            }))
        ),
        selectedFreeGifts: Object.entries(state.selectedFreeGifts || {}).map(
          ([promotionId, productId]) => ({ promotionId, productId })
        ),
        declinedFreeGifts: Object.entries(state.declinedFreeGifts || {})
          .filter(([, declined]) => declined)
          .map(([promotionId]) => promotionId),
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
        const errorMessage = data.error || t('checkout.errors.order_failed', 'Bestellung konnte nicht erstellt werden')
        console.error('Order creation failed:', errorMessage)
        throw new Error(errorMessage)
      }
      
      if (!data.order || !data.order.id) {
        console.error('Invalid order response:', data)
        throw new Error(t('checkout.errors.server_response', 'Ungültige Antwort vom Server'))
      }
      
      // Подписанный токен доступа к заказу — по нему страница подтверждения
      // открывает заказ и счёт без сессии. Телефон в query больше не шлём.
      // Заказ на сервере уже СОЗДАН. Бросок из sessionStorage (заблокированные
      // cookies / приватный режим на iOS) улетал бы в общий catch, показывал
      // «попробуйте ещё раз» — и клиент оформлял ДУБЛЬ. Токен не критичен:
      // без него страница подтверждения откроется по cookie-сессии.
      if (data.order.accessToken) {
        storageSet(`order:${data.order.id}:token`, data.order.accessToken, 'session')
      }

      // Онлайн-оплата: на сервере создан ДРАФТ (status 'pending_payment', без
      // номера) — в «Заказы» и на кухню он не попадает. «Новым» заказ становится
      // только после серверного подтверждения оплаты (webhook/confirm); отмена
      // или закрытие окна заказ не создают, брошенные драфты чистит TTL-джоба.
      // Показываем модалку с виджетом выбранного провайдера; корзину чистим и
      // редиректим только после подтверждения оплаты.
      if (selectedGroup) {
        if (selectedGroup.provider === 'sumup') {
          // SumUp-группа (Karte / Apple Pay / Google Pay; позже SEPA): checkout
          // создаётся сразу, виджет монтируется с whitelist'ом группы.
          const checkoutRes = await fetch('/api/payments/sumup/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: data.order.id }),
          })
          const checkoutData = await checkoutRes.json()
          if (!checkoutRes.ok || !checkoutData.success) {
            throw new Error(checkoutData.error || t('checkout.errors.payment_init', 'Online-Zahlung konnte nicht gestartet werden'))
          }
          setOnlinePay({
            orderId: data.order.id,
            amount: checkoutData.amount,
            method: selectedGroup.id,
            sumupIds: selectedGroup.effectiveSumupIds,
            sumupCheckoutId: checkoutData.checkoutId,
            accessToken: data.order.accessToken || null,
          })
        } else {
          // PayPal-группы (жёлтая кнопка или SEPA-Lastschrift): Order создаётся
          // лениво самой кнопкой (createOrder → /api/payments/paypal/create-order);
          // сумма — на сервере.
          setOnlinePay({
            orderId: data.order.id,
            amount: data.order.total,
            method: selectedGroup.id,
            sumupIds: [],
            sumupCheckoutId: null,
            accessToken: data.order.accessToken || null,
          })
        }
        submitInFlightRef.current = false
        setIsSubmitting(false)
        return
      }

      // Оплата при получении: сразу завершаем оформление.
      clearCart()

      // Redirect to confirmation page
      console.log('Redirecting to:', `/checkout/confirmation/${data.order.id}`)
      window.location.href = `/checkout/confirmation/${data.order.id}`
    } catch (error: any) {
      console.error('Error submitting order:', error)
      setErrors({ submit: error.message || t('checkout.errors.submit_generic', 'Beim Abschließen der Bestellung ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.') })
      submitInFlightRef.current = false
      setIsSubmitting(false)
    }
  }
  
  // Виджет SumUp сообщил об оплате → подтверждаем на сервере (источник истины),
  // и только при успехе чистим корзину и уходим на страницу подтверждения.
  const handleSumUpPaid = useCallback(async () => {
    if (!onlinePay || !onlinePay.sumupCheckoutId) return
    try {
      const res = await fetch('/api/payments/sumup/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: onlinePay.orderId, checkoutId: onlinePay.sumupCheckoutId }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        // Отложенные методы (redirect-APM / direct debit): checkout ещё PENDING —
        // деньги в обработке, финал придёт вебхуком. Уходим на подтверждение
        // без ?paid=1 (как PayPal-pending), заказ допромоутит вебхук.
        if (res.status === 402 && data?.status === 'PENDING') {
          const pendingOrderId = onlinePay.orderId
          setOnlinePay(null)
          clearCart()
          window.location.href = `/checkout/confirmation/${pendingOrderId}`
          return
        }
        throw new Error(data.error || t('checkout.errors.payment_confirm', 'Zahlung konnte nicht bestätigt werden'))
      }
      const orderId = onlinePay.orderId
      setOnlinePay(null)
      clearCart()
      // ?paid=1 → на странице подтверждения автоматически всплывёт НДС-чек (Beleg).
      window.location.href = `/checkout/confirmation/${orderId}?paid=1`
    } catch (error: any) {
      setErrors({ submit: error.message || t('checkout.errors.payment_confirm', 'Zahlung konnte nicht bestätigt werden') })
    }
  }, [onlinePay, clearCart, t])

  const handleSumUpError = useCallback((message: string) => {
    setErrors({ submit: message })
  }, [])

  // PayPal: capture уже подтверждён сервером (/api/payments/paypal/capture) —
  // здесь только завершение оформления.
  const handlePayPalPaid = useCallback(() => {
    if (!onlinePay) return
    const orderId = onlinePay.orderId
    setOnlinePay(null)
    clearCart()
    window.location.href = `/checkout/confirmation/${orderId}?paid=1`
  }, [onlinePay, clearCart])

  // Capture PENDING: деньги в обработке, финальный статус придёт вебхуком.
  // Уходим на подтверждение без ?paid=1 (чек появится после оплаты).
  const handlePayPalPending = useCallback(() => {
    if (!onlinePay) return
    const orderId = onlinePay.orderId
    setOnlinePay(null)
    clearCart()
    window.location.href = `/checkout/confirmation/${orderId}`
  }, [onlinePay, clearCart])

  // Покупатель закрыл PayPal-окно: заказ остаётся pending, корзина и модалка
  // целы — можно попробовать снова или переключиться на SumUp.
  const handlePayPalCancel = useCallback(() => {
    setErrors({})
  }, [])

  const handlePayPalError = useCallback((message: string) => {
    setErrors({ submit: message })
  }, [])

  // Выбор метода — только в плоском списке шага 2; повторного выбора после
  // сабмита нет («Zurück» в платёжной панели возвращает к списку).
  const selectPaymentMethod = (method: CheckoutPaymentMethod) => {
    setPaymentMethod(method)
    if (errors.paymentMethod) {
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors.paymentMethod
        return newErrors
      })
    }
  }

  const totalItems = state.items.reduce((sum, item) => sum + item.quantity, 0) + bogoItemCount
  
  return (
    <div className="container mx-auto px-4 py-8">
      <Link href="/cart" className="flex items-center text-primary-600 mb-6">
        <ChevronLeft className="w-5 h-5 mr-1" />
        {t('checkout.back_to_cart', 'Zurück zum Warenkorb')}
      </Link>
      
      <h1 className="text-3xl font-bold mb-8">{t('checkout.title', 'Bestellung abschließen')}</h1>
      
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
            <p className="mt-1 text-sm">{t('checkout.steps.address', 'Adresse')}</p>
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
            <p className="mt-1 text-sm">{t('checkout.steps.payment', 'Zahlung')}</p>
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
            <p className="mt-1 text-sm">{t('checkout.steps.confirmation', 'Bestätigung')}</p>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {/* Step 1: Delivery Info */}
          {step === 1 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4">{t('checkout.delivery_info', 'Lieferinformationen')}</h2>
              
              <div className="mb-6">
                <label className="block text-gray-700 font-medium mb-2">{t('checkout.delivery_type_label', 'Wählen Sie die Art der Übergabe:')}</label>
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
                      <p className="font-medium">{t('checkout.delivery', 'Lieferung')}</p>
                      <p className="text-sm text-gray-500">{t('checkout.delivery_time', '30-60 Minuten, zu Stoßzeiten bis 90 Minuten')}</p>
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
                      <p className="font-medium">{t('checkout.pickup', 'Abholung')}</p>
                      <p className="text-sm text-gray-500">{t('checkout.pickup_time', '15-20 Minuten')}</p>
                    </div>
                    {deliveryType === 'pickup' && (
                      <Check className="h-5 w-5 ml-auto text-primary-600" />
                    )}
                  </label>
                </div>
              </div>
              
              {deliveryType === 'delivery' && (
                <div className="mb-6">
                  <p className="text-sm text-gray-600">
                    {t('checkout.zone_auto_hint', 'Ihr Liefergebiet wird anhand Ihrer Adresse unten geprüft.')}
                  </p>

                  {(() => {
                    const start = orderSettings?.deliverySlotStart ?? '17:00'
                    const end = orderSettings?.deliverySlotEnd ?? '21:30'
                    const step = Number(orderSettings?.deliverySlotStepMinutes) || 5
                    const timeZone = orderSettings?.ordersTimeZone || 'Europe/Berlin'
                    const slots = getDeliveryTimeSlots(start, end, step)
                    const visibleSlots = filterSlotsByCurrentTime(slots, timeZone)
                    return (
                      <div className="mt-4">
                        <label className="block text-gray-700 font-medium mb-2">{t('checkout.desired_delivery_time', 'Gewünschte Lieferzeit')}</label>
                        <select
                          className="input"
                          value={visibleSlots.includes(desiredDeliveryTime) ? desiredDeliveryTime : ''}
                          onChange={(e) => setDesiredDeliveryTime(e.target.value)}
                        >
                          <option value="">{t('checkout.as_soon_as_possible', 'So schnell wie möglich')}</option>
                          {visibleSlots.map((slot) => (
                            <option key={slot} value={slot}>{slot}</option>
                          ))}
                        </select>
                      </div>
                    )
                  })()}
                </div>
              )}
              
              <h3 className="text-lg font-medium mb-4">{t('checkout.contact_info', 'Kontaktinformationen')}</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label htmlFor="name" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.name', 'Name')} *</label>
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
                  <label htmlFor="phone" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.phone', 'Telefon')} *</label>
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
                <p className="text-xs text-gray-500 mt-1">{t('checkout.email_hint', 'An diese Adresse wird der Beleg gesendet')}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {t(
                    'checkout.email_marketing_notice',
                    'Wir können Ihre E-Mail-Adresse nutzen, um Sie über eigene ähnliche Angebote zu informieren (§ 7 Abs. 3 UWG). Sie können dem jederzeit über den Abmelde-Link in jeder E-Mail oder per Nachricht an info@dumbospizza.de widersprechen.'
                  )}{' '}
                  <Link href="/datenschutz" className="underline hover:text-gray-600" target="_blank" rel="noreferrer">
                    {t('checkout.email_marketing_more', 'Mehr im Datenschutz')}
                  </Link>
                </p>
              </div>
              
              {deliveryType === 'delivery' && (
                <>
                  <h3 className="text-lg font-medium mb-4">{t('checkout.address_title', 'Lieferadresse')}</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label htmlFor="street" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.street', 'Straße')} *</label>
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
                      <label htmlFor="houseNumber" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.house_number', 'Hausnummer')} *</label>
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
                      <label htmlFor="postalCode" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.postal_code', 'Postleitzahl')} *</label>
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
                      <label htmlFor="city" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.city', 'Ort')} *</label>
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
                    <label htmlFor="floor" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.floor', 'Etage / Wohnung')}</label>
                    <input
                      id="floor"
                      name="floor"
                      type="text"
                      className="input"
                      value={contactDetails.floor}
                      onChange={handleContactDetailChange}
                    />
                  </div>

                  {/* Проверка зоны доставки по адресу */}
                  <div className="mb-6">
                    <button
                      type="button"
                      onClick={handleCheckZone}
                      disabled={checkingZone}
                      className="inline-flex min-h-[40px] items-center justify-center rounded-md border border-primary-600 px-4 py-2 text-center leading-tight text-primary-600 hover:bg-primary-50 disabled:opacity-50"
                    >
                      {checkingZone ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" /> : null}
                      {t('checkout.check_zone', 'Liefergebiet prüfen')}
                    </button>

                    {errors.zone && <p className="mt-2 text-sm text-red-600">{errors.zone}</p>}

                    {zoneCheck?.canDeliver && zoneCheck.message && (
                      <p className="mt-2 text-sm text-green-700">{zoneCheck.message}</p>
                    )}
                    {zoneCheck && !zoneCheck.canDeliver && zoneCheck.message && (
                      <p className="mt-2 text-sm text-red-600">{zoneCheck.message}</p>
                    )}

                    {deliveryGate.reason === 'below_min_order' && (
                      <p className="mt-2 text-sm text-red-600">
                        Mindestbestellwert für diese Zone: {(zoneCheck?.zone?.minOrderAmount ?? 0).toFixed(2)} €.
                        <br />
                        Es fehlen noch {(deliveryGate.shortfall ?? 0).toFixed(2)} €.
                      </p>
                    )}
                  </div>
                </>
              )}
              
              <div className="mb-6">
                <label htmlFor="notes" className="block text-gray-700 text-sm font-medium mb-1">{t('checkout.notes', 'Hinweise zur Bestellung')}</label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  className="input resize-none"
                  placeholder={t('checkout.notes_placeholder', 'Besondere Wünsche oder Hinweise')}
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
                  <span className="ml-2 text-gray-700">{t('checkout.save_info', 'Informationen für nächste Bestellungen speichern')}</span>
                </label>
              </div>
              
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleNextStep}
                  disabled={deliveryType === 'delivery' && !deliveryGate.allowed}
                >
                  {t('common.next', 'Weiter')}
                </button>
              </div>
            </div>
          )}
          
          {/* Step 2: Payment Method */}
          {/* Платёжная панель (draft создан): РОВНО ОДИН виджет выбранного
              метода — SumUp с whitelist группы или PayPal-кнопки. Модалки и
              повторного выбора нет; «Zurück» возвращает к списку. */}
          {step === 2 && onlinePay && (
            <OnlinePaymentPanel
              pay={onlinePay}
              language={language}
              errorMessage={errors.submit}
              t={t}
              onSumUpPaid={handleSumUpPaid}
              onSumUpError={handleSumUpError}
              onPayPalPaid={handlePayPalPaid}
              onPayPalPending={handlePayPalPending}
              onPayPalCancel={handlePayPalCancel}
              onPayPalError={handlePayPalError}
              onBack={() => {
                // Назад к выбору метода: корзина и форма целы. Брошенный
                // draft чистит TTL-джоба, PENDING-checkout SumUp истекает сам.
                setOnlinePay(null)
                setErrors({})
              }}
            />
          )}

          {step === 2 && !onlinePay && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4">{t('checkout.payment_method', 'Zahlungsmethode')}</h2>
              
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
                      setPaymentMethod(e.target.value as 'cash' | 'card' | 'online' | 'paypal')
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
                      <p className="font-medium">{t('checkout.payments.cash', 'Bar bei Lieferung')}</p>
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
                      setPaymentMethod(e.target.value as 'cash' | 'card' | 'online' | 'paypal')
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
                      <p className="font-medium">{t('checkout.payments.card', 'Karte bei Lieferung')}</p>
                    </div>
                    {paymentMethod === 'card' && (
                      <Check className="h-5 w-5 ml-auto text-primary-600" />
                    )}
                  </label>

                  {/* Онлайн-группы из METHOD_GROUPS × allowlist SumUp (плоский
                      список): один клик — один метод, после «Bezahlen» сразу
                      виджет группы, без повторного выбора. */}
                  {visibleGroups.map((group) => (
                    <label
                      key={group.id}
                      className={`flex items-center p-4 border rounded-lg cursor-pointer ${
                        paymentMethod === group.id
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="paymentMethod"
                        value={group.id}
                        checked={paymentMethod === group.id}
                        onChange={() => selectPaymentMethod(group.id)}
                        className="sr-only"
                      />
                      {group.id === 'paypal' ? (
                        <PayPalMark />
                      ) : group.id === 'sepa' ? (
                        <Landmark className="h-6 w-6 mr-3 text-primary-600" />
                      ) : (
                        <Wallet className="h-6 w-6 mr-3 text-primary-600" />
                      )}
                      <div>
                        {group.id === 'paypal' ? (
                          <>
                            <p className="font-medium"><NoTranslate>PayPal</NoTranslate></p>
                            <p className="text-sm text-gray-500">{t('checkout.payments.paypal_hint', 'Mit Ihrem PayPal-Konto bezahlen')}</p>
                          </>
                        ) : group.id === 'sepa' ? (
                          <p className="font-medium">{t('checkout.payments.sepa', 'SEPA-Lastschrift')}</p>
                        ) : (
                          <p className="font-medium">{t('checkout.payments.card_online', 'Karte, Apple Pay & Google Pay')}</p>
                        )}
                      </div>
                      {paymentMethod === group.id && (
                        <Check className="h-5 w-5 ml-auto text-primary-600" />
                      )}
                    </label>
                  ))}
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

              {/* SMS-Marketing-Einwilligung — separat, optional, nicht vorausgewählt (UWG §7) */}
              <div className="mb-6">
                <label className="flex items-start">
                  <input
                    type="checkbox"
                    checked={smsConsent}
                    onChange={(e) => setSmsConsent(e.target.checked)}
                    className="h-4 w-4 mt-1 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-gray-700 text-sm">
                    {t(
                      'checkout.sms_consent',
                      'Ja, ich möchte Angebote und Aktionen von Dumbos Pizza per SMS erhalten. Abmeldung jederzeit möglich.'
                    )}
                  </span>
                </label>
                <p className="ml-6 mt-1 text-xs text-gray-400">
                  {t('checkout.sms_consent_hint', 'Freiwillig — die Bestellung ist auch ohne diese Zustimmung möglich.')}
                </p>
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
              
              <div className="flex flex-col justify-between gap-3 sm:flex-row">
                <button 
                  type="button" 
                  className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-center leading-tight text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  onClick={handlePreviousStep}
                  disabled={isSubmitting}
                >
                  {t('common.back', 'Zurück')}
                </button>
                
                <button 
                  type="button" 
                  className="btn-primary disabled:opacity-50"
                  onClick={handleSubmitOrder}
                  disabled={isSubmitting || orderBlocked}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {t('checkout.submitting', 'Wird gesendet...')}
                    </>
                  ) : isOnlineCheckoutMethod(paymentMethod) ? (
                    <>
                      {t('checkout.pay_now', 'Jetzt bezahlen')}
                      <NoTranslate>{` · ${state.total.toFixed(2)} €`}</NoTranslate>
                    </>
                  ) : (
                    t('checkout.place_order', 'Bestellung abschicken')
                  )}
                </button>
              </div>
            </div>
          )}
          
        </div>
        
        {/* Order Summary */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow-md p-6 sticky top-24">
            <h2 className="text-xl font-bold mb-4">{t('checkout.summary_title', 'Ihre Bestellung')}</h2>
            
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
                            <h4 className="font-semibold text-gray-900"><NoTranslate>{item.name}</NoTranslate></h4>
                            <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded">
                              ×{item.quantity}
                            </span>
                          </div>
                          
                          {item.size && item.size.name && (
                            <p className="text-sm text-gray-700 mb-1">
                              <span className="font-medium">{t('product.size', 'Größe')}:</span> <NoTranslate>{item.size.name}</NoTranslate>
                            </p>
                          )}

                          {item.options && item.options.length > 0 && (
                            <p className="text-sm text-gray-700 mb-1">
                              <NoTranslate>{item.options.map(o => o.name).join(', ')}</NoTranslate>
                            </p>
                          )}

                          {hasExtras && (
                            <div className="text-xs text-gray-600 mt-2 space-y-1">
                              {item.extras?.toppings && item.extras.toppings.length > 0 && (
                                <div>
                                  <span className="font-medium">{t('product.toppings', 'Beläge')}:</span>{' '}
                                  {item.extras.toppings.map((t, i) => (
                                    <span key={i}>
                                      <NoTranslate>{t.name}</NoTranslate>
                                      {i < item.extras!.toppings!.length - 1 && ', '}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {item.extras?.sauces && item.extras.sauces.length > 0 && (
                                <div>
                                  <span className="font-medium">{t('product.sauces', 'Saucen')}:</span>{' '}
                                  {item.extras.sauces.map((s, i) => (
                                    <span key={i}>
                                      <NoTranslate>{s.name}</NoTranslate>
                                      {i < item.extras!.sauces!.length - 1 && ', '}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {item.extras?.sides && item.extras.sides.length > 0 && (
                                <div>
                                  <span className="font-medium">{t('product.sides', 'Beilagen')}:</span>{' '}
                                  {item.extras.sides.map((s, i) => (
                                    <span key={i}>
                                      <NoTranslate>{s.name}</NoTranslate>
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
                            <NoTranslate>{(item.price * item.quantity).toFixed(2)} €</NoTranslate>
                          </p>
                          {item.quantity > 1 && (
                            <p className="text-xs text-gray-500">
                              <NoTranslate>{item.price.toFixed(2)} € × {item.quantity}</NoTranslate>
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
                <p>{t('cart.empty', 'Ihr Warenkorb ist leer')}</p>
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
              declinedFreeGifts={state.declinedFreeGifts}
              t={t}
            />

            {/* Coupon Input */}
            <div className="border-b pb-4 mb-4">
              <CouponInput
                orderAmount={state.items.reduce((s, i) => s + i.price * i.quantity, 0)}
                appliedCode={state.couponCode}
                appliedDiscount={state.couponDiscount}
                onCouponApplied={(coupon) => {
                  applyCoupon(coupon.code, coupon.discount || 0);
                }}
                onCouponRemoved={() => {
                  removeCoupon();
                }}
                onPromotionCodeApplied={(code) => setPromotionPromoCode(code)}
                onPromotionCodeRemoved={() => setPromotionPromoCode(undefined)}
                angebotConflictActive={state.moneyPromotionAvailable}
                angebotName={getConflictingPromotions(state.promotionCalculation)[0]?.promotionName || undefined}
              />
            </div>

            {/* Treuepunkte einlösen — только для авторизованных клиентов с балансом */}
            <LoyaltyRedeem
              orderAmountBeforePoints={state.total + state.loyaltyPointsDiscount}
              appliedPoints={state.loyaltyPointsToRedeem || 0}
              onChange={setLoyaltyPoints}
              t={t}
            />

            <div className="border-b pb-4 mb-4">
              <div className="flex justify-between mb-2">
                <span>{t('checkout.items', 'Artikel')} ({totalItems})</span>
                <NoTranslate className="font-medium">{merchandiseSubtotal.toFixed(2)} €</NoTranslate>
              </div>
              
              <div className="flex justify-between mb-2">
                <span>{t('checkout.delivery', 'Lieferung')}</span>
                <span>{state.deliveryFee === 0 ? t('cart.free_delivery', 'Kostenlos') : <NoTranslate>{state.deliveryFee.toFixed(2)} €</NoTranslate>}</span>
              </div>
              
              {state.couponDiscount > 0 && (
                <div className="flex justify-between text-green-600 text-sm mb-2">
                  <span>{t('checkout.discount_coupon', 'Rabatt mit Gutscheincode')} <NoTranslate>{state.couponCode}</NoTranslate></span>
                  <NoTranslate>-{state.couponDiscount.toFixed(2)} €</NoTranslate>
                </div>
              )}
              
              {state.loyaltyPointsDiscount > 0 && (
                <div className="flex justify-between text-green-600 text-sm mb-2">
                  <span>{t('checkout.discount_points', 'Rabatt (Punkte)')}</span>
                  <NoTranslate>-{state.loyaltyPointsDiscount.toFixed(2)} €</NoTranslate>
                </div>
              )}
            </div>
            
            <div className="flex justify-between font-bold">
              <span>{t('cart.total', 'Gesamt')}</span>
              <NoTranslate>{state.total.toFixed(2)} €</NoTranslate>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
