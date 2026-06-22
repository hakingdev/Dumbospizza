import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// Create axios instance with default settings
const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true // Include cookies for authentication
});

// Products
export const getProducts = async (params?: { category?: string, available?: boolean, search?: string }) => {
  const response = await apiClient.get('/api/products', { params });
  return response.data;
};

export const getProductById = async (id: string) => {
  const response = await apiClient.get(`/api/products/${id}`);
  return response.data;
};

export const createProduct = async (productData: any) => {
  const response = await apiClient.post('/api/products', productData);
  return response.data;
};

export const updateProduct = async (id: string, productData: any) => {
  const response = await apiClient.put(`/api/products/${id}`, productData);
  return response.data;
};

export const deleteProduct = async (id: string) => {
  const response = await apiClient.delete(`/api/products/${id}`);
  return response.data;
};

// Categories
export const getCategories = async (params?: { active?: boolean }) => {
  const response = await apiClient.get('/api/categories', { params });
  return response.data;
};

export const createCategory = async (categoryData: any) => {
  const response = await apiClient.post('/api/categories', categoryData);
  return response.data;
};

// Orders
export const getOrders = async (params?: { 
  phoneNumber?: string, 
  status?: string,
  page?: number,
  limit?: number
}) => {
  const response = await apiClient.get('/api/orders', { params });
  return response.data;
};

export const getOrderById = async (id: string) => {
  const response = await apiClient.get(`/api/orders/${id}`);
  return response.data;
};

// Повторение заказа
export const repeatOrder = async (orderId: string, phoneNumber: string) => {
  const response = await apiClient.post('/api/orders/repeat', { orderId, phoneNumber });
  return response.data;
};

// Акции (Angebote) — автоматические скидки
export const getActivePromotions = async (params?: { modal?: boolean; type?: string }) => {
  const response = await apiClient.get('/api/promotions', {
    params: {
      ...(params?.modal ? { modal: '1' } : {}),
      ...(params?.type ? { type: params.type } : {}),
    },
  });
  return response.data;
};

export const getPromotionsAdmin = async (params?: { type?: string; lifecycle?: string }) => {
  const response = await apiClient.get('/api/promotions', {
    params: { admin: '1', ...params },
  });
  return response.data;
};

export const getPromotionBySlug = async (slug: string) => {
  const response = await apiClient.get(`/api/promotions/slug/${slug}`);
  return response.data;
};

export const createPromotion = async (data: Record<string, unknown>) => {
  const response = await apiClient.post('/api/promotions', data);
  return response.data;
};

export const updatePromotion = async (id: string, data: Record<string, unknown>) => {
  const response = await apiClient.put(`/api/promotions/${id}`, data);
  return response.data;
};

export const deletePromotion = async (id: string) => {
  const response = await apiClient.delete(`/api/promotions/${id}`);
  return response.data;
};

export const calculatePromotions = async (
  items: unknown[],
  channel: 'web' | 'app' = 'web',
  promoCode?: string,
  phoneNumber?: string,
  selections?: {
    selectedBogoSecond?: Array<{ promotionId: string; productId: string }>;
    selectedFreeGifts?: Array<{ promotionId: string; productId: string }>;
    /** Активен купон → денежные акции подавляются (несовместимы с купоном). */
    couponActive?: boolean;
  }
) => {
  const response = await apiClient.post('/api/promotions/calculate', {
    items,
    channel,
    promoCode,
    phoneNumber,
    selectedBogoSecond: selections?.selectedBogoSecond,
    selectedFreeGifts: selections?.selectedFreeGifts,
    couponActive: selections?.couponActive,
  });
  return response.data;
};

export const validatePromotionCode = async (code: string) => {
  // Не бросаем исключение на 404 — возвращаем стабильный объект, чтобы вызывающий
  // код не парсил строки ошибок и не ловил «ложный expired» из текста сообщения.
  try {
    const response = await apiClient.get('/api/promotions/validate-code', {
      params: { code: (code || '').trim().toUpperCase() },
    });
    return response.data;
  } catch (error: any) {
    return error?.response?.data ?? { success: false, reason: 'not_found' };
  }
};

