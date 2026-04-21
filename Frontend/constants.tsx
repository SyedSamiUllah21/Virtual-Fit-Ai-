

import { Product } from './types';

export const FRONTEND_TO_BACKEND_PRODUCT_ID: Record<string, string> = {
  m1: 'M-UP-01',
  m2: 'M-UP-02',
  m3: 'M-UP-03',
  m4: 'M-BT-01',
  m5: 'M-BT-02',
  m6: 'M-BT-03',
  w1: 'W-UP-01',
  w2: 'W-UP-02',
  w3: 'W-UP-03',
  w4: 'W-BT-01',
  w5: 'W-BT-02',
  w6: 'W-BT-03',
};

export const BACKEND_TO_FRONTEND_PRODUCT_ID: Record<string, string> = Object.fromEntries(
  Object.entries(FRONTEND_TO_BACKEND_PRODUCT_ID).map(([frontendId, backendId]) => [backendId, frontendId])
);

export const MOCK_PRODUCTS: Product[] = [
  // Men's Uppers
  { id: 'm1', name: 'Olive Bomber Jacket', price: 129.99, gender: 'Men', category: 'Casual', image: '/m1u.png', description: '70% Cashmere, 30% Wool • Regular fit', rating: 4.8, reviews: 124 },
  { id: 'm2', name: 'Graphic Tee', price: 45.00, gender: 'Men', category: 'Casual', image: '/purple-tee.png', description: 'Oversized heavy cotton graphic tee', rating: 4.8, reviews: 56 },
  { id: 'm3', name: 'Blue Plaid Flannel Shirt', price: 145.00, gender: 'Men', category: 'Casual', image: '/m3u.png', description: '100% Cotton Flannel • Regular fit', rating: 4.8, reviews: 124 },
  
  // Men's Bottoms
  { id: 'm4', name: 'Khaki Chinos', price: 79.99, gender: 'Men', category: 'Essentials', image: '/m1L.png', description: 'Stretch Cotton Twill', rating: 4.5, reviews: 210 },
  { id: 'm5', name: 'Charcoal Dress Pants', price: 89.99, gender: 'Men', category: 'Formal', image: '/m2L.png', description: 'Premium Wool Blend', rating: 4.6, reviews: 145 },
  { id: 'm6', name: 'Olive Cargo Pants', price: 69.99, gender: 'Men', category: 'Casual', image: '/m3L.png', description: 'Heavy-Duty Cotton Canvas', rating: 4.7, reviews: 312 },

  // Women's Uppers
  { id: 'w1', name: 'Silk Blouse', price: 89.99, gender: 'Women', category: 'Formal', image: '/W1u.png', description: '100% Mulberry Silk', rating: 4.8, reviews: 112 },
  { id: 'w2', name: 'Cashmere Mock Sweater', price: 149.99, gender: 'Women', category: 'Essentials', image: '/W2u.png', description: 'Grade A Cashmere', rating: 4.9, reviews: 56 },
  { id: 'w3', name: 'Vintage Graphic Tee', price: 39.99, gender: 'Women', category: 'Casual', image: '/W3u.png', description: 'Distressed Cotton', rating: 4.3, reviews: 14 },
  
  // Women's Bottoms
  { id: 'w4', name: 'High-Rise Wide Leg Jeans', price: 79.99, gender: 'Women', category: 'Formal', image: '/w1L.png', description: '100% Belgian Linen', rating: 4.6, reviews: 33 },
  { id: 'w5', name: 'Beige Linen Culottes', price: 95.00, gender: 'Women', category: 'Casual', image: '/w2L.png', description: 'Vintage Wash Denim', rating: 4.7, reviews: 201 },
  { id: 'w6', name: 'Tailored Black Trousers', price: 110.00, gender: 'Women', category: 'Essentials', image: '/w3L.png', description: 'Stretch Crepe', rating: 4.9, reviews: 88 },
];
