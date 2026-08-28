import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyGuestFashionMemorySnapshot,
  FashionLocalStore,
} from "./local/store";
import { writePurchaseMemory } from "./purchase";
import { formatRecentPicksLine } from "./router/profile-context-format";

describe("writePurchaseMemory", () => {
  it("writes purchase event on the originating search recipient plus stated 0.9 attrs", async () => {
    const snap = emptyGuestFashionMemorySnapshot();
    const store = new FashionLocalStore(snap);
    const self = store.ensureSelfPerson("guest-1");
    const mother = store.createPerson({
      userId: "guest-1",
      relation: "mother",
      name: null,
    });
    store.logRequestEvent({
      userId: "guest-1",
      personId: mother.id,
      conversationId: "c1",
      attributes: {
        search_id: "buy-01",
        garment: "dress",
        color: "navy",
        occasion: "general",
      },
    });
    const event = await writePurchaseMemory({
      userId: "guest-1",
      searchId: "buy-01",
      ref: "dress-1",
      product: {
        id: "dress-1",
        title: "Navy dress",
        catalogAttributes: [
          { name: "color", value: "navy" },
          { name: "brand", value: "cos" },
          { name: "garment", value: "dress" },
        ],
      },
      guestSnapshot: snap,
    });
    assert.equal(event?.attributes.kind, "purchase");
    assert.equal(event?.person_id, mother.id);
    const navy = snap.style_signals.find(
      (s) => s.person_id === mother.id && s.signal_type === "color",
    );
    assert.equal(navy?.value, "navy");
    assert.equal(navy?.source, "stated");
    assert.equal(navy?.confidence, 0.9);
    assert.equal(navy?.status, "active");
    assert.equal(
      snap.style_signals.some((s) => s.person_id === self.id),
      false,
    );
    const picks = formatRecentPicksLine(snap.request_events);
    assert.ok(picks && /cos/i.test(picks) && /navy/i.test(picks));
    assert.ok(picks && /bought/i.test(picks));
  });

  it("is idempotent for the same search_id + ref", async () => {
    const snap = emptyGuestFashionMemorySnapshot();
    const store = new FashionLocalStore(snap);
    const self = store.ensureSelfPerson("guest-1");
    store.logRequestEvent({
      userId: "guest-1",
      personId: self.id,
      conversationId: "c1",
      attributes: { search_id: "buy-dup", garment: "shirt" },
    });
    const product = {
      id: "shirt-1",
      title: "Navy Percival shirt",
      catalogAttributes: [
        { name: "color", value: "navy" },
        { name: "brand", value: "percival" },
        { name: "garment", value: "shirt" },
      ],
    };
    const first = await writePurchaseMemory({
      userId: "guest-1",
      searchId: "buy-dup",
      ref: "shirt-1",
      product,
      guestSnapshot: snap,
    });
    const second = await writePurchaseMemory({
      userId: "guest-1",
      searchId: "buy-dup",
      ref: "shirt-1",
      product,
      guestSnapshot: snap,
    });
    assert.equal(first?.id, second?.id);
    assert.equal(
      snap.request_events.filter((e) => e.attributes.kind === "purchase")
        .length,
      1,
    );
    const picks = formatRecentPicksLine(snap.request_events);
    assert.ok(picks && /percival/i.test(picks) && /navy/i.test(picks));
  });
});
