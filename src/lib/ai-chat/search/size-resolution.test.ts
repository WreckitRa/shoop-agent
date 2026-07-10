import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import {
  collectSizeOptionValues,
  expandRequestedSizeTokens,
  formatSizeDropReason,
  isExactSizeVerified,
  parseChestLengthSize,
  parseFixedListingSize,
  parseMerchantSuitLabel,
  letterFromFullWordLabel,
  lettersForChestMatch,
  resolveSizeDeterministic,
  shouldSurfaceWithSizeVerification,
  sizeResolutionNeedsLlm,
} from "./size-resolution";

const product = (
  id: string,
  title: string,
  extra: Record<string, unknown> = {},
): CatalogProductSummary =>
  ({
    id,
    title,
    variants: [
      {
        price: { amount: 9900, currency: "USD" },
        checkout_url: "https://example.test/cart/1:1",
      },
    ],
    ...extra,
  }) as unknown as CatalogProductSummary;

/** Suit Depot — numeric chest sizes only. */
const suitDepotBlazer = product(
  "gid://shopify/p/suit-depot",
  "Raphael Mens Solid Black Slim Fit Stretch 2 Button Blazer Sportcoat",
  {
    options: [
      {
        name: "Size",
        values: [
          { label: "34" },
          { label: "36" },
          { label: "38" },
          { label: "40" },
          { label: "42" },
          { label: "44" },
          { label: "46" },
          { label: "42L" },
        ],
      },
    ],
  },
);

/** Design Menswear — hybrid letter-(chest) labels. */
const designMenswearBlazer = product(
  "gid://shopify/p/design-menswear",
  "Purple Men's Blazer Jacket Stretch Fabric Notch Lapel Slim-Fit Style-S1601",
  {
    options: [
      {
        name: "Size",
        values: [
          { label: "s-(36)" },
          { label: "m-(38)" },
          { label: "l-(42)" },
          { label: "xl-(44)" },
          { label: "2xl-(46)" },
        ],
      },
    ],
  },
);

/** Bristol — fixed single-SKU with size in title. */
const calvinKlein38L = product(
  "gid://shopify/p/calvin-klein",
  "Calvin Klein Mens Slim fit Suit Jacket Blazer 38 L Black Solid",
  {
    variants: [
      {
        title: "Calvin Klein Mens Slim fit Suit Jacket Blazer 38 L Black Solid",
        description: {
          plain:
            "APPEARANCE Size: 38 Color: Black JACKET INFO Jacket Length: Long",
        },
        price: { amount: 7649, currency: "USD" },
        checkout_url: "https://example.test/cart/2:1",
      },
    ],
  },
);

/** Fusion Republic — weight-band letter sizes. */
const fusionRepublicBlazer = product(
  "gid://shopify/p/fusion",
  "Men's Business Casual Wool Blazer Solid Color Regular Fit",
  {
    options: [
      {
        name: "Size",
        values: [
          { label: "m 50-60 kg" },
          { label: "l 60-67.5 kg" },
          { label: "xl 65-75 kg" },
          { label: "xxl 70-82.5 kg" },
        ],
      },
    ],
  },
);

/** MensUSA — letter-only labels with prose. */
const mensUsaBlazer = product(
  "gid://shopify/p/mensusa",
  "Men'S Cotton Stretch Slim Fit Blazer Black",
  {
    options: [
      {
        name: "Size",
        values: [
          { label: "xl" },
          { label: "l or large" },
          { label: "m or medium" },
          { label: "s or small" },
        ],
      },
    ],
  },
);

/** Rovarix — full-word S/M/L/XL (chart: M 40–42, L 44–46). */
const rovarixBlazer = product(
  "gid://shopify/p/24FbHynphNCxdVDu7nKjH9",
  "Rovarix Men Blazer Black Slim Fit Sport Coat Jacket Classic",
  {
    options: [
      {
        name: "Size",
        values: [
          { label: "small" },
          { label: "medium" },
          { label: "large" },
          { label: "xl" },
        ],
      },
    ],
  },
);

/** Suit Secret — chest + length words; search options may omit variant sizes. */
const suitSecretBlazer = product(
  "gid://shopify/p/suit-secret",
  "Men's Black Classic Blazer 2 Button Regular Fit Z-2PP",
  {
    options: [
      { name: "Color", values: [{ label: "Black" }] },
      {
        name: "Size",
        values: [{ label: "38 regular" }, { label: "40 regular" }],
      },
    ],
    variants: [
      {
        id: "v1",
        checkout_url: "https://suitsecret.com/cart/1:1",
        price: { amount: 13900, currency: "USD" },
        options: [
          { name: "Color", label: "Black" },
          { name: "Size", label: "42 regular" },
        ],
      },
    ],
  },
);

