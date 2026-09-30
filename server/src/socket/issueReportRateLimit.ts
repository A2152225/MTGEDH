/**
 * Per-player sliding-window rate limit for issue reports (default 10 per minute).
 * In-memory only; a server restart resets it, which is fine for abuse protection.
 */
export const ISSUE_REPORT_RATE_LIMIT_MAX = 10;
export const ISSUE_REPORT_RATE_LIMIT_WINDOW_MS = 60_000;

const hitsByKey = new Map<string, number[]>();

export type IssueRateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

export function checkIssueReportRateLimit(
  key: string,
  now: number = Date.now(),
  max: number = ISSUE_REPORT_RATE_LIMIT_MAX,
  windowMs: number = ISSUE_REPORT_RATE_LIMIT_WINDOW_MS,
): IssueRateLimitResult {
  const recent = (hitsByKey.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hitsByKey.set(key, recent);
    return { allowed: false, retryAfterMs: Math.max(1, windowMs - (now - recent[0]!)) };
  }
  recent.push(now);
  hitsByKey.set(key, recent);
  // Opportunistic cleanup so the map cannot grow without bound.
  if (hitsByKey.size > 5000) {
    for (const [k, v] of hitsByKey) {
      if (!v.some((t) => now - t < windowMs)) hitsByKey.delete(k);
    }
  }
  return { allowed: true };
}

export function resetIssueReportRateLimitForTests(): void {
  hitsByKey.clear();
}