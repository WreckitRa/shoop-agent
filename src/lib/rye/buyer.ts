import { normalizeShopifyCountryInput } from "@/lib/cart/countries";
import type { CheckoutAddressInput } from "@/lib/cart/types";

export type RyeBuyerInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1: string;
  address2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
};

/** Rye Universal Checkout is US-only. */
export function isUsRyeCheckoutCountry(country: string | undefined): boolean {
  if (!country?.trim()) return false;
  return normalizeShopifyCountryInput(country.trim()) === "US";
}

/** Format phone for Rye (e.g. 212-333-2121). */
export function formatRyePhone(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    const local = digits.slice(1);
    return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return trimmed;
}

export function checkoutFormToRyeBuyer(input: {
  buyerEmail: string;
  shippingAddress: CheckoutAddressInput;
}): RyeBuyerInput {
  const address = input.shippingAddress;
  const country = normalizeShopifyCountryInput(address.addressCountry ?? "US");
  if (country !== "US") {
    throw new Error("Rye checkout requires a US shipping address.");
  }

  const firstName = address.firstName?.trim() ?? "";
  const lastName = address.lastName?.trim() ?? "";
  const email = input.buyerEmail.trim();
  const phone = formatRyePhone(address.phoneNumber?.trim() ?? "");
  const address1 = address.streetAddress?.trim() ?? "";
  const city = address.addressLocality?.trim() ?? "";
  const province = address.addressRegion?.trim() ?? "";
  const postalCode = address.postalCode?.trim() ?? "";

  if (!firstName || !lastName || !email || !phone || !address1 || !city || !province || !postalCode) {
    throw new Error("Complete all shipping fields before checkout.");
  }

  return {
    firstName,
    lastName,
    email,
    phone,
    address1,
    city,
    province,
    postalCode,
    country: "US",
  };
}
