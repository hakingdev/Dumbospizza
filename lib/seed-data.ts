import { connectToDatabase } from './models';
import { Category } from './models/category.model';
import { Product } from './models/product.model';
import { User } from './models/user.model';
import { genObjectId } from './db/object-id';

// Sample categories. Ids предгенерируются как hex-строки (genObjectId), чтобы
// связать товары с категориями ещё до записи в БД — формат совместим с
// text-колонкой id в Postgres (см. lib/db/object-id.ts).
const categories = [
  {
    _id: genObjectId(),
    name: 'Пицца',
    slug: 'pizza',
    image: '/images/categories/pizza.jpg',
    active: true,
    order: 1
  },
  {
    _id: genObjectId(),
    name: 'Напитки',
    slug: 'drinks',
    image: '/images/categories/drinks.jpg',
    active: true,
    order: 2
  },
  {
    _id: genObjectId(),
    name: 'Закуски',
    slug: 'appetizers',
    image: '/images/categories/appetizers.jpg',
    active: true,
    order: 3
  },
  {
    _id: genObjectId(),
    name: 'Десерты',
    slug: 'desserts',
    image: '/images/categories/desserts.jpg',
    active: true,
    order: 4
  }
];

// Sample products
const generateProducts = (categoryIds: { [key: string]: string }) => [
  {
    name: 'Маргарита',
    description: 'Классическая пицца с томатным соусом и моцареллой',
    category: categoryIds.pizza,
    basePrice: 9.99,
    image: '/images/products/margherita.jpg',
    available: true,
    taxRate: 0.07,
    sizes: [
      { id: 'small', name: 'Маленькая', size: '25cm', priceModifier: 0 },
      { id: 'medium', name: 'Средняя', size: '32cm', priceModifier: 4 },
      { id: 'large', name: 'Большая', size: '40cm', priceModifier: 8 }
    ],
    extras: {
      toppings: [
        { name: 'Дополнительный сыр', price: 1.5 },
        { name: 'Грибы', price: 1.0 },
        { name: 'Ветчина', price: 2.0 },
        { name: 'Оливки', price: 1.0 }
      ],
      sauces: [
        { name: 'Томатный', price: 0 },
        { name: 'Сливочный', price: 0.5 },
        { name: 'Острый', price: 0.5 }
      ]
    }
  },
  {
    name: 'Пепперони',
    description: 'Пицца с томатным соусом, моцареллой и пепперони',
    category: categoryIds.pizza,
    basePrice: 11.99,
    image: '/images/products/pepperoni.jpg',
    available: true,
    taxRate: 0.07,
    sizes: [
      { id: 'small', name: 'Маленькая', size: '25cm', priceModifier: 0 },
      { id: 'medium', name: 'Средняя', size: '32cm', priceModifier: 4 },
      { id: 'large', name: 'Большая', size: '40cm', priceModifier: 8 }
    ],
    extras: {
      toppings: [
        { name: 'Дополнительный сыр', price: 1.5 },
        { name: 'Грибы', price: 1.0 },
        { name: 'Ветчина', price: 2.0 },
        { name: 'Оливки', price: 1.0 }
      ],
      sauces: [
        { name: 'Томатный', price: 0 },
        { name: 'Сливочный', price: 0.5 },
        { name: 'Острый', price: 0.5 }
      ]
    }
  },
  {
    name: 'Гавайская',
    description: 'Пицца с ветчиной и ананасами',
    category: categoryIds.pizza,
    basePrice: 12.99,
    image: '/images/products/hawaiian.jpg',
    available: false,
    taxRate: 0.07,
    sizes: [
      { id: 'small', name: 'Маленькая', size: '25cm', priceModifier: 0 },
      { id: 'medium', name: 'Средняя', size: '32cm', priceModifier: 4 },
      { id: 'large', name: 'Большая', size: '40cm', priceModifier: 8 }
    ],
    extras: {
      toppings: [
        { name: 'Дополнительный сыр', price: 1.5 },
        { name: 'Грибы', price: 1.0 },
        { name: 'Ветчина', price: 2.0 },
        { name: 'Оливки', price: 1.0 }
      ],
      sauces: [
        { name: 'Томатный', price: 0 },
        { name: 'Сливочный', price: 0.5 },
        { name: 'Острый', price: 0.5 }
      ]
    }
  },
  {
    name: 'Четыре сыра',
    description: 'Пицца с четырьмя видами сыра: моцарелла, пармезан, горгонзола и чеддер',
    category: categoryIds.pizza,
    basePrice: 13.99,
    image: '/images/products/four-cheese.jpg',
    available: true,
    taxRate: 0.07,
    sizes: [
      { id: 'small', name: 'Маленькая', size: '25cm', priceModifier: 0 },
      { id: 'medium', name: 'Средняя', size: '32cm', priceModifier: 4 },
      { id: 'large', name: 'Большая', size: '40cm', priceModifier: 8 }
    ],
    extras: {
      toppings: [
        { name: 'Дополнительный сыр', price: 1.5 },
        { name: 'Грибы', price: 1.0 },
        { name: 'Ветчина', price: 2.0 },
        { name: 'Оливки', price: 1.0 }
      ],
      sauces: [
        { name: 'Томатный', price: 0 },
        { name: 'Сливочный', price: 0.5 },
        { name: 'Острый', price: 0.5 }
      ]
    }
  },
  {
    name: 'Кола',
    description: 'Освежающий газированный напиток',
    category: categoryIds.drinks,
    basePrice: 2.99,
    image: '/images/products/cola.jpg',
    available: true,
    taxRate: 0.19,
    sizes: [
      { id: 'small', name: '0.33л', size: '0.33л', priceModifier: 0 },
      { id: 'large', name: '0.5л', size: '0.5л', priceModifier: 0.5 }
    ]
  },
  {
    name: 'Минеральная вода',
    description: 'Негазированная минеральная вода',
    category: categoryIds.drinks,
    basePrice: 1.99,
    image: '/images/products/water.jpg',
    available: true,
    taxRate: 0.19,
    sizes: [
      { id: 'small', name: '0.5л', size: '0.5л', priceModifier: 0 }
    ]
  },
  {
    name: 'Чесночные хлебцы',
    description: 'Хрустящие чесночные хлебцы',
    category: categoryIds.appetizers,
    basePrice: 4.99,
    image: '/images/products/garlic-bread.jpg',
    available: true,
    taxRate: 0.07,
    extras: {
      sauces: [
        { name: 'Чесночный', price: 0 },
        { name: 'Томатный', price: 0.5 }
      ]
    }
  },
  {
    name: 'Тирамису',
    description: 'Классический итальянский десерт',
    category: categoryIds.desserts,
    basePrice: 5.99,
    image: '/images/products/tiramisu.jpg',
    available: true,
    taxRate: 0.19
  }
];

