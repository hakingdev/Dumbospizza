// Seed data for products with extras
export const seedProducts = [
  {
    name: 'Маргарита',
    description: 'Классическая итальянская пицца с томатным соусом, моцареллой и базиликом',
    category: 'pizza', // Will be replaced with actual category ID
    basePrice: 9.99,
    image: '/images/products/margherita.jpg',
    available: true,
    taxRate: 0.07,
    sizes: [
      { id: 'small', name: 'Маленькая', size: '25 см', priceModifier: 0 },
      { id: 'medium', name: 'Средняя', size: '30 см', priceModifier: 2 },
      { id: 'large', name: 'Большая', size: '35 см', priceModifier: 4 }
    ],
    extras: {
      toppings: [
        { name: 'Дополнительный сыр', price: 1.5 },
        { name: 'Свежий базилик', price: 1.0 },
        { name: 'Моцарелла буффало', price: 2.5 }
      ],
      sauces: [
        { name: 'Томатный соус', price: 0 },
        { name: 'Чесночный соус', price: 0.5 }
      ],
      sides: [
        { name: 'Кола 0.5л', price: 2.5 },
        { name: 'Вода 0.5л', price: 1.5 },
        { name: 'Чесночные булочки (4 шт)', price: 3.5 }
      ]
    }
  },
  {
    name: 'Пепперони',
    description: 'Пицца с томатным соусом, моцареллой и острыми колбасками пепперони',
    category: 'pizza',
    basePrice: 11.99,
    image: '/images/products/pepperoni.jpg',
    available: true,
    taxRate: 0.07,
    sizes: [
      { id: 'small', name: 'Маленькая', size: '25 см', priceModifier: 0 },
      { id: 'medium', name: 'Средняя', size: '30 см', priceModifier: 2 },
      { id: 'large', name: 'Большая', size: '35 см', priceModifier: 4 }
    ],
    extras: {
      toppings: [
        { name: 'Дополнительный пепперони', price: 2.0 },
        { name: 'Дополнительный сыр', price: 1.5 },
        { name: 'Халапеньо', price: 1.2 },
        { name: 'Оливки', price: 1.0 }
      ],
      sauces: [
        { name: 'Томатный соус', price: 0 },
        { name: 'Острый соус', price: 0.5 },
        { name: 'BBQ соус', price: 0.5 }
      ],
      sides: [
        { name: 'Кола 0.5л', price: 2.5 },
        { name: 'Спрайт 0.5л', price: 2.5 },
        { name: 'Картофельные дольки', price: 4.5 }
      ]
    }
  },
  {
    name: 'Гавайская',
    description: 'Пицца с томатным соусом, моцареллой, ветчиной и ананасом',
    category: 'pizza',
    basePrice: 12.99,
    image: '/images/products/hawaiian.jpg',
    available: true,
    taxRate: 0.07,
    sizes: [
      { id: 'small', name: 'Маленькая', size: '25 см', priceModifier: 0 },
      { id: 'medium', name: 'Средняя', size: '30 см', priceModifier: 2 },
      { id: 'large', name: 'Большая', size: '35 см', priceModifier: 4 }
    ],
    extras: {
      toppings: [
        { name: 'Дополнительная ветчина', price: 2.0 },
        { name: 'Дополнительный ананас', price: 1.5 },
        { name: 'Дополнительный сыр', price: 1.5 }
      ],
      sauces: [
        { name: 'Томатный соус', price: 0 },
        { name: 'Сырный соус', price: 0.5 }
      ],
      sides: [
        { name: 'Фанта 0.5л', price: 2.5 },
        { name: 'Сок апельсиновый 0.33л', price: 2.0 }
      ]
    }
  },
  {
    name: 'Четыре сыра',
    description: 'Пицца с томатным соусом, моцареллой, горгонзолой, пармезаном и чеддером',
    category: 'pizza',
    basePrice: 13.99,
    image: '/images/products/four-cheese.jpg',
    available: true,
    taxRate: 0.07,
    sizes: [
      { id: 'small', name: 'Маленькая', size: '25 см', priceModifier: 0 },
      { id: 'medium', name: 'Средняя', size: '30 см', priceModifier: 2 },
      { id: 'large', name: 'Большая', size: '35 см', priceModifier: 4 }
    ],
    extras: {
      toppings: [
        { name: 'Пятый сыр (Бри)', price: 2.5 },
        { name: 'Грецкие орехи', price: 1.5 },
        { name: 'Мёд', price: 1.0 }
      ],
      sauces: [
        { name: 'Сливочный соус', price: 0.5 },
        { name: 'Томатный соус', price: 0 }
      ],
      sides: [
        { name: 'Белое вино бокал 0.2л', price: 5.0 },
        { name: 'Вода газированная 0.5л', price: 2.0 }
      ]
    }
  },
  {
    name: 'Вегетарианская',
    description: 'Пицца с томатным соусом, моцареллой, болгарским перцем, грибами, оливками и луком',
    category: 'pizza',
    basePrice: 11.99,
    image: '/images/products/vegetarian.jpg',
    available: true,
    taxRate: 0.07,
    sizes: [
      { id: 'small', name: 'Маленькая', size: '25 см', priceModifier: 0 },
      { id: 'medium', name: 'Средняя', size: '30 см', priceModifier: 2 },
      { id: 'large', name: 'Большая', size: '35 см', priceModifier: 4 }
    ],
    extras: {
      toppings: [
        { name: 'Артишоки', price: 2.0 },
        { name: 'Руккола', price: 1.5 },
        { name: 'Вяленые томаты', price: 1.8 },
        { name: 'Шпинат', price: 1.5 }
      ],
      sauces: [
        { name: 'Томатный соус', price: 0 },
        { name: 'Песто', price: 0.8 }
      ],
      sides: [
        { name: 'Овощной салат', price: 4.5 },
        { name: 'Зелёный чай', price: 2.0 }
      ]
    }
  },
  {
    name: 'Барбекю',
    description: 'Пицца с соусом барбекю, моцареллой, курицей, беконом и красным луком',
    category: 'pizza',
    basePrice: 13.99,
    image: '/images/products/bbq.jpg',
    available: true,
    taxRate: 0.07,
    sizes: [
      { id: 'small', name: 'Маленькая', size: '25 см', priceModifier: 0 },
      { id: 'medium', name: 'Средняя', size: '30 см', priceModifier: 2 },
      { id: 'large', name: 'Большая', size: '35 см', priceModifier: 4 }
    ],
    extras: {
      toppings: [
        { name: 'Дополнительная курица', price: 2.5 },
        { name: 'Дополнительный бекон', price: 2.0 },
        { name: 'Кукуруза', price: 1.0 },
        { name: 'Острый перец', price: 1.2 }
      ],
      sauces: [
        { name: 'BBQ соус', price: 0 },
        { name: 'Ранч соус', price: 0.5 },
        { name: 'Острый BBQ', price: 0.5 }
      ],
      sides: [
        { name: 'Куриные крылышки (6 шт)', price: 6.5 },
        { name: 'Картофель фри', price: 3.5 },
        { name: 'Кола 1л', price: 3.5 }
      ]
    }
  },
  {
    name: 'Морская',
    description: 'Пицца с томатным соусом, моцареллой, креветками, мидиями, кальмарами и чесноком',
    category: 'pizza',
    basePrice: 15.99,
    image: '/images/products/seafood.jpg',
    available: true,
    taxRate: 0.07,
    sizes: [
      { id: 'small', name: 'Маленькая', size: '25 см', priceModifier: 0 },
      { id: 'medium', name: 'Средняя', size: '30 см', priceModifier: 2 },
      { id: 'large', name: 'Большая', size: '35 см', priceModifier: 4 }
    ],
    extras: {
      toppings: [
        { name: 'Дополнительные креветки', price: 3.5 },
        { name: 'Лосось', price: 4.0 },
        { name: 'Каперсы', price: 1.5 },
        { name: 'Лимон', price: 1.0 }
      ],
      sauces: [
        { name: 'Томатный соус', price: 0 },
        { name: 'Чесночный соус', price: 0.5 },
        { name: 'Белый винный соус', price: 0.8 }
      ],
      sides: [
        { name: 'Греческий салат', price: 5.5 },
        { name: 'Белое вино бокал 0.2л', price: 5.0 }
      ]
    }
  },
  {
    name: 'Мексиканская',
    description: 'Острая пицца с томатным соусом, моцареллой, говяжьим фаршем, халапеньо, кукурузой и фасолью',
    category: 'pizza',
    basePrice: 13.49,
    image: '/images/products/mexican.jpg',
    available: true,
    taxRate: 0.07,
    sizes: [
      { id: 'small', name: 'Маленькая', size: '25 см', priceModifier: 0 },
      { id: 'medium', name: 'Средняя', size: '30 см', priceModifier: 2 },
      { id: 'large', name: 'Большая', size: '35 см', priceModifier: 4 }
    ],
    extras: {
      toppings: [
        { name: 'Дополнительный острый перец', price: 1.5 },
        { name: 'Гуакамоле', price: 2.0 },
        { name: 'Чоризо', price: 2.5 },
        { name: 'Сальса', price: 1.5 }
      ],
      sauces: [
        { name: 'Острый томатный', price: 0 },
        { name: 'Чили соус', price: 0.5 },
        { name: 'Сметанный соус', price: 0.5 }
      ],
      sides: [
        { name: 'Начос с сыром', price: 4.5 },
        { name: 'Текила шот', price: 4.0 },
        { name: 'Корона пиво 0.33л', price: 3.5 }
      ]
    }
  }
];

