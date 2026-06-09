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
  shouldDeclineOptionalStepsForAudit,
} from './executor-coverage-audit.ts';
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';
import fs from 'node:fs';

await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8')) as any[];

for (const cardName of ['Foot Chopper', 'Wooden Stake', 'Maulfist Squad', "Geralf's Messenger", 'Risen Reef', 'Raiders\' Karve']) {
  const card = cards.find((c: any) => c.name === cardName);
  if (!card) continue;
  const oracle = getCombinedOracleText(card);
  for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
    const effect = String(trigger.effect || '').trim();
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
    const status = classifyExecutionResult(result, countOracleSteps(steps), hasUnknownIRSteps(effect, card.name));
    if (status.status === 'fully_applied') continue;
    console.log('---', cardName, status);
    console.log('effect:', effect.slice(0, 120));
    console.log('decline:', decline);
    for (const s of result.stepResults || []) {
      console.log(s.applied ? 'APPLIED' : 'SKIP', (s as any).stepKind, String(s.message || '').slice(0, 90));
    }
  }
}
