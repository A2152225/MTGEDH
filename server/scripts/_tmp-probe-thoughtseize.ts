import { collectStepsFromIrText, buildAuditFixtureState, buildAuditExecutionContext, enrichAuditStateAndContextForTargets, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';

for (const [name, text] of [
  ["Gix's Caress", "Target opponent reveals their hand. You choose a nonland card from it. That player discards that card."],
  ['Thoughtseize', 'Target player reveals their hand. You choose a nonland card from it. That player discards that card. You lose 2 life.'],
]) {
  const steps = collectStepsFromIrText(text, name);
  const rec = dryRunOracleSteps(steps, name, hasUnknownIRSteps(text, name));
  console.log('\n', name, rec.status, rec.reasonCodes, 'applied', rec.applied, 'skipped', rec.skipped);

  let state = buildAuditFixtureState(name);
  let ctx = buildAuditExecutionContext(name);
  const enriched = enrichAuditStateAndContextForTargets(steps, state, ctx, { oracleText: text });
  const r = applyOracleIRStepsToGameState(enriched.state, steps, enriched.ctx, { allowOptional: true });
  console.log(
    'gaps',
    r.automationGaps?.map((g) => ({ reason: g.reasonCode, kind: g.stepKind }))
  );
  console.log('applied', r.appliedSteps?.map((s) => s.kind), 'skipped', r.skippedSteps?.map((s) => s.kind));
}
