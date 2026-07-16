import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearMockDressCallLog,
  getMockDressCallLog,
  MockAvatarProvider,
  MockTryOnProvider,
  garmentTypeFromSlot,
  isAccessoryGarment,
} from "./providers/mock-providers";
import { sortRefsForOutfitChain } from "./garment-type";
import {
  resetTryonProvidersForTests,
  setTryonProvidersForTests,
} from "./providers";
import {
  clearInMemoryGenerations,
  countUserGenerationsToday,
  findCachedSingleTryon,
  useInMemoryGenerations,
  TryonCapError,
  assertUserGenerationCap,
} from "./generations";
import {
  clearTryonMemoryStorage,
  setTryonStorageMode,
} from "./storage";
import { setAvatarIntakeOverride } from "./avatar/intake";
import { buildFashnAvatarPrompt } from "./avatar/fashn-prompt";
import { buildTryonDressPromptCompact } from "./dress/prompt";
import { buildOutfitCollagePrompt } from "./dress/outfit-collage";
import { buildTryonProductContext } from "./dress/product-context";
import { toPickTryonContract } from "./run-single";
import { clearOutfitProgress } from "./run-outfit";
import {
  isGlobalTryonCapTripped,
  isTryonEnabledForUser,
  tripGlobalTryonCap,
} from "./feature-flags";
import { TRYON_USER_DAILY_CAP } from "./config";
import { TRYON_DISCLAIMER } from "./types";
import { RENDER_CONTRACT_VERSION } from "@/lib/fashion-memory/types/render-contract";
import type { RenderContract } from "@/lib/fashion-memory/types/render-contract";

const USER = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
const PERSON = "b2c3d4e5-f6a7-4890-b123-456789abcdef";

beforeEach(() => {
  process.env.TRYON_USE_MOCKS = "1";
  process.env.TRYON_ENABLED = "1";
  delete process.env.TRYON_GLOBAL_CAP_TRIPPED;
  delete (globalThis as { __tryonDailySpend?: number }).__tryonDailySpend;
  resetTryonProvidersForTests();
  setTryonStorageMode("memory");
  clearTryonMemoryStorage();
  useInMemoryGenerations();
  clearMockDressCallLog();
  clearOutfitProgress();
  setAvatarIntakeOverride(null);
  setTryonProvidersForTests({
    avatar: new MockAvatarProvider(),
    tryOn: new MockTryOnProvider(),
  });
});

afterEach(() => {
  clearInMemoryGenerations();
  setAvatarIntakeOverride(null);
});

describe("feature flags", () => {
  it("try-on is enabled by default", async () => {
    delete process.env.TRYON_ENABLED;
    delete process.env.TRYON_USER_IDS;
    assert.equal(await isTryonEnabledForUser(USER), true);
  });

  it("TRYON_ENABLED=0 disables try-on", async () => {
    process.env.TRYON_ENABLED = "0";
    assert.equal(await isTryonEnabledForUser(USER), false);
  });
});

describe("dress provider resolution", () => {
  it("resolves FASHN only when key is set", () => {
    const prevFashn = process.env.FASHN_API_KEY;
    const prevMocks = process.env.TRYON_USE_MOCKS;
    delete process.env.TRYON_USE_MOCKS;
    process.env.FASHN_API_KEY = "fashn-test";
    resetTryonProvidersForTests();
    const { resolveDressProviderKeys, isDressCompareMode } = require("./providers/resolve-dress-providers");
    assert.deepEqual(resolveDressProviderKeys(), ["fashn"]);
    assert.equal(isDressCompareMode(), false);
    process.env.FASHN_API_KEY = prevFashn;
    process.env.TRYON_USE_MOCKS = prevMocks;
    resetTryonProvidersForTests();
  });
});

