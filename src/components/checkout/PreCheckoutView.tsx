"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Loader2, PackageOpen, ShoppingCart } from "lucide-react";
import { appendUtmToContinueUrlAction } from "@/actions/catalog";
import { RyeCheckoutPanel } from "@/components/checkout/RyeCheckoutPanel";
import { useCartStore } from "@/components/cart/cart-store";
import {
  SettingsCard,
  SettingsCardHeader,
  SettingsInput,
} from "@/components/profile/profile-settings-ui";
import { cn } from "@/lib/ai-chat/cn";
import { friendlyStoreName } from "@/lib/commerce/friendly-store-name";
import {
  normalizeShopifyCountryInput,
  SHOPIFY_COUNTRIES,
  shopifyCountryLabel,
} from "@/lib/cart/countries";
import { regionsForCountry } from "@/lib/cart/regions";
import { variantIdsMatch } from "@/lib/cart/variant-id";
import {
  clearPendingCheckout,
  pendingCheckoutSelection,
  readPendingCheckout,
} from "@/lib/client/pending-checkout";
import { guestFetch } from "@/lib/client/guest-fetch";
import type {
  ActiveCartGroup,
  ActiveCartLine,
  CartGroupCheckoutResponse,
  CheckoutAddressInput,
  SavedAddress,
} from "@/lib/cart/types";
import {
  isUnrecoverableCheckoutFailure,
  normalizeCheckoutStatus,
  unrecoverableCheckoutUserMessage,
} from "@/lib/shopify/checkout-lifecycle";
import type { RyeCheckoutIntentSnapshot } from "@/lib/rye/types";

/**
 * Checkout flow:
 *   form  -> user fills address; store price/currency re-localizes by location.
 *   Buy now:
 *     - US address with a saved Rye product URL  -> try Rye, render `rye` phase.
 *     - otherwise, or if Rye can't serve the store -> redirect to the Shopify
 *       store checkout URL (UCP `continueUrl`) prefilled with the buyer info.
 */
type CheckoutPhase = "form" | "rye";

type CheckoutFormState = {
  buyerEmail: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  streetAddress: string;
  addressLocality: string;
  addressRegion: string;
  postalCode: string;
  addressCountry: string;
};

type SavedAddressesResponse = { addresses: SavedAddress[] };

const EMPTY_FORM: CheckoutFormState = {
  buyerEmail: "",
  firstName: "",
  lastName: "",
  phoneNumber: "",
  streetAddress: "",
  addressLocality: "",
  addressRegion: "",
  postalCode: "",
  addressCountry: "",
};

function formatPrice(amount: number, currency: string): string {
  const value = amount / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function lineTotalCents(line: ActiveCartLine): number | null {
  return (
    line.lineTotalCents ??
    (line.priceCents != null ? line.priceCents * line.quantity : null)
  );
}

function linePrice(
  line: ActiveCartLine,
  fallbackCurrency: string | null,
): string | null {
  const currency = line.currency ?? fallbackCurrency ?? "USD";
  const amount = lineTotalCents(line);
  return amount != null ? formatPrice(amount, currency) : null;
}

function formToAddress(
  form: CheckoutFormState,
): CheckoutAddressInput | undefined {
  const address: CheckoutAddressInput = {
    firstName: form.firstName,
    lastName: form.lastName,
    phoneNumber: form.phoneNumber,
    streetAddress: form.streetAddress,
    addressLocality: form.addressLocality,
    addressRegion: form.addressRegion,
    postalCode: form.postalCode,
    addressCountry: form.addressCountry.toUpperCase(),
  };
  return Object.values(address).some((value) => value?.trim())
    ? address
    : undefined;
}

function formFromSavedAddress(address: SavedAddress): CheckoutFormState {
  return {
    buyerEmail: address.buyerEmail ?? "",
    firstName: address.firstName,
    lastName: address.lastName,
    phoneNumber: address.phoneNumber,
    streetAddress: address.streetAddress,
    addressLocality: address.addressLocality,
    addressRegion: address.addressRegion,
    postalCode: address.postalCode,
    addressCountry: address.addressCountry,
  };
}

function canContinue(form: CheckoutFormState): boolean {
  return Boolean(
    form.buyerEmail.trim() &&
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.phoneNumber.trim() &&
    form.streetAddress.trim() &&
    form.addressLocality.trim() &&
    form.addressRegion.trim() &&
    form.postalCode.trim() &&
    form.addressCountry.trim(),
  );
}

async function saveCheckoutAddress(form: CheckoutFormState): Promise<void> {
  const res = await guestFetch("/api/profile/addresses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: `${form.firstName} ${form.lastName}`.trim() || undefined,
      buyerEmail: form.buyerEmail,
      firstName: form.firstName,
      lastName: form.lastName,
      phoneNumber: form.phoneNumber,
      streetAddress: form.streetAddress,
      addressLocality: form.addressLocality,
      addressRegion: form.addressRegion,
      postalCode: form.postalCode,
      addressCountry: form.addressCountry,
    }),
  });
  if (!res.ok) throw new Error("Could not save address.");
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? fallback);
  return body as T;
}

