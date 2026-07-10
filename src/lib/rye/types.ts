export type RyeMoney = {
  amountSubunits: number;
  currencyCode: string;
};

export type RyeOfferShippingOption = {
  id: string;
  cost: RyeMoney;
};

export type RyeOffer = {
  subtotal: RyeMoney;
  tax: RyeMoney | null;
  shipping: RyeMoney | null;
  total: RyeMoney;
  selectedShippingOptionId: string | null;
  shippingOptions: RyeOfferShippingOption[];
};

export type RyeFailureReason = {
  code: string;
  message: string;
};

export type RyeCheckoutIntentSnapshot = {
  id: string;
  state: string;
  productUrl: string;
  quantity: number;
  offer: RyeOffer | null;
  failureReason: RyeFailureReason | null;
  orderId: string | null;
};
