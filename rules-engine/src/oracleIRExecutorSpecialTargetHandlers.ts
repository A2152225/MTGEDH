import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { tryBatch386ExileStep } from './oracleIRExecutorSpecialTargetHandlersBatch386Bulk';
import { tryBatch387ExileStep } from './oracleIRExecutorSpecialTargetHandlersBatch387Bulk';
import { tryBatch388ExileStep } from './oracleIRExecutorSpecialTargetHandlersBatch388Bulk';
import { tryBatch389ExileStep } from './oracleIRExecutorSpecialTargetHandlersBatch389Bulk';
import { tryApplyExileLookedContextualStep } from './oracleIRExecutorExileLookedContextualHandlers';
import { tryApplyExilePileCounterAndTargetedStep } from './oracleIRExecutorExilePileCounterAndTargetedHandlers';
import { type SpecialTargetStepResult } from './oracleIRExecutorSpecialTargetOps';
export type { SpecialTargetStepResult };


export function trySpecialExileStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const batch386 = tryBatch386ExileStep(state, step, ctx);
  if (batch386) return batch386;
  const batch387 = tryBatch387ExileStep(state, step, ctx);
  if (batch387) return batch387;
  const batch388 = tryBatch388ExileStep(state, step, ctx);
  if (batch388) return batch388;
  const batch389 = tryBatch389ExileStep(state, step, ctx);
  if (batch389) return batch389;

  const lookedContextual = tryApplyExileLookedContextualStep(state, step, ctx);
  if (lookedContextual) return lookedContextual;


  const pileCounterAndTargeted = tryApplyExilePileCounterAndTargetedStep(state, step, ctx);
  if (pileCounterAndTargeted) return pileCounterAndTargeted;


  return null;
}

export { trySpecialDestroyStep } from './oracleIRExecutorSpecialTargetDestroyHandlers';

export {
  trySpecialAddCounterStep,
  trySpecialRemoveCounterStep,
} from './oracleIRExecutorSpecialTargetAddRemoveCounterHandlers';

export {
  trySpecialRegenerateStep,
  trySpecialDealDamageStep,
  trySpecialPreventDamageStep,
} from './oracleIRExecutorSpecialTargetRegenerateDamageHandlers';

export { trySpecialDoubleCountersStep } from './oracleIRExecutorSpecialTargetDoubleCountersHandlers';

export { trySpecialSacrificeStep } from './oracleIRExecutorSpecialTargetSacrificeHandlers';

export { trySpecialCopyPermanentStep } from './oracleIRExecutorSpecialTargetCopyPermanentHandlers';

export {
  trySpecialExertStep,
  trySpecialTurnFaceDownStep,
  trySpecialTapOrUntapStep,
  trySpecialForceBlockStep,
  trySpecialSuspectStep,
} from './oracleIRExecutorSpecialTargetCombatStatusHandlers';

export {
  trySpecialMoveCountersStep,
  trySpecialScheduleDelayedBattlefieldActionStep,
} from './oracleIRExecutorSpecialTargetMoveCountersHandlers';

