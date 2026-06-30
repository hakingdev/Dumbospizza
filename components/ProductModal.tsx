"use client";

import { useState, useEffect, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X, Plus, Minus, ShoppingCart, Check } from 'lucide-react';
import { useCart } from '../lib/contexts/CartContext';
import { useLanguage } from '../lib/contexts/LanguageContext';
import { loadTranslation } from '../lib/i18n';
import { normalizeObjectId } from '../lib/normalize-id';
import { getSizePrice } from '../lib/product-pricing';
import { ProductPromotionsBanner } from './promotions/PromotionBadges';
import { SafeImage } from './SafeImage';

interface Extra {
  name: string;
  price: number;
}

interface Size {
  id: string;
  variationId?: string;
  name: string;
  label?: string;
  price?: number;
  // legacy
  size?: string;
  priceModifier?: number;
}

interface OptionItem {
  _id: string;
  name: string;
  price: number;
}

interface OptionGroup {
  _id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  optionIds: OptionItem[];
}

interface Product {
  _id: string;
  name: string;
  description: string;
  basePrice: number;
  image: string;
  available: boolean;
  category?: string;
  extras?: {
    toppings?: Extra[];
    sauces?: Extra[];
    sides?: Extra[];
  };
  optionGroupIds?: OptionGroup[];
  sizes?: Size[];
}

interface ProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  productId: string;
}

