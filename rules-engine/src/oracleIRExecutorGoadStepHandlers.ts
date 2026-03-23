import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { applyGoadToCreatures, resolveGoadTargetCreatureIds } from './oracleIRExecutorCreatureStepUtils';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly lastGoadedCreatures: readonly BattlefieldPermanent[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason: 'no_deterministic_target' | 'failed_to_apply';
};

export type GoadStepHandlerResult = StepApplyResult | StepSkipResult;

export function applyGoadStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'goad' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID
): GoadStepHandlerResult {
  const targetCreatureIds = resolveGoadTargetCreatureIds(state, step.target, ctx);
  if (targetCreatureIds.length === 0) {
    return {
      applied: false,
      message: `Skipped goad (no deterministic creature targets): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const nextState = applyGoadToCreatures(state, targetCreatureIds, controllerId);
  if (!nextState) {
    return {
      applied: false,
      message: `Skipped goad (failed to apply): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const goadedSet = new Set(targetCreatureIds);
  const lastGoadedCreatures = (((nextState as any).battlefield || []) as BattlefieldPermanent[]).filter(permanent =>
    goadedSet.has(String((permanent as any)?.id || '').trim())
  );

  return {
    applied: true,
    state: nextState,
    log: [`Goaded ${targetCreatureIds.length} creature(s)`],
    lastGoadedCreatures,
  };
}
