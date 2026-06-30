import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, beforeEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerId =
  (process.env.VITEST_WORKER_ID || process.env.VITEST_POOL_ID || '').trim() ||
  String(process.pid);
const testDbFile = path.resolve(__dirname, '..', 'data', `mtgedh.test.${workerId}.sqlite`);
const testCardLookupDbFile = path.resolve(__dirname, '..', 'data', `card-lookup.test.${workerId}.sqlite`);

function rmIfExists(filePath: string) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // ignore
  }
}

beforeEach(() => {
  // Default-off in tests so legacy-path suites stay stable; IR-primary tests opt in with =1.
  process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';
  delete process.env.ORACLE_IR_TRIGGER_LEGACY;
  process.env.ORACLE_IR_SPELL_PRIMARY = '0';
  delete process.env.ORACLE_IR_SPELL_LEGACY;
});

beforeAll(() => {
  process.env.SQLITE_FILE = testDbFile;
  process.env.CARD_LOOKUP_SQLITE_FILE = testCardLookupDbFile;
  // Ensure a clean slate (WAL leaves sidecar files)
  rmIfExists(testDbFile);
  rmIfExists(`${testDbFile}-wal`);
  rmIfExists(`${testDbFile}-shm`);
  rmIfExists(testCardLookupDbFile);
  rmIfExists(`${testCardLookupDbFile}-wal`);
  rmIfExists(`${testCardLookupDbFile}-shm`);
});

afterAll(() => {
  // Best-effort cleanup; DB handle may keep WAL around on Windows.
  rmIfExists(testDbFile);
  rmIfExists(`${testDbFile}-wal`);
  rmIfExists(`${testDbFile}-shm`);
  rmIfExists(testCardLookupDbFile);
  rmIfExists(`${testCardLookupDbFile}-wal`);
  rmIfExists(`${testCardLookupDbFile}-shm`);
});