describe("avatar try-on storage contract", () => {
  it("maps content types to file extensions", () => {
    const {
      extensionForImageContentType,
      contentTypeFromStoragePath,
      resolveAvatarContentType,
    } = require("./avatar/tryon-ready");
    assert.equal(extensionForImageContentType("image/png"), "png");
    assert.equal(extensionForImageContentType("image/jpeg"), "jpg");
    assert.equal(
      contentTypeFromStoragePath("user/person/avatar/preview-fashn-1.png"),
      "image/png",
    );
    assert.equal(
      resolveAvatarContentType(undefined, "user/person/avatar/preview-fashn-1.jpg"),
      "image/jpeg",
    );
  });
});

describe("avatar provider resolution", () => {
  it("resolves FASHN when photo and key are set; empty without photo", () => {
    const prevFashn = process.env.FASHN_API_KEY;
    const prevMocks = process.env.TRYON_USE_MOCKS;
    delete process.env.TRYON_USE_MOCKS;
    process.env.FASHN_API_KEY = "fashn-test";
    resetTryonProvidersForTests();
    const {
      resolveAvatarProviderKeys,
      isAvatarCompareMode,
    } = require("./providers/resolve-avatar-providers");
    assert.deepEqual(resolveAvatarProviderKeys(true), ["fashn"]);
    assert.equal(isAvatarCompareMode(true), false);
    assert.deepEqual(resolveAvatarProviderKeys(false), []);
    process.env.FASHN_API_KEY = prevFashn;
    process.env.TRYON_USE_MOCKS = prevMocks;
    resetTryonProvidersForTests();
  });

  it("mocks require photo for avatar", () => {
    process.env.TRYON_USE_MOCKS = "1";
    const {
      resolveAvatarProviderKeys,
      isAvatarCompareMode,
    } = require("./providers/resolve-avatar-providers");
    assert.deepEqual(resolveAvatarProviderKeys(true), ["fashn"]);
    assert.deepEqual(resolveAvatarProviderKeys(false), []);
    assert.equal(isAvatarCompareMode(true), false);
  });
});

describe("tryon providers", () => {
  it("mock dress returns canned image", async () => {
    const provider = new MockTryOnProvider();
    const result = await provider.dress({
      avatarUrl: "https://example.com/av.jpg",
      garmentImageUrl: "https://example.com/shirt.jpg",
      garmentType: "top",
    });
    assert.match(result.imageUrl, /tryon-mock\.local/);
  });

  it("outfit chain order is dress → top → bottom → outerwear → shoes", () => {
    const ordered = sortRefsForOutfitChain([
      { ref: "s", garment: "sneakers" },
      { ref: "t", garment: "tee shirt" },
      { ref: "p", garment: "jeans" },
      { ref: "j", garment: "blazer" },
    ]);
    assert.deepEqual(
      ordered.map((o) => o.type),
      ["top", "bottom", "outerwear", "shoes"],
    );
  });

  it("dress shirt maps to top, not one-piece dress", () => {
    assert.equal(garmentTypeFromSlot("dress shirt"), "top");
    assert.equal(garmentTypeFromSlot("shirt dress"), "dress");
    assert.equal(garmentTypeFromSlot("chinos"), "bottom");
    assert.equal(garmentTypeFromSlot("knitwear"), "top");
    assert.equal(garmentTypeFromSlot("suit"), "outerwear");
    assert.equal(isAccessoryGarment("tie"), true);
  });

  it("keeps separates when ambiguous dress is in the look", () => {
    const ordered = sortRefsForOutfitChain([
      { ref: "d", garment: "dress" },
      { ref: "t", garment: "dress shirt" },
      { ref: "p", garment: "chinos" },
    ]);
    assert.deepEqual(
      ordered.map((o) => o.ref),
      ["t", "p"],
    );
  });

  it("includes suit + dress shirt + tie for full-look collage", () => {
    const ordered = sortRefsForOutfitChain([
      { ref: "suit_2", garment: "suit", title: "Beo Blazer – Black" },
      { ref: "dress_shirt_3", garment: "dress shirt", title: "Black Lightweight Dress Shirt" },
      { ref: "tie_1", garment: "tie", title: "CRAVATE EN SOIE TRICOTÉE – NOIRE" },
    ]);
    assert.deepEqual(
      ordered.map((o) => o.ref),
      ["dress_shirt_3", "suit_2", "tie_1"],
    );
    assert.equal(ordered.find((o) => o.ref === "tie_1")?.accessory, true);
    assert.equal(ordered.find((o) => o.ref === "suit_2")?.type, "outerwear");
  });
});

