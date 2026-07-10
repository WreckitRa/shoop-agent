import { z } from "zod";

const optionalNullableString = z.string().max(4000).nullable().optional();

export const cartItemProductSchema = z
  .object({
    title: z.string().max(500).optional(),
    imageUrl: optionalNullableString,
    priceCents: z.number().int().nonnegative().nullable().optional(),
    currency: z.string().max(8).nullable().optional(),
    sellerName: z.string().max(200).nullable().optional(),
    sellerDomain: z.string().max(300).nullable().optional(),
    productId: z.string().max(500).nullable().optional(),
    productUrl: z.string().url().max(4000).nullable().optional(),
  })
  .strict();

export const cartAddItemSchema = z
  .object({
    variantId: z.string().min(1).max(500),
    checkoutUrl: z.string().url().max(4000),
    quantity: z.number().int().min(1).max(99).optional(),
    replaceExisting: z.boolean().optional(),
    product: cartItemProductSchema.optional(),
  })
  .strict();

export const cartUpdateItemSchema = z
  .object({
    quantity: z.number().int().min(0).max(99),
  })
  .strict();

export const checkoutAddressSchema = z
  .object({
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    phoneNumber: z.string().max(40).optional(),
    streetAddress: z.string().max(300).optional(),
    addressLocality: z.string().max(120).optional(),
    addressRegion: z.string().max(120).optional(),
    postalCode: z.string().max(40).optional(),
    /** Accept friendly inputs like "USA"; route normalizes to ISO-3166 alpha-2 for Shopify. */
    addressCountry: z.string().max(80).optional(),
  })
  .strict();

export const cartLocalizeSchema = z
  .object({
    shippingAddress: z.object({
      addressCountry: z.string().min(2).max(80),
      addressRegion: z.string().max(120).optional(),
      postalCode: z.string().max(40).optional(),
    }),
  })
  .strict();

export const cartGroupCheckoutSchema = z
  .object({
    mode: z.enum(["agentic", "embedded", "merchant"]),
    buyerEmail: z.string().email().max(320).optional().or(z.literal("")),
    shippingAddress: checkoutAddressSchema.optional(),
  })
  .strict();

export const shopPayBillingAddressSchema = z
  .object({
    full_name: z.string().min(1).max(200),
    street_address: z.string().min(1).max(300),
    address_locality: z.string().min(1).max(120),
    address_region: z.string().min(1).max(120),
    postal_code: z.string().min(1).max(40),
    address_country: z.string().min(1).max(80),
  })
  .strict();

export const cartGroupCompleteCheckoutSchema = z
  .object({
    checkoutId: z.string().min(1).max(1000),
    checkoutUrl: z.string().url().max(4000),
    shopToken: z.string().min(1).max(4000),
    buyerEmail: z.string().email().max(320).optional().or(z.literal("")),
    billingAddress: shopPayBillingAddressSchema,
  })
  .strict();

export const savedAddressPostSchema = z
  .object({
    label: z.string().max(120).optional(),
    buyerEmail: z.string().email().max(320).optional().or(z.literal("")),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    phoneNumber: z.string().min(1).max(40),
    streetAddress: z.string().min(1).max(300),
    addressLocality: z.string().min(1).max(120),
    addressRegion: z.string().min(1).max(120),
    postalCode: z.string().min(1).max(40),
    addressCountry: z.string().min(1).max(80),
    isDefault: z.boolean().optional(),
  })
  .strict();
