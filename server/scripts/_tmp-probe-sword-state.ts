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

await loadEffectIrParser();
const cards = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8'))) as any[];
const card = cards.find((c: any) => c.name === 'Sword of Light and Shadow');
const oracle = getCombinedOracleText(card);
for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
  const effect = String(trigger.effect || '').trim();
  const steps = collectStepsFromIrText(effect, card.name);
  let state = buildAuditFixtureState(card.name, card.type_line);
  let ctx = buildAuditExecutionContext(card.name);
  const enriched = enrichAuditStateAndContextForCopySteps({ name: card.name, type_line: card.type_line, oracle_text: oracle }, steps, state, ctx);
  const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText: oracle });
  console.log('before:', (targetEnriched.state.battlefield as any[])?.some((p) => p.id === 'bf-creature-1'));
  const after1 = applyOracleIRStepsToGameState(targetEnriched.state, steps.slice(0, 1), targetEnriched.ctx, { allowOptional: true });
  console.log('after gain_life:', (after1.state.battlefield as any[])?.some((p) => p.id === 'bf-creature-1'));
  const after2 = applyOracleIRStepsToGameState(after1.state, steps.slice(1, 2), targetEnriched.ctx, { allowOptional: true });
  console.log('after move:', (after2.state.battlefield as any[])?.some((p) => p.id === 'bf-creature-1'));
  console.log('move step:', steps[1]);
}
