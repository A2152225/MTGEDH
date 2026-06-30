import fs from 'node:fs';
import path from 'node:path';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { resolveOracleIRWithOverlay } from '../../rules-engine/src/oracleIRCompilerEnvelope.js';
import {
  normalizeOverlayImportRecord,
  validateCompilerEnvelope,
} from './oracleIrOverlayImportUtils.js';

type CliArgs = {
  readonly file: string;
  readonly compareParser: boolean;
};

function parseArgs(argv: readonly string[]): CliArgs {
  let file = '';
  let compareParser = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--file') {
      file = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (arg === '--compare-parser') {
      compareParser = true;
    }
  }

  if (!file) {
    throw new Error('Usage: npx tsx scripts/validate-compiled-oracle-ir-overlay.ts --file <path> [--compare-parser]');
  }

  return { file: path.resolve(file), compareParser };
}

const args = parseArgs(process.argv.slice(2));
const label = path.basename(args.file);
const raw = JSON.parse(fs.readFileSync(args.file, 'utf8')) as unknown;
const record = normalizeOverlayImportRecord(raw, label);
const validation = validateCompilerEnvelope(record.envelope);

if (!validation.ok) {
  console.error(`Validation failed for ${args.file}:`);
  for (const error of validation.errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

if (record.envelope.fallback_to_bespoke) {
  console.log(`OK: ${label} (fallback_to_bespoke — no steps required)`);
  process.exit(0);
}

const stepCount = (record.envelope.abilities || []).reduce(
  (sum, ability) => sum + (ability.steps?.length || 0),
  0,
);
const kinds = (record.envelope.abilities || []).flatMap((ability) =>
  (ability.steps || []).map((step) => String(step.kind || 'missing')),
);

console.log(`OK: ${label}`);
console.log(`  card_id: ${record.cardId || record.envelope.card_id || '(none)'}`);
console.log(`  name: ${record.name || '(none)'}`);
console.log(`  abilities: ${record.envelope.abilities?.length || 0}`);
console.log(`  steps: ${stepCount}`);
console.log(`  kinds: ${kinds.join(', ') || '(none)'}`);

if (args.compareParser) {
  const effectText = (record.envelope.abilities || [])
    .map((ability) => ability.effect_text || '')
    .filter(Boolean)
    .join(' ')
    .trim();
  const cardName = record.name || record.cardId || label;
  if (!effectText) {
    console.warn('  compare-parser: skipped (no effect_text on abilities)');
    process.exit(0);
  }

  const parsed = parseOracleTextToIR(effectText, cardName);
  const parsedKinds = parsed.abilities.flatMap((ability) => ability.steps.map((step) => step.kind));
  const parsedUnknown = parsedKinds.filter((kind) => kind === 'unknown').length;

  const resolved = resolveOracleIRWithOverlay(effectText, cardName, record.envelope);
  const resolvedKinds = resolved.abilities.flatMap((ability) => ability.steps.map((step) => step.kind));

  console.log(`  parser kinds: ${parsedKinds.join(', ') || '(none)'}`);
  console.log(`  parser unknown steps: ${parsedUnknown}`);
  console.log(`  overlay-resolved kinds: ${resolvedKinds.join(', ') || '(none)'}`);
}
