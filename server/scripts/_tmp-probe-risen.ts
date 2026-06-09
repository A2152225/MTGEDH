import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  collectAutoSelectedModeIds,
  collectStepsFromIrText,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
  shouldDeclineOptionalStepsForAudit,
} from './executor-coverage-audit.ts';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';
import fs from 'node:fs';

await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8')) as any[];
for (const cardName of ['Risen Reef', "Raiders' Karve", 'Wooden Stake']) {
  const card = cards.find((c: any) => c.name === cardName);
  const oracle = getCombinedOracleText(card);
  for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
    const effect = String(trigger.effect || '').trim();
    if (!/look at the top|destroy that creature/i.test(effect)) continue;
    const steps = collectStepsFromIrText(effect, card.name);
    let state = buildAuditFixtureState(card.name, card.type_line);
    let ctx = buildAuditExecutionContext(card.name);
    const enriched = enrichAuditStateAndContextForCopySteps(
      { name: card.name, type_line: card.type_line, oracle_text: oracle },
      steps,
      state,
      ctx
    );
    const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, {
      oracleText: oracle,
    });
    const decline = shouldDeclineOptionalStepsForAudit(steps);
    const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
      allowOptional: !decline,
      ...(collectAutoSelectedModeIds(steps).length > 0
        ? { selectedModeIds: collectAutoSelectedModeIds(steps) }
        : {}),
    });
    console.log('\n===', cardName, 'decline=', decline);
    console.log('applied:', result.appliedSteps?.map((s: any) => s.kind + ': ' + s.raw?.slice(0, 50)));
    console.log('skipped:', result.skippedSteps?.map((s: any) => s.kind + ': ' + s.raw?.slice(0, 50)));
    console.log('gaps:', result.automationGaps?.map((g: any) => g.reasonCode));
    console.log('log tail:', result.log?.slice(-8));
  }
}