describe("expandRequestedSizeTokens", () => {
  it("splits M / 40R into letter and chest tokens", () => {
    const p = expandRequestedSizeTokens("M / 40R");
    assert.equal(p.compound, true);
    assert.ok(p.tokens.includes("M"));
    assert.ok(p.tokens.includes("40"));
    assert.equal(p.chest, 40);
    assert.equal(p.length, "regular");
  });

  it("parses 40L as chest 40 long", () => {
    const cl = parseChestLengthSize("40L");
    assert.ok(cl);
    assert.equal(cl!.chest, 40);
    assert.equal(cl!.length, "long");
  });

  it("parses merchant suit labels", () => {
    assert.deepEqual(parseMerchantSuitLabel("42 regular"), {
      chest: 42,
      length: "regular",
    });
    assert.deepEqual(parseMerchantSuitLabel("40 long"), {
      chest: 40,
      length: "long",
    });
  });

  it("merges variant size labels when product options are incomplete", () => {
    const labels = collectSizeOptionValues(suitSecretBlazer).map((v) => v.label);
    assert.ok(labels.includes("42 regular"));
    assert.ok(labels.includes("38 regular"));
  });
});

describe("resolveSizeDeterministic", () => {
  const ctx = { category: "blazer", query: "black blazer men's" };

  it("matches M to m-(38) on hybrid labels", () => {
    const r = resolveSizeDeterministic("M", designMenswearBlazer, ctx);
    assert.equal(r.status, "match");
    if (r.status === "match") {
      assert.equal(r.merchantLabel, "m-(38)");
      assert.equal(r.method, "option_letter_token");
    }
  });

  it("matches compound M / 40R to m-(38) via M token", () => {
    const r = resolveSizeDeterministic("M / 40R", designMenswearBlazer, ctx);
    assert.equal(r.status, "match");
    if (r.status === "match") {
      assert.equal(r.merchantLabel, "m-(38)");
      assert.equal(r.matchedToken, "M");
    }
  });

  it("matches compound M / 40R to m 50-60 kg via M token", () => {
    const r = resolveSizeDeterministic("M / 40R", fusionRepublicBlazer, ctx);
    assert.equal(r.status, "match");
    if (r.status === "match") {
      assert.equal(r.merchantLabel, "m 50-60 kg");
      assert.equal(r.matchedToken, "M");
    }
  });

  it("matches 42R to weight-band M via chest→letter map (40–42 band prefers M)", () => {
    const r = resolveSizeDeterministic("42R", fusionRepublicBlazer, ctx);
    assert.equal(r.status, "match");
    if (r.status === "match") {
      assert.equal(r.merchantLabel, "m 50-60 kg");
      assert.equal(r.method, "chest_map");
    }
  });

  it("matches 42R to m or medium when both M and L exist on letter-only labels", () => {
    const r = resolveSizeDeterministic("42R", mensUsaBlazer, ctx);
    assert.equal(r.status, "match");
    if (r.status === "match") {
      assert.equal(r.merchantLabel, "m or medium");
      assert.equal(r.method, "chest_map");
    }
  });

  it("matches 42R to medium on full-word S/M/L/XL labels (chest 40–42 band)", () => {
    const r = resolveSizeDeterministic("42R", rovarixBlazer, ctx);
    assert.equal(r.status, "match");
    if (r.status === "match") {
      assert.equal(r.merchantLabel, "medium");
      assert.equal(r.method, "chest_map");
    }
  });

  it("matches 42R to large on full-word labels when medium is absent", () => {
    const noMedium = product("gid://shopify/p/no-m", "Blazer", {
      options: [
        {
          name: "Size",
          values: [{ label: "small" }, { label: "large" }, { label: "xl" }],
        },
      ],
    });
    const r = resolveSizeDeterministic("42R", noMedium, ctx);
    assert.equal(r.status, "match");
    if (r.status === "match") assert.equal(r.merchantLabel, "large");
  });

  it("maps full-word merchant labels to letter tokens", () => {
    assert.equal(letterFromFullWordLabel("large"), "l");
    assert.equal(letterFromFullWordLabel("Medium"), "m");
    assert.equal(letterFromFullWordLabel("small"), "s");
    assert.equal(letterFromFullWordLabel("xlarge"), "xl");
  });

  it("orders chest 42 as M before L for boundary sizing", () => {
    assert.deepEqual(lettersForChestMatch(42), ["m", "l"]);
  });

  it("matches 42R to 42 regular including variant-only size labels", () => {
    const r = resolveSizeDeterministic("42R", suitSecretBlazer, ctx);
    assert.equal(r.status, "match");
    if (r.status === "match") {
      assert.equal(r.merchantLabel, "42 regular");
    }
  });

  it("escalates exotic labels to LLM when tokens fail", () => {
    const exoticOnly = product("gid://shopify/p/exotic", "Blazer", {
      options: [
        {
          name: "Size",
          values: [{ label: "CN 175/96A" }, { label: "CN 180/100A" }],
        },
      ],
    });
    const r = resolveSizeDeterministic("M / 40R", exoticOnly, ctx);
    assert.equal(r.status, "unknown");
    assert.equal(
      sizeResolutionNeedsLlm(r, expandRequestedSizeTokens("M / 40R"), exoticOnly),
      true,
    );
  });

  it("matches M to chest 40 on numeric-only blazer options", () => {
    const r = resolveSizeDeterministic("M", suitDepotBlazer, ctx);
    assert.equal(r.status, "match");
    if (r.status === "match") {
      assert.ok(r.merchantLabel === "38" || r.merchantLabel === "40");
      assert.equal(r.method, "chest_map");
    }
  });

  it("matches numeric 40 on numeric labels", () => {
    const r = resolveSizeDeterministic("40", suitDepotBlazer, ctx);
    assert.equal(r.status, "match");
    if (r.status === "match") assert.equal(r.merchantLabel, "40");
  });

  it("mismatches M on numeric-only when only 2XL+ sizes exist", () => {
    const bigOnly = product("gid://shopify/p/big", "Big Blazer", {
      options: [
        {
          name: "Size",
          values: [{ label: "2xl-(46)" }, { label: "3xl-(48)" }],
        },
      ],
    });
    const r = resolveSizeDeterministic("M", bigOnly, ctx);
    assert.equal(r.status, "mismatch");
  });

  it("parses fixed SKU 38 L from Calvin Klein title", () => {
    const parsed = parseFixedListingSize(calvinKlein38L);
    assert.ok(parsed);
    assert.equal(parsed!.chest, 38);
    assert.equal(parsed!.length, "long");
  });

  it("matches M to fixed SKU chest 38 on single-SKU listing", () => {
    const r = resolveSizeDeterministic("M", calvinKlein38L, ctx);
    assert.equal(r.status, "match");
    if (r.status === "match") assert.equal(r.method, "sku_parsed");
  });

  it("mismatches M on fixed SKU chest 44", () => {
    const bigSku = product(
      "gid://shopify/p/big-sku",
      "Mens Blazer 44 L Navy",
      { variants: [{ checkout_url: "https://x.test/1" }] },
    );
    const r = resolveSizeDeterministic("M", bigSku, ctx);
    assert.equal(r.status, "mismatch");
  });

  it("unknown for single-SKU with no parseable size when size required path", () => {
    const noSize = product("gid://shopify/p/vague", "Generic Blazer Black", {
      variants: [{ checkout_url: "https://x.test/1" }],
    });
    const r = resolveSizeDeterministic("M", noSize, ctx);
    assert.equal(r.status, "unknown");
  });
});

