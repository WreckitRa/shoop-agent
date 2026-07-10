import { z } from "zod";
import { checkoutAddressSchema } from "@/lib/cart/validators";

export const ryeCheckoutCreateSchema = z
  .object({
    productUrl: z.string().url().max(4000),
    quantity: z.number().int().min(1).max(99),
    buyerEmail: z.string().email().max(320),
    shippingAddress: checkoutAddressSchema,
  })
  .strict();

export const ryeCheckoutConfirmSchema = z
  .object({
    stripeToken: z.string().min(1).max(500),
  })
  .strict();
