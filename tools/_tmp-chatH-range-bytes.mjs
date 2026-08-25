#!/usr/bin/env node
/** Deprecated alias — use tools/ts-cluster-range-bytes.mjs */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync(
  process.execPath,
  [path.join(here, 'ts-cluster-range-bytes.mjs'), ...process.argv.slice(2)],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);
