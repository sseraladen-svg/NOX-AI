import "server-only";

// ───────────────────────────────────────────────────────────────────────────
// Simple in-memory rate limiter.
//
// Tracks requests per IP (or per user ID if provided) in a sliding window.
// When the limit is exceeded, returns true (rate-limited). Otherwise records
// the request and returns false.
//
// This is intentionally simple — no Redis, no persistence. On server restart,
// all counters reset. For a single-instance deployment this is sufficient.
// For multi-instance, swap this for a Redis-backed limiter.
// ───────────────────────────────────────────────────────────────────────────

interface RateBucket {
  count: number;
  windowStart: number;
}

// Map key → bucket. Key is typically `${ip}:${route}` or `${userId}:${route}`.
const buckets = new Map<string, RateBucket>();

// Clean up old buckets every 5 minutes to prevent memory growth.
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  // Remove any bucket whose window has expired (older than the max window size).
  const maxWindow = 60 * 60 * 1000; // 1 hour — max window we use
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > maxWindow) {
      buckets.delete(key);
    }
  }
}

/**
 * Check if a request should be rate-limited.
 *
 * @param key      Identifier for the caller — typically IP or userId
 * @param route    Route name (e.g. "auth/login", "dispatch")
 * @param limit    Max requests allowed in the window
 * @param windowMs Window size in milliseconds
 * @returns        true if the request should be blocked (limit exceeded),
 *                 false if the request is allowed (and the counter is incremented)
 */
export function isRateLimited(
  key: string,
  route: string,
  limit: number,
  windowMs: number
): boolean {
  cleanup();
  const bucketKey = `${key}:${route}`;
  const now = Date.now();
  const bucket = buckets.get(bucketKey);

  if (!bucket) {
    // First request in this window.
    buckets.set(bucketKey, { count: 1, windowStart: now });
    return false;
  }

  // If the window has expired, reset the bucket.
  if (now - bucket.windowStart >= windowMs) {
    buckets.set(bucketKey, { count: 1, windowStart: now });
    return false;
  }

  // Same window — increment and check.
  bucket.count += 1;
  return bucket.count > limit;
}

/**
 * Extract the client IP from a Next.js request.
 * Checks x-forwarded-for (set by the Caddy gateway) and falls back to
 * x-real-ip, then the connection remote address.
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list; the first is the client.
    return forwarded.split(",")[0].trim();
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

// ─── Preset rate limits ────────────────────────────────────────────────────

export const RATE_LIMITS = {
  // Auth: 10 attempts per minute per IP (prevents brute-force login).
  AUTH: { limit: 10, windowMs: 60_000 },
  // Dispatch: 30 requests per minute per IP (prevents API abuse).
  DISPATCH: { limit: 30, windowMs: 60_000 },
  // Signup: 3 per hour per IP (prevents account farming).
  SIGNUP: { limit: 3, windowMs: 60 * 60_000 },
  // Config save: 20 per minute per IP.
  CONFIG: { limit: 20, windowMs: 60_000 },
  // Test: 10 per minute per IP (test pings real APIs — prevent abuse).
  TEST: { limit: 10, windowMs: 60_000 },
  // General API: 60 per minute per IP.
  GENERAL: { limit: 60, windowMs: 60_000 },
} as const;