describe("isExactSizeVerified", () => {
  it("rejects null preferredMatched when size required without resolution match", () => {
    assert.equal(isExactSizeVerified(true, undefined, null), false);
  });

  it("accepts sku_parsed match when preferredMatched is null", () => {
    assert.equal(
      isExactSizeVerified(
        true,
        {
          status: "match",
          method: "sku_parsed",
          confidence: 0.88,
        },
        null,
      ),
      true,
    );
  });

  it("rejects when preferredMatched is false", () => {
    assert.equal(
      isExactSizeVerified(
        true,
        {
          status: "match",
          merchantLabel: "m-(38)",
          method: "option_letter_token",
          confidence: 0.92,
        },
        false,
      ),
      false,
    );
  });
});

describe("parseMerchantSuitLabel", () => {
  it("parses fit-modified chest labels", () => {
    const r = parseMerchantSuitLabel("42 relaxed");
    assert.ok(r);
    assert.equal(r!.chest, 42);
    assert.equal(r!.fit, "relaxed");
  });
});

describe("shouldSurfaceWithSizeVerification", () => {
  it("surfaces unknown resolution when in stock", () => {
    assert.equal(
      shouldSurfaceWithSizeVerification(true, { status: "unknown", reason: "x" }, null),
      true,
    );
  });

  it("drops when Shopify relaxed to another size", () => {
    assert.equal(
      shouldSurfaceWithSizeVerification(
        true,
        { status: "match", method: "option_exact", confidence: 0.95, merchantLabel: "L" },
        false,
      ),
      false,
    );
  });
});

describe("formatSizeDropReason", () => {
  it("uses mismatch reason", () => {
    const text = formatSizeDropReason({
      status: "mismatch",
      reason: "Fixed SKU size 44 L does not match requested M",
      confidence: 0.9,
    });
    assert.match(text, /44 L/);
  });
});