export default function ProductModal({ isOpen, onClose, productId }: ProductModalProps) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [selectedSize, setSelectedSize] = useState<Size | null>(null);
  const [selectedToppings, setSelectedToppings] = useState<Extra[]>([]);
  const [selectedSauces, setSelectedSauces] = useState<Extra[]>([]);
  const [selectedSides, setSelectedSides] = useState<Extra[]>([]);
  // выбранные опции по группам: { [groupId]: OptionItem[] }
  const [selectedOptions, setSelectedOptions] = useState<Record<string, OptionItem[]>>({});
  const [optionError, setOptionError] = useState<string>('');
  const { addItem } = useCart();
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string, fallback?: string) => fallback ?? k);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/products/${productId}`);
        const data = await response.json();
        
        if (data.success) {
          setProduct(data.product);
          // Set default size
          if (data.product.sizes && data.product.sizes.length > 0) {
            setSelectedSize(data.product.sizes[0]);
          }
          // сброс выбранных опций при открытии нового товара
          setSelectedOptions({});
          setOptionError('');
        }
      } catch (error) {
        console.error('Error fetching product:', error);
      } finally {
        setLoading(false);
      }
    };

    if (isOpen && productId) {
      fetchProduct();
    }
  }, [isOpen, productId]);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };

    loadTranslations();
  }, [language]);

  const toggleTopping = (topping: Extra) => {
    setSelectedToppings(prev => {
      const exists = prev.find(t => t.name === topping.name);
      if (exists) {
        return prev.filter(t => t.name !== topping.name);
      }
      return [...prev, topping];
    });
  };

  const toggleSauce = (sauce: Extra) => {
    setSelectedSauces(prev => {
      const exists = prev.find(s => s.name === sauce.name);
      if (exists) {
        return prev.filter(s => s.name !== sauce.name);
      }
      return [...prev, sauce];
    });
  };

  const toggleSide = (side: Extra) => {
    setSelectedSides(prev => {
      const exists = prev.find(s => s.name === side.name);
      if (exists) {
        return prev.filter(s => s.name !== side.name);
      }
      return [...prev, side];
    });
  };

  // Выбор опции в группе с учётом правил (maxSelect: 1 = переключатель, иначе чекбоксы)
  const toggleOption = (group: OptionGroup, option: OptionItem) => {
    setOptionError('');
    setSelectedOptions((prev) => {
      const current = prev[group._id] || [];
      const exists = current.some((o) => o._id === option._id);
      let next: OptionItem[];
      if (exists) {
        next = current.filter((o) => o._id !== option._id);
      } else if (group.maxSelect === 1) {
        next = [option]; // одиночный выбор
      } else if (group.maxSelect > 0 && current.length >= group.maxSelect) {
        // достигнут лимит — заменяем самый старый? нет, просто игнорируем
        return prev;
      } else {
        next = [...current, option];
      }
      return { ...prev, [group._id]: next };
    });
  };

  const isOptionSelected = (groupId: string, optionId: string) =>
    (selectedOptions[groupId] || []).some((o) => o._id === optionId);

  // Проверка обязательных групп; возвращает текст ошибки или ''
  const validateOptions = (): string => {
    const groups = product?.optionGroupIds || [];
    for (const g of groups) {
      const count = (selectedOptions[g._id] || []).length;
      const min = Math.max(g.minSelect || 0, g.required ? 1 : 0);
      if (count < min) {
        return `Выберите ${min > 1 ? `минимум ${min} в группе` : 'опцию в группе'} «${g.name}»`;
      }
    }
    return '';
  };

  const calculateTotal = () => {
    if (!product) return 0;

    // Абсолютная цена выбранного размера (или базовая цена, если размеров нет)
    let basePrice = selectedSize
      ? getSizePrice(product, selectedSize)
      : product.basePrice;

    // Add toppings
    const toppingsTotal = selectedToppings.reduce((sum, t) => sum + t.price, 0);
    
    // Add sauces
    const saucesTotal = selectedSauces.reduce((sum, s) => sum + s.price, 0);
    
    // Add sides
    const sidesTotal = selectedSides.reduce((sum, s) => sum + s.price, 0);

    // Add option groups
    const optionsTotal = Object.values(selectedOptions)
      .flat()
      .reduce((sum, o) => sum + (Number(o.price) || 0), 0);

    return (basePrice + toppingsTotal + saucesTotal + sidesTotal + optionsTotal) * quantity;
  };

  // Плоский список выбранных опций для корзины/заказа
  const buildSelectedOptions = () => {
    const groups = product?.optionGroupIds || [];
    const result: Array<{ groupId: string; group: string; name: string; price: number }> = [];
    for (const g of groups) {
      for (const o of selectedOptions[g._id] || []) {
        result.push({ groupId: g._id, group: g.name, name: o.name, price: Number(o.price) || 0 });
      }
    }
    return result;
  };

  const handleAddToCart = () => {
    if (!product) return;

    const err = validateOptions();
    if (err) {
      setOptionError(err);
      return;
    }

    const chosenOptions = buildSelectedOptions();

    addItem({
      id: product._id,
      productId: product._id,
      categoryId: normalizeObjectId(product.category),
      name: product.name,
      price: calculateTotal() / quantity,
      quantity: quantity,
      basePrice: product.basePrice,
      image: product.image,
      size: selectedSize ? {
        id: selectedSize.id,
        variationId: selectedSize.variationId,
        name: selectedSize.name,
        label: selectedSize.label ?? selectedSize.size ?? '',
        price: getSizePrice(product, selectedSize),
        // legacy для обратной совместимости отображения
        size: selectedSize.label ?? selectedSize.size ?? '',
        priceModifier: selectedSize.priceModifier ?? 0
      } : undefined,
      options: chosenOptions.length > 0 ? chosenOptions : undefined,
      extras: {
        toppings: selectedToppings.length > 0 ? selectedToppings : undefined,
        sauces: selectedSauces.length > 0 ? selectedSauces : undefined,
        sides: selectedSides.length > 0 ? selectedSides : undefined
      }
    });

    // Reset and close
    setQuantity(1);
    setSelectedToppings([]);
    setSelectedSauces([]);
    setSelectedSides([]);
    setSelectedOptions({});
    onClose();
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-50" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-stretch sm:items-center justify-center p-0 sm:p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 sm:scale-95"
              enterTo="opacity-100 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 sm:scale-100"
              leaveTo="opacity-0 sm:scale-95"
            >
              <Dialog.Panel className="relative w-full sm:max-w-3xl h-[100dvh] sm:h-auto sm:max-h-[90vh] transform overflow-hidden rounded-none sm:rounded-2xl bg-white shadow-xl transition-all flex flex-col">
                {loading ? (
                  <div className="p-12 text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">{t('common.loading', 'Загрузка...')}</p>
                  </div>
                ) : product ? (
                  <>
                    <button
                      onClick={onClose}
                      className="absolute top-3 right-3 z-20 bg-white/90 backdrop-blur rounded-full p-2 shadow-lg hover:bg-white transition-colors"
                    >
                      <X className="h-5 w-5" />
                    </button>

                    <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
                     <div className="px-4 py-4 sm:px-6 sm:py-6">
                      <div className="grid lg:grid-cols-2 gap-6 lg:gap-8 items-start">
                      {/* Фото — справа на десктопе, сверху на мобильном */}
                      <div className="order-1 lg:order-2 lg:sticky lg:top-0">
                        {product.image && !product.image.includes('default-product') ? (
                          <SafeImage
                            src={product.image}
                            alt={product.name}
                            className="w-full max-h-[42vh] lg:max-h-[60vh] object-contain rounded-xl bg-gray-50"
                          />
                        ) : (
                          <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl aspect-[4/3] flex items-center justify-center">
                            <div className="text-center">
                              <div className="text-7xl mb-2">🍕</div>
                              <p className="text-gray-600 font-semibold">{product.name}</p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Конфигурация — слева на десктопе */}
                      <div className="order-2 lg:order-1 min-w-0">
                      <h2 className="text-2xl sm:text-3xl font-bold mb-2">{product.name}</h2>
                      <p className="text-gray-600 mb-4">{product.description}</p>

                      <div className="mb-6">
                        <ProductPromotionsBanner productId={product._id} categoryId={product.category} />
                      </div>

                      {/* Sizes — вертикальный список (Lieferando-стиль) */}
                      {product.sizes && product.sizes.length > 0 && (
                        <div className="mb-6">
                          <h3 className="text-lg sm:text-xl font-bold mb-3">{t('product_modal.size_title', 'Выберите размер:')}</h3>
                          <div className="space-y-2">
                            {product.sizes.map((size) => {
                              const sel = selectedSize?.id === size.id;
                              const sub = size.label ?? size.size;
                              return (
                                <button
                                  key={size.id}
                                  onClick={() => setSelectedSize(size)}
                                  className={`w-full p-3 sm:p-4 rounded-xl border-2 transition-all text-left flex items-center justify-between gap-3 ${
                                    sel ? 'border-primary-600 bg-primary-50' : 'border-gray-200 hover:border-primary-300'
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="font-bold">{size.name}</div>
                                    {sub && <div className="text-sm text-gray-600 truncate">{sub}</div>}
                                  </div>
                                  <div className="flex items-center gap-3 flex-shrink-0">
                                    <span className="text-primary-600 font-semibold whitespace-nowrap">
                                      {getSizePrice(product, size).toFixed(2)}€
                                    </span>
                                    <span className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${sel ? 'border-primary-600' : 'border-gray-300'}`}>
                                      {sel && <span className="h-2.5 w-2.5 rounded-full bg-primary-600" />}
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Option Groups — вертикальный список с радио/чекбоксами */}
                      {(product.optionGroupIds || []).map((group) => {
                        const single = group.maxSelect === 1;
                        const min = Math.max(group.minSelect || 0, group.required ? 1 : 0);
                        return (
                          <div key={group._id} className="mb-6">
                            <div className="flex items-baseline gap-2 mb-3">
                              <h3 className="text-lg sm:text-xl font-bold">{group.name}</h3>
                              {min > 0 ? (
                                <span className="text-xs font-semibold text-red-600 uppercase">обязательно</span>
                              ) : (
                                <span className="text-xs text-gray-400">необязательно</span>
                              )}
                              {group.maxSelect > 0 && !single && (
                                <span className="text-xs text-gray-400">до {group.maxSelect}</span>
                              )}
                            </div>
                            <div className="space-y-2">
                              {(group.optionIds || []).map((option) => {
                                const isSelected = isOptionSelected(group._id, option._id);
                                return (
                                  <button
                                    key={option._id}
                                    type="button"
                                    onClick={() => toggleOption(group, option)}
                                    className={`w-full p-3 sm:p-4 rounded-xl border-2 transition-all text-left flex justify-between items-center gap-3 ${
                                      isSelected ? 'border-primary-600 bg-primary-50' : 'border-gray-200 hover:border-primary-300'
                                    }`}
                                  >
                                    <span className="font-medium min-w-0 truncate">{option.name}</span>
                                    <div className="flex items-center gap-3 flex-shrink-0">
                                      {option.price > 0 && (
                                        <span className="text-sm text-gray-600 whitespace-nowrap">+{option.price.toFixed(2)}€</span>
                                      )}
                                      {single ? (
                                        <span className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-primary-600' : 'border-gray-300'}`}>
                                          {isSelected && <span className="h-2.5 w-2.5 rounded-full bg-primary-600" />}
                                        </span>
                                      ) : (
                                        <span className={`h-5 w-5 rounded border-2 flex items-center justify-center ${isSelected ? 'border-primary-600 bg-primary-600' : 'border-gray-300'}`}>
                                          {isSelected && <Check className="h-3.5 w-3.5 text-white" />}
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      {/* Toppings (legacy — только если нет групп опций) */}
                      {(!product.optionGroupIds || product.optionGroupIds.length === 0) &&
                        product.extras?.toppings && product.extras.toppings.length > 0 && (
                        <div className="mb-6">
                          <h3 className="text-xl font-bold mb-3">{t('product_modal.toppings_title', 'Дополнительные топпинги:')}</h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {product.extras.toppings.map((topping, index) => {
                              const isSelected = selectedToppings.some(t => t.name === topping.name);
                              return (
                                <button
                                  key={index}
                                  onClick={() => toggleTopping(topping)}
                                  className={`p-3 rounded-xl border-2 transition-all text-left ${
                                    isSelected
                                      ? 'border-primary-600 bg-primary-50'
                                      : 'border-gray-200 hover:border-primary-300'
                                  }`}
                                >
                                  <div className="flex justify-between items-center">
                                    <div>
                                      <div className="font-semibold">{topping.name}</div>
                                      <div className="text-sm text-gray-600">+{topping.price.toFixed(2)}€</div>
                                    </div>
                                    {isSelected && (
                                      <div className="text-primary-600 font-bold text-xl">✓</div>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Sauces (legacy) */}
                      {(!product.optionGroupIds || product.optionGroupIds.length === 0) &&
                        product.extras?.sauces && product.extras.sauces.length > 0 && (
                        <div className="mb-6">
                          <h3 className="text-xl font-bold mb-3">{t('product_modal.sauces_title', 'Соусы:')}</h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {product.extras.sauces.map((sauce, index) => {
                              const isSelected = selectedSauces.some(s => s.name === sauce.name);
                              return (
                                <button
                                  key={index}
                                  onClick={() => toggleSauce(sauce)}
                                  className={`p-3 rounded-xl border-2 transition-all text-left ${
                                    isSelected
                                      ? 'border-primary-600 bg-primary-50'
                                      : 'border-gray-200 hover:border-primary-300'
                                  }`}
                                >
                                  <div className="flex justify-between items-center">
                                    <div>
                                      <div className="font-semibold">{sauce.name}</div>
                                      <div className="text-sm text-gray-600">+{sauce.price.toFixed(2)}€</div>
                                    </div>
                                    {isSelected && (
                                      <div className="text-primary-600 font-bold text-xl">✓</div>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Sides (legacy) */}
                      {(!product.optionGroupIds || product.optionGroupIds.length === 0) &&
                        product.extras?.sides && product.extras.sides.length > 0 && (
                        <div className="mb-6">
                          <h3 className="text-xl font-bold mb-3">{t('product_modal.sides_title', 'Напитки и закуски:')}</h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {product.extras.sides.map((side, index) => {
                              const isSelected = selectedSides.some(s => s.name === side.name);
                              return (
                                <button
                                  key={index}
                                  onClick={() => toggleSide(side)}
                                  className={`p-3 rounded-xl border-2 transition-all text-left ${
                                    isSelected
                                      ? 'border-primary-600 bg-primary-50'
                                      : 'border-gray-200 hover:border-primary-300'
                                  }`}
                                >
                                  <div className="flex justify-between items-center">
                                    <div>
                                      <div className="font-semibold">{side.name}</div>
                                      <div className="text-sm text-gray-600">+{side.price.toFixed(2)}€</div>
                                    </div>
                                    {isSelected && (
                                      <div className="text-primary-600 font-bold text-xl">✓</div>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Quantity */}
                      <div className="mb-6">
                        <h3 className="text-xl font-bold mb-3">{t('product_modal.quantity', 'Количество:')}</h3>
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => setQuantity(Math.max(1, quantity - 1))}
                            className="w-12 h-12 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-primary-600 hover:bg-primary-50 transition-all"
                          >
                            <Minus className="h-5 w-5" />
                          </button>
                          <span className="text-3xl font-bold w-16 text-center">{quantity}</span>
                          <button
                            onClick={() => setQuantity(quantity + 1)}
                            className="w-12 h-12 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-primary-600 hover:bg-primary-50 transition-all"
                          >
                            <Plus className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                      </div>{/* /конфигурация */}
                      </div>{/* /grid 2 колонки */}
                     </div>
                    </div>

                    {/* Fixed Bottom Button */}
                    <div className="flex-shrink-0 p-4 sm:p-6 border-t bg-gray-50">
                      {optionError && (
                        <p className="text-sm text-red-600 mb-2 text-center">{optionError}</p>
                      )}
                      <button
                        onClick={handleAddToCart}
                        className="flex min-h-[56px] w-full items-center justify-center gap-3 rounded-xl bg-primary-600 px-6 py-4 text-center text-lg font-bold leading-tight text-white shadow-lg transition-all hover:bg-primary-700 hover:shadow-xl"
                      >
                        <ShoppingCart className="h-6 w-6 shrink-0" />
                        <span className="min-w-0">{t('product.add_to_cart', 'Добавить в корзину')} — {calculateTotal().toFixed(2)}€</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="p-12 text-center">
                    <p className="text-gray-600">{t('product_modal.not_found', 'Продукт не найден')}</p>
                  </div>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
