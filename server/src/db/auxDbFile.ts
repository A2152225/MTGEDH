import path from 'node:path';

/**
 * File for the auxiliary account/deck/match/tournament/trade tables. Production keeps the
 * historical cwd-relative location. Under vitest these modules use a private in-memory DB:
 * they open at import time, so a file path would either be the real database or would lock
 * the per-worker test DB before vitest.setup can reset it.
 *
 * Prefer VITEST_WORKER_ID / VITEST_POOL_ID as well as VITEST — some runners set the worker
 * id before the boolean flag, and writing test decks into the live file DB is how "Guest
 * Public Deck" / "Private Acct Deck" spam used to accumulate.
 */
export function resolveAuxDbFile(): string {
  if (
    process.env.VITEST
    || process.env.VITEST_WORKER_ID
    || process.env.VITEST_POOL_ID
  ) {
    return ':memory:';
  }
  return path.join(process.cwd(), 'server', 'data', 'mtgedh.sqlite');
}