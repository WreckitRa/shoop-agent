import { makeNoiseProduct, makeProduct } from "../make-product";
import type { FakeUcpCatalogConfig } from "../types";

export const baseMensCatalog: FakeUcpCatalogConfig = {
  relevant: [
    makeProduct("gid://shopify/Product/101", "Men's Oxford Dress Shirt", {
      priceUsd: 45,
      size: "M",
      color: "White",
      gender: "mens",
      category: "gid://shopify/TaxonomyCategory/aa-1-13-8",
    }),
    makeProduct("gid://shopify/Product/102", "Men's Wool Dress Trousers", {
      priceUsd: 55,
      size: "33",
      color: "Charcoal",
      gender: "mens",
      category: "gid://shopify/TaxonomyCategory/aa-1-13-9",
    }),
    makeProduct("gid://shopify/Product/103", "Men's Leather Oxford Shoes", {
      priceUsd: 75,
      size: "10",
      color: "Black",
      gender: "mens",
      category: "gid://shopify/TaxonomyCategory/aa-1-14-2",
    }),
    makeProduct("gid://shopify/Product/104", "Men's Navy Blazer", {
      priceUsd: 89,
      size: "M",
      color: "Navy",
      gender: "mens",
    }),
    makeProduct("gid://shopify/Product/105", "Men's Olive Chinos", {
      priceUsd: 42,
      size: "33",
      color: "Olive",
      gender: "mens",
    }),
    makeProduct("gid://shopify/Product/106", "Men's White Dress Shirt", {
      priceUsd: 38,
      size: "M",
      color: "White",
      gender: "mens",
    }),
  ],
};

export const baseWomensNoise = [
  makeNoiseProduct("gid://shopify/Product/w901", "Womens Floral Midi Dress", {
    shopName: "Shein Boutique",
    gender: "womens",
  }),
  makeNoiseProduct("gid://shopify/Product/w902", "Womens Heels", {
    shopName: "Shein Boutique",
    gender: "womens",
  }),
];
