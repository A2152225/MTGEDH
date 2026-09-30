/**
 * Origin parent: oracleIRExecutorSpecialTargetHandlersBatch389Bulk.ts (tryBatch389DealDamageStep).
 * Cluster: bound-target damage from the ability's own source that used to only write a log line:
 *   - "This permanent deals N damage to that creature."  (marks damage on the bound creature)
 *   - "This permanent deals that much damage to target player or planeswalker."  (life loss / loyalty loss)
 * "That much" reads the reference amount carried by the executor; a printed number wins over it.
 * Damage goes through the same prevention preview as every other damage step.
 * Leaf must not import oracleIR.ts or oracleIRExecutorDamageStepHandlers.ts.
 */
import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { previewPreventedDamage } from './oracleIRDamagePrevention';
import {
  addDamageToPermanentLikeCreatureFromSource,
  hasExecutorClass,
  removeLoyaltyFromPlaneswalker,
} from './oracleIRExecutorPermanentUtils';
import { adjustLife, quantityToNumber } from './oracleIRExecutorPlayerUtils';
import { collectBoundIds } from './oracleIRExecutorSpecialTargetOps';

type DealDamageStep = Extract<OracleEffectStep, { kind: 'deal_damage' }>;

export type BoundTargetDamageResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly count?: number;
  readonly lastDamagedBattlefieldPermanentIds?: readonly string[];
};

function findPermanent(state: GameState, id: string): any | undefined {
  const needle = String(id || '').trim();
  if (!needle) return undefined;
  return ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === needle);
}

/** Printed number wins ("deals 3 damage"), then "that much", then the resolved step amount. */
function resolveBoundDamageAmount(
  raw: string,
  step: DealDamageStep,
  ctx: OracleIRExecutionContext,
  amount: number,
): number {
  const printed = raw.match(/deals (\d+) damage/i);
  if (printed) return Math.max(0, Number(printed[1]));
  if (/deals that much damage/i.test(raw)) {
    const reference = Number((ctx as any).lastReferenceAmount ?? ctx.referenceAmount);
    if (Number.isFinite(reference)) return Math.max(0, reference);
  }
  if (Number.isFinite(amount) && amount > 0) return Math.max(0, amount);
  const fromStep = quantityToNumber((step as any).amount, ctx);
  return fromStep !== null && Number.isFinite(fromStep) ? Math.max(0, fromStep) : Math.max(0, Number(amount) || 0);
}

function markDamageOnPermanent(
  state: GameState,
  permanentId: string,
  damage: number,
  sourceId: string | undefined,
): { state: GameState; log: string[]; dealt: number } {
  const prevention = previewPreventedDamage(state, damage, sourceId, { targetPermanentId: permanentId });
  const base = prevention.state ?? state;
  const log = [...prevention.log];
  const dealt = Math.max(0, Number(prevention.remainingDamage ?? damage));
  if (dealt <= 0) {
    log.push(`All damage to ${permanentId} was prevented`);
    return { state: base, log, dealt: 0 };
  }
  const battlefield = ((base.battlefield || []) as any[]).map((perm) => {
    if (String(perm?.id || '').trim() !== permanentId) return perm;
    if (hasExecutorClass(perm, 'planeswalker') && !hasExecutorClass(perm, 'creature')) {
      return removeLoyaltyFromPlaneswalker(perm, dealt);
    }
    return addDamageToPermanentLikeCreatureFromSource(perm, dealt, sourceId);
  });
  return { state: { ...(base as any), battlefield } as GameState, log, dealt };
}

/** "This permanent deals N damage to that creature." */
export function applySourceDamageToThatCreatureStep(
  state: GameState,
  step: DealDamageStep,
  ctx: OracleIRExecutionContext,
  raw: string,
  amount: number,
): BoundTargetDamageResult {
  const candidates = [
    ...collectBoundIds(ctx),
    String(ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || '').trim(),
  ].filter(Boolean);
  const targetId = candidates.find((id) => {
    const perm = findPermanent(state, id);
    return perm && hasExecutorClass(perm, 'creature');
  });
  const damage = resolveBoundDamageAmount(raw, step, ctx, amount);
  if (!targetId) {
    return { applied: true, state, log: [`No creature to deal damage to: ${step.raw}`], count: 0 };
  }
  if (damage <= 0) {
    return { applied: true, state, log: [`No damage dealt to ${targetId}: ${step.raw}`], count: 0 };
  }
  const sourceId = String(ctx.sourceId || '').trim() || undefined;
  const result = markDamageOnPermanent(state, targetId, damage, sourceId);
  const log = [...result.log];
  if (result.dealt > 0) log.push(`${sourceId || 'Source'} dealt ${result.dealt} damage to ${targetId}`);
  return {
    applied: true,
    state: result.state,
    log,
    count: result.dealt,
    ...(result.dealt > 0 ? { lastDamagedBattlefieldPermanentIds: [targetId] } : {}),
  };
}

/** "This permanent deals that much damage to target player or planeswalker." */
export function applySourceDamageToPlayerOrPlaneswalkerStep(
  state: GameState,
  step: DealDamageStep,
  ctx: OracleIRExecutionContext,
  raw: string,
  amount: number,
): BoundTargetDamageResult {
  const damage = resolveBoundDamageAmount(raw, step, ctx, amount);
  const sourceId = String(ctx.sourceId || '').trim() || undefined;

  const planeswalkerId = collectBoundIds(ctx).find((id) => {
    const perm = findPermanent(state, id);
    return perm && hasExecutorClass(perm, 'planeswalker');
  });
  if (planeswalkerId) {
    if (damage <= 0) {
      return { applied: true, state, log: [`No damage dealt to ${planeswalkerId}: ${step.raw}`], count: 0 };
    }
    const result = markDamageOnPermanent(state, planeswalkerId, damage, sourceId);
    const log = [...result.log];
    if (result.dealt > 0) log.push(`${sourceId || 'Source'} dealt ${result.dealt} damage to ${planeswalkerId}`);
    return {
      applied: true,
      state: result.state,
      log,
      count: result.dealt,
      ...(result.dealt > 0 ? { lastDamagedBattlefieldPermanentIds: [planeswalkerId] } : {}),
    };
  }

  const playerId = String(
    ctx.selectorContext?.targetPlayerId ||
      ctx.targetPlayerId ||
      ctx.selectorContext?.targetOpponentId ||
      '',
  ).trim() as PlayerID;
  if (!playerId || !state.players.some((player) => player.id === playerId)) {
    return { applied: true, state, log: [`No player or planeswalker to deal damage to: ${step.raw}`], count: 0 };
  }
  if (damage <= 0) {
    return { applied: true, state, log: [`No damage dealt to ${playerId}: ${step.raw}`], count: 0 };
  }
  const prevention = previewPreventedDamage(state, damage, sourceId, { targetPlayerId: playerId });
  const base = prevention.state ?? state;
  const log = [...prevention.log];
  const dealt = Math.max(0, Number(prevention.remainingDamage ?? damage));
  if (dealt <= 0) {
    log.push(`All damage to ${playerId} was prevented: ${step.raw}`);
    return { applied: true, state: base, log, count: 0 };
  }
  const life = adjustLife(base, playerId, -dealt);
  log.push(...life.log, `${playerId} is dealt ${dealt} damage`);
  return { applied: true, state: life.state, log, count: dealt };
}