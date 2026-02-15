import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbFile = path.resolve(__dirname, '..', 'data', 'mtgedh.test.sqlite');

function rmIfExists(filePath: string) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // ignore
  }
}

beforeAll(() => {
  process.env.SQLITE_FILE = testDbFile;
  // Ensure a clean slate (WAL leaves sidecar files)
  rmIfExists(testDbFile);
  rmIfExists(`${testDbFile}-wal`);
  rmIfExists(`${testDbFile}-shm`);
});

afterAll(() => {
  // Best-effort cleanup; DB handle may keep WAL around on Windows.
  rmIfExists(testDbFile);
  rmIfExists(`${testDbFile}-wal`);
  rmIfExists(`${testDbFile}-shm`);
});
