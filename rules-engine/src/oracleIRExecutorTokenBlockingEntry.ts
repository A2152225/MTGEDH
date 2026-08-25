/**
 * Extracted from oracleIRExecutorTokenStepHandlers.ts.
 * Cluster: applyBlockingEntryToCreatedTokens and resolveBlockTargetPermanentId.
 * Public: applyBlockingEntryToCreatedTokens, resolveBlockTargetPermanentId.
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

function applyBlockingEntryToCreatedTokens(
  state: GameState,
  createdTokenIds: readonly string[],
  blockTargetPermanentId: string,
): GameState {
  const normalizedBlockTarget = String(blockTargetPermanentId || '').trim();
  if (!normalizedBlockTarget || createdTokenIds.length === 0) return state;

  const battlefield = [...(state.battlefield || [])] as any[];
  for (const tokenId of createdTokenIds) {
    const normalizedTokenId = String(tokenId || '').trim();
    if (!normalizedTokenId) continue;
    const token = battlefield.find((perm) => String(perm?.id || '').trim() === normalizedTokenId);
    if (!token) continue;
    token.blocking = [normalizedBlockTarget];
    token.summoningSickness = false;
    const attacker = battlefield.find((perm) => String(perm?.id || '').trim() === normalizedBlockTarget);
    if (attacker) {
      attacker.blockedBy = Array.isArray(attacker.blockedBy) ? attacker.blockedBy : [];
      if (!attacker.blockedBy.includes(normalizedTokenId)) {
        attacker.blockedBy.push(normalizedTokenId);
      }
    }
  }

  return { ...state, battlefield } as GameState;
}

function resolveBlockTargetPermanentId(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_token' }>,
  ctx: OracleIRExecutionContext,
): string | undefined {
  if (step.blocking !== 'that_creature') return undefined;

  const explicitTarget = String(
    ctx.selectorContext?.targetPermanentId ||
      ctx.targetPermanentId ||
      ctx.selectorContext?.targetCreatureId ||
      ctx.targetCreatureId ||
      '',
  ).trim();
  if (explicitTarget) return explicitTarget;

  const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (chosenIds.length === 1) return chosenIds[0];

  const sourceId = String(ctx.sourceId || '').trim();
  const sourcePermanent = (state.battlefield || []).find(
    (perm: any) => String(perm?.id || '').trim() === sourceId,
  ) as any;
  const blockingTarget = Array.isArray(sourcePermanent?.blocking)
    ? String(sourcePermanent.blocking[0] || '').trim()
    : '';
  return blockingTarget || undefined;
}

export {
  applyBlockingEntryToCreatedTokens,
  resolveBlockTargetPermanentId,
};
