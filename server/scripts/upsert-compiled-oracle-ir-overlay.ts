import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { OracleIRCompilerEnvelope } from '../../rules-engine/src/oracleIRCompilerEnvelope.js';
import { ensureLocalCardLookupIndexSync } from '../src/services/localCardLookup.js';
import { upsertCompiledOracleIROverlaySync } from '../src/services/oracleIrCompiledOverlayStore.js';
import { normalizeOverlayImportRecord, validateCompilerEnvelope } from './oracleIrOverlayImportUtils.js';

type CliArgs = {
  readonly file: string;
  readonly cardId?: string;
  readonly name?: string;
};

function parseArgs(argv: readonly string[]): CliArgs {
  let file = '';
  let cardId: string | undefined;
  let name: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--file') {
      file = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (arg === '--card-id') {
      cardId = String(argv[index + 1] || '').trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === '--name') {
      name = String(argv[index + 1] || '').trim() || undefined;
      index += 1;
    }
  }

  if (!file) {
    throw new Error('Usage: npx tsx scripts/upsert-compiled-oracle-ir-overlay.ts --file <path> [--card-id <id>] [--name <card name>]');
  }

  return { file, cardId, name };
}

function loadEnvelope(filePath: string): OracleIRCompilerEnvelope {
  const absolutePath = path.resolve(filePath);
  const raw = JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as unknown;
  return normalizeOverlayImportRecord(raw, path.basename(absolutePath)).envelope;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const envelope = loadEnvelope(args.file);
const validation = validateCompilerEnvelope(envelope);

if (!validation.ok) {
  console.error('Overlay validation failed:');
  for (const error of validation.errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

ensureLocalCardLookupIndexSync();
upsertCompiledOracleIROverlaySync({
  cardId: args.cardId || envelope.card_id,
  name: args.name,
  envelope,
});

console.log(`Upserted compiled Oracle IR overlay from ${path.resolve(args.file)}`);
