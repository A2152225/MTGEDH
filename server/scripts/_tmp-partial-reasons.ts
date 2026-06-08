import fs from 'node:fs';
import path from 'node:path';

import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  classifyExecutionResult,
  collectAutoSelectedModeIds,
  collectStepsFromIrText,
  countOracleSteps,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
} from './executor-coverage-audit.ts';
import {
  getCombinedOracleText,
  hasUnknownIRSteps,
  isCommanderLegalCard,
  isEligible,
  isIgnorableCardForIrGap,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const oraclePath = path.join(repoRoot, 'oracle-cards.json');

await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as any[];

const reasonTotals: Record<string, number> = {};
const skipKindTotals: Record<string, number> = {};
let partialCount = 0;
let partialWithOnlyChoice = 0;
let partialWithUnsupported = 0;
let partialNoGaps = 0;

for (const card of cards) {
  if (!isEligible(card) || !isCommanderLegalCard(card)) continue;
  const oracle = getCombinedOracleText(card);
  if (!oracle) continue;

  for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
    const effect = String(trigger.effect || '').trim();
    if (!effect) continue;
    if (isIgnorableCardForIrGap(card) && hasUnknownIRSteps(effect, card.name).length > 0) continue;

    const irGaps = hasUnknownIRSteps(effect, card.name);
    const steps = collectStepsFromIrText(effect, card.name);
    const stepCount = countOracleSteps(steps);
    if (irGaps.length > 0 || stepCount.recognized === 0) continue;

    const cardRecord = { name: card.name, type_line: card.type_line, oracle_text: oracle };
    let state = buildAuditFixtureState(card.name, card.type_line);
    let ctx = buildAuditExecutionContext(card.name);
    const enriched = enrichAuditStateAndContextForCopySteps(cardRecord, steps, state, ctx);
    const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText: oracle });
    state = targetEnriched.state;
    ctx = targetEnriched.ctx;

    const result = applyOracleIRStepsToGameState(state, steps, ctx, {
      allowOptional: true,
      ...(collectAutoSelectedModeIds(steps).length > 0 ? { selectedModeIds: collectAutoSelectedModeIds(steps) } : {}),
    });
    const record = classifyExecutionResult(result, stepCount, irGaps);
    if (record.status !== 'partial') continue;
    partialCount += 1;

    const gaps = result.automationGaps || [];
    if (gaps.length === 0) partialNoGaps += 1;

    const hasChoice = gaps.some((g) => g.reasonCode === 'player_choice_required');
    const hasUnsupported = gaps.some((g) => g.reasonCode !== 'player_choice_required');
    if (hasChoice && !hasUnsupported) partialWithOnlyChoice += 1;
    if (hasUnsupported) partialWithUnsupported += 1;

    for (const gap of gaps) {
      const code = String(gap.reasonCode || 'unknown');
      reasonTotals[code] = (reasonTotals[code] || 0) + 1;
      const kind = String(gap.stepKind || 'unknown');
      skipKindTotals[kind] = (skipKindTotals[kind] || 0) + 1;
    }

    for (const skip of result.skippedSteps || []) {
      const kind = String((skip as any).kind || (skip as any).stepKind || 'unknown');
      skipKindTotals[`skipped:${kind}`] = (skipKindTotals[`skipped:${kind}`] || 0) + 1;
    }
  }
}

console.log(`Partial effects: ${partialCount}`);
console.log(`  with only player_choice gaps: ${partialWithOnlyChoice}`);
console.log(`  with unsupported gaps: ${partialWithUnsupported}`);
console.log(`  with zero automationGaps: ${partialNoGaps}`);
console.log('\nReason codes in partial gaps:');
for (const [k, v] of Object.entries(reasonTotals).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${k}: ${v}`);
}
console.log('\nTop skipped step kinds (from gaps):');
for (const [k, v] of Object.entries(skipKindTotals).filter(([k]) => !k.startsWith('skipped:')).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${k}: ${v}`);
}
