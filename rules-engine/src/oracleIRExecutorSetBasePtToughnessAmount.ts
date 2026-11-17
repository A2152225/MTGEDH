/**
 * Origin parent: oracleIRExecutorModifyPtStepHandlers.ts (`applySetBasePtStep`).
 * Cluster: resolving `set_base_pt.toughnessAmount` ("base toughness becomes equal to 1 plus the number of
 *   creature cards in your graveyard") at execution time.
 * Public entry: resolveSetBasePtToughnessAmount.
 */

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleQuantity } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import { resolveOracleQuantity } from './oracleIRExecutorResolveQuantity';

/** Returns a non-negative toughness, or null when the amount text cannot be resolved. */
export function resolveSetBasePtToughnessAmount(
  state: GameState,
  amount: OracleQuantity,
  ctx: OracleIRExecutionContext,
): number | null {
  const controllerId = String(ctx.controllerId || '').trim() as PlayerID;
  if (!controllerId) return null;

  const resolved = resolveOracleQuantity(state, controllerId, amount, ctx);
  if (resolved !== null) return Math.max(0, Math.floor(resolved));

  if (amount.kind !== 'reference_amount') return null;
  const raw = String(amount.raw || '').trim().toLowerCase();
  if (!raw) return null;
  const evaluated = evaluateModifyPtWhereX(state, controllerId, raw.startsWith('x is ') ? raw : `x is ${raw}`, undefined, ctx);
  return evaluated === null ? null : Math.max(0, Math.floor(evaluated));
}
