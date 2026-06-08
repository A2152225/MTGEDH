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
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';

await loadEffectIrParser();
const cardName = process.argv[2] || 'Graveyard Trespasser // Graveyard Glutton';
const cards = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8'))) as any[];
const card = cards.find((c: any) => c.name === cardName);
if (!card) { console.error('not found'); process.exit(1); }
const oracle = getCombinedOracleText(card);
for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
  const effect = String(trigger.effect || '').trim();
  if (!effect) continue;
  const irGaps = hasUnknownIRSteps(effect, card.name);
  const steps = collectStepsFromIrText(effect, card.name);
  console.log('STEPS:', JSON.stringify(steps, null, 2));
  let state = buildAuditFixtureState(card.name, card.type_line);
  let ctx = buildAuditExecutionContext(card.name);
  const enriched = enrichAuditStateAndContextForCopySteps({ name: card.name, type_line: card.type_line, oracle_text: oracle }, steps, state, ctx);
  const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText: oracle });
  const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
    allowOptional: true,
    ...(collectAutoSelectedModeIds(steps).length > 0 ? { selectedModeIds: collectAutoSelectedModeIds(steps) } : {}),
  });
  console.log('STATUS:', classifyExecutionResult(result, countOracleSteps(steps), irGaps));
  console.log('APPLIED:', result.appliedSteps?.map((s: any) => s.kind + ': ' + s.raw?.slice(0, 60)));
  console.log('SKIPPED:', result.skippedSteps?.map((s: any) => s.kind + ': ' + s.raw?.slice(0, 80)));
  console.log('GAPS:', result.automationGaps?.map((g: any) => g.reasonCode + ' | ' + g.stepKind + ' | ' + g.message?.slice(0, 80)));
}
