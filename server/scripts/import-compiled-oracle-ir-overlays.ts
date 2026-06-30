import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureLocalCardLookupIndexSync } from '../src/services/localCardLookup.js';
import { upsertCompiledOracleIROverlaySync } from '../src/services/oracleIrCompiledOverlayStore.js';
import {
  inferOverlayNameFromFilename,
  isOverlayExampleFile,
  normalizeOverlayImportRecord,
  validateCompilerEnvelope,
} from './oracleIrOverlayImportUtils.js';

type CliArgs = {
  readonly dir: string;
  readonly dryRun: boolean;
};

function parseArgs(argv: readonly string[]): CliArgs {
  let dir = '';
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dir') {
      dir = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  if (!dir) {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    dir = path.join(scriptDir, '..', 'data', 'compiled-oracle-ir-overlays');
  }

  return { dir: path.resolve(dir), dryRun };
}

function listJsonFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory)
    .filter((entry) => entry.toLowerCase().endsWith('.json'))
    .filter((entry) => !isOverlayExampleFile(entry))
    .map((entry) => path.join(directory, entry))
    .sort((left, right) => left.localeCompare(right));
}

const args = parseArgs(process.argv.slice(2));
const files = listJsonFiles(args.dir);

if (files.length === 0) {
  console.log(`No overlay JSON files found in ${args.dir}`);
  process.exit(0);
}

if (!args.dryRun) {
  ensureLocalCardLookupIndexSync();
}

let imported = 0;
let skipped = 0;
const failures: string[] = [];

for (const filePath of files) {
  const label = path.basename(filePath);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    const record = normalizeOverlayImportRecord(raw, label);
    const validation = validateCompilerEnvelope(record.envelope);
    if (!validation.ok) {
      failures.push(`${label}: ${validation.errors.join('; ')}`);
      skipped += 1;
      continue;
    }

    const name = record.name || inferOverlayNameFromFilename(label);
    if (!record.cardId && !name) {
      failures.push(`${label}: missing card_id/name`);
      skipped += 1;
      continue;
    }

    if (!args.dryRun) {
      upsertCompiledOracleIROverlaySync({
        cardId: record.cardId,
        name,
        envelope: {
          ...record.envelope,
          ...(record.cardId ? { card_id: record.cardId } : {}),
        },
      });
    }

    imported += 1;
    console.log(`${args.dryRun ? '[dry-run] ' : ''}imported ${label}${name ? ` (${name})` : ''}`);
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    skipped += 1;
  }
}

console.log(`Overlay import complete: imported=${imported}, skipped=${skipped}, dir=${args.dir}`);
if (failures.length > 0) {
  console.error('Failures:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
