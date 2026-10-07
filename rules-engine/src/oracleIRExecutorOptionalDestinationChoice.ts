// Origin parent: oracleIRExecutorMainLoop.ts
// Cluster moved: optional graveyard return whose following "if that land is a {type}"
//   conditional offers the battlefield instead (Emeria Shepherd Plains landfall).
// Public entry symbol: matchOptionalHandOrBattlefieldInsteadChoice.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { evaluateConditionalWrapperCondition } from './oracleIRExecutorConditionalStepSupport';

function isOptionalMoveTo(
  step: OracleEffectStep | undefined,
  zone: 'hand' | 'battlefield',
): step is Extract<OracleEffectStep, { kind: 'move_zone' }> {
  return Boolean(
    step
    && step.kind === 'move_zone'
    && step.optional === true
    && step.to === zone,
  );
}

/**
 * When a Plains (or other named land type) already satisfies the following
 * conditional, the hand return and the battlefield "instead" are one choice.
 * The card stays put until that choice is made.
 */
export function matchOptionalHandOrBattlefieldInsteadChoice(params: {
  step: OracleEffectStep;
  followingStep: OracleEffectStep | undefined;
  state: GameState;
  ctx: OracleIRExecutionContext;
  controllerId: PlayerID;
  lastMovedCards: readonly unknown[];
}): boolean {
  const { step, followingStep } = params;
  if (!isOptionalMoveTo(step, 'hand')) return false;
  if (!followingStep || followingStep.kind !== 'conditional') return false;

  const condition = followingStep.condition;
  const conditionRaw = String(condition?.raw || '').trim();
  if (!/^that land is (?:a|an) /i.test(conditionRaw)) return false;

  const innerSteps = Array.isArray(followingStep.steps) ? followingStep.steps : [];
  const battlefieldStep = innerSteps[0];
  if (innerSteps.length !== 1 || !isOptionalMoveTo(battlefieldStep, 'battlefield')) return false;

  const conditionTrue = evaluateConditionalWrapperCondition({
    condition,
    nextState: params.state,
    controllerId: params.controllerId,
    ctx: params.ctx,
    lastActionOutcome: null,
    pendingSteps: innerSteps,
    lastMovedCards: params.lastMovedCards,
    step: followingStep,
  });
  return conditionTrue === true;
}
