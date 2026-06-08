import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { collectStepsFromIrText, buildAuditFixtureState, buildAuditExecutionContext } from './executor-coverage-audit.ts';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';

const card = 'Kathari Bomber';
const oracle = "Unearth {1}{B} ({1}{B}: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. Unearth only as a sorcery.)";
for (const trigger of parseTriggeredAbilitiesFromText(oracle, card)) {
  const effect = String(trigger.effect || '').trim();
  const steps = collectStepsFromIrText(effect, card);
  const state = buildAuditFixtureState(card, 'Creature — Bird Soldier');
  const ctx = buildAuditExecutionContext(card);
  const r = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
  const gaps = (r.automationGaps || []).filter(g => g.reasonCode === 'unsupported_selector');
  console.log('effect:', effect);
  console.log('steps:', JSON.stringify(steps));
  console.log('gaps:', gaps.length, gaps[0]?.raw);
}
