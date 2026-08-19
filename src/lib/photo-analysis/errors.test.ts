import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PHOTO_ERROR,
  classifyPhotoError,
  publicPhotoError,
  publicPhotoErrorFromHttp,
  retryWaitMs,
  stripProviderSecrets,
} from "./errors";

const RAW_429 =
  "Rate limit reached for gpt-5.4-pro in organization org-cXfzmPHBeSRUEQPXX96qB2X6 on tokens per min (TPM): Limit 50000, Used 26953, Requested 29463. Please try again in 7.699s. Visit https://platform.openai.com/account/rate-limits to learn more.";

describe("photo-analysis errors", () => {
  it("maps the OpenAI TPM dump to a short public line", () => {
    assert.equal(classifyPhotoError(RAW_429), "rate_limited");
    assert.equal(publicPhotoError(RAW_429), PHOTO_ERROR.rate_limited);
    assert.equal(
      publicPhotoErrorFromHttp(429, { error: { message: RAW_429 } }),
      PHOTO_ERROR.rate_limited,
    );
  });

  it("strips org ids and URLs", () => {
    const out = stripProviderSecrets(RAW_429);
    assert.equal(out.includes("org-"), false);
    assert.equal(out.includes("http"), false);
    assert.equal(out.toLowerCase().includes("tpm"), false);
  });

  it("reads retry-after from the TPM dump and the header", () => {
    const fromBody = retryWaitMs(
      new Response(null, { status: 429 }),
      { error: { message: RAW_429 } },
    );
    assert.equal(fromBody, Math.ceil(7.699 * 1000) + 750);

    const fromHeader = retryWaitMs(
      new Response(null, { status: 429, headers: { "retry-after": "12" } }),
      null,
    );
    assert.equal(fromHeader, 12_000 + 750);
  });

  it("keeps timeout and missing-key as stable copy", () => {
    assert.equal(
      publicPhotoError("GPT photo analysis timed out"),
      PHOTO_ERROR.timeout,
    );
    assert.equal(
      publicPhotoError("OPENAI_API_KEY is not set"),
      PHOTO_ERROR.missing_key,
    );
  });
});
