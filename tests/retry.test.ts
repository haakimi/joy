import assert from "node:assert/strict";
import test from "node:test";

import { withRetry, isDefaultRetryable } from "../src/providers/retry.ts";

test("retries a retryable error (429) and succeeds on a later attempt", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 3) {
      const e: any = new Error("rate limited");
      e.status = 429;
      throw e;
    }
    return "done";
  };

  const result = await withRetry(fn, { retries: 5, baseDelayMs: 1, maxDelayMs: 2 });
  assert.equal(result, "done");
  assert.equal(calls, 3);
});

test("retries 5xx server errors", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 2) {
      const e: any = new Error("bad gateway");
      e.status = 502;
      throw e;
    }
    return "ok";
  };

  const result = await withRetry(fn, { retries: 3, baseDelayMs: 1, maxDelayMs: 2 });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("does NOT retry non-retryable 4xx (400) — throws immediately", async () => {
  let calls = 0;
  const wrapped = async () => {
    calls++;
    if (calls === 1) {
      const e: any = new Error("bad request");
      e.status = 400;
      throw e;
    }
    return "ok";
  };

  await assert.rejects(() => withRetry(wrapped, { retries: 4, baseDelayMs: 1, maxDelayMs: 2 }), /bad request/);
  assert.equal(calls, 1);
});

test("throws the last error after exhausting retries", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    const e: any = new Error("rate limited");
    e.status = 429;
    throw e;
  };

  await assert.rejects(
    () => withRetry(fn, { retries: 2, baseDelayMs: 1, maxDelayMs: 2 }),
    /rate limited/,
  );
  // 1 initial + 2 retries
  assert.equal(calls, 3);
});

test("does not call the function when signal is already aborted", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    return "ok";
  };
  const ac = new AbortController();
  ac.abort();

  await assert.rejects(() => withRetry(fn, { signal: ac.signal }), /Aborted/);
  assert.equal(calls, 0);
});

test("retries on per-attempt timeout", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 2) {
      // Sleep longer than the timeout to trigger RetryTimeoutError.
      await new Promise((r) => setTimeout(r, 50));
      return "slow";
    }
    return "fast";
  };

  const result = await withRetry(fn, {
    retries: 3,
    timeoutMs: 10,
    baseDelayMs: 1,
    maxDelayMs: 2,
  });
  assert.equal(result, "fast");
  assert.equal(calls, 2);
});

test("isDefaultRetryable classifies common cases", () => {
  const rate: any = new Error("rate"); rate.status = 429;
  const server: any = new Error("oops"); server.status = 500;
  const client: any = new Error("bad"); client.status = 400;
  const net: any = new Error("reset"); net.code = "ECONNRESET";
  const fetch: any = new Error("fetch failed");
  const benign: any = new Error("all good");

  assert.equal(isDefaultRetryable(rate), true);
  assert.equal(isDefaultRetryable(server), true);
  assert.equal(isDefaultRetryable(net), true);
  assert.equal(isDefaultRetryable(fetch), true);
  assert.equal(isDefaultRetryable(client), false);
  assert.equal(isDefaultRetryable(benign), false);
  assert.equal(isDefaultRetryable(null), false);
});
