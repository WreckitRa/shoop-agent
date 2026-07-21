import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectRequestArea } from "./request-area";

describe("detectRequestArea", () => {
  it("uses Vercel coarse geo headers without reading an IP", () => {
    const headers = new Headers({
      "x-vercel-ip-country": "LB",
      "x-vercel-ip-city": "Beirut",
    });

    assert.deepEqual(detectRequestArea(headers, { VERCEL: "1" }), {
      countryCode: "LB",
      countryLabel: "Lebanon",
      cityLabel: "Beirut",
    });
  });

  it("ignores spoofable geo headers without a trusted proxy", () => {
    const headers = new Headers({
      "x-vercel-ip-country": "LB",
      "x-vercel-ip-city": "Beirut",
    });

    assert.equal(detectRequestArea(headers, {}), null);
  });

  it("accepts Cloudflare geo only when its request marker is present", () => {
    const headers = new Headers({
      "cf-ray": "example",
      "cf-ipcountry": "FR",
    });

    assert.deepEqual(detectRequestArea(headers, {}), {
      countryCode: "FR",
      countryLabel: "France",
      cityLabel: null,
    });
  });
});
