import type { PlayerID } from '../../../../shared/src/index.js';
import type { OraclePlayerSelector, OracleQuantity } from '../../../../rules-engine/src/oracleIR.js';
import { resolveOracleQuantity } from '../../../../rules-engine/src/oracleIRExecutor.js';
import type { OracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';
import { resolvePlayers } from '../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';

export function buildStackOracleIRContext(
  caster: PlayerID,
  options?: {
    xValue?: number;
    sourceId?: string;
    targetPlayerId?: PlayerID;
    targetOpponentId?: PlayerID;
    referenceAmount?: number;
  },
): OracleIRExecutionContext {
  return {
    controllerId: caster,
    sourceId: options?.sourceId,
    xValue: options?.xValue,
    ...(typeof options?.referenceAmount === 'number' && Number.isFinite(options.referenceAmount)
      ? { referenceAmount: Math.max(0, Math.floor(options.referenceAmount)) }
      : {}),
    selectorContext: {
      ...(options?.targetPlayerId ? { targetPlayerId: options.targetPlayerId } : {}),
      ...(options?.targetOpponentId ? { targetOpponentId: options.targetOpponentId } : {}),
    },
  };
}

export function resolveOracleQuantityToNumber(
  q: OracleQuantity,
  xValue?: number,
  options?: {
    state?: any;
    controllerId?: PlayerID;
    sourceId?: string;
    targetPlayerId?: PlayerID;
    referenceAmount?: number;
    whereX?: { kind: 'where'; raw: string };
  },
): number | null {
  if (!q) return null;
  const state = options?.state;
  const controllerId = (options?.controllerId || '') as PlayerID;
  if (!state || !controllerId) {
    if (q.kind === 'number') return Number.isFinite(q.value) ? q.value : null;
    if (q.kind === 'x') return typeof xValue === 'number' && Number.isFinite(xValue) ? xValue : null;
    return null;
  }

  const ctx = buildStackOracleIRContext(controllerId, {
    xValue,
    sourceId: options?.sourceId,
    targetPlayerId: options?.targetPlayerId,
    referenceAmount: options?.referenceAmount,
  });

  return resolveOracleQuantity(state, controllerId, q, ctx, {
    whereX: options?.whereX,
  });
}

export function resolveOracleWhoToPlayerIds(
  who: OraclePlayerSelector,
  caster: PlayerID,
  state: any,
  irCtx?: OracleIRExecutionContext,
): PlayerID[] {
  const ctx =
    irCtx ||
    buildStackOracleIRContext(caster, {
      sourceId: undefined,
    });
  return [...resolvePlayers(state, who, ctx)];
}
