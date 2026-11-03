import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';

/** Bind ctx.xValue for "If X is N or more" conditionals that follow a "where X is ..." clause. */
export function bindConditionalWhereX(
  step: any,
  state: GameState,
  controllerId: PlayerID,
  ctx: OracleIRExecutionContext,
): OracleIRExecutionContext {
  const whereRaw = String(step?.xWhereRaw || '').trim();
  if (!whereRaw) return ctx;
  if (typeof (ctx as any).xValue === 'number' && Number.isFinite((ctx as any).xValue)) return ctx;
  const value = evaluateModifyPtWhereX(state, controllerId, whereRaw, undefined, ctx);
  if (typeof value !== 'number' || !Number.isFinite(value)) return ctx;
  return { ...ctx, xValue: value } as OracleIRExecutionContext;
}