// Sample users
const users = [
  {
    name: 'Admin User',
    email: 'admin@dumbospizza.de',
    phoneNumber: '+4912345678901',
    password: 'admin123',
    role: 'admin'
  },
  {
    name: 'Staff User',
    email: 'staff@dumbospizza.de',
    phoneNumber: '+4912345678902',
    password: 'staff123',
    role: 'staff'
  },
  {
    name: 'Max Mustermann',
    email: 'max@example.com',
    phoneNumber: '+4912345678903',
    password: 'customer123',
    role: 'customer',
    addresses: [
      {
        street: 'Hauptstraße',
        houseNumber: '42',
        postalCode: '97688',
        city: 'Bad Kissingen',
        isDefault: true
      }
    ]
  }
];

export interface SeedOptions {
  /**
   * ОПАСНО: при true перед сидированием удаляются ВСЕ существующие товары,
   * категории и пользователи (Model.deleteMany). По умолчанию false — сидирование
   * идемпотентно (существующие записи не трогаются), чтобы случайный вызов
   * /api/seed не стёр перенесённые в Supabase боевые данные.
   */
  reset?: boolean;
}

// Seed function
export async function seedDatabase(options: SeedOptions = {}) {
  const { reset = false } = options;
  try {
    console.log('Connecting to database...');
    await connectToDatabase();

    if (reset) {
      console.warn(
        '[seed] reset=true — удаляю существующие products / categories / users перед сидированием'
      );
      // Порядок: сначала товары (ссылаются на категории), затем категории, затем пользователи.
      await Product.deleteMany({});
      await Category.deleteMany({});
      await User.deleteMany({});
    }

    console.log('Seeding categories...');
    // Create a map of category slugs to their IDs (hex-строки)
    const categoryIds: { [key: string]: string } = {};
    await Promise.all(
      categories.map(async (category) => {
        // Check if category exists
        const existingCategory = await Category.findOne({ slug: category.slug });
        if (existingCategory) {
          categoryIds[category.slug] = existingCategory._id;
          return;
        }
        // Create new category с предгенерированным _id
        const created = await Category.create(category);
        categoryIds[category.slug] = created._id;
      })
    );

    console.log('Seeding products...');
    // Create products
    const products = generateProducts(categoryIds);

    await Promise.all(
      products.map(async (product) => {
        // Check if product exists
        const existingProduct = await Product.findOne({ name: product.name });
        if (existingProduct) {
          return existingProduct;
        }
        // Create new product
        return await Product.create(product);
      })
    );

    console.log('Seeding users...');
    // Create users. Пароль хешируется хуком preSave модели User (см. user.model.ts),
    // поэтому передаём его в открытом виде и не дублируем bcrypt здесь.
    await Promise.all(
      users.map(async (user) => {
        // Check if user exists
        const existingUser = await User.findOne({ email: user.email });
        if (existingUser) {
          return existingUser;
        }
        // Create new user
        return await User.create(user);
      })
    );

    console.log('Database seeding completed successfully!');
    return { success: true };
  } catch (error) {
    console.error('Error seeding database:', error);
    return { success: false, error };
  }
}