function CheckoutField({
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <SettingsInput
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
    </label>
  );
}

function CountrySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selectedLabel = value ? `${shopifyCountryLabel(value)} (${value})` : "";
  const search = query.trim().toLowerCase();
  const options = SHOPIFY_COUNTRIES.filter((country) => {
    if (!search) return true;
    return (
      country.label.toLowerCase().includes(search) ||
      country.code.toLowerCase().includes(search)
    );
  }).slice(0, 40);

  return (
    <label className="relative flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-soft">Country</span>
      <SettingsInput
        value={open ? query : selectedLabel}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        placeholder="Search country"
        autoComplete="country-name"
      />
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close country selector"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
            tabIndex={-1}
          />
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-hairline bg-white p-1 shadow-card">
            {options.length ? (
              options.map((country) => (
                <button
                  key={country.code}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(country.code);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-ink transition hover:bg-surface-subtle"
                >
                  <span>{country.label}</span>
                  <span className="font-mono text-[10px] text-ink-muted">
                    {country.code}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-2.5 py-2 text-xs text-ink-muted">
                No supported country found.
              </p>
            )}
          </div>
        </>
      ) : null}
    </label>
  );
}

function RegionField({
  countryCode,
  value,
  onChange,
}: {
  countryCode: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const regions = regionsForCountry(countryCode);
  if (!regions.length) {
    return (
      <CheckoutField
        label="State / region"
        value={value}
        onChange={onChange}
        placeholder="State, province, or region"
        autoComplete="address-level1"
      />
    );
  }

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-soft">State / region</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="address-level1"
        className="input w-full rounded-xl border-hairline bg-surface-subtle/50 px-3.5 focus:border-ink/30 focus:bg-white focus:ring-2 focus:ring-ink/5"
      >
        <option value="">Select state / region</option>
        {regions.map((region) => (
          <option key={region.code} value={region.code}>
            {region.label} ({region.code})
          </option>
        ))}
      </select>
    </label>
  );
}

function AddressForm({
  form,
  onChange,
}: {
  form: CheckoutFormState;
  onChange: (patch: Partial<CheckoutFormState>) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <CheckoutField
        label="Email"
        value={form.buyerEmail}
        onChange={(buyerEmail) => onChange({ buyerEmail })}
        type="email"
        autoComplete="email"
      />
      <CheckoutField
        label="Phone"
        value={form.phoneNumber}
        onChange={(phoneNumber) => onChange({ phoneNumber })}
        type="tel"
        autoComplete="tel"
      />
      <CheckoutField
        label="First name"
        value={form.firstName}
        onChange={(firstName) => onChange({ firstName })}
        autoComplete="given-name"
      />
      <CheckoutField
        label="Last name"
        value={form.lastName}
        onChange={(lastName) => onChange({ lastName })}
        autoComplete="family-name"
      />
      <div className="sm:col-span-2">
        <CheckoutField
          label="Address"
          value={form.streetAddress}
          onChange={(streetAddress) => onChange({ streetAddress })}
          autoComplete="street-address"
        />
      </div>
      <CheckoutField
        label="City"
        value={form.addressLocality}
        onChange={(addressLocality) => onChange({ addressLocality })}
        autoComplete="address-level2"
      />
      <CountrySelect
        value={form.addressCountry}
        onChange={(addressCountry) =>
          onChange({ addressCountry, addressRegion: "" })
        }
      />
      <RegionField
        countryCode={form.addressCountry}
        value={form.addressRegion}
        onChange={(addressRegion) => onChange({ addressRegion })}
      />
      <CheckoutField
        label={form.addressCountry === "US" ? "ZIP" : "Postal code"}
        value={form.postalCode}
        onChange={(postalCode) => onChange({ postalCode })}
        autoComplete="postal-code"
      />
    </div>
  );
}

