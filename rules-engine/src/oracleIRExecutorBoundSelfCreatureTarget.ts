/**
 * Origin: oracleIRExecutorCreatureStepUtils.resolveSingleCreatureTargetId
 * Cluster: "this creature" / "this permanent" when sourceId is not the affected creature
 * (ability or spell source vs bound targetPermanentId / targetCreatureId).
 * Public: resolveBoundSelfOrSourceCreatureTargetId
 */

import type { GameState } from '../../shared/src';
import type { OracleObjectSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolveSingleCreatureTargetId, getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { isExecutorCreature } from './oracleIRExecutorPermanentUtils';
import { normalizeOracleText } from './oracleIRExecutorPlayerUtils';

function isSelfReferencedCreatureTargetText(text: string): boolean {
  const normalized = normalizeOracleText(text).trim().toLowerCase();
  return (
    normalized === 'this creature'
    || normalized === 'this permanent'
    || normalized === 'this'
  );
}

/**
 * Resolve a connive / explore / self-referenced creature target.
 * Prefer the battlefield source, then bound targetPermanentId / targetCreatureId.
 */
export function resolveBoundSelfOrSourceCreatureTargetId(
  state: GameState,
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext,
): string | undefined {
  const resolved = resolveSingleCreatureTargetId(state, target, ctx);
  if (resolved) return resolved;
  if (target.kind !== 'raw') return undefined;
  if (!isSelfReferencedCreatureTargetText(target.text)) return undefined;

  const battlefield = getProcessedBattlefield(state);
  const candidates = [
    String(ctx.targetPermanentId || '').trim(),
    String(ctx.targetCreatureId || '').trim(),
    String(ctx.selectorContext?.targetPermanentId || '').trim(),
    String(ctx.selectorContext?.targetCreatureId || '').trim(),
    String(ctx.lastReferencedPermanentId || '').trim(),
  ].filter(Boolean);

  const seen = new Set<string>();
  for (const candidateId of candidates) {
    if (seen.has(candidateId)) continue;
    seen.add(candidateId);
    const matched = battlefield.find(
      (permanent) => String((permanent as any)?.id || '').trim() === candidateId,
    );
    if (matched && isExecutorCreature(matched)) {
      return candidateId;
    }
  }

  return undefined;
}
