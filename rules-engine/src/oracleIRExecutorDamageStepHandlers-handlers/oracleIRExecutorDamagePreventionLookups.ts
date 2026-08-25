/**
 * Origin parent: oracleIRExecutorDamageStepHandlers.ts
 * Cluster moved: resolvePreventionRecipientPermanentId, resolvePreventionTargetSourceId,
 *   findSourceObject
 * Public: resolvePreventionRecipientPermanentId, resolvePreventionTargetSourceId,
 *   findSourceObject
 */

import type { GameState } from '../../../shared/src';
import type { OracleEffectStep } from '../oracleIR';
import type { OracleIRExecutionContext } from '../oracleIRExecutionTypes';
import { hasExecutorClass } from '../oracleIRExecutorPermanentUtils';
import { getStackItems } from '../stackOperations';
import { resolveSinglePermanentDamageTargetId } from './oracleIRExecutorDamagePermanentTarget';

export function resolvePreventionRecipientPermanentId(
  state: GameState,
  target: Extract<OracleEffectStep, { kind: 'prevent_damage' }>['recipientTarget'],
  ctx: OracleIRExecutionContext
): string | undefined {
  if (!target) return undefined;

  const anyTargetId = resolveSinglePermanentDamageTargetId(state, target as any, ctx);
  if (anyTargetId) return anyTargetId;

  const candidateIds = [
    String(ctx.targetPermanentId || '').trim(),
    String(ctx.targetCreatureId || '').trim(),
    ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) && ctx.selectorContext.chosenObjectIds.length === 1
      ? [String(ctx.selectorContext.chosenObjectIds[0] || '').trim()]
      : []),
  ].filter(Boolean);

  const battlefield = (state.battlefield || []) as any[];
  for (const candidateId of candidateIds) {
    const matched = battlefield.find(permanent => String((permanent as any)?.id || '').trim() === candidateId);
    if (!matched) continue;
    if (
      hasExecutorClass(matched, 'creature') ||
      hasExecutorClass(matched, 'planeswalker') ||
      hasExecutorClass(matched, 'battle')
    ) {
      return candidateId;
    }
  }

  return undefined;
}

export function resolvePreventionTargetSourceId(state: GameState, ctx: OracleIRExecutionContext): string | null {
  const explicitSourceId = String((ctx.selectorContext as any)?.targetSourceId || (ctx.selectorContext as any)?.chosenSourceId || '').trim();
  if (explicitSourceId) return explicitSourceId;

  const directTargetId = String(ctx.targetPermanentId || '').trim();
  if (directTargetId) return directTargetId;

  const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [];
  if (chosenObjectIds.length === 1) {
    const chosenId = String(chosenObjectIds[0] || '').trim();
    if (chosenId) return chosenId;
  }

  return null;
}

export function findSourceObject(state: GameState, sourceId: string): any | null {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return null;

  const battlefieldMatch = (state.battlefield || []).find(
    (permanent: any) => String((permanent as any)?.id || '').trim() === normalizedSourceId
  );
  if (battlefieldMatch) return battlefieldMatch;

  const stackMatch = getStackItems((state as any)?.stack).find(
    (item: any) => String((item as any)?.id || '').trim() === normalizedSourceId
  );
  if (stackMatch) return stackMatch;

  return null;
}

