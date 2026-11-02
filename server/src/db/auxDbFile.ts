import path from 'node:path';

/**
 * File for the auxiliary account/deck/match/tournament/trade tables. Production keeps the
 * historical cwd-relative location. Under vitest these modules use a private in-memory DB:
 * they open at import time, so a file path would either be the real database or would lock
 * the per-worker test DB before vitest.setup can reset it.
 */
export function resolveAuxDbFile(): string {
  if (process.env.VITEST) return ':memory:';
  return path.join(process.cwd(), 'server', 'data', 'mtgedh.sqlite');
}