import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRateLimitMcpError,
  isRetryableMcpNetworkError,
  isTransientMcpError,
  retryTransientMcp,
  withMcpRetry,
} from "./mcp-retry";

const RATE_LIMIT = new Error(
  'JSON-RPC error: {"code":-32600,"message":"Invalid Request","data":"Rate limit exceeded"}',
);
const SERVICE = new Error(
  'JSON-RPC error: {"code":-32000,"message":"Service error. Please try again later."}',
);

describe("mcp retry", () => {
  it("treats catalog rate-limit JSON-RPC as transient", () => {
    assert.equal(isRateLimitMcpError(RATE_LIMIT), true);
    assert.equal(isTransientMcpError(RATE_LIMIT), true);
    assert.equal(isTransientMcpError(SERVICE), true);
    assert.equal(
      isTransientMcpError(new Error('JSON-RPC error: {"code":-32602,"message":"Invalid params"}')),
      false,
    );
  });

  it("retries a rate-limit throw then succeeds", async () => {
    let n = 0;
    const out = await retryTransientMcp(
      async () => {
        n += 1;
        if (n < 2) throw RATE_LIMIT;
        return "ok";
      },
      { maxRetries: 2 },
    );
    assert.equal(out, "ok");
    assert.equal(n, 2);
  });

  it("treats dropped connections as transient", () => {
    const err = new Error("fetch failed");
    err.cause = new Error("read ECONNRESET");
    assert.equal(isRetryableMcpNetworkError(err), true);
    assert.equal(isTransientMcpError(err), true);
  });

  it("retries fetch failed then succeeds", async () => {
    let n = 0;
    const out = await withMcpRetry(async () => {
      n += 1;
      if (n < 2) {
        const err = new Error("fetch failed");
        err.cause = new Error("read ECONNRESET");
        throw err;
      }
      return new Response("ok", { status: 200 });
    });
    assert.equal(out.status, 200);
    assert.equal(n, 2);
  });
});
