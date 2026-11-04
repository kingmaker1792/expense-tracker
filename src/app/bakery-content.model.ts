/** Published bakery content shared with the public storefront. */
export interface BakeryDiscountTier {
  minQuantity: number;
  percent: number;
}

export interface BakeryProduct {
  isSample?: boolean;
  name: string;
  description: string;
  category: 'Cakes' | 'Cupcakes' | 'Brownies';
  price: number;
  minQuantity: number;
  maxQuantity: number;
  discountPercent: number | null;
  discountTiers: BakeryDiscountTier[];
  images: string[];
  flavour: string;
  type: string;
  occasions: string[];
  badge?: string;
  collection?: string;
  size?: string;
}
