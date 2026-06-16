// Generic retry wrapper with exponential backoff, jitter, per-attempt timeout,
// and conservative retryable-error classification. Designed for model API
// calls (HTTP 429 / 5xx / network failures), where transient blips should not
// fail an entire agent turn.
const DEFAULTS = {
    retries: 3,
    baseDelayMs: 500,
    maxDelayMs: 8_000,
};
/**
 * Default retryable classifier. Retries on:
 *  - HTTP 429 (rate limit) and any 5xx
 *  - Network/connection errors (ENOTFOUND, ECONNRESET, ETIMEDOUT, EAI_AGAIN, fetch failed)
 *  - Timeout errors produced by this module (name === "RetryTimeoutError")
 *  - SDK/APIConnectionError / APIConnectionTimeoutError style names
 * Does NOT retry 4xx (except 429), aborts, or unknown non-network errors.
 */
export function isDefaultRetryable(err) {
    if (!err)
        return false;
    const e = err;
    if (e.name === "RetryTimeoutError")
        return true;
    const status = typeof e.status === "number" ? e.status : 0;
    if (status === 429 || (status >= 500 && status <= 599))
        return true;
    if (e.code && RETRYABLE_CODES.has(e.code))
        return true;
    if (e.name && RETRYABLE_NAME_SUBSTRINGS.some((s) => e.name.includes(s)))
        return true;
    const msg = typeof e.message === "string" ? e.message : "";
    if (RETRYABLE_MSG_SUBSTRINGS.some((s) => msg.includes(s)))
        return true;
    return false;
}
const RETRYABLE_CODES = new Set([
    "ENOTFOUND",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
]);
const RETRYABLE_NAME_SUBSTRINGS = [
    "APIConnectionError",
    "APIConnectionTimeoutError",
    "ConnectionError",
];
const RETRYABLE_MSG_SUBSTRINGS = [
    "fetch failed",
    "network",
    "socket hang up",
    "terminated",
    "timeout",
];
/** Marker error so the retry loop recognizes its own timeouts as retryable. */
class RetryTimeoutError extends Error {
    name = "RetryTimeoutError";
    constructor(timeoutMs) {
        super(`Operation timed out after ${timeoutMs}ms`);
    }
}
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error("Aborted"));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("Aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
function backoffDelay(attempt, baseDelayMs, maxDelayMs) {
    // Exponential backoff with full jitter: [0, base * 2^attempt), capped.
    const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    return Math.floor(Math.random() * ceiling);
}
function withTimeout(fn, timeoutMs) {
    if (!timeoutMs)
        return fn();
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new RetryTimeoutError(timeoutMs)), timeoutMs);
    });
    return Promise.race([fn(), timeout]).finally(() => {
        if (timer)
            clearTimeout(timer);
    });
}
export async function withRetry(fn, opts = {}) {
    const retries = opts.retries ?? DEFAULTS.retries;
    const baseDelayMs = opts.baseDelayMs ?? DEFAULTS.baseDelayMs;
    const maxDelayMs = opts.maxDelayMs ?? DEFAULTS.maxDelayMs;
    const timeoutMs = opts.timeoutMs;
    const signal = opts.signal;
    const isRetryable = opts.isRetryable ?? isDefaultRetryable;
    if (signal?.aborted) {
        throw new Error("Aborted");
    }
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (signal?.aborted)
            throw new Error("Aborted");
        try {
            return await withTimeout(fn, timeoutMs);
        }
        catch (err) {
            lastErr = err;
            // Aborts are never retried.
            if (err instanceof Error && err.message === "Aborted")
                throw err;
            const retryable = isRetryable(err);
            if (!retryable || attempt === retries)
                throw err;
        }
        // Wait before the next attempt. Delay is skipped on the final loop.
        if (attempt < retries) {
            try {
                await sleep(backoffDelay(attempt, baseDelayMs, maxDelayMs), signal);
            }
            catch (err) {
                // sleep rejects on abort — propagate immediately.
                throw err;
            }
        }
    }
    // Should be unreachable, but keeps the type checker happy.
    throw lastErr;
}
