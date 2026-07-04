import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { tryEvaluateCombatDamageReferenceCount } from './oracleIRExecutorCombatDamageCounts';

export function tryEvaluateModifyPtWhereCombatDamageCounts(params: {
  readonly state: GameState;
  readonly controllerId: PlayerID;
  readonly raw: string;
  readonly ctx?: OracleIRExecutionContext;
}): number | null {
  return tryEvaluateCombatDamageReferenceCount(
    params.state,
    params.controllerId,
    params.raw,
    params.ctx,
  );
}
