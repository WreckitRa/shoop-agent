import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyLocalFashionOps } from "../local/apply-local-fashion-ops";
import {
  emptyGuestFashionMemorySnapshot,
  FashionLocalStore,
} from "../local/store";
import { buildPersonShortIdMap } from "./context-format";
import type { PersonRow } from "../types";

describe("applyLocalFashionOps shared rules", () => {
  it("normalizes Medium → M and reverse old_value Medium vs M", async () => {
    const store = new FashionLocalStore(emptyGuestFashionMemorySnapshot());
    const person = store.ensureSelfPerson("u1");
    const people: PersonRow[] = [person];
    const shortIds = buildPersonShortIdMap(people);
    const ref = Object.keys(shortIds)[0]!;

    const first = await applyLocalFashionOps({
      store,
      userId: "u1",
      personShortIds: shortIds,
      people,
      newMessageTexts: ["Medium"],
      ops: [
        {
          op: "fact_add",
          person_ref: ref,
          source: "stated",
          confidence: 0.9,
          evidence_quote: "Medium",
          fact_type: "size",
          garment_type: "tops",
          value: "Medium",
        },
      ],
    });
    assert.equal(first[0]?.accepted, true);
    const active = store.findActiveFashionFact({
      userId: "u1",
      personId: person.id,
      factType: "size",
      garmentType: "tops",
    });
    assert.deepEqual(active?.value, { system: "alpha", value: "M" });

    const reversed = await applyLocalFashionOps({
      store,
      userId: "u1",
      personShortIds: shortIds,
      people,
      newMessageTexts: ["actually I'm an L now"],
      ops: [
        {
          op: "fact_reverse",
          person_ref: ref,
          source: "stated",
          confidence: 0.9,
          evidence_quote: "actually I'm an L now",
          fact_type: "size",
          garment_type: "tops",
          old_value: "M",
          value: { system: "alpha", value: "L" },
        },
      ],
    });
    assert.equal(reversed[0]?.accepted, true);
    const next = store.findActiveFashionFact({
      userId: "u1",
      personId: person.id,
      factType: "size",
      garmentType: "tops",
    });
    assert.deepEqual(next?.value, { system: "alpha", value: "L" });
  });

  it("rejects duplicate new_person refs (same as supabase)", async () => {
    const store = new FashionLocalStore(emptyGuestFashionMemorySnapshot());
    store.ensureSelfPerson("u1");
    const people = store.snapshot.people.filter((p) => p.user_id === "u1");
    const results = await applyLocalFashionOps({
      store,
      userId: "u1",
      personShortIds: {},
      people,
      newMessageTexts: ["my nephew"],
      ops: [
        {
          op: "new_person",
          person_ref: "new:1",
          source: "stated",
          confidence: 0.9,
          evidence_quote: "my nephew",
          relation: "nephew",
          name: null,
        },
        {
          op: "new_person",
          person_ref: "new:1",
          source: "stated",
          confidence: 0.9,
          evidence_quote: "my nephew",
          relation: "nephew",
          name: null,
        },
      ],
    });
    assert.equal(results[0]?.accepted, true);
    assert.equal(results[1]?.accepted, false);
    assert.equal(results[1]?.reason, "duplicate_new_ref");
  });

  it("merges canonical mother onto existing mother slot and remaps new:1", async () => {
    const store = new FashionLocalStore(emptyGuestFashionMemorySnapshot());
    store.ensureSelfPerson("u1");
    const mother = store.createPerson({
      userId: "u1",
      relation: "mother",
      name: null,
    });
    const people = store.snapshot.people.filter((p) => p.user_id === "u1");
    const results = await applyLocalFashionOps({
      store,
      userId: "u1",
      personShortIds: {},
      people,
      newMessageTexts: ["gift for mama"],
      ops: [
        {
          op: "new_person",
          person_ref: "new:1",
          source: "stated",
          confidence: 0.9,
          evidence_quote: "gift for mama",
          relation: "mother",
          name: null,
        },
        {
          op: "fact_add",
          person_ref: "new:1",
          source: "stated",
          confidence: 0.9,
          evidence_quote: "gift for mama",
          fact_type: "size",
          garment_type: "tops",
          value: { system: "alpha", value: "M" },
        },
      ],
    });
    assert.equal(results[0]?.accepted, true);
    assert.equal(results[0]?.entity_id, mother.id);
    assert.equal(results[1]?.accepted, true);
    assert.equal(
      store.snapshot.people.filter((p) => p.relation === "mother").length,
      1,
    );
  });

  it("does not merge son Gabriel onto brother Gabriel via match_existing", async () => {
    const store = new FashionLocalStore(emptyGuestFashionMemorySnapshot());
    store.ensureSelfPerson("u1");
    const brother = store.createPerson({
      userId: "u1",
      relation: "brother",
      name: "Gabriel",
    });
    const people = store.snapshot.people.filter((p) => p.user_id === "u1");
    const shortIds = buildPersonShortIdMap(people);
    const brotherShort = Object.entries(shortIds).find(
      ([, id]) => id === brother.id,
    )![0];
    const results = await applyLocalFashionOps({
      store,
      userId: "u1",
      personShortIds: shortIds,
      people,
      newMessageTexts: ["my son Gabriel needs shoes"],
      ops: [
        {
          op: "new_person",
          person_ref: "new:1",
          source: "stated",
          confidence: 0.9,
          evidence_quote: "my son Gabriel needs shoes",
          relation: "son",
          name: "Gabriel",
          match_existing: {
            person_ref: brotherShort,
            confidence: 0.95,
            why: "same first name",
          },
        },
      ],
    });
    assert.equal(results[0]?.accepted, true);
    assert.notEqual(results[0]?.entity_id, brother.id);
    assert.ok(
      store.snapshot.people.some(
        (p) => p.relation === "son" && p.name === "Gabriel",
      ),
    );
  });

  it("writes no_go slug + {kind, value}", async () => {
    const store = new FashionLocalStore(emptyGuestFashionMemorySnapshot());
    const person = store.ensureSelfPerson("u1");
    const people: PersonRow[] = [person];
    const shortIds = buildPersonShortIdMap(people);
    const ref = Object.keys(shortIds)[0]!;
    const results = await applyLocalFashionOps({
      store,
      userId: "u1",
      personShortIds: shortIds,
      people,
      newMessageTexts: ["allergic to polyester"],
      ops: [
        {
          op: "fact_add",
          person_ref: ref,
          source: "stated",
          confidence: 0.9,
          evidence_quote: "allergic to polyester",
          fact_type: "no_go",
          value: { kind: "material", value: "polyester" },
        },
      ],
    });
    assert.equal(results[0]?.accepted, true);
    const fact = store.findActiveFashionFact({
      userId: "u1",
      personId: person.id,
      factType: "no_go",
      garmentType: "nogo-material-polyester",
    });
    assert.deepEqual(fact?.value, { kind: "material", value: "polyester" });
  });

  it("noops a fact_add whose value already matches the active row", async () => {
    const store = new FashionLocalStore(emptyGuestFashionMemorySnapshot());
    const person = store.ensureSelfPerson("u1");
    const people: PersonRow[] = [person];
    const shortIds = buildPersonShortIdMap(people);
    const ref = Object.keys(shortIds)[0]!;
    const depthOp = {
      op: "fact_add" as const,
      person_ref: ref,
      source: "stated" as const,
      confidence: 0.9,
      evidence_quote: "always show me 5 options",
      fact_type: "depth_default" as const,
      value: { count: 5, unit: "options" },
    };
    const first = await applyLocalFashionOps({
      store,
      userId: "u1",
      personShortIds: shortIds,
      people,
      newMessageTexts: ["always show me 5 options"],
      ops: [depthOp],
    });
    assert.equal(first[0]?.accepted, true);
    const second = await applyLocalFashionOps({
      store,
      userId: "u1",
      personShortIds: shortIds,
      people,
      newMessageTexts: ["always show me 5 options"],
      ops: [{ ...depthOp, evidence_quote: "show me 5" }],
    });
    assert.equal(second[0]?.accepted, true);
    const rows = store.snapshot.fashion_facts.filter(
      (f) => f.fact_type === "depth_default",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, "active");
    assert.deepEqual(rows[0]?.value, { count: 5, unit: "options" });
  });

  it("coerces tap-backed signal_add to inferred candidate", async () => {
    const store = new FashionLocalStore(emptyGuestFashionMemorySnapshot());
    const person = store.ensureSelfPerson("u1");
    const people: PersonRow[] = [person];
    const shortIds = buildPersonShortIdMap(people);
    const ref = Object.keys(shortIds)[0]!;
    const results = await applyLocalFashionOps({
      store,
      userId: "u1",
      personShortIds: shortIds,
      people,
      newMessageTexts: ["[tap] You decide"],
      ops: [
        {
          op: "signal_add",
          person_ref: ref,
          source: "stated",
          confidence: 0.9,
          evidence_quote: "You decide",
          signal_type: "shopping_style",
          signal_value: "quick",
          polarity: 1,
        },
      ],
    });
    assert.equal(results[0]?.accepted, true);
    const row = store.snapshot.style_signals[0]!;
    assert.equal(row.source, "inferred");
    assert.equal(row.status, "candidate");
    assert.equal(row.value, "quick");
  });

  it("supersedes opposite-polarity same canonical on signal_add", async () => {
    const store = new FashionLocalStore(emptyGuestFashionMemorySnapshot());
    const person = store.ensureSelfPerson("u1");
    store.upsertStyleSignal({
      userId: "u1",
      personId: person.id,
      signalType: "color",
      value: "navy",
      polarity: 1,
      source: "stated",
      status: "active",
    });
    const people: PersonRow[] = [person];
    const shortIds = buildPersonShortIdMap(people);
    const ref = Object.keys(shortIds)[0]!;
    const results = await applyLocalFashionOps({
      store,
      userId: "u1",
      personShortIds: shortIds,
      people,
      newMessageTexts: ["I'm done with navy"],
      ops: [
        {
          op: "signal_add",
          person_ref: ref,
          source: "stated",
          confidence: 0.9,
          evidence_quote: "I'm done with navy",
          signal_type: "color",
          signal_value: "navy",
          polarity: -1,
          context: "general preference shift",
        },
      ],
    });
    assert.equal(results[0]?.accepted, true);
    const rows = store.snapshot.style_signals.filter(
      (s) => s.signal_type === "color",
    );
    const plus = rows.find((s) => s.polarity === 1);
    const minus = rows.find((s) => s.polarity === -1);
    assert.equal(plus?.status, "superseded");
    assert.equal(minus?.status, "active");
    assert.equal(minus?.context, "general");
  });
});