describe("fashn avatar prompt", () => {
  it("steers silhouette only — no skin/hair from attrs", () => {
    const prompt = buildFashnAvatarPrompt({
      height_band: "180_190",
      build: "athletic",
      muscularity: "high",
    });
    assert.match(prompt ?? "", /athletic build/);
    assert.match(prompt ?? "", /defined musculature/);
    assert.match(prompt ?? "", /tall stature/);
    assert.doesNotMatch(prompt ?? "", /skin|hair/i);
    assert.match(prompt ?? "", /neutral standing pose/);
  });
});

describe("dress prompt", () => {
  it("fidelity prompt includes product facts FASHN can use", () => {
    const product = buildTryonProductContext({
      candidate: {
        id: "gid://shopify/Product/1",
        upid: "u1",
        matched_by: [0],
        matched_by_color_variant: false,
        title: "Navy Merino Crew",
        variant_options: [{ name: "Color", value: "Navy" }],
        price: { amount: 8900, currency: "USD" },
        image_urls: ["https://example.com/shirt.jpg"],
        media_urls: ["https://example.com/shirt.jpg"],
        raw: {
          metadata: {
            attributes: [
              { name: "Material", value: "Merino wool" },
              { name: "Fit", value: "Regular" },
              { name: "Neckline", value: "Crew" },
            ],
          },
        },
        size_status: "confirmed",
        size_selection: {
          merchant_label: "M",
          option_name: "Size",
        },
        color_selection: {
          merchant_label: "Navy",
          option_name: "Color",
        },
        normalized: {
          colors: { buckets: ["navy"], status: "resolved" },
          sizes: [
            {
              raw: "M",
              size: { alpha: "M", fit_modifier: "regular" },
              status: "resolved",
            },
          ],
        },
        detail: {
          id: "gid://shopify/Product/1",
          title: "Navy Merino Crew",
          brand: "Theory",
          description: { text: "Fine-gauge merino crew neck sweater." },
          options: [
            {
              name: "Size",
              values: [{ label: "M", available: true }],
            },
          ],
        },
      } as import("@/lib/fashion-memory/hydration/types").HydratedCandidate,
      garmentType: "top",
      garmentImageUrl: "https://example.com/shirt.jpg",
      pick: {
        stylist_line: "Clean desk-to-dinner layer — tuck lightly.",
        catalogAttributes: [{ name: "Sleeve", value: "Long" }],
      },
      occasionContext: "smart casual office",
    });
    assert.equal(product.prompt_version, "v3");
    assert.ok(product.material_notes.some((n) => /Merino/i.test(n)));
    assert.ok(product.fit_notes.some((n) => /Fit/i.test(n)));
    assert.deepEqual(product.normalized_colors, ["navy"]);
    assert.equal(product.selected_color, "Navy");
    assert.equal(product.selected_size, "M");
    assert.equal(product.occasion_context, "smart casual office");

    const prompt = buildTryonDressPromptCompact(product);
    assert.match(prompt, /Navy Merino Crew/);
    assert.match(prompt, /Theory/);
    assert.match(prompt, /Merino/);
    assert.match(prompt, /Preserve exact color/);
    assert.match(prompt, /upper body/);
    assert.doesNotMatch(prompt, /face|pose|background/i);
  });

  it("outfit chain cue keeps prior layers", () => {
    const product = buildTryonProductContext({
      candidate: {
        id: "gid://shopify/Product/2",
        upid: "u2",
        matched_by: [0],
        matched_by_color_variant: false,
        title: "Wool Overcoat",
        variant_options: [],
        image_urls: ["https://example.com/coat.jpg"],
        media_urls: ["https://example.com/coat.jpg"],
        raw: {},
        size_status: "confirmed",
      } as import("@/lib/fashion-memory/hydration/types").HydratedCandidate,
      garmentType: "outerwear",
      garmentImageUrl: "https://example.com/coat.jpg",
    });
    const prompt = buildTryonDressPromptCompact(product, {
      stepIndex: 1,
      stepTotal: 2,
      priorGarmentTitles: ["Navy Merino Crew"],
    });
    assert.match(prompt, /CRITICAL multi-garment try-on step 2 of 2/);
    assert.match(prompt, /Navy Merino Crew/);
    assert.match(prompt, /Do NOT remove/);
  });

  it("outfit collage prompt asks for every garment", () => {
    const prompt = buildOutfitCollagePrompt({
      titles: ["Navy Merino Crew", "Chino", "Oxford"],
      types: ["top", "bottom", "shoes"],
    });
    assert.match(prompt, /COMPLETE outfit/i);
    assert.match(prompt, /Navy Merino Crew/);
    assert.match(prompt, /EVERY garment/i);
  });
});