export const getPromotionAdminById = async (id: string) => {
  const response = await apiClient.get(`/api/promotions/${id}`, { params: { admin: '1' } });
  return response.data;
};

export const trackPromotionEvent = async (
  promotionId: string,
  event: 'view' | 'modal_open' | 'click' | 'order',
  revenue?: number
) => {
  const response = await apiClient.post('/api/promotions/analytics', {
    promotionId,
    event,
    revenue,
  });
  return response.data;
};

export const getPromotionCampaignPreview = async (promotionId: string) => {
  const response = await apiClient.get(`/api/promotions/${promotionId}/campaign`);
  return response.data;
};

export const sendPromotionCampaign = async (
  promotionId: string,
  channel: 'email' | 'push' | 'both',
  testEmail?: string
) => {
  const response = await apiClient.post(`/api/promotions/${promotionId}/campaign`, {
    channel,
    testEmail,
  });
  return response.data;
};

// Купоны и промокоды
export const validateCoupon = async (code: string, orderAmount?: number) => {
  // Всегда возвращаем стабильный объект { success, reason?, error?, coupon? } и НЕ бросаем
  // исключение на 4xx — вызывающий код ветвится по machine-readable `reason`, а не парсит
  // строку ошибки (иначе «Invalid or expired …» давало ложный expired).
  try {
    const params = new URLSearchParams({ code: (code || '').trim().toUpperCase() });
    if (orderAmount !== undefined) {
      params.append('orderAmount', orderAmount.toString());
    }

    const response = await fetch(`/api/coupons?${params.toString()}`);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        success: false,
        reason: data?.reason ?? 'not_found',
        error: data?.error ?? 'Invalid coupon',
      };
    }
    return data;
  } catch (_error) {
    return { success: false, reason: 'network', error: 'Network error' };
  }
};

export const getCoupons = async () => {
  const response = await apiClient.get('/api/coupons');
  return response.data;
};

export const getCouponById = async (id: string) => {
  const response = await apiClient.get(`/api/coupons/${id}`);
  return response.data;
};

export const createCoupon = async (couponData: any) => {
  const response = await apiClient.post('/api/coupons', couponData);
  return response.data;
};

export const updateCoupon = async (id: string, couponData: any) => {
  const response = await apiClient.put(`/api/coupons/${id}`, couponData);
  return response.data;
};

export const deleteCoupon = async (id: string) => {
  const response = await apiClient.delete(`/api/coupons/${id}`);
  return response.data;
};

export const createOrder = async (orderData: any) => {
  const response = await apiClient.post('/api/orders', orderData);
  return response.data;
};

export const updateOrderStatus = async (id: string, status: string) => {
  const response = await apiClient.put(`/api/orders/${id}`, { status });
  return response.data;
};

// Users
export const getUserByPhone = async (phoneNumber: string) => {
  const response = await apiClient.get(`/api/users?phoneNumber=${phoneNumber}`);
  return response.data;
};

export const createUser = async (userData: any) => {
  const response = await apiClient.post('/api/users', userData);
  return response.data;
};

// Loyalty
export const getLoyaltyByPhone = async (phoneNumber: string) => {
  const response = await apiClient.get(`/api/loyalty?phoneNumber=${phoneNumber}`);
  return response.data;
};

export const createLoyaltyProgram = async (data: { 
  phoneNumber: string, 
  userId?: string,
  name?: string
}) => {
  const response = await apiClient.post('/api/loyalty', data);
  return response.data;
};

// Admin dashboard stats
export const getAdminStats = async () => {
  const response = await apiClient.get('/api/admin/stats');
  return response.data;
};

// Handle errors from API requests
apiClient.interceptors.response.use(
  response => response,
  error => {
    // Check if error response exists
    if (error.response) {
      // Unauthorized, redirect to login
      if (error.response.status === 401) {
        // In client-side code, we can redirect to login
        if (typeof window !== 'undefined') {
          window.location.href = '/admin/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
