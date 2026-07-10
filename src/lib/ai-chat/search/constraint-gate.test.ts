import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyConstraintGate,
  colorConstraintViolation,
  genderConstraintViolation,
} from "./constraint-gate";
import { ensureGenderPrefixInQuery } from "./query-hygiene";
import {
  blazerTraceBrief,
  blazerTraceViolators,
  validBlackMensBlazer,
  womensVerityBlazer,
} from "./fixtures/blazer-trace-fixture";
import type { PoolCandidate } from "./types";

const asCandidate = (product: { id: string; title: string }): PoolCandidate => ({
  product: product as PoolCandidate["product"],
  upid: product.id,
  sources: [{ queryId: "w2-17", rank: 0 }],
  bestRank: 0,
  corroboration: 1,
  fromDiscovery: false,
});

describe("constraint gate — blazer trace fixture", () => {
  it("drops women's blazer on men's scope (P0 #3/#4)", () => {
    const v = genderConstraintViolation(blazerTraceBrief, womensVerityBlazer.title!);
    assert.ok(v);
    assert.match(v!, /women/i);
  });

  it("drops navy/beige on black requirement (P0 #4)", () => {
    for (const p of blazerTraceViolators.slice(1)) {
      const v = colorConstraintViolation(blazerTraceBrief, p.title!.toLowerCase());
      assert.ok(v, `expected color violation for ${p.title}`);
    }
  });

  it("keeps valid black men's blazer", () => {
    const { passed, metrics } = applyConstraintGate(
      [asCandidate(validBlackMensBlazer)],
      blazerTraceBrief,
    );
    assert.equal(passed.length, 1);
    assert.equal(metrics.drops.length, 0);
  });

  it("filters all three trace violators from pool", () => {
    const pool = blazerTraceViolators.map(asCandidate);
    const { passed, metrics } = applyConstraintGate(pool, blazerTraceBrief);
    assert.equal(passed.length, 0);
    assert.equal(metrics.drops.length, 3);
    assert.ok((metrics.dropsByGate.gender ?? 0) >= 1);
    assert.ok((metrics.dropsByGate.color ?? 0) >= 2);
  });
});

describe("gender prefix on portfolio queries", () => {
  it("appends men's when wave query omits gender (P0 #3)", () => {
    const q = ensureGenderPrefixInQuery("unstructured lightweight blazer", blazerTraceBrief);
    assert.match(q, /^men's /i);
  });
});
