/*
  Run migration suite with telemetry snapshot export, then legacy triage report.
  See scripts/oracle-ir-legacy-triage.ts for output format.

  Optional: pass --legacy to run forced-legacy integration subset with
  ORACLE_IR_TRIGGER_LEGACY=1 (richer legacy_handled signal) instead of full migration.
*/

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, '..');
const legacyOnly = process.argv.includes('--legacy');
const snapshotPath = path.join(
  serverRoot,
  'scripts',
  'out',
  legacyOnly ? 'telemetry-snapshot-legacy-forced.json' : 'telemetry-snapshot.json',
);
const appendPath = `${snapshotPath}.jsonl`;
const triageOut = path.join(
  serverRoot,
  'scripts',
  'out',
  legacyOnly ? 'oracle-ir-legacy-triage-forced.json' : 'oracle-ir-legacy-triage-post-migration.json',
);

try {
  fs.rmSync(appendPath, { force: true });
  fs.rmSync(snapshotPath, { force: true });
} catch {
  // ignore
}

const testCommand = legacyOnly
  ? null
  : ['run', 'test:oracle-ir-migration'];

const migration = legacyOnly
  ? spawnSync(
      'npx',
      [
        'vitest',
        'run',
        'tests/oracle-ir-legacy-forced.integration.test.ts',
        'tests/oracle-ir-trigger-legacy-parity.integration.test.ts',
        'tests/oracle-ir-trigger-legacy-handler-retirement.unit.test.ts',
        '--pool=threads',
        '--maxWorkers=1',
      ],
      {
        cwd: serverRoot,
        stdio: 'inherit',
        shell: true,
        env: {
          ...process.env,
          ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT: snapshotPath,
          ORACLE_IR_TRIGGER_LEGACY: '1',
          ORACLE_IR_SPELL_LEGACY: '1',
          ORACLE_IR_GAP_TELEMETRY_LEGACY_SOAK: '1',
        },
      },
    )
  : spawnSync('npm', testCommand!, {
      cwd: serverRoot,
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT: snapshotPath,
      },
    });

if (migration.status !== 0) {
  process.exit(migration.status ?? 1);
}

const triage = spawnSync(
  'npm',
  ['run', 'oracle-ir:legacy-triage', '--', '--snapshot', snapshotPath, '--out', triageOut],
  { cwd: serverRoot, stdio: 'inherit', shell: true },
);

process.exit(triage.status ?? 0);
