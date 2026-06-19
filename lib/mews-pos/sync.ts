import { fetchAllPages } from './pagination';
import { mewsPosRequest } from './client';

interface MewsResource {
  id: string;
  type: string;
  attributes?: Record<string, any>;
  relationships?: Record<string, any>;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function getAttribute(attrs: Record<string, any> | undefined, keys: string[], fallback: any = '') {
  if (!attrs) return fallback;
  for (const key of keys) {
    const value = attrs[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return fallback;
}

function getPrice(attrs: Record<string, any> | undefined): number {
  if (!attrs) return 0;
  const candidates = [
    attrs.price?.amount,
    attrs.price?.value,
    attrs.price,
    attrs.unitPrice?.amount,
    attrs.unitPrice?.value,
    attrs.unitPrice,
    attrs.amount,
    attrs.value
  ];
  const found = candidates.find((v) => v !== undefined && v !== null);
  return typeof found === 'number' ? found : Number(found || 0);
}

function getRelationshipId(resource: MewsResource, rel: string) {
  const relation = resource.relationships?.[rel]?.data;
  if (!relation) return undefined;
  if (Array.isArray(relation)) {
    return relation[0]?.id;
  }
  return relation.id;
}

export async function fetchMewsPosCategories() {
  const productTypes = await fetchAllPages<MewsResource>('/v1/product-types');

  return productTypes.map((type) => {
    const name = getAttribute(type.attributes, ['name', 'displayName', 'title'], 'Category');
    return {
      _id: type.id,
      name,
      slug: slugify(name),
      image: '/images/default-category.jpg',
      active: true,
      mewsProductTypeId: type.id
    };
  });
}

export async function fetchMewsPosProducts(options: {
  categorySlug?: string;
  available?: boolean;
  featured?: boolean;
  search?: string;
} = {}) {
  const [products, categories] = await Promise.all([
    fetchAllPages<MewsResource>('/v1/products'),
    fetchMewsPosCategories()
  ]);

  const categoryById = new Map(categories.map((cat) => [cat._id, cat]));

  let mapped = products.map((product) => {
    const name = getAttribute(product.attributes, ['name', 'displayName', 'title'], 'Product');
    const description = getAttribute(product.attributes, ['description', 'details'], '');
    const categoryId = getRelationshipId(product, 'productType');
    const category = categoryId ? categoryById.get(categoryId) : undefined;
    const available = Boolean(getAttribute(product.attributes, ['available', 'active', 'enabled'], true));
    const featured = Boolean(getAttribute(product.attributes, ['featured', 'isFeatured'], false));

    return {
      _id: product.id,
      name,
      description,
      category: category || categoryId || '',
      basePrice: getPrice(product.attributes),
      image: getAttribute(product.attributes, ['imageUrl', 'image', 'photoUrl'], '/images/default-product.jpg'),
      available,
      featured,
      sizes: [],
      extras: {
        toppings: [],
        sauces: [],
        sides: []
      }
    };
  });

  if (options.categorySlug) {
    mapped = mapped.filter((item) => {
      if (typeof item.category === 'string') return false;
      return item.category.slug === options.categorySlug;
    });
  }

  if (options.available !== undefined) {
    mapped = mapped.filter((item) => item.available === options.available);
  }

  if (options.featured !== undefined) {
    mapped = mapped.filter((item) => item.featured === options.featured);
  }

  if (options.search) {
    const term = options.search.toLowerCase();
    mapped = mapped.filter((item) =>
      item.name.toLowerCase().includes(term) || item.description.toLowerCase().includes(term)
    );
  }

  return mapped;
}

export async function fetchMewsPosProductById(id: string) {
  const response = await mewsPosRequest<MewsResource>(`/v1/products/${id}`);
  const product = response.data;
  const name = getAttribute(product.attributes, ['name', 'displayName', 'title'], 'Product');

  return {
    _id: product.id,
    name,
    description: getAttribute(product.attributes, ['description', 'details'], ''),
    category: getRelationshipId(product, 'productType') || '',
    basePrice: getPrice(product.attributes),
    image: getAttribute(product.attributes, ['imageUrl', 'image', 'photoUrl'], '/images/default-product.jpg'),
    available: Boolean(getAttribute(product.attributes, ['available', 'active', 'enabled'], true)),
    sizes: [],
    extras: {
      toppings: [],
      sauces: [],
      sides: []
    }
  };
}

