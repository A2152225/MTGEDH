import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { buildOracleOverlayCollectOptions } from '../src/state/modules/oracleIrCompiledOverlayLookup.js';
import { lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';
import { lookupCompiledOracleIROverlaySync } from '../src/services/oracleIrCompiledOverlayStore.js';

export type OverlayProbeInput = {
  name?: string;
  cardId?: string;
  oracleText?: string;
};

export type OverlayProbeResult = {
  name: string;
  cardId?: string;
  oracleTextChars: number;
  parserAbilityCount: number;
  parserStepKinds: string;
  parserUnknownCount: number;
  parserUnknownSamples: string[];
  collectedStepKinds: string;
  hasStoredOverlay: boolean;
  overlayStepKinds: string;
  overlayFallbackToBespoke: boolean;
  recommendation: string;
};

function summarizeStepKinds(steps: readonly { kind?: string }[]): string {
  if (steps.length === 0) return '(none)';
  return steps.map((step) => String(step.kind || 'missing')).join(', ');
}

export function probeCompiledOracleIrOverlay(input: OverlayProbeInput): OverlayProbeResult {
  const localCard = input.name ? lookupLocalCardByNameSync(input.name) : undefined;
  const resolvedName = input.name || localCard?.name || '(unknown)';
  const resolvedCardId = input.cardId || localCard?.oracle_id || localCard?.id;
  const resolvedOracleText = input.oracleText || String(localCard?.oracle_text || '').trim();

  if (!resolvedOracleText) {
    throw new Error(`No oracle text for ${resolvedName}. Pass oracleText or use a known card name.`);
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

  return {
    name: resolvedName,
    cardId: resolvedCardId,
    oracleTextChars: resolvedOracleText.length,
    parserAbilityCount: parsed.abilities.length,
    parserStepKinds: summarizeStepKinds(parsedSteps),
    parserUnknownCount: parsedUnknown.length,
    parserUnknownSamples: parsedUnknown.slice(0, 5).map((step) => String(step.raw || '').slice(0, 120)),
    collectedStepKinds: summarizeStepKinds(collectedSteps),
    hasStoredOverlay: Boolean(overlay),
    overlayStepKinds: summarizeStepKinds(overlaySteps),
    overlayFallbackToBespoke: Boolean(overlay?.fallback_to_bespoke),
    recommendation,
  };
}

export function printOverlayProbeResult(result: OverlayProbeResult): void {
  console.log('Oracle IR overlay probe');
  console.log(`  name: ${result.name}`);
  console.log(`  card_id: ${result.cardId || '(none)'}`);
  console.log(`  oracle_text_chars: ${result.oracleTextChars}`);
  console.log(`  parser abilities: ${result.parserAbilityCount}`);
  console.log(`  parser step kinds: ${result.parserStepKinds}`);
  console.log(`  parser unknown steps: ${result.parserUnknownCount}`);
  for (const sample of result.parserUnknownSamples) {
    console.log(`    - ${sample}`);
  }
  console.log(`  collected step kinds (with overlay hook): ${result.collectedStepKinds}`);
  console.log(`  stored overlay: ${result.hasStoredOverlay ? 'yes' : 'no'}`);
  if (result.hasStoredOverlay) {
    console.log(`  overlay step kinds: ${result.overlayStepKinds}`);
    console.log(`  overlay fallback_to_bespoke: ${result.overlayFallbackToBespoke}`);
  }
  console.log(`  recommendation: ${result.recommendation}`);
}
