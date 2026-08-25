import { makeNoiseProduct, makeProduct } from "../make-product";
import type { FakeUcpCatalogConfig } from "../types";

export const baseMensCatalog: FakeUcpCatalogConfig = {
  relevant: [
    makeProduct("gid://shopify/Product/101", "Men's Oxford Dress Shirt", {
      priceUsd: 22,
      size: "M",
      color: "White",
      gender: "mens",
      category: "gid://shopify/TaxonomyCategory/aa-1-13-7",
    }),
    makeProduct("gid://shopify/Product/102", "Men's Wool Dress Trousers", {
      priceUsd: 28,
      size: "33",
      color: "Charcoal",
      gender: "mens",
      category: "gid://shopify/TaxonomyCategory/aa-1-12-11",
    }),
    makeProduct("gid://shopify/Product/103", "Men's Leather Oxford Shoes", {
      priceUsd: 32,
      size: "10",
      color: "Black",
      gender: "mens",
      category: "gid://shopify/TaxonomyCategory/aa-8",
    }),
    makeProduct("gid://shopify/Product/104", "Men's Navy Blazer", {
      priceUsd: 40,
      size: "M",
      color: "Navy",
      gender: "mens",
    }),
    makeProduct("gid://shopify/Product/105", "Men's Olive Chinos", {
      priceUsd: 24,
      size: "33",
      color: "Olive",
      gender: "mens",
    }),
    makeProduct("gid://shopify/Product/106", "Men's White Dress Shirt", {
      priceUsd: 20,
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
