/**
 * Outcome sweep process environment. The CLI imports this module first so every engine module
 * it loads afterwards sees: an in-memory game DB, the card corpus opened read-only, no stall
 * reports and no Oracle IR telemetry append logs. Nothing on disk is written except the sweep
 * output directory.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SWEEP_SERVER_ROOT = path.resolve(here, '..', '..');
export const SWEEP_REPO_ROOT = path.resolve(SWEEP_SERVER_ROOT, '..');

export function applyOutcomeSweepEnv(): void {
  process.env.SQLITE_FILE = ':memory:';
  if (!process.env.CARD_LOOKUP_SQLITE_FILE) {
    process.env.CARD_LOOKUP_SQLITE_FILE = path.join(SWEEP_SERVER_ROOT, 'data', 'card-lookup.sqlite');
  }
  process.env.CARD_LOOKUP_SQLITE_READONLY_FILE = process.env.CARD_LOOKUP_SQLITE_FILE;
  process.env.MTGEDH_STALL_DETECTOR = '0';
  process.env.ORACLE_IR_GAP_TELEMETRY_LOG = '0';
  delete process.env.ORACLE_IR_TELEMETRY_APPEND_PATH;
  delete process.env.ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT;
  if (!process.env.DEBUG_STATE) process.env.DEBUG_STATE = '0';
}

applyOutcomeSweepEnv();
