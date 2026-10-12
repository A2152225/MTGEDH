import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, beforeEach } from 'vitest';
import { getOracleIrGapTelemetrySnapshot, loadOracleIrGapTelemetrySnapshotFromAppendLog } from '../src/state/modules/oracleIrGapTelemetry.js';
import { ensureLocalCardLookupIndexSync, resetLocalCardLookupForTests } from '../src/services/localCardLookup.js';
import { resetCompiledOracleIROverlayDatabaseForTests } from '../src/services/oracleIrCompiledOverlayDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerId =
  (process.env.VITEST_WORKER_ID || process.env.VITEST_POOL_ID || '').trim() ||
  String(process.pid);
const testDbFile = path.resolve(__dirname, '..', 'data', `mtgedh.test.${workerId}.sqlite`);
const canonicalCardLookupDbFile = path.resolve(__dirname, '..', 'data', 'card-lookup.sqlite');
// Only the compiled-overlay table is written during tests, so it gets its own small
// per-worker database and the 137 MB card corpus is shared read-only instead of copied.
const testOverlayDbFile = path.resolve(__dirname, '..', 'data', `oracle-ir-overlay.test.${workerId}.sqlite`);

function rmIfExists(filePath: string) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // ignore
  }
}

function rmDbFamily(filePath: string) {
  rmIfExists(filePath);
  rmIfExists(`${filePath}-wal`);
  rmIfExists(`${filePath}-shm`);
}

/**
 * Windows keeps the SQLite handle open past `afterAll`, so per-worker files used to
 * survive every run and accumulate indefinitely. Sweep leftovers that are too old to
 * belong to a concurrently running worker.
 */
const STALE_TEST_DB_AGE_MS = 2 * 60 * 60 * 1000;

function sweepStaleTestDatabases(): void {
  const dataDir = path.resolve(__dirname, '..', 'data');
  let entries: string[];
  try {
    entries = fs.readdirSync(dataDir);
  } catch {
    return;
  }

  const cutoff = Date.now() - STALE_TEST_DB_AGE_MS;
  for (const entry of entries) {
    if (!/\.test\.[^.]+\.sqlite(?:-wal|-shm)?$/.test(entry)) continue;
    const fullPath = path.join(dataDir, entry);
    try {
      if (fs.statSync(fullPath).mtimeMs > cutoff) continue;
    } catch {
      continue;
    }
    rmIfExists(fullPath);
  }
}

let censusWarned = false;
function warnIgnoredCensusEnv(censusRun: boolean): void {
  if (censusRun || censusWarned) return;
  const stray = ['ORACLE_IR_CENSUS_PRIMARY', 'ORACLE_IR_CENSUS_SPELL_PRIMARY', 'ORACLE_IR_CENSUS_TRIGGER_PRIMARY']
    .filter((name) => process.env[name] === '1');
  if (stray.length === 0) return;
  censusWarned = true;
  console.warn(`[vitest.setup] Ignoring ${stray.join(', ')} (set ORACLE_IR_CENSUS_RUN=1 for a census run).`);
}

beforeEach(() => {
  // Default-off in tests so legacy-path suites stay stable; IR-primary tests opt in with =1.
  // P4e: ORACLE_IR_*_LEGACY is ignored — PRIMARY=0 is the only opt-out.
  // Census (`ORACLE_IR_CENSUS_PRIMARY=1` or ORACLE_IR_CENSUS_{SPELL,TRIGGER}_PRIMARY=1)
  // flips the harness to production-on so a failure census can run without editing this file.
  // Census flags are honored only inside an explicit census run (ORACLE_IR_CENSUS_RUN=1, set by
  // scripts/oracle-ir-primary-census.ts). A stray ORACLE_IR_CENSUS_* left in a developer shell
  // used to flip the whole suite to IR-primary and fail ~70 prompt/payment tests.
  const censusRun = process.env.ORACLE_IR_CENSUS_RUN === '1';
  warnIgnoredCensusEnv(censusRun);
  const censusAll = censusRun && process.env.ORACLE_IR_CENSUS_PRIMARY === '1';
  const censusSpell = censusAll || (censusRun && process.env.ORACLE_IR_CENSUS_SPELL_PRIMARY === '1');
  const censusTrigger = censusAll || (censusRun && process.env.ORACLE_IR_CENSUS_TRIGGER_PRIMARY === '1');
  process.env.ORACLE_IR_TRIGGER_PRIMARY = censusTrigger ? '1' : '0';
  delete process.env.ORACLE_IR_TRIGGER_LEGACY;
  process.env.ORACLE_IR_SPELL_PRIMARY = censusSpell ? '1' : '0';
  delete process.env.ORACLE_IR_SPELL_LEGACY;
});

beforeAll(() => {
  process.env.SQLITE_FILE = testDbFile;
  process.env.CARD_LOOKUP_SQLITE_FILE = canonicalCardLookupDbFile;
  process.env.CARD_LOOKUP_SQLITE_READONLY_FILE = canonicalCardLookupDbFile;
  process.env.ORACLE_IR_OVERLAY_SQLITE_FILE = testOverlayDbFile;
  // Ensure a clean slate (WAL leaves sidecar files)
  rmDbFamily(testDbFile);
  rmDbFamily(testOverlayDbFile);
  sweepStaleTestDatabases();
  // Warm card lookup once per worker so integration tests do not pay rebuild cost mid-test.
  ensureLocalCardLookupIndexSync();
});

afterAll(() => {
  const telemetrySnapshotPath = String(process.env.ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT || '').trim();
  if (telemetrySnapshotPath) {
    try {
      const appendPath = `${telemetrySnapshotPath}.jsonl`;
      const snapshot = fs.existsSync(appendPath)
        ? loadOracleIrGapTelemetrySnapshotFromAppendLog(appendPath)
        : getOracleIrGapTelemetrySnapshot();
      fs.mkdirSync(path.dirname(telemetrySnapshotPath), { recursive: true });
      fs.writeFileSync(telemetrySnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    } catch {
      // ignore — telemetry dump is best-effort
    }
  }

  // Close our own handles first so the files are actually deletable on Windows.
  resetCompiledOracleIROverlayDatabaseForTests();
  resetLocalCardLookupForTests();

  // Best-effort cleanup; the game DB handle may keep WAL around on Windows. Anything that
  // survives is reclaimed by sweepStaleTestDatabases() on a later run.
  rmDbFamily(testDbFile);
  rmDbFamily(testOverlayDbFile);
});
