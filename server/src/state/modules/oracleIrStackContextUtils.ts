import type { PlayerID } from '../../../../shared/src/index.js';
import type { OraclePlayerSelector, OracleQuantity } from '../../../../rules-engine/src/oracleIR.js';
import { buildOracleIRExecutionContext, resolveOracleQuantity } from '../../../../rules-engine/src/oracleIRExecutor.js';
import type { OracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';
import { resolvePlayers } from '../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';

export function buildStackOracleIRContext(
  caster: PlayerID,
  options?: {
    xValue?: number;
    sourceId?: string;
    targetPlayerId?: PlayerID;
    targetOpponentId?: PlayerID;
    targetPermanentId?: string;
    targetCreatureId?: string;
    targetSpellId?: string;
    chosenObjectIds?: readonly string[];
    referenceAmount?: number;
    lastAntecedentBattlefieldPermanentIds?: readonly string[];
    chosenCreatureType?: string;
  },
): OracleIRExecutionContext {
  const antecedentIds = Array.isArray(options?.lastAntecedentBattlefieldPermanentIds)
    ? options.lastAntecedentBattlefieldPermanentIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const chosenCreatureType = String(options?.chosenCreatureType || '').trim();

  return buildOracleIRExecutionContext(
    {
      controllerId: caster,
      sourceId: options?.sourceId,
      xValue: options?.xValue,
      ...(options?.targetPermanentId ? { targetPermanentId: options.targetPermanentId } : {}),
      ...(options?.targetCreatureId ? { targetCreatureId: options.targetCreatureId } : {}),
      ...(options?.targetSpellId ? { targetSpellId: options.targetSpellId } : {}),
      ...(typeof options?.referenceAmount === 'number' && Number.isFinite(options.referenceAmount)
        ? { referenceAmount: Math.max(0, Math.floor(options.referenceAmount)) }
        : {}),
      ...(antecedentIds.length > 0 ? { lastAntecedentBattlefieldPermanentIds: antecedentIds } : {}),
      ...(chosenCreatureType ? { chosenCreatureType } : {}),
      selectorContext: {
        ...(options?.targetPlayerId ? { targetPlayerId: options.targetPlayerId } : {}),
        ...(options?.targetOpponentId ? { targetOpponentId: options.targetOpponentId } : {}),
        ...(options?.targetPermanentId ? { targetPermanentId: options.targetPermanentId } : {}),
        ...(options?.targetCreatureId ? { targetCreatureId: options.targetCreatureId } : {}),
        ...(options?.targetSpellId ? { targetSpellId: options.targetSpellId } : {}),
        ...(options?.chosenObjectIds?.length ? { chosenObjectIds: options.chosenObjectIds } : {}),
        ...(antecedentIds.length > 0 ? { lastAntecedentBattlefieldPermanentIds: antecedentIds } : {}),
        ...(chosenCreatureType ? { chosenCreatureType } : {}),
      },
    },
    {
      targetPlayerId: options?.targetPlayerId,
      targetOpponentId: options?.targetOpponentId,
      targetPermanentId: options?.targetPermanentId,
      targetCreatureId: options?.targetCreatureId,
      targetSpellId: options?.targetSpellId,
      chosenObjectIds: options?.chosenObjectIds,
      referenceAmount: options?.referenceAmount,
    },
  );
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
