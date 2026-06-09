import { collectStepsFromIrText, buildAuditFixtureState, buildAuditExecutionContext, enrichAuditStateAndContextForTargets } from './executor-coverage-audit.ts';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.ts';

const text =
  "Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.";
const steps = collectStepsFromIrText(text, "Gix's Caress");
console.log(JSON.stringify(steps, null, 2));

let state = buildAuditFixtureState("Gix's Caress");
let ctx = buildAuditExecutionContext("Gix's Caress");
const enriched = enrichAuditStateAndContextForTargets(steps, state, ctx, { oracleText: text });
state = enriched.state;
ctx = enriched.ctx;

console.log('ctx chosen', ctx.selectorContext?.chosenObjectIds, ctx.selectorContext?.targetPlayerId);

const r = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
console.log(
  'gaps',
  r.automationGaps?.map((g) => ({ reason: g.reasonCode, kind: g.stepKind, msg: g.message?.slice(0, 80) }))
);
console.log(
  'applied',
  r.appliedSteps?.map((s) => s.kind),
  'skipped',
  r.skippedSteps?.map((s) => ({ k: s.kind, raw: String((s as any).raw || '').slice(0, 50) }))
);
