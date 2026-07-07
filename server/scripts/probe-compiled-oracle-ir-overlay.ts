import { ensureLocalCardLookupIndexSync } from '../src/services/localCardLookup.js';
import {
  probeCompiledOracleIrOverlay,
  printOverlayProbeResult,
} from './probeCompiledOracleIrOverlayCore.js';

type CliArgs = {
  readonly name?: string;
  readonly cardId?: string;
  readonly oracleText?: string;
};

function parseArgs(argv: readonly string[]): CliArgs {
  let name: string | undefined;
  let cardId: string | undefined;
  let oracleText: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--name') {
      name = String(argv[index + 1] || '').trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === '--card-id') {
      cardId = String(argv[index + 1] || '').trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === '--oracle-text') {
      oracleText = String(argv[index + 1] || '').trim() || undefined;
      index += 1;
    }
  }

  if (!name && !cardId && !oracleText) {
    throw new Error(
      'Usage: npx tsx scripts/probe-compiled-oracle-ir-overlay.ts --name "Card Name" [--card-id <uuid>] [--oracle-text "..."]',
    );
  }

  return { name, cardId, oracleText };
}

const args = parseArgs(process.argv.slice(2));
ensureLocalCardLookupIndexSync();

try {
  const result = probeCompiledOracleIrOverlay(args);
  printOverlayProbeResult(result);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
