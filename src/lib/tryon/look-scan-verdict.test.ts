import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lookScanDimRows,
  lookScanWeaknessChip,
  previewScanNotes,
  previewScanWhispers,
  resolveLookScanMode,
  scoreFromLookScanChecks,
  shortPieceName,
  weakestLookScanCheck,
} from "./look-scan-types";
import { coerceLookScanPayload } from "./look-scan-verdict";

describe("resolveLookScanMode", () => {
  it("treats zero or one piece as single_item", () => {
    assert.equal(resolveLookScanMode([]), "single_item");
    assert.equal(
      resolveLookScanMode([{ title: "Navy blazer" }]),
      "single_item",
    );
  });

  it("treats two+ pieces as outfit", () => {
    assert.equal(
      resolveLookScanMode([
        { title: "Blazer" },
        { title: "Trousers" },
      ]),
      "outfit",
    );
  });

  it("honors explicit look mode", () => {
    assert.equal(
      resolveLookScanMode([{ title: "A" }, { title: "B" }], "single_item"),
      "single_item",
    );
    assert.equal(
      resolveLookScanMode([{ title: "A" }], "outfit"),
      "outfit",
    );
  });
});

describe("coerceLookScanPayload", () => {
  it("accepts the canonical snake_case shape", () => {
    const out = coerceLookScanPayload({
      verdict_title: "Love-it territory",
      verdict_body: "The **black tee** lands clean.",
      annotations: ["a", "b", "c", "d"],
      whispers: ["w1", "w2", "w3", "w4"],
      checks: { fit: "pass", palette: "caution", nolist: "fail" },
    }) as Record<string, unknown>;

    assert.equal(out.verdict_title, "Love-it territory");
    assert.equal(out.verdict_body, "The **black tee** lands clean.");
    assert.deepEqual(out.annotations, ["a", "b", "c", "d"]);
    assert.deepEqual(out.checks, {
      fit: "pass",
      palette: "caution",
      nolist: "fail",
    });
  });

  it("recovers camelCase aliases and pads missing lists", () => {
    const out = coerceLookScanPayload({
      verdictTitle: "Keep it",
      verdictBody: "Shoulders sit right.",
      checks: { fit: "ok", palette: "warn", noList: "clear" },
    }) as Record<string, unknown>;

    assert.equal(out.verdict_title, "Keep it");
    assert.equal(out.verdict_body, "Shoulders sit right.");
    assert.equal((out.annotations as string[]).length, 4);
    assert.equal((out.whispers as string[]).length, 4);
    assert.deepEqual(out.checks, {
      fit: "pass",
      palette: "caution",
      nolist: "pass",
    });
  });

  it("unwraps nested verdict + title/body aliases", () => {
    const out = coerceLookScanPayload({
      verdict: {
        title: "Almost",
        body: "Hem wants **one size up**.",
        annotations: ["hem"],
      },
      checks: { fit: "caution", palette: "pass", nolist: "pass" },
    }) as Record<string, unknown>;

    assert.equal(out.verdict_title, "Almost");
    assert.equal(out.verdict_body, "Hem wants **one size up**.");
    assert.equal((out.annotations as string[])[0], "hem");
    assert.equal((out.annotations as string[]).length, 4);
  });

  it("unwraps parseLlmJsonObject wrapper if passed by mistake", () => {
    const out = coerceLookScanPayload({
      value: {
        verdict_title: "Yes",
        verdict_body: "Works.",
        checks: { fit: "pass", palette: "pass", nolist: "pass" },
      },
      salvaged: false,
    }) as Record<string, unknown>;

    assert.equal(out.verdict_title, "Yes");
    assert.equal(out.verdict_body, "Works.");
  });
});

describe("previewScanNotes", () => {
  it("streams process copy from piece titles, not a fake verdict", () => {
    const out = previewScanNotes([
      { title: "The Classic Oxford Shirt | White", priceLabel: "$49" },
      { title: "Taylor Suit Pants · Tan" },
    ]);
    assert.equal(out.likes[0]?.name, "The Classic Oxford Shirt");
    assert.match(out.likes[0]?.text ?? "", /checking/);
    assert.equal(out.likes.at(-1)?.name, "Together");
    assert.equal(out.gripes[0]?.name, "Taylor Suit Pants");
    assert.match(out.gripes[0]?.text ?? "", /palette/);
  });

  it("uses a price check when a label is present", () => {
    const out = previewScanNotes([
      { title: "Navy Shirt", priceLabel: "$20" },
    ]);
    assert.ok(out.gripes.some((n) => n.dim === "price" && n.text.includes("$20")));
  });
});

describe("previewScanWhispers", () => {
  it("names the first piece in the palette whisper", () => {
    const lines = previewScanWhispers([
      { title: "Fine Wale Corduroy Chore Blazer | Navy" },
    ]);
    assert.match(lines[1], /fine wale corduroy chore blazer/i);
    assert.equal(shortPieceName("A | B"), "A");
  });
});

describe("scoreFromLookScanChecks", () => {
  it("weights pass / caution / fail into a /10", () => {
    const score = scoreFromLookScanChecks({
      fit: "pass",
      palette: "fail",
      nolist: "pass",
    });
    assert.ok(score >= 6 && score <= 8);
  });

  it("flags colour-only weakness", () => {
    const checks = {
      fit: "pass" as const,
      palette: "fail" as const,
      nolist: "pass" as const,
    };
    assert.equal(weakestLookScanCheck(checks), "palette");
    assert.equal(
      lookScanWeaknessChip(checks),
      "COLOUR IS THE ONLY THING WRONG",
    );
  });

  it("builds three dim rows from the body", () => {
    const rows = lookScanDimRows({
      verdict_title: "Not this one.",
      verdict_body:
        "Shoulders sit right. Colour is too close to your skin. Clear of the no-list.",
      annotations: ["a", "b", "c", "d"],
      whispers: ["w1", "w2", "w3", "w4"],
      checks: { fit: "pass", palette: "fail", nolist: "pass" },
    });
    assert.equal(rows.length, 3);
    assert.equal(rows[0]?.label, "FIT");
    assert.equal(rows[1]?.tone, "fail");
    assert.match(rows[1]?.why ?? "", /Colour/i);
  });
});
