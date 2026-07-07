/*
  Run the Oracle IR migration vitest suite.

  On Windows the full single-process run can crash (access violation). Default to
  8 shards on win32; override with ORACLE_IR_MIGRATION_SHARDS=1 for a single run.
  Uses --pool=forks to reduce native crashes under load on win32.
*/

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, '..');

function readMigrationTestFiles(): string[] {
  const pkgPath = path.join(serverRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const singleScript = String(pkg.scripts?.['test:oracle-ir-migration:single'] || '').trim();
  if (!singleScript.startsWith('vitest run ')) {
    throw new Error('package.json is missing scripts.test:oracle-ir-migration:single');
  }
  const withoutFlags = singleScript
    .slice('vitest run '.length)
    .replace(/\s+--pool=.*$/, '')
    .trim();
  return withoutFlags.split(/\s+/).filter(Boolean);
}

function resolveShardCount(): number {
  const raw = String(process.env.ORACLE_IR_MIGRATION_SHARDS || '').trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
  }
  return process.platform === 'win32' ? 8 : 1;
}

function runShard(files: readonly string[], shard: number, shardCount: number): number {
  const args = [
    'vitest',
    'run',
    ...files,
    '--pool=forks',
    '--maxWorkers=1',
  ];
  if (shardCount > 1) {
    args.push(`--shard=${shard}/${shardCount}`);
  }

  const result = spawnSync('npx', args, {
    cwd: serverRoot,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  return result.status ?? 1;
}

function main(): void {
  const files = readMigrationTestFiles();
  const shardCount = resolveShardCount();

  console.log(
    `Oracle IR migration: ${files.length} test files, ${shardCount} shard(s)` +
      (shardCount > 1 ? ` (platform=${process.platform})` : ''),
  );

  for (let shard = 1; shard <= shardCount; shard += 1) {
    if (shardCount > 1) {
      console.log(`\n=== Migration shard ${shard}/${shardCount} ===\n`);
    }
    const status = runShard(files, shard, shardCount);
    if (status !== 0) {
      process.exit(status);
    }
  }
}

main();