// Delivery zones configuration
export const deliveryZones = [
  {
    id: 'bad_kissingen_center',
    name: 'Bad Kissingen Zentrum',
    minOrderAmount: 10,
    deliveryFee: 0,
    maxDistance: 3 // km from center
  },
  {
    id: 'garitz',
    name: 'Bad Kissingen Garitz',
    minOrderAmount: 15,
    deliveryFee: 2,
    maxDistance: 5
  },
  {
    id: 'hausen',
    name: 'Hausen',
    minOrderAmount: 20,
    deliveryFee: 3,
    maxDistance: 7
  },
  {
    id: 'arnshausen',
    name: 'Arnshausen',
    minOrderAmount: 20,
    deliveryFee: 3,
    maxDistance: 8
  },
  {
    id: 'reiterswiesen',
    name: 'Reiterswiesen',
    minOrderAmount: 25,
    deliveryFee: 4,
    maxDistance: 10
  },
  {
    id: 'winkels',
    name: 'Winkels',
    minOrderAmount: 25,
    deliveryFee: 4,
    maxDistance: 12
  }
];

// Restaurant location (центральная точка для расчёта расстояний)
export const restaurantLocation = {
  address: 'Kurhausstr. 11A, 97688 Bad Kissingen',
  lat: 50.19526,
  lng: 10.07827
};