describe("minor refusal", () => {
  it("refuses minor photo — nothing stored", async () => {
    setAvatarIntakeOverride(() => ({
      clear: {},
      missing: [],
      minor_refused: true,
      refusal_message: "Minor refused.",
    }));
    const { runAvatarIntake } = await import("./avatar/intake");
    const result = await runAvatarIntake({
      photoSignedUrl: "https://example.com/minor.jpg",
    });
    assert.equal(result.minor_refused, true);
    assert.match(result.refusal_message ?? "", /Minor/);
  });
});

describe("tryon cache", () => {
  it("second identical tap uses cache — zero provider calls", async () => {
    const { createGeneration, updateGeneration } = await import("./generations");
    const gen = await createGeneration({
      personId: PERSON,
      userId: USER,
      kind: "single",
      provider: "mock",
      inputRefs: {},
      productRef: "ref1",
      avatarVersion: "av_v1",
    });
    await updateGeneration(gen.id, {
      status: "completed",
      outputUrl: "https://cached.local/1.jpg",
      costEstimate: 0,
    });
    const cached = await findCachedSingleTryon({
      avatarVersion: "av_v1",
      productRef: "ref1",
    });
    assert.ok(cached?.outputUrl);
    clearMockDressCallLog();
    const cached2 = await findCachedSingleTryon({
      avatarVersion: "av_v1",
      productRef: "ref1",
    });
    assert.equal(cached2?.id, gen.id);
    assert.equal(getMockDressCallLog().length, 0);
  });

  it("avatar regen invalidates cache key via version", async () => {
    const old = await findCachedSingleTryon({
      avatarVersion: "av_old",
      productRef: "ref1",
    });
    assert.equal(old, null);
    const { createGeneration, updateGeneration } = await import("./generations");
    await updateGeneration(
      (
        await createGeneration({
          personId: PERSON,
          userId: USER,
          kind: "single",
          provider: "mock",
          inputRefs: {},
          productRef: "ref1",
          avatarVersion: "av_new",
        })
      ).id,
      { status: "completed", outputUrl: "https://new.local/x.jpg" },
    );
    const hit = await findCachedSingleTryon({
      avatarVersion: "av_new",
      productRef: "ref1",
    });
    assert.ok(hit);
    const miss = await findCachedSingleTryon({
      avatarVersion: "av_old",
      productRef: "ref1",
    });
    assert.equal(miss, null);
  });
});

describe("generation caps", () => {
  it("blocks 31st generation of the day", async () => {
    const { createGeneration } = await import("./generations");
    for (let i = 0; i < TRYON_USER_DAILY_CAP; i++) {
      await createGeneration({
        personId: PERSON,
        userId: USER,
        kind: "single",
        provider: "mock",
        inputRefs: {},
      });
    }
    const count = await countUserGenerationsToday(USER);
    assert.equal(count, TRYON_USER_DAILY_CAP);
    await assert.rejects(
      () => assertUserGenerationCap(USER),
      TryonCapError,
    );
  });

  it("global cap flips flag", () => {
    assert.equal(isGlobalTryonCapTripped(), false);
    tripGlobalTryonCap();
    assert.equal(isGlobalTryonCapTripped(), true);
  });
});

