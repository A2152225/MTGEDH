import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { applyMoveZoneStep } from '../../rules-engine/src/oracleIRExecutorMoveZoneStepHandlers.js';
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
  shouldDeclineOptionalStepsForAudit,
} from './executor-coverage-audit.ts';
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';

await loadEffectIrParser();
const cardName = process.argv[2] || 'Molderhulk';
const cards = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8'))) as any[];
const card = cards.find((c: any) => c.name === cardName);
const oracle = getCombinedOracleText(card);
for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
  const effect = String(trigger.effect || '').trim();
  if (!/graveyard/i.test(effect)) continue;
  const steps = collectStepsFromIrText(effect, card.name);
  console.log('effect:', effect.slice(0, 120));
  console.log('steps:', JSON.stringify(steps, null, 2));
  let state = buildAuditFixtureState(card.name, card.type_line);
  let ctx = buildAuditExecutionContext(card.name);
  const enriched = enrichAuditStateAndContextForCopySteps({ name: card.name, type_line: card.type_line, oracle_text: oracle }, steps, state, ctx);
  const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText: oracle });
  const decline = shouldDeclineOptionalStepsForAudit(steps);
  const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
    allowOptional: !decline,
    ...(collectAutoSelectedModeIds(steps).length > 0 ? { selectedModeIds: collectAutoSelectedModeIds(steps) } : {}),
  });
  console.log('declineOptional:', decline);
  console.log('STATUS:', classifyExecutionResult(result, countOracleSteps(steps), hasUnknownIRSteps(effect, card.name)));
  console.log('GAPS:', result.automationGaps?.map((g: any) => g.reasonCode + ' | ' + g.message?.slice(0, 80)));
}
