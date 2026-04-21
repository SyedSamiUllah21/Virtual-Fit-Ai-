

export interface Product {
  id: string;
  name: string;
  price: number;
  image: string;
  category: string;
  gender: 'Men' | 'Women';
  description?: string;
  rating?: number;
  reviews?: number;
}

export type BodyType = 'Athletic Build' | 'Slim Frame' | 'Broad Shoulders';

export type AppView = 'login' | 'signup' | 'collections' | 'studio' | 'dashboard' | 'orders' | 'settings';