function normalizeShopDomain(domain: string | null | undefined): string | null {
  const trimmed = domain?.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().replace(/^www\./, "");
}

function findSelection(
  groups: ActiveCartGroup[],
  shopDomain: string | null,
  variantId: string | null,
): { group: ActiveCartGroup; line: ActiveCartLine } | null {
  if (!variantId) return null;

  const normalizedShop = normalizeShopDomain(shopDomain);

  const findInGroup = (group: ActiveCartGroup) =>
    group.lineItems.find((item) => variantIdsMatch(item.variantId, variantId));

  if (normalizedShop) {
    for (const group of groups) {
      if (normalizeShopDomain(group.shopDomain) !== normalizedShop) continue;
      const line = findInGroup(group);
      if (line) return { group, line };
    }
  }

  for (const group of groups) {
    const line = findInGroup(group);
    if (line) return { group, line };
  }

  return null;
}

export function PreCheckoutView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const shopDomain = searchParams.get("shop");
  const variantId = searchParams.get("variant");
  const cart = useCartStore((s) => s.cart);
  const loadingCart = useCartStore((s) => s.loading);
  const refresh = useCartStore((s) => s.refresh);
  const setDrawerOpen = useCartStore((s) => s.setDrawerOpen);
  const [form, setForm] = useState<CheckoutFormState>(EMPTY_FORM);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [saveAddress, setSaveAddress] = useState(true);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [preparingCheckout, setPreparingCheckout] = useState(false);
  const [localizingPrice, setLocalizingPrice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<CheckoutPhase>("form");
  const [ryeIntent, setRyeIntent] = useState<RyeCheckoutIntentSnapshot | null>(
    null,
  );

  const selection = useMemo(() => {
    const fromCart = findSelection(cart?.groups ?? [], shopDomain, variantId);
    if (fromCart) return fromCart;
    const pending = readPendingCheckout(shopDomain, variantId);
    return pending ? pendingCheckoutSelection(pending) : null;
  }, [cart?.groups, shopDomain, variantId]);

  useEffect(() => {
    if (!cart && !loadingCart) void refresh();
  }, [cart, loadingCart, refresh]);

  useEffect(() => {
    if (findSelection(cart?.groups ?? [], shopDomain, variantId)) {
      clearPendingCheckout();
    }
  }, [cart?.groups, shopDomain, variantId]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await guestFetch("/api/profile/addresses", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as SavedAddressesResponse;
        const addresses = data.addresses ?? [];
        setSavedAddresses(addresses);
        const defaultAddress =
          addresses.find((address) => address.isDefault) ?? addresses[0];
        if (defaultAddress) setForm(formFromSavedAddress(defaultAddress));
      } catch {
        // Saved addresses are optional; manual entry still works.
      } finally {
        setLoadingAddresses(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const shop = selection?.group.shopDomain;
    const country = form.addressCountry.trim();
    if (!shop || !country || phase !== "form") return;

    const address = formToAddress(form);
    if (!address?.addressCountry) return;

    const timer = window.setTimeout(() => {
      const localize = useCartStore.getState().localizeGroup;
      if (typeof localize !== "function") return;

      setLocalizingPrice(true);
      void localize({ shopDomain: shop, shippingAddress: address }).finally(
        () => {
          setLocalizingPrice(false);
        },
      );
    }, 500);

    return () => window.clearTimeout(timer);
  }, [
    form.addressCountry,
    form.addressRegion,
    form.postalCode,
    phase,
    selection?.group.shopDomain,
  ]);

  const updateForm = useCallback(
    (patch: Partial<CheckoutFormState>) => {
      setForm((prev) => ({ ...prev, ...patch }));
      if (phase !== "form") setPhase("form");
      setRyeIntent(null);
      setError(null);
    },
    [phase],
  );

  /** Shopify fallback: hand the buyer off to the store's secure checkout URL. */
  const goToStoreCheckout = useCallback(async () => {
    if (!selection || !shopDomain || !variantId) {
      throw new Error("Could not start checkout.");
    }

    const res = await guestFetch(
      `/api/cart/items/${encodeURIComponent(variantId)}/checkout?shop=${encodeURIComponent(shopDomain)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "merchant",
          buyerEmail: form.buyerEmail,
          shippingAddress: formToAddress(form),
        }),
      },
    );

    if (res.status === 404 && selection.group.checkoutUrl) {
      const { url } = await appendUtmToContinueUrlAction(
        selection.group.checkoutUrl,
      );
      clearPendingCheckout();
      window.location.assign(url);
      return;
    }

    const { checkout } = await readJson<{ checkout: CartGroupCheckoutResponse }>(
      res,
      "Could not start checkout.",
    );

    const status = normalizeCheckoutStatus(checkout.status);
    const messages = checkout.messages ?? [];
    if (isUnrecoverableCheckoutFailure(status, messages)) {
      throw new Error(unrecoverableCheckoutUserMessage(messages));
    }

    const continueUrl = checkout.continueUrl;
    if (!continueUrl) {
      throw new Error(
        checkout.detail || "This store could not start checkout right now.",
      );
    }

    const { url } = await appendUtmToContinueUrlAction(continueUrl);
    clearPendingCheckout();
    window.location.assign(url);
  }, [form, selection, shopDomain, variantId]);

  /** Rye intents are immutable — created only when the buyer commits at Buy now. */
  const startRyeCheckout = useCallback(async (): Promise<boolean> => {
    if (!selection?.line.productUrl) {
      return false;
    }

    const res = await guestFetch("/api/rye/checkout-intents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productUrl: selection.line.productUrl,
        quantity: selection.line.quantity,
        buyerEmail: form.buyerEmail,
        shippingAddress: formToAddress(form),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      intent?: RyeCheckoutIntentSnapshot;
      error?: string;
      fallback?: string | null;
      fixable?: boolean;
    };

    // Rye disabled or store-level limitation -> let the caller fall back.
    if (res.status === 503 || data.fallback === "shopify") {
      return false;
    }

    if (!res.ok || !data.intent) {
      throw new Error(data.error ?? "Could not start checkout.");
    }
    if (data.intent.state === "failed") {
      throw new Error(data.error ?? "Checkout could not be completed.");
    }

    clearPendingCheckout();
    setRyeIntent(data.intent);
    setPhase("rye");
    return true;
  }, [form, selection]);

  const startCheckout = useCallback(() => {
    void (async () => {
      setPreparingCheckout(true);
      setError(null);
      try {
        if (saveAddress) {
          await saveCheckoutAddress(form).catch(() => undefined);
        }

        const normalizedCountry = normalizeShopifyCountryInput(
          form.addressCountry.trim(),
        );
        const isUs = normalizedCountry === "US";
        const hasProductUrl = Boolean(selection?.line.productUrl);

        if (isUs && hasProductUrl) {
          const handled = await startRyeCheckout();
          if (handled) return;
        }

        await goToStoreCheckout();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not start checkout.",
        );
        setPhase("form");
        setRyeIntent(null);
      } finally {
        setPreparingCheckout(false);
      }
    })();
  }, [
    form,
    goToStoreCheckout,
    saveAddress,
    selection,
    startRyeCheckout,
    variantId,
  ]);

  const fallbackToStoreCheckout = useCallback(() => {
    setPreparingCheckout(true);
    setError(null);
    void goToStoreCheckout()
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Could not start store checkout.",
        );
        setPhase("form");
        setRyeIntent(null);
      })
      .finally(() => setPreparingCheckout(false));
  }, [goToStoreCheckout]);

  const handleRyeComplete = useCallback(
    (orderId: string | null) => {
      const id = orderId ?? ryeIntent?.id ?? null;
      setRyeIntent(null);
      setPhase("form");
      router.push(
        id ? `/order/confirmed?id=${encodeURIComponent(id)}` : "/order/confirmed",
      );
    },
    [router, ryeIntent?.id],
  );

  const handleRyeError = useCallback(
    (message: string, options?: { fallback?: boolean }) => {
      if (options?.fallback) {
        fallbackToStoreCheckout();
        return;
      }
      setError(message);
      setPhase("form");
      setRyeIntent(null);
    },
    [fallbackToStoreCheckout],
  );

  if (loadingCart && !cart) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-body-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" />
        Preparing checkout...
      </div>
    );
  }

  if (!selection) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center shoop-page-x py-10">
        <SettingsCard className="max-w-sm p-8 text-center">
          <PackageOpen className="mx-auto size-10 text-ink-muted" />
          <h1 className="mt-4 font-serif text-2xl font-semibold tracking-tight text-ink">
            We could not find that item
          </h1>
          <p className="mt-2 text-sm leading-5 text-ink-muted">
            Open your cart and choose Buy now from the product you want to
            checkout.
          </p>
          <button
            type="button"
            onClick={() => {
              setDrawerOpen(true);
              router.push("/");
            }}
            className="btn-primary mt-5"
          >
            Open cart
          </button>
        </SettingsCard>
      </div>
    );
  }

  const { group, line } = selection;
  const price = linePrice(line, group.currency);
  const totalCents = lineTotalCents(line);
  const subtotal =
    totalCents != null
      ? formatPrice(totalCents, line.currency ?? group.currency ?? "USD")
      : price;
  const isUsAddress =
    normalizeShopifyCountryInput(form.addressCountry.trim()) === "US";
  const canUseRye = isUsAddress && Boolean(line.productUrl);
  const canUseStoreCheckout = group.checkout.checkoutSupported;
  const canSubmit =
    canContinue(form) &&
    !preparingCheckout &&
    (canUseRye || canUseStoreCheckout);
  const checkoutFootnote =
    phase === "rye"
      ? "Review final pricing and pay securely without leaving Shoop."
      : canUseRye
        ? "We'll try instant checkout, then the store's secure checkout if needed."
        : "You'll continue on the store's secure checkout.";

  return (
    <div className="shoop-page-x mx-auto w-full max-w-page-wide py-4 md:py-6">
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-4 inline-flex items-center gap-1.5 text-body-sm font-medium text-ink-soft transition-colors hover:text-ink"
      >
        <ChevronLeft className="size-4" />
        Back
      </button>
      <h1 className="mb-5 font-serif text-2xl font-semibold tracking-tight text-ink md:text-3xl">
        Checkout
      </h1>

      <div className="grid gap-5 pb-8 lg:grid-cols-[1fr_20rem] lg:gap-6 xl:grid-cols-[1fr_22rem]">
        {phase === "rye" && ryeIntent ? (
          <SettingsCard>
            <SettingsCardHeader
              title="Secure checkout"
              description="Review your order and pay without leaving Shoop."
            />
            <div className="px-5 py-4 sm:px-6">
              <RyeCheckoutPanel
                intent={ryeIntent}
                onComplete={handleRyeComplete}
                onError={handleRyeError}
                onIntentUpdate={setRyeIntent}
                onUseStoreCheckout={
                  canUseStoreCheckout ? fallbackToStoreCheckout : undefined
                }
              />
            </div>
          </SettingsCard>
        ) : (
          <SettingsCard>
            <SettingsCardHeader
              title="Contact & shipping"
              description="We use this for delivery and order updates."
            />
            <div className="px-5 py-4 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-ink">Shipping address</p>
                {loadingAddresses ? (
                  <Loader2 className="size-4 animate-spin text-ink-muted" />
                ) : null}
              </div>

              {savedAddresses.length ? (
                <div className="mt-4 grid gap-2">
                  {savedAddresses.map((address) => {
                    const selected =
                      form.streetAddress === address.streetAddress &&
                      form.postalCode === address.postalCode;
                    return (
                      <button
                        key={address.id}
                        type="button"
                        onClick={() =>
                          updateForm(formFromSavedAddress(address))
                        }
                        className={cn(
                          "rounded-xl border px-4 py-3 text-left text-sm transition-all duration-150 ease-ios",
                          selected
                            ? "border-ink bg-ink text-white shadow-[0_2px_8px_rgba(26,26,46,0.18)]"
                            : "border-hairline text-ink hover:border-ink/30 hover:bg-surface-subtle/80",
                        )}
                      >
                        <span className="block font-medium">
                          {address.label ||
                            `${address.firstName} ${address.lastName}`}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 block text-xs leading-5",
                            selected ? "text-white/75" : "text-ink-muted",
                          )}
                        >
                          {address.streetAddress}, {address.addressLocality}{" "}
                          {address.addressRegion} {address.postalCode}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="mt-5">
                <AddressForm form={form} onChange={updateForm} />
              </div>

              <label className="mt-4 flex items-center gap-2 text-xs font-medium text-ink-secondary">
                <input
                  type="checkbox"
                  checked={saveAddress}
                  onChange={(event) => setSaveAddress(event.target.checked)}
                  className="size-4 rounded border-hairline text-brand focus:ring-brand/20"
                />
                Save this address for next time
              </label>
            </div>
          </SettingsCard>
        )}

        <SettingsCard className="h-fit">
          <div className="border-b border-hairline-soft px-5 py-4 sm:px-6">
            <h2 className="text-sm font-semibold tracking-tight text-ink">
              Order summary
            </h2>
            <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-secondary">
              {friendlyStoreName(group.shopDomain)}
            </p>
          </div>

          <div className="px-5 py-4 sm:px-6">
            <div className="flex gap-3">
              <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-muted text-ink-muted">
                {line.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={line.imageUrl}
                    alt={line.title}
                    className="size-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <ShoppingCart className="size-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink">
                  {line.title}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Qty × {line.quantity}
                </p>
              </div>
              {price && phase === "form" ? (
                <p className="text-sm font-semibold text-ink">
                  {localizingPrice ? (
                    <Loader2 className="inline size-3.5 animate-spin text-ink-muted" />
                  ) : (
                    price
                  )}
                </p>
              ) : null}
            </div>

            {phase === "form" ? (
              <>
                <div className="mt-4 space-y-2 border-t border-hairline-soft pt-4 text-body-sm">
                  <div className="flex justify-between text-ink-secondary">
                    <span>Items ({line.quantity})</span>
                    <span className="font-semibold text-ink">
                      {localizingPrice ? (
                        <Loader2 className="inline size-3.5 animate-spin text-ink-muted" />
                      ) : (
                        (price ?? "--")
                      )}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex justify-between border-t border-hairline-soft pt-4 text-base font-semibold text-ink">
                  <span>Subtotal</span>
                  <span>
                    {localizingPrice ? (
                      <Loader2 className="inline size-4 animate-spin text-ink-muted" />
                    ) : (
                      (subtotal ?? "--")
                    )}
                  </span>
                </div>
              </>
            ) : null}

            {!group.checkout.checkoutSupported ? (
              <p className="mt-3 rounded-xl border border-warning-tint bg-warning-tint/60 px-3 py-2 text-xs text-warning-dark">
                This store does not support single-product agent checkout yet.
              </p>
            ) : null}
            {error ? (
              <p className="mt-3 rounded-xl border border-error-border bg-error-bg px-3 py-2 text-xs text-error-deep">
                {error}
              </p>
            ) : null}

            {phase === "form" ? (
              <button
                type="button"
                disabled={!canSubmit}
                onClick={startCheckout}
                className="btn-primary mt-4 inline-flex h-12 w-full items-center justify-center gap-2 text-[13px]"
              >
                {preparingCheckout ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Buy now{subtotal ? ` — ${subtotal}` : ""}
              </button>
            ) : null}

            <p className="mt-2 text-center text-[11px] leading-4 text-ink-muted">
              {checkoutFootnote}
            </p>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
