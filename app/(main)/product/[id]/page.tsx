"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, Plus, Minus, ShoppingCart, Check } from 'lucide-react';
import { useCart } from '../../../../lib/contexts/CartContext';
import { useParams, useRouter } from 'next/navigation';
import { useLanguage } from '../../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../../lib/i18n';
import { ProductPromotionsBanner } from '../../../../components/promotions/PromotionBadges';
import { normalizeObjectId } from '../../../../lib/normalize-id';
import { getSizePrice } from '../../../../lib/product-pricing';
import { SafeImage } from '../../../../components/SafeImage';

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

export default function ProductPage() {
  const params = useParams();
  const productId = params.id as string;
  const router = useRouter();
  const { addItem } = useCart();
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string, fallback?: string) => fallback ?? k);
  
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [selectedSize, setSelectedSize] = useState<Size | null>(null);
  const [selectedToppings, setSelectedToppings] = useState<Extra[]>([]);
  const [selectedSauces, setSelectedSauces] = useState<Extra[]>([]);
  const [selectedSides, setSelectedSides] = useState<Extra[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, OptionItem[]>>({});
  const [optionError, setOptionError] = useState('');
  const [notes, setNotes] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  
  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const response = await fetch(`/api/products/${productId}`);
        const data = await response.json();
        
        if (data.success) {
          setProduct(data.product);
          // Set default size if available
          if (data.product.sizes && data.product.sizes.length > 0) {
            setSelectedSize(data.product.sizes[0]);
          }
        }
      } catch (error) {
        console.error('Error fetching product:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [productId]);

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
  
  const toggleOption = (group: OptionGroup, option: OptionItem) => {
    setOptionError('');
    setSelectedOptions((prev) => {
      const current = prev[group._id] || [];
      const exists = current.some((o) => o._id === option._id);
      let next: OptionItem[];
      if (exists) {
        next = current.filter((o) => o._id !== option._id);
      } else if (group.maxSelect === 1) {
        next = [option];
      } else if (group.maxSelect > 0 && current.length >= group.maxSelect) {
        return prev;
      } else {
        next = [...current, option];
      }
      return { ...prev, [group._id]: next };
    });
  };

  const isOptionSelected = (groupId: string, optionId: string) =>
    (selectedOptions[groupId] || []).some((o) => o._id === optionId);

  const validateOptions = (): string => {
    for (const g of product?.optionGroupIds || []) {
      const count = (selectedOptions[g._id] || []).length;
      const min = Math.max(g.minSelect || 0, g.required ? 1 : 0);
      if (count < min) {
        return `Выберите ${min > 1 ? `минимум ${min} в группе` : 'опцию в группе'} «${g.name}»`;
      }
    }
    return '';
  };

  const buildSelectedOptions = () => {
    const result: Array<{ groupId: string; group: string; name: string; price: number }> = [];
    for (const g of product?.optionGroupIds || []) {
      for (const o of selectedOptions[g._id] || []) {
        result.push({ groupId: g._id, group: g.name, name: o.name, price: Number(o.price) || 0 });
      }
    }
    return result;
  };

  const calculateTotalPrice = () => {
    if (!product) return 0;

    // Абсолютная цена выбранного размера (или базовая цена, если размеров нет)
    let total = selectedSize ? getSizePrice(product, selectedSize) : product.basePrice;

    // Add toppings
    selectedToppings.forEach(t => {
      total += t.price;
    });

    // Add sauces
    selectedSauces.forEach(s => {
      total += s.price;
    });

    // Add sides
    selectedSides.forEach(s => {
      total += s.price;
    });

    // Add option groups
    Object.values(selectedOptions).flat().forEach((o) => {
      total += Number(o.price) || 0;
    });

    return total;
  };
  
  const handleAddToCart = () => {
    if (!product) return;

    const err = validateOptions();
    if (err) {
      setOptionError(err);
      return;
    }

    setIsAdding(true);

    const itemPrice = calculateTotalPrice();
    const chosenOptions = buildSelectedOptions();

    addItem({
      id: `${product._id}-${Date.now()}`, // Unique ID for cart item
      productId: product._id,
      categoryId: normalizeObjectId(product.category),
      name: product.name,
      quantity,
      price: itemPrice,
      basePrice: product.basePrice,
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
        toppings: selectedToppings.length > 0 ? selectedToppings.map(t => ({ name: t.name, price: t.price })) : undefined,
        sauces: selectedSauces.length > 0 ? selectedSauces.map(s => ({ name: s.name, price: s.price })) : undefined,
        sides: selectedSides.length > 0 ? selectedSides.map(s => ({ name: s.name, price: s.price })) : undefined
      },
      image: product.image,
      notes
    });
    
    // Show success feedback
    setTimeout(() => {
      setIsAdding(false);
      router.push('/');
    }, 500);
  };
  
  if (loading) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">{t('common.loading', 'Загрузка...')}</p>
      </div>
    );
  }
  
  if (!product || !product.available) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-bold mb-4">{t('product.unavailable', 'Продукт недоступен')}</h1>
        <Link href="/" className="btn-primary">
          {t('common.back_home', 'Вернуться на главную')}
        </Link>
      </div>
    );
  }
  
  const totalPrice = calculateTotalPrice();
  
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        {/* Back button */}
        <Link href="/" className="mb-6 inline-flex max-w-full items-center gap-1 leading-tight text-primary-600 hover:text-primary-700">
          <ChevronLeft className="h-5 w-5 shrink-0" />
          {t('menu.back_to_menu', 'Назад к меню')}
        </Link>
        
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Product Image — слева, прилипает при прокрутке */}
          <div className="bg-white rounded-2xl p-4 sm:p-8 shadow-sm lg:sticky lg:top-8 lg:self-start">
            {product.image && !product.image.includes('default-product') ? (
              <SafeImage
                src={product.image}
                alt={product.name}
                className="w-full max-h-[70vh] object-contain rounded-xl bg-gray-50"
              />
            ) : (
              <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl flex items-center justify-center">
                <div className="text-center">
                  <div className="text-9xl mb-4">🍕</div>
                  <span className="text-gray-400">{product.name}</span>
                </div>
              </div>
            )}
          </div>
          
          {/* Product Configuration */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <h1 className="mb-2 break-words text-3xl font-bold leading-tight">{product.name}</h1>
              <p className="mb-4 break-words text-gray-600">{product.description}</p>

              <ProductPromotionsBanner productId={product._id} categoryId={product.category} />

              <div className="flex items-baseline gap-2 mb-6">
                <span className="text-4xl font-bold text-primary-600">
                  {totalPrice.toFixed(2)} €
                </span>
                {totalPrice > product.basePrice && (
                  <span className="text-lg text-gray-500 line-through">
                    {product.basePrice.toFixed(2)} €
                  </span>
                )}
              </div>
              
              {/* Sizes */}
              {product.sizes && product.sizes.length > 0 && (
                <div className="mb-6">
                <h3 className="font-bold mb-3">{t('product_modal.size_title', 'Выберите размер:')}</h3>
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
              
              {/* Option Groups (Optionsgruppen) */}
              {(product.optionGroupIds || []).map((group) => {
                const single = group.maxSelect === 1;
                const min = Math.max(group.minSelect || 0, group.required ? 1 : 0);
                return (
                  <div key={group._id} className="mb-6">
                    <div className="flex items-baseline gap-2 mb-3">
                      <h3 className="font-bold">{group.name}</h3>
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
                        const selected = isOptionSelected(group._id, option._id);
                        return (
                          <button
                            key={option._id}
                            type="button"
                            onClick={() => toggleOption(group, option)}
                            className={`w-full p-3 sm:p-4 rounded-xl border-2 transition-all text-left flex justify-between items-center gap-3 ${
                              selected
                                ? 'border-primary-600 bg-primary-50'
                                : 'border-gray-200 hover:border-primary-300'
                            }`}
                          >
                            <span className="font-medium min-w-0 truncate">{option.name}</span>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              {option.price > 0 && (
                                <span className="text-sm text-gray-600 whitespace-nowrap">+{option.price.toFixed(2)}€</span>
                              )}
                              {single ? (
                                <span className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${selected ? 'border-primary-600' : 'border-gray-300'}`}>
                                  {selected && <span className="h-2.5 w-2.5 rounded-full bg-primary-600" />}
                                </span>
                              ) : (
                                <span className={`h-5 w-5 rounded border-2 flex items-center justify-center ${selected ? 'border-primary-600 bg-primary-600' : 'border-gray-300'}`}>
                                  {selected && <Check className="h-3.5 w-3.5 text-white" />}
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

              {/* Toppings (legacy — скрыто при наличии групп опций) */}
              {(!product.optionGroupIds || product.optionGroupIds.length === 0) &&
                product.extras?.toppings && product.extras.toppings.length > 0 && (
                <div className="mb-6">
                <h3 className="font-bold mb-3">{t('product_modal.toppings_title', 'Дополнительные топпинги:')}</h3>
                  <div className="space-y-2">
                    {product.extras.toppings.map((topping, index) => {
                      const isSelected = selectedToppings.find(t => t.name === topping.name);
                      return (
                        <button
                          key={index}
                          onClick={() => toggleTopping(topping)}
                          className={`w-full p-3 rounded-lg border-2 transition-all flex items-center justify-between ${
                            isSelected
                              ? 'border-primary-600 bg-primary-50'
                              : 'border-gray-200 hover:border-primary-300'
                          }`}
                        >
                            <span className="min-w-0 break-words text-left font-medium">{topping.name}</span>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="whitespace-nowrap text-primary-600">+{topping.price.toFixed(2)}€</span>
                            {isSelected && <Check className="h-5 w-5 text-primary-600" />}
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
                <h3 className="font-bold mb-3">{t('product_modal.sauces_title', 'Соусы:')}</h3>
                  <div className="space-y-2">
                    {product.extras.sauces.map((sauce, index) => {
                      const isSelected = selectedSauces.find(s => s.name === sauce.name);
                      return (
                        <button
                          key={index}
                          onClick={() => toggleSauce(sauce)}
                          className={`w-full p-3 rounded-lg border-2 transition-all flex items-center justify-between ${
                            isSelected
                              ? 'border-primary-600 bg-primary-50'
                              : 'border-gray-200 hover:border-primary-300'
                          }`}
                        >
                          <span className="min-w-0 break-words text-left font-medium">{sauce.name}</span>
                          <div className="flex shrink-0 items-center gap-2">
                            {sauce.price > 0 && (
                              <span className="whitespace-nowrap text-primary-600">+{sauce.price.toFixed(2)}€</span>
                            )}
                            {isSelected && <Check className="h-5 w-5 text-primary-600" />}
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
                <h3 className="font-bold mb-3">{t('product_modal.sides_title', 'Напитки / Закуски:')}</h3>
                  <div className="space-y-2">
                    {product.extras.sides.map((side, index) => {
                      const isSelected = selectedSides.find(s => s.name === side.name);
                      return (
                        <button
                          key={index}
                          onClick={() => toggleSide(side)}
                          className={`w-full p-3 rounded-lg border-2 transition-all flex items-center justify-between ${
                            isSelected
                              ? 'border-primary-600 bg-primary-50'
                              : 'border-gray-200 hover:border-primary-300'
                          }`}
                        >
                          <span className="min-w-0 break-words text-left font-medium">{side.name}</span>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="whitespace-nowrap text-primary-600">+{side.price.toFixed(2)}€</span>
                            {isSelected && <Check className="h-5 w-5 text-primary-600" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* Notes */}
              <div className="mb-6">
                <h3 className="font-bold mb-3">{t('product.notes', 'Особые пожелания:')}</h3>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('product.notes_placeholder', 'Например: без лука, хорошо прожарить...')}
                  className="input resize-none"
                  rows={3}
                />
              </div>
              
              {/* Quantity */}
              <div className="mb-6">
                <h3 className="font-bold mb-3">{t('product_modal.quantity', 'Количество:')}</h3>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="w-12 h-12 rounded-lg border-2 border-gray-300 flex items-center justify-center hover:border-primary-600 transition-colors"
                    disabled={quantity <= 1}
                  >
                    <Minus className="h-5 w-5" />
                  </button>
                  <span className="text-2xl font-bold w-12 text-center">{quantity}</span>
                  <button
                    onClick={() => setQuantity(quantity + 1)}
                    className="w-12 h-12 rounded-lg border-2 border-gray-300 flex items-center justify-center hover:border-primary-600 transition-colors"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              </div>
              
              {optionError && (
                <p className="text-sm text-red-600 mb-2">{optionError}</p>
              )}

              {/* Add to Cart Button */}
              <button
                onClick={handleAddToCart}
                disabled={isAdding}
                className="btn-primary w-full text-lg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAdding ? (
                  <>
                    <Check className="h-6 w-6" />
                    {t('product.added', 'Добавлено!')}
                  </>
                ) : (
                  <>
                    <ShoppingCart className="h-6 w-6" />
                    {t('product.add_to_cart', 'Добавить в корзину')} {t('product.for_price', 'за')} {(totalPrice * quantity).toFixed(2)} €
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
