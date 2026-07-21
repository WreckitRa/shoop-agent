import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FittingRoomItem } from "@/lib/tryon/fitting-room-types";
import { MAX_FITTING_ROOM_ITEMS } from "@/lib/tryon/fitting-room-types";
import { useTryOnDrawerStore } from "./tryon-drawer-store";

function resetStore() {
  useTryOnDrawerStore.setState({
    open: false,
    itemsById: {},
    rackIds: [],
    activeIds: [],
    avatarUrl: "https://avatar.local/me.jpg",
    status: "idle",
    jobId: null,
    resultUrl: null,
    error: null,
    compare: false,
    variants: [],
    lookSteps: [],
    partialNote: null,
    renderGeneration: 0,
    previewLookId: null,
    previewLookTitle: null,
  });
}

function sampleItem(
  id: string,
  supported = true,
  garment = "shirt",
): FittingRoomItem {
  return {
    id,
    title: `Item ${id}`,
    garment,
    imageUrl: "https://img.local/x.jpg",
    provenance: {
      kind: "product",
      productId: id,
    },
    tryonSupported: supported,
  };
}

beforeEach(() => {
  resetStore();
});

describe("fitting room store", () => {
  it("adds up to six rack items and rejects extras", () => {
    const store = useTryOnDrawerStore.getState();
    for (let i = 0; i < MAX_FITTING_ROOM_ITEMS; i++) {
      assert.equal(store.addToFittingRoom(sampleItem(`item-${i}`)), "added");
    }
    assert.equal(
      useTryOnDrawerStore.getState().addToFittingRoom(sampleItem("item-6")),
      "full",
    );
    assert.equal(useTryOnDrawerStore.getState().rackIds.length, 6);
  });

  it("dedupes rack adds", () => {
    const item = sampleItem("dup");
    assert.equal(useTryOnDrawerStore.getState().addToFittingRoom(item), "added");
    assert.equal(useTryOnDrawerStore.getState().addToFittingRoom(item), "duplicate");
  });

  it("keeps active items when removing from rack only", () => {
    const item = sampleItem("keep-active");
    const store = useTryOnDrawerStore.getState();
    store.addToFittingRoom(item);
    store.tryOnItem(item.id);
    store.removeFromRack(item.id);

    const next = useTryOnDrawerStore.getState();
    assert.equal(next.rackIds.includes(item.id), false);
    assert.equal(next.activeIds.includes(item.id), true);
    assert.ok(next.itemsById[item.id]);
  });

  it("clears avatar result when last active item is removed", () => {
    const item = sampleItem("solo");
    const store = useTryOnDrawerStore.getState();
    store.addToFittingRoom(item);
    store.tryOnItem(item.id);
    useTryOnDrawerStore.setState({
      resultUrl: "https://tryon.local/out.jpg",
      status: "completed",
    });

    store.removeFromAvatar(item.id);
    const next = useTryOnDrawerStore.getState();
    assert.equal(next.activeIds.length, 0);
    assert.equal(next.resultUrl, null);
    assert.equal(next.status, "idle");
  });

  it("blocks more than six active garments", () => {
    const store = useTryOnDrawerStore.getState();
    const garments = ["shirt", "jeans", "sneakers", "blazer", "dress", "belt"];
    for (let i = 0; i < 6; i++) {
      const item = sampleItem(`active-${i}`, true, garments[i]!);
      store.addToFittingRoom(item);
      store.tryOnItem(item.id);
    }
    const seventh = sampleItem("active-6", true, "watch");
    useTryOnDrawerStore.setState({
      itemsById: {
        ...useTryOnDrawerStore.getState().itemsById,
        [seventh.id]: seventh,
      },
    });
    store.tryOnItem(seventh.id);
    assert.match(
      useTryOnDrawerStore.getState().error ?? "",
      /six pieces/i,
    );
    assert.equal(useTryOnDrawerStore.getState().activeIds.length, 6);
  });

  it("blocks a second bottom until replaced", () => {
    const store = useTryOnDrawerStore.getState();
    const jeans = sampleItem("jeans-1", true, "jeans");
    const chinos = sampleItem("chinos-1", true, "chinos");
    store.addToFittingRoom(jeans);
    store.addToFittingRoom(chinos);
    store.tryOnItem(jeans.id);
    store.tryOnItem(chinos.id);

    const blocked = useTryOnDrawerStore.getState();
    assert.match(blocked.error ?? "", /bottoms on your avatar/i);
    assert.deepEqual(blocked.activeIds, [jeans.id]);

    store.tryOnItem(chinos.id, { replaceSameType: true });
    const replaced = useTryOnDrawerStore.getState();
    assert.equal(replaced.error, null);
    assert.deepEqual(replaced.activeIds, [chinos.id]);
  });
});
