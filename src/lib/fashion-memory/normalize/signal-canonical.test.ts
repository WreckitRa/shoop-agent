import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalBrandCase,
  canonicalizeSignalValue,
  canonicalizeSignalValueSync,
} from "./signal-canonical";

describe("canonicalizeSignalValueSync", () => {
  it("keeps exact color buckets", () => {
    assert.equal(canonicalizeSignalValueSync("color", "Navy"), "navy");
  });

  it("does not invent navy from dark blue", () => {
    assert.equal(canonicalizeSignalValueSync("color", "dark blue"), "dark blue");
  });

  it("title-cases brands and keeps short all-caps", () => {
    assert.equal(canonicalBrandCase("nike"), "Nike");
    assert.equal(canonicalBrandCase("COS"), "COS");
  });

  it("maps style spellings onto the logos vocab entry", () => {
    assert.equal(canonicalizeSignalValueSync("style", "big logos"), "logos");
    assert.equal(canonicalizeSignalValueSync("style", "logo-heavy"), "logos");
  });

  it("hits aesthetic vocab exactly", () => {
    assert.equal(
      canonicalizeSignalValueSync("aesthetic", "quiet luxury"),
      "quiet luxury",
    );
  });
});

describe("canonicalizeSignalValue", () => {
  it("maps dark blue to navy via the classifier", async () => {
    const got = await canonicalizeSignalValue("color", "dark blue", {
      classifyInto: async (_vocab, raw) => {
        assert.match(raw, /dark blue/i);
        return "navy";
      },
    });
    assert.equal(got, "navy");
  });

  it("maps understated to quiet luxury via the classifier", async () => {
    const got = await canonicalizeSignalValue("aesthetic", "understated", {
      classifyInto: async () => "quiet luxury",
    });
    assert.equal(got, "quiet luxury");
  });

  it("keeps unknown style tokens when the classifier abstains", async () => {
    const got = await canonicalizeSignalValue("style", "loafers", {
      classifyInto: async () => null,
    });
    assert.equal(got, "loafers");
  });
});

describe("local upsert keys on canonical", () => {
  it("merges dark blue onto navy when valueCanonical is navy", async () => {
    const { emptyGuestFashionMemorySnapshot, FashionLocalStore } =
      await import("../local/store");
    const store = new FashionLocalStore(emptyGuestFashionMemorySnapshot());
    const self = store.ensureSelfPerson("u1");
    store.upsertStyleSignal({
      userId: "u1",
      personId: self.id,
      signalType: "color",
      value: "navy",
      polarity: 1,
      source: "stated",
      status: "active",
    });
    const bumped = store.upsertStyleSignal({
      userId: "u1",
      personId: self.id,
      signalType: "color",
      value: "dark blue",
      valueCanonical: "navy",
      polarity: 1,
      source: "stated",
      status: "active",
    });
    const active = store.snapshot.style_signals.filter(
      (s) => s.status === "active" || s.status === "candidate",
    );
    assert.equal(active.length, 1);
    assert.equal(active[0]!.value, "navy");
    assert.equal(active[0]!.value_canonical, "navy");
    assert.equal(bumped.evidence_count, 2);
  });
});
