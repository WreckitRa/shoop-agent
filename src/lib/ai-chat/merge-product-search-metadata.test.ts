import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeProductSearchMetadata } from "./merge-product-search-metadata";
import type { MessageProductSearchV1 } from "./types";

const heuristicSearch: MessageProductSearchV1["searches"][number] = {
  query: "black tee",
  searchKey: "toolu_123",
  products: [],
  curatedPicks: [
    {
      id: "gid://shopify/p/1",
      title: "Tee",
      slot: "shoop_pick",
      reason: "Top-ranked match for your query — personalizing picks…",
      verdict: "buy",
      insight: {
        pickStory: "",
        fitReasons: ["Fit one", "Fit two", "Fit three"],
        checkedItems: [],
        changeMindItems: [],
        retailerCheckNote: "",
      },
    },
  ],
  curationPending: true,
};

const modelSearch: MessageProductSearchV1["searches"][number] = {
  ...heuristicSearch,
  curatedPicks: [
    {
      ...heuristicSearch.curatedPicks![0],
      reason: "Oversized streetwear cut in classic black with bold graphic.",
    },
  ],
  curationFallback: false,
  curationPending: false,
};

describe("mergeProductSearchMetadata", () => {
  it("keeps live-stream pending state when done metadata has no model curation yet", () => {
    const client: MessageProductSearchV1 = {
      version: 1,
      searches: [heuristicSearch],
    };
    const server: MessageProductSearchV1 = {
      version: 1,
      searches: [
        {
          ...heuristicSearch,
          curatedPicks: [],
          curationPending: undefined,
        },
      ],
    };

    const merged = mergeProductSearchMetadata(client, server);
    assert.equal(merged?.searches[0]?.curationPending, true);
    assert.equal(merged?.searches[0]?.curatedPicks?.length, 1);
  });

  it("prefers server model curation once it lands", () => {
    const client: MessageProductSearchV1 = {
      version: 1,
      searches: [heuristicSearch],
    };
    const server: MessageProductSearchV1 = {
      version: 1,
      searches: [modelSearch],
    };

    const merged = mergeProductSearchMetadata(client, server);
    assert.equal(merged?.searches[0]?.curationFallback, false);
    assert.match(
      merged?.searches[0]?.curatedPicks?.[0]?.reason ?? "",
      /Oversized streetwear/,
    );
  });
});