describe("render contract snapshots", () => {
  it("pick tryon fields include disclaimer", () => {
    const contract = toPickTryonContract(true, {
      imageUrl: "https://x.jpg",
      jobId: "job1",
    });
    assert.equal(contract.available, true);
    assert.equal(contract.image_url, "https://x.jpg");
    assert.equal(contract.disclaimer, TRYON_DISCLAIMER);
  });

  it("look chain shape includes legend fields", () => {
    const render: RenderContract = {
      contract_version: RENDER_CONTRACT_VERSION,
      narration: {
        opening: "Hi",
        degradation: { kind: "none", user_line: "" },
      },
      tiers: { picks: [], verified: [], unverified: [] },
      looks: [
        {
          name: "Office",
          item_refs: ["a", "b"],
          total: 200,
          tryon_look: {
            status: "processing",
            steps: [
              {
                ref: "a",
                title: "Shirt",
                price: { amount: 5000, currency: "USD" },
                status: "completed",
                image_url: "https://step.jpg",
              },
            ],
            disclaimer: TRYON_DISCLAIMER,
          },
        },
      ],
      meta: {
        mode: "outfit",
        thin_slots: [],
        fallback: false,
      },
      affordances: { can_recurate: false, exhausted: false },
    };
    assert.equal(render.looks?.[0].tryon_look?.disclaimer, TRYON_DISCLAIMER);
    assert.equal(render.looks?.[0].tryon_look?.steps[0].title, "Shirt");
  });
});

describe("outfit compare", () => {
  it("poll returns FASHN variant for outfit compare parent", async () => {
    const { createGeneration, updateGeneration } = await import("./generations");
    const { pollOutfitTryon } = await import("./run-outfit");

    const parent = await createGeneration({
      personId: PERSON,
      userId: USER,
      kind: "outfit",
      provider: "compare",
      inputRefs: {
        refs: ["top1", "bot1"],
        look_id: "Office",
        provider_keys: ["fashn"],
      },
      productRef: "top1|bot1",
      avatarVersion: "av_v1",
      lookId: "Office",
      skipCapCheck: true,
    });

    const fashnChild = await createGeneration({
      personId: PERSON,
      userId: USER,
      kind: "outfit",
      provider: "mock-fashn",
      inputRefs: { provider_key: "fashn" },
      productRef: "top1|bot1",
      avatarVersion: "av_v1",
      lookId: "Office",
      parentJobId: parent.id,
      skipCapCheck: true,
    });
    await updateGeneration(fashnChild.id, {
      status: "completed",
      outputUrl: "https://outfit-fashn.local/final.jpg",
      ms: 4200,
    });

    await updateGeneration(parent.id, { status: "processing" });

    const polled = await pollOutfitTryon({ jobId: parent.id, userId: USER });
    assert.equal(polled.compare, true);
    assert.equal(polled.variants?.length, 1);
    assert.equal(
      polled.variants?.find((v) => v.provider_key === "fashn")?.image_url,
      "https://outfit-fashn.local/final.jpg",
    );
    assert.equal(polled.final_image_url, "https://outfit-fashn.local/final.jpg");
  });

  it("findCachedOutfitCompareTryon returns completed compare jobs", async () => {
    const {
      createGeneration,
      updateGeneration,
      findCachedOutfitCompareTryon,
    } = await import("./generations");

    const parent = await createGeneration({
      personId: PERSON,
      userId: USER,
      kind: "outfit",
      provider: "compare",
      inputRefs: { provider_keys: ["fashn"] },
      productRef: "top1|bot1",
      avatarVersion: "av_v1",
      skipCapCheck: true,
    });
    await updateGeneration(parent.id, { status: "completed" });

    const child = await createGeneration({
      personId: PERSON,
      userId: USER,
      kind: "outfit",
      provider: "mock-fashn",
      inputRefs: { provider_key: "fashn" },
      productRef: "top1|bot1",
      avatarVersion: "av_v1",
      parentJobId: parent.id,
      skipCapCheck: true,
    });
    await updateGeneration(child.id, {
      status: "completed",
      outputUrl: "https://cached-outfit.local/final.jpg",
    });

    const cached = await findCachedOutfitCompareTryon({
      avatarVersion: "av_v1",
      cacheKey: "top1|bot1",
      userId: USER,
    });
    assert.ok(cached);
    assert.equal(cached.parent.id, parent.id);
    assert.equal(cached.children.length, 1);
  });

  it("single-provider outfit cache ignores compare parents", async () => {
    const {
      createGeneration,
      updateGeneration,
      findCachedOutfitTryon,
    } = await import("./generations");

    const compareParent = await createGeneration({
      personId: PERSON,
      userId: USER,
      kind: "outfit",
      provider: "compare",
      inputRefs: {},
      productRef: "top1|bot1",
      avatarVersion: "av_v1",
      skipCapCheck: true,
    });
    await updateGeneration(compareParent.id, {
      status: "completed",
      outputUrl: "https://compare.local/final.jpg",
    });

    const single = await createGeneration({
      personId: PERSON,
      userId: USER,
      kind: "outfit",
      provider: "mock-fashn",
      inputRefs: {},
      productRef: "top1|bot1",
      avatarVersion: "av_v1",
      skipCapCheck: true,
    });
    await updateGeneration(single.id, {
      status: "completed",
      outputUrl: "https://single.local/final.jpg",
    });

    const cached = await findCachedOutfitTryon({
      avatarVersion: "av_v1",
      cacheKey: "top1|bot1",
    });
    assert.equal(cached?.id, single.id);
  });
});

