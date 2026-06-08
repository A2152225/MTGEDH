import { loadEffectIrParser } from './trigger-coverage-audit.ts';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  collectStepsFromIrText,
  enrichAuditStateAndContextForTargets,
  enrichAuditStateAndContextForCopySteps,
} from './executor-coverage-audit.ts';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { applyCreateTokenStep } from '../../rules-engine/src/oracleIRExecutorTokenStepHandlers.js';

await loadEffectIrParser();

const text = "create X 1/1 black Thrull creature tokens, where X is that spell's mana value";
const steps = collectStepsFromIrText(text, 'Endrek Sahr');
let state = buildAuditFixtureState('Endrek Sahr', 'Creature');
let ctx = buildAuditExecutionContext('Endrek Sahr');
const enriched = enrichAuditStateAndContextForCopySteps({ name: 'Endrek Sahr', type_line: 'Creature', oracle_text: text }, steps, state, ctx);
state = enriched.state;
ctx = enrichAuditStateAndContextForTargets(steps, enriched.ctx);
const step = steps[0];
const direct = applyCreateTokenStep(state, step as any, ctx, {});
console.log('direct', direct);
const full = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
console.log('gaps', full.automationGaps);
