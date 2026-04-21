
import React from 'react';
import { Product } from '../types';

interface ProductCardProps {
  product: Product;
  onBuyNow: (product: Product) => void;
}

const ProductCard: React.FC<ProductCardProps> = ({ product, onBuyNow }) => {
  return (
    <div className="w-full max-w-[480px] flex flex-col group animate-in fade-in duration-700 h-full">
      {/* Large Clean Minimalist Image Frame with Sandy Background */}
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-[#e5dfd3] rounded-3xl mb-8 group-hover:shadow-[0_30px_60px_-15px_rgba(93,70,49,0.3)] transition-all duration-700 cursor-pointer">
        <img 
          src={product.image} 
          alt={product.name} 
          className="w-full h-full object-cover mix-blend-multiply transition-transform duration-1000 group-hover:scale-105"
        />
      </div>
      
      {/* Product Info */}
      <div className="flex flex-col items-center text-center px-2 mb-8 flex-grow">
        <h3 className="serif text-2xl md:text-3xl font-medium text-[#5d4631] mb-2 leading-tight tracking-tight">{product.name}</h3>
        <p className="text-xl font-bold text-[#8a5f3b]">${product.price}</p>
      </div>

      {/* Action Button - Dark Brown Minimalist */}
      <button
        onClick={() => onBuyNow(product)}
        className="w-full mt-auto bg-[#7d6244] border border-[#7d6244] text-white py-5 rounded-full text-sm font-bold uppercase tracking-[0.25em] hover:bg-[#fffaf2] hover:text-[#7d6244] transition-all active:scale-95 shadow-xl"
      >
        Buy Now
      </button>
    </div>
  );
};

export default ProductCard;
