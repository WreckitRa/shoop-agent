import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFittingRoomItemId,
  fittingRoomLookId,
  MAX_FITTING_ROOM_ITEMS,
} from "./fitting-room-types";
import {
  findActiveSlotConflict,
  slotGuardMessage,
} from "./fitting-room-slot-guard";
import type { FittingRoomItem } from "./fitting-room-types";

describe("fitting room ids", () => {
  it("builds stable search-backed ids", () => {
    const id = buildFittingRoomItemId({
      kind: "search",
      searchId: "msg-1",
      ref: "pick-a",
    });
    assert.equal(id, "search:msg-1:pick-a");
  });

  it("builds stable product-backed ids", () => {
    const id = buildFittingRoomItemId({
      kind: "product",
      productId: "prod-1",
      variantId: "var-1",
      preferredOptions: [{ name: "Size", label: "M" }],
    });
    assert.equal(id, "product:prod-1:var-1:Size=M");
  });

  it("sorts active ids for look cache keys", () => {
    assert.equal(
      fittingRoomLookId(["b", "a", "c"]),
      "fitting-room:a|b|c",
    );
  });

  it("caps rack at six items", () => {
    assert.equal(MAX_FITTING_ROOM_ITEMS, 6);
  });
});

describe("fitting room slot guard", () => {
  const jeans: FittingRoomItem = {
    id: "jeans",
    title: "Blue jeans",
    garment: "jeans",
    provenance: { kind: "product", productId: "p1" },
    tryonSupported: true,
  };
  const chinos: FittingRoomItem = {
    id: "chinos",
    title: "Tan chinos",
    garment: "chinos",
    provenance: { kind: "product", productId: "p2" },
    tryonSupported: true,
  };
  const tee: FittingRoomItem = {
    id: "tee",
    title: "White tee",
    garment: "t-shirt",
    provenance: { kind: "product", productId: "p3" },
    tryonSupported: true,
  };

  it("detects duplicate bottom slots", () => {
    const conflict = findActiveSlotConflict([jeans], chinos);
    assert.ok(conflict);
    assert.equal(conflict?.type, "bottom");
    assert.match(slotGuardMessage(conflict!), /bottoms on your avatar/i);
  });

  it("allows top plus bottom", () => {
    assert.equal(findActiveSlotConflict([jeans], tee), null);
    assert.equal(findActiveSlotConflict([tee], chinos), null);
  });
});