describe("outfit step failure", () => {
  it("delivers last-good step on failure", async () => {
    const mock = new MockTryOnProvider();
    mock.failOnRef = "fail-pants";
    setTryonProvidersForTests({ tryOn: mock });

    const chain = sortRefsForOutfitChain([
      { ref: "top1", garment: "shirt" },
      { ref: "bot1", garment: "jeans" },
    ]);
    assert.equal(chain.length, 2);

    let lastGood: string | undefined = "https://avatar.local/a.jpg";
    const progress = {
      steps: chain.map((c) => ({
        ref: c.ref,
        status: "pending" as const,
      })),
    };
    for (const step of chain) {
      try {
        const img =
          step.ref === "bot1"
            ? "https://garment/fail-pants.jpg"
            : "https://garment/ok.jpg";
        const result = await mock.dress({
          avatarUrl: lastGood!,
          garmentImageUrl: img,
          garmentType: step.type,
        });
        lastGood = result.imageUrl;
        const idx = progress.steps.findIndex((s) => s.ref === step.ref);
        if (idx >= 0) progress.steps[idx].status = "completed";
      } catch {
        const idx = progress.steps.findIndex((s) => s.ref === step.ref);
        if (idx >= 0) progress.steps[idx].status = "failed";
        break;
      }
    }
    assert.ok(lastGood);
    assert.equal(progress.steps[0].status, "completed");
    assert.equal(progress.steps[1].status, "failed");
  });
});

describe("deletion purges storage paths", () => {
  it("memory storage clears person paths", async () => {
    const { uploadPrivateObject, listPersonStoragePaths } = await import(
      "./storage"
    );
    await uploadPrivateObject({
      userId: USER,
      personId: PERSON,
      kind: "source-photo",
      filename: "x.jpg",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
    });
    const before = await listPersonStoragePaths(USER, PERSON);
    assert.equal(before.length, 1);
    const { deletePrivateObjects } = await import("./storage");
    await deletePrivateObjects(before);
    const after = await listPersonStoragePaths(USER, PERSON);
    assert.equal(after.length, 0);
  });
});
