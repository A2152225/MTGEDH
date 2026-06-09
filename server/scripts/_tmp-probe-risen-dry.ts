import { dryRunOracleSteps, collectStepsFromIrText } from './executor-coverage-audit.ts';
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
  shouldDeclineOptionalStepsForAudit,
  collectAutoSelectedModeIds,
} from './executor-coverage-audit.ts';
import fs from 'node:fs';

await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8')) as any[];
const card = cards.find((c: any) => c.name === 'Risen Reef');
const oracle = getCombinedOracleText(card);
for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
  const effect = String(trigger.effect || '').trim();
  const steps = collectStepsFromIrText(effect, card.name);
  const irGaps = hasUnknownIRSteps(effect, card.name);
  console.log('dryRun', dryRunOracleSteps(steps, card, irGaps));
  let state = buildAuditFixtureState(card.name, card.type_line);
  let ctx = buildAuditExecutionContext(card.name);
  const enriched = enrichAuditStateAndContextForCopySteps({ name: card.name, type_line: card.type_line, oracle_text: oracle }, steps, state, ctx);
  const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText: oracle });
  const decline = shouldDeclineOptionalStepsForAudit(steps);
  const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
    allowOptional: decline ? false : true,
    ...(decline ? { declineOptionalSteps: true } : {}),
    ...(collectAutoSelectedModeIds(steps).length > 0 ? { selectedModeIds: collectAutoSelectedModeIds(steps) } : {}),
  });
  console.log('applied', result.appliedSteps?.map((s: any) => s.raw?.slice(0, 50)));
  console.log('skipped', result.skippedSteps?.map((s: any) => s.raw?.slice(0, 50)));
  console.log('gaps', result.automationGaps);
  console.log('log', result.log);
}
