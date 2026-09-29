/**
 * Origin parents: oracleIRExecutorSpecialTargetHandlersBatch389Bulk.ts (self-damage) and
 *   oracleIRExecutorSpecialTargetHandlersBatch391Bulk.ts (damage to a creature's controller).
 * Cluster: "damage equal to its power" steps that previously only logged a number.
 *   - "Target creature deals damage to itself equal to its power" (Justice Strike, Repentance,
 *     Kiku's Shadow, Wisecrack, Cut Propulsion ...): marks damage on that creature, using its
 *     current power (anthems, pumps, counters, P/T-setting effects).
 *   - "... deals damage to that creature's controller equal to the creature's power"
 *     (Boros Fury-Shield, Kaervek's Purge, Cinder Cloud): the controller loses life. A creature that
 *     was just destroyed/sacrificed uses its recorded (last known) power; a creature still on the
 *     battlefield uses its current power.
 * Public: applySelfDamageEqualToPowerStep, applyControllerDamageEqualToCreaturePowerStep
 * Leaf must not import oracleIR.ts or oracleIRExecutorDamageStepHandlers.ts.
 */
import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { previewPreventedDamage } from './oracleIRDamagePrevention';
import { resolveSingleCreatureTargetId } from './oracleIRExecutorCreatureStepUtils';
import { readCurrentPower } from './oracleIRExecutorCurrentPowerToughness';
import {
  addDamageToPermanentLikeCreatureFromSource,
  isExecutorCreature,
} from './oracleIRExecutorPermanentUtils';
import { adjustLife } from './oracleIRExecutorPlayerUtils';
import { collectBoundIds } from './oracleIRExecutorSpecialTargetOps';

type DealDamageStep = Extract<OracleEffectStep, { kind: 'deal_damage' }>;

export type PowerBasedDamageResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly count?: number;
  readonly lastDamagedBattlefieldPermanentIds?: readonly string[];
};

function findBattlefieldPermanent(state: GameState, id: string): any | undefined {
  const needle = String(id || '').trim();
  if (!needle) return undefined;
  return ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === needle);
}

function isCreatureLike(entry: any): boolean {
  const typeLine = String(entry?.type_line || entry?.card?.type_line || '').toLowerCase();
  return typeLine.includes('creature');
}

function resolveSelfDamageCreatureId(state: GameState, step: DealDamageStep, ctx: OracleIRExecutionContext): string {
  try {
    const fromSelector = resolveSingleCreatureTargetId(state, step.source as any, ctx);
    if (fromSelector && findBattlefieldPermanent(state, fromSelector)) return fromSelector;
  } catch {
    // fall back to bound ids below
  }
  const candidates = [
    ...collectBoundIds(ctx),
    String(ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || '').trim(),
  ].filter(Boolean);
  return candidates.find((id) => {
    const perm = findBattlefieldPermanent(state, id);
    return perm && isExecutorCreature(perm);
  }) || '';
}

/**
 * "Target creature deals damage to itself equal to its power." With a multiplier of 2 this is the
 * "if it has flying, it deals twice that much damage to itself instead" replacement (Cut Propulsion).
 */
export function applySelfDamageEqualToPowerStep(
  state: GameState,
  step: DealDamageStep,
  ctx: OracleIRExecutionContext,
  multiplier = 1,
): PowerBasedDamageResult {
  const creatureId = resolveSelfDamageCreatureId(state, step, ctx);
  const creature = creatureId ? findBattlefieldPermanent(state, creatureId) : undefined;
  if (!creature) {
    return { applied: true, state, log: [`No creature to deal damage to itself: ${step.raw}`], count: 0 };
  }
  const power = Math.max(0, Number(readCurrentPower(state, creature, ctx) ?? 0)) * Math.max(1, multiplier);
  if (power <= 0) {
    return { applied: true, state, log: [`${creatureId} has no power; no damage dealt: ${step.raw}`], count: 0 };
  }
  const prevention = previewPreventedDamage(state, power, creatureId, { targetPermanentId: creatureId });
  let nextState = prevention.state ?? state;
  const log = [...prevention.log];
  const finalAmount = Math.max(0, Number(prevention.remainingDamage ?? power));
  if (finalAmount <= 0) {
    log.push(`All damage to ${creatureId} was prevented: ${step.raw}`);
    return { applied: true, state: nextState, log, count: 0 };
  }
  nextState = {
    ...(nextState as any),
    battlefield: ((nextState.battlefield || []) as any[]).map((perm) =>
      String(perm?.id || '').trim() === creatureId
        ? addDamageToPermanentLikeCreatureFromSource(perm, finalAmount, creatureId)
        : perm,
    ),
  } as GameState;
  log.push(
    multiplier > 1
      ? `${creatureId} dealt ${finalAmount} damage to itself (${multiplier}x its power)`
      : `${creatureId} dealt ${finalAmount} damage to itself (equal to its power)`,
  );
  return { applied: true, state: nextState, log, count: finalAmount, lastDamagedBattlefieldPermanentIds: [creatureId] };
}

function findReferencedCreature(
  state: GameState,
  ctx: OracleIRExecutionContext,
): { readonly creature: any; readonly onBattlefield: boolean } | null {
  const snapshots = [
    ...(Array.isArray((ctx as any)?.lastDestroyedPermanents) ? (ctx as any).lastDestroyedPermanents : []),
    ...(Array.isArray((ctx as any)?.lastSacrificedPermanents) ? (ctx as any).lastSacrificedPermanents : []),
    ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
  ];
  const snapshot = snapshots.find((entry) => isCreatureLike(entry) && !findBattlefieldPermanent(state, entry?.id));
  if (snapshot) return { creature: snapshot, onBattlefield: false };

  const ids = [
    String(ctx.targetCreatureId || '').trim(),
    String(ctx.selectorContext?.targetCreatureId || '').trim(),
    ...collectBoundIds(ctx),
  ].filter(Boolean);
  for (const id of ids) {
    const perm = findBattlefieldPermanent(state, id);
    if (perm && isExecutorCreature(perm)) return { creature: perm, onBattlefield: true };
  }
  return null;
}

/** "... deals damage to that creature's controller equal to the creature's power." */
export function applyControllerDamageEqualToCreaturePowerStep(
  state: GameState,
  step: DealDamageStep,
  ctx: OracleIRExecutionContext,
): PowerBasedDamageResult | null {
  const referenced = findReferencedCreature(state, ctx);
  if (!referenced) return null;
  const { creature } = referenced;
  const controllerId = String(creature?.controller || creature?.owner || '').trim() as PlayerID;
  if (!controllerId) return null;
  const power = Math.max(0, Number(readCurrentPower(state, creature, ctx) ?? 0));
  if (power <= 0) {
    return { applied: true, state, log: [`Creature power is 0; no damage to ${controllerId}: ${step.raw}`], count: 0 };
  }
  const damageSourceId = String(ctx.sourceId || '').trim() || undefined;
  const prevention = previewPreventedDamage(state, power, damageSourceId, { targetPlayerId: controllerId });
  let nextState = prevention.state ?? state;
  const log = [...prevention.log];
  const finalAmount = Math.max(0, Number(prevention.remainingDamage ?? power));
  if (finalAmount <= 0) {
    log.push(`All damage to ${controllerId} was prevented: ${step.raw}`);
    return { applied: true, state: nextState, log, count: 0 };
  }
  const life = adjustLife(nextState, controllerId, -finalAmount);
  nextState = life.state;
  log.push(...life.log, `${controllerId} is dealt ${finalAmount} damage (equal to the creature's power)`);
  return { applied: true, state: nextState, log, count: finalAmount };
}