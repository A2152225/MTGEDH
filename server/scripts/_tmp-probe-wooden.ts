import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  collectStepsFromIrText,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
} from './executor-coverage-audit.ts';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';
import fs from 'node:fs';

await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8')) as any[];
const card = cards.find((c: any) => c.name === 'Wooden Stake');
const oracle = getCombinedOracleText(card);
for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
  const effect = String(trigger.effect || '').trim();
  if (!/destroy that creature/i.test(effect)) continue;
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
  console.log('ctx target:', targetEnriched.ctx.targetCreatureId);
  console.log('bf before:', targetEnriched.state.battlefield?.map((p: any) => p.id));
  const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
    allowOptional: true,
  });
  console.log('bf after:', result.state.battlefield?.map((p: any) => p.id));
  console.log('log:', result.log);
}
