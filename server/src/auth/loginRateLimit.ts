/**
 * Loose in-memory login rate limit (per username + IP).
 * Process-local only; fine for a single-node v1.
 */
type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const buckets = new Map<string, Bucket>();

function keyFor(username: string, ip: string): string {
  return `${ip}|${username.toLowerCase()}`;
}

export function isLoginRateLimited(username: string, ip: string): boolean {
  const key = keyFor(username, ip);
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket) return false;
  if (now >= bucket.resetAt) {
    buckets.delete(key);
    return false;
  }
  return bucket.count >= MAX_FAILURES;
}

export function recordLoginFailure(username: string, ip: string): void {
  const key = keyFor(username, ip);
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  bucket.count += 1;
}

export function clearLoginFailures(username: string, ip: string): void {
  buckets.delete(keyFor(username, ip));
}

export function loginRateLimitRetrySeconds(): number {
  return Math.ceil(WINDOW_MS / 1000);
}
