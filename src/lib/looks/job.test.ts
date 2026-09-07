import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksPublicNote, looksTwinUserId, piecesForDress, swatchesToSeed } from "./job";
import { looksNeedResume } from "./store";
import { fashnNeedsInline } from "./fashn";
import type { StyleContract } from "@/lib/photo-analysis/style-contract";

const UUID = "6f953830-dae2-4fd7-9aca-66c8ecfd54a3";

function palette(partial: StyleContract["palette"]): Pick<StyleContract, "palette"> {
  return { palette: partial };
}

describe("looks job helpers", () => {
  it("maps guest-{uuid} onto the avatar owner uuid", () => {
    assert.equal(looksTwinUserId(`guest-${UUID}`), UUID);
    assert.equal(looksTwinUserId(UUID), UUID);
  });

  it("seeds core colours when near_face is empty", () => {
    const rows = swatchesToSeed(
      palette({
        near_face: [],
        core: [
          { family: "navy", shade: "ink navy", hex: "#131E30" },
          { family: "olive", shade: "deep olive", hex: "#494F38" },
        ],
        neutrals: [{ family: "grey", shade: "charcoal", hex: "#585A5E" }],
        accents: [],
        avoid_near_face: [],
      }),
    );
    assert.deepEqual(
      rows.map((r) => r.shade),
      ["ink navy", "deep olive", "charcoal"],
    );
    assert.ok(rows.every((r) => r.kind === "yes"));
  });

  it("prefers near_face over core", () => {
    const rows = swatchesToSeed(
      palette({
        near_face: [{ family: "navy", shade: "ink navy", hex: "#131E30" }],
        core: [{ family: "olive", shade: "deep olive", hex: "#494F38" }],
        neutrals: [],
        accents: [],
        avoid_near_face: [
          {
            family: "purple",
            shade: "lavender",
            hex: "#D8D2E8",
            why: "cool",
            fix: "below",
          },
        ],
      }),
    );
    assert.equal(rows[0]?.shade, "ink navy");
    assert.equal(rows[0]?.kind, "yes");
    assert.equal(rows[1]?.kind, "no");
  });

  it("hides JSON-RPC rate limits from the look card", () => {
    assert.equal(
      looksPublicNote(
        new Error(
          'JSON-RPC error: {"code":-32600,"message":"Invalid Request","data":"Rate limit exceeded"}',
        ),
      ),
      "Catalog is busy — tap Retry in a moment.",
    );
  });

  it("tells the user when FASHN is out of credits", () => {
    assert.equal(
      looksPublicNote(
        new Error(
          'FASHN run 429: {"error":"OutOfCredits","message":"You are out of credits. Please visit your account to purchase more."}',
        ),
      ),
      "Try-on credits ran out — add FASHN credits, then tap Retry.",
    );
  });

  it("hides dropped catalog connections from the look card", () => {
    const err = new Error("fetch failed");
    err.cause = new Error("read ECONNRESET");
    assert.equal(looksPublicNote(err), "Catalog is busy — tap Retry in a moment.");
  });

  it("resumes try-on when looks already have garments", () => {
    assert.equal(
      looksNeedResume([
        {
          status: "products_ready",
          pieces: [{ status: "picked", product: { id: "1" } }],
        },
        { status: "queued", pieces: [{ status: "pending" }] },
      ]),
      true,
    );
    assert.equal(
      looksNeedResume([
        {
          status: "queued",
          pieces: [{ status: "picked", garmentImageUrl: "https://x" }],
        },
      ]),
      true,
    );
    assert.equal(
      looksNeedResume([
        { status: "queued", pieces: [{ status: "pending" }] },
        { status: "queued", pieces: [{ status: "pending" }] },
      ]),
      false,
    );
  });

  it("inlines signed twin URLs for FASHN, not Shopify CDNs", () => {
    assert.equal(
      fashnNeedsInline("https://xyz.supabase.co/storage/v1/object/sign/avatars/a.jpg?token=abc"),
      true,
    );
    assert.equal(
      fashnNeedsInline("https://cdn.shopify.com/s/files/1/tee.jpg"),
      false,
    );
    assert.equal(fashnNeedsInline("https://cdn.fashn.ai/out.jpg"), false);
    assert.equal(fashnNeedsInline("data:image/jpeg;base64,xx"), false);
  });

  it("still dresses a top that FASHN previously marked dropped", () => {
    const pieces = piecesForDress([
      {
        slot: "top",
        garmentImageUrl: "https://cdn.shopify.com/tee.jpg",
        garmentPhotoType: "model",
        spec: {},
      },
      {
        slot: "bottom",
        garmentImageUrl: "https://cdn.shopify.com/pant.jpg",
        garmentPhotoType: "model",
        spec: {},
      },
    ]);
    assert.equal(pieces.some((p) => p.slot === "top"), true);
    assert.equal(pieces.length, 2);
  });
});
