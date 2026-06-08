import { loadEffectIrParser } from './trigger-coverage-audit.ts';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  collectStepsFromIrText,
} from './executor-coverage-audit.ts';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';

await loadEffectIrParser();

const effect =
  'create two 1/1 red goblin creature tokens and sacrifice this creature.\nunearth {3}{b}{r} ({3}{b}{r}: return this card from your graveyard to the battlefield. it gains haste. exile it at the beginning of the next end step. if it would leave the battlefield, exile it instead of putting it anywhere else.)';
const steps = collectStepsFromIrText(effect, 'Kathari Bomber');
const state = buildAuditFixtureState('Kathari Bomber', 'Creature — Bird Soldier');
const ctx = buildAuditExecutionContext('Kathari Bomber');

let working = state;
for (let i = 0; i < steps.length; i++) {
  const step = steps[i];
  const result = applyOracleIRStepsToGameState(working, [step], ctx, { allowOptional: true });
  const gaps = (result.automationGaps || []).filter(g => g.reasonCode === 'unsupported_selector');
  console.log(`\nStep ${i}: ${step.kind} | ${step.raw?.slice(0, 60)}`);
  console.log('  applied:', result.appliedSteps?.length, 'gaps:', gaps.length);
  if (gaps.length) for (const g of gaps) console.log('  ', g.reasonCode, g.raw);
  working = result.state;
  const p1 = working.players.find(p => p.id === 'p1') as any;
  const gyIds = (p1?.graveyard || []).map((c: any) => c.id);
  const bfIds = (working.battlefield || []).map((p: any) => p.id);
  console.log('  bf:', bfIds.join(', '));
  console.log('  gy:', gyIds.join(', '));
}
