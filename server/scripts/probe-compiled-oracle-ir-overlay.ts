import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { buildOracleOverlayCollectOptions } from '../src/state/modules/oracleIrCompiledOverlayLookup.js';
import { ensureLocalCardLookupIndexSync, lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';
import { lookupCompiledOracleIROverlaySync } from '../src/services/oracleIrCompiledOverlayStore.js';

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

function summarizeStepKinds(steps: readonly { kind?: string }[]): string {
  if (steps.length === 0) return '(none)';
  return steps.map((step) => String(step.kind || 'missing')).join(', ');
}

const args = parseArgs(process.argv.slice(2));
ensureLocalCardLookupIndexSync();

const localCard = args.name ? lookupLocalCardByNameSync(args.name) : undefined;
const resolvedName = args.name || localCard?.name || '(unknown)';
const resolvedCardId = args.cardId || localCard?.oracle_id || localCard?.id;
const resolvedOracleText = args.oracleText || String(localCard?.oracle_text || '').trim();

if (!resolvedOracleText) {
  console.error('No oracle text available. Pass --oracle-text or use a card name in local lookup.');
  process.exit(1);
}

const overlay = lookupCompiledOracleIROverlaySync({
  cardId: resolvedCardId,
  name: resolvedName,
});

const parsed = parseOracleTextToIR(resolvedOracleText, resolvedName);
const parsedSteps = parsed.abilities.flatMap((ability) => ability.steps);
const parsedUnknown = parsedSteps.filter((step) => step.kind === 'unknown');

const collectedSteps = collectOracleEffectSteps(
  resolvedOracleText,
  resolvedName,
  buildOracleOverlayCollectOptions({
    cardId: resolvedCardId,
    cardName: resolvedName,
    card: localCard,
    effectiveCard: localCard,
  }),
);

const overlaySteps = (overlay?.abilities || []).flatMap((ability) => ability.steps || []);
const recommendation = (() => {
  if (overlay?.fallback_to_bespoke) return 'overlay_marked_fallback_to_bespoke';
  if (parsedUnknown.length > 0 && !overlay) return 'compile_overlay_recommended';
  if (parsedUnknown.length > 0 && overlay) return 'overlay_present_covers_parser_gap';
  if (overlay && parsedUnknown.length === 0) return 'overlay_optional_parser_already_handles';
  return 'no_overlay_needed';
})();

console.log('Oracle IR overlay probe');
console.log(`  name: ${resolvedName}`);
console.log(`  card_id: ${resolvedCardId || '(none)'}`);
console.log(`  oracle_text_chars: ${resolvedOracleText.length}`);
console.log(`  parser abilities: ${parsed.abilities.length}`);
console.log(`  parser step kinds: ${summarizeStepKinds(parsedSteps)}`);
console.log(`  parser unknown steps: ${parsedUnknown.length}`);
if (parsedUnknown.length > 0) {
  for (const step of parsedUnknown.slice(0, 5)) {
    console.log(`    - ${String(step.raw || '').slice(0, 120)}`);
  }
}
console.log(`  collected step kinds (with overlay hook): ${summarizeStepKinds(collectedSteps)}`);
console.log(`  stored overlay: ${overlay ? 'yes' : 'no'}`);
if (overlay) {
  console.log(`  overlay step kinds: ${summarizeStepKinds(overlaySteps)}`);
  console.log(`  overlay fallback_to_bespoke: ${Boolean(overlay.fallback_to_bespoke)}`);
}
console.log(`  recommendation: ${recommendation}`);
