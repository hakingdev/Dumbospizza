"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, ShoppingCart, Minus, Plus, Trash2 } from 'lucide-react';
import { useCart } from '../../lib/contexts/CartContext';
import { useLanguage } from '../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../lib/i18n';
import OrderSummaryBreakdown from './OrderSummaryBreakdown';
import BogoRewardLines from '../promotions/BogoRewardLines';
import { groupCartRows } from '../../lib/cart/combo';
import { ComboCartGroup } from './ComboCartGroup';

interface CartModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CartModal({ isOpen, onClose }: CartModalProps) {
  const { state, updateItem, removeItem, removeCombo } = useCart();
  const {
    items,
    subtotal,
    deliveryFee,
    total,
    promotionCalculation,
    selectedFreeGifts,
    declinedFreeGifts,
    couponCode,
    couponDiscount,
    loyaltyPointsDiscount,
  } = state;
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string, fallback?: string) => fallback ?? k);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };

    loadTranslations();
  }, [language]);

  if (!isOpen) return null;

  const itemLabel = items.length === 1 ? t('cart.item_singular', 'товар') : t('cart.item_plural', 'товара');

  const handleUpdateQuantity = (itemId: string, newQuantity: number) => {
    if (newQuantity < 1) {
      removeItem(itemId);
    } else {
      updateItem(itemId, { quantity: newQuantity });
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className="modal-backdrop animate-fadeIn"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed top-0 right-0 h-full w-full md:w-[450px] bg-white shadow-2xl z-50 flex flex-col animate-slideInRight">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center space-x-3">
            <div className="bg-primary-100 rounded-full p-2">
              <ShoppingCart className="h-6 w-6 text-primary-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{t('cart.title', 'Корзина')}</h2>
              <p className="text-sm text-gray-500">{items.length} {itemLabel}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-2"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-6">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <div className="text-6xl mb-4">🛒</div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">{t('cart.empty', 'Корзина пуста')}</h3>
              <p className="text-gray-600 mb-6">{t('cart.empty_hint', 'Добавьте товары в корзину, чтобы оформить заказ')}</p>
              <button 
                onClick={onClose}
                className="btn-primary"
              >
                {t('cart.go_to_menu', 'Перейти к меню')}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {groupCartRows(items).map((row) => {
                if (row.kind === 'combo') {
                  return (
                    <ComboCartGroup
                      key={row.comboId}
                      group={row}
                      onRemove={removeCombo}
                      freeLabel={t('cart.free', 'gratis')}
                    />
                  );
                }
                const item = row.item;
                return (
                <div key={item.id} className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-start space-x-4">
                    {/* Image placeholder */}
                    <div className="w-20 h-20 bg-gray-200 rounded-lg flex-shrink-0 flex items-center justify-center">
                      <span className="text-2xl">🍕</span>
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-bold text-gray-900">{item.name}</h3>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors ml-2"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {item.size && (
                        <p className="text-sm text-gray-600 mb-1">
                          {item.size.name}{(item.size.label || item.size.size) ? ` (${item.size.label || item.size.size})` : ''}
                        </p>
                      )}

                      {item.options && item.options.length > 0 && (
                        <p className="text-sm text-gray-600 mb-1">
                          + {item.options.map(o => o.name).join(', ')}
                        </p>
                      )}

                      {item.extras?.toppings && item.extras.toppings.length > 0 && (
                        <p className="text-sm text-gray-600 mb-2">
                          + {item.extras.toppings.map(t => t.name).join(', ')}
                        </p>
                      )}

                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center border border-gray-300 rounded-lg">
                          <button
                            onClick={() => handleUpdateQuantity(item.id, item.quantity - 1)}
                            className="p-2 hover:bg-gray-100 transition-colors rounded-l-lg"
                          >
                            <Minus className="h-4 w-4 text-gray-600" />
                          </button>
                          <span className="px-4 py-1 font-medium">{item.quantity}</span>
                          <button
                            onClick={() => handleUpdateQuantity(item.id, item.quantity + 1)}
                            className="p-2 hover:bg-gray-100 transition-colors rounded-r-lg"
                          >
                            <Plus className="h-4 w-4 text-gray-600" />
                          </button>
                        </div>
                        <span className="font-bold text-lg text-primary-600">
                          {(item.price * item.quantity).toFixed(2)} €
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
              {/* Награды акции (2-й товар со скидкой) — строками рядом с товарами */}
              <BogoRewardLines calculation={promotionCalculation} selectedFreeGifts={selectedFreeGifts} variant="card" />
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t bg-white p-6 space-y-4">
            {/* Единый разбор суммы: subtotal → скидки (купон/Treuepunkte/акции) → Gesamtsumme */}
            <OrderSummaryBreakdown
              subtotal={subtotal}
              deliveryFee={deliveryFee}
              total={total}
              couponCode={couponCode}
              couponDiscount={couponDiscount}
              loyaltyPointsDiscount={loyaltyPointsDiscount}
              promotionCalculation={promotionCalculation}
              selectedFreeGifts={selectedFreeGifts}
              declinedFreeGifts={declinedFreeGifts}
              t={t}
              showDelivery={false}
            />

            {/* Actions */}
            <Link 
              href="/checkout"
              className="btn-primary w-full flex items-center justify-center"
              onClick={onClose}
            >
              {t('cart.proceed_to_checkout', 'Оформить заказ')}
            </Link>
            
            <button 
              onClick={onClose}
              className="w-full text-center text-gray-600 hover:text-gray-900 font-medium"
            >
              {t('cart.continue_shopping', 'Продолжить покупки')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
