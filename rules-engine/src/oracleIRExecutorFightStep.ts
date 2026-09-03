/**
 * Origin parent: rules-engine/src/oracleIRExecutorDamageStepHandlers.ts
 * Cluster: CR 701.14 fight — deal_damage steps whose oracle is "X fights Y"
 *   or "those creatures fight each other". The Batch391 special-target path
 *   logged a damage total without marking either creature, so Apex Altisaur
 *   (and Bushwhack-style fights) applied 1 IR step and left both alive.
 * Public: tryApplyFightDealDamageStep
 * Leaf must not import oracleIR.ts or oracleIRExecutorDamageStepHandlers.ts.
 */
import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolveSingleCreatureTargetId } from './oracleIRExecutorCreatureStepUtils';
import {
  addDamageToPermanentLikeCreatureFromSource,
  getExcessDamageToPermanent,
  isExecutorCreature,
} from './oracleIRExecutorPermanentUtils';
import {
  collectBoundIds,
  normalizeRaw,
  readPower,
  type SpecialTargetStepResult,
} from './oracleIRExecutorSpecialTargetOps';

export type FightDealDamageResult = SpecialTargetStepResult & {
  readonly excessDamageDealtThisWay?: number;
  readonly lastDamagedBattlefieldPermanentIds?: readonly string[];
};

function isFightDealDamageClause(raw: string): boolean {
  return /\bfights?\b/.test(raw);
}

function collectFightEachOtherIds(ctx: OracleIRExecutionContext): string[] {
  const ids = [
    ...(Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : []),
    ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds) ? ctx.lastAntecedentBattlefieldPermanentIds : []),
    ...collectBoundIds(ctx),
  ]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

function findCreature(state: GameState, id: string): any | undefined {
  const needle = String(id || '').trim();
  if (!needle) return undefined;
  return (state.battlefield || []).find((entry: any) => String(entry?.id || '').trim() === needle);
}

function applyDamageMap(
  state: GameState,
  damageById: Map<string, { amount: number; sourceId: string }>,
): {
  state: GameState;
  damagedIds: string[];
  excessDamageDealtThisWay: number;
  damageDealt: number;
} {
  let excessDamageDealtThisWay = 0;
  let damageDealt = 0;
  const damagedIds: string[] = [];
  const battlefield = (state.battlefield || []).map((permanent: any) => {
    const permanentId = String(permanent?.id || '').trim();
    const hit = damageById.get(permanentId);
    if (!hit || hit.amount <= 0 || !isExecutorCreature(permanent)) return permanent;
    damagedIds.push(permanentId);
    damageDealt += hit.amount;
    excessDamageDealtThisWay += getExcessDamageToPermanent(permanent, hit.amount);
    return addDamageToPermanentLikeCreatureFromSource(permanent, hit.amount, hit.sourceId);
  });
  return {
    state: { ...(state as any), battlefield } as GameState,
    damagedIds,
    excessDamageDealtThisWay,
    damageDealt,
  };
}

function addFightDamage(
  damageById: Map<string, { amount: number; sourceId: string }>,
  targetId: string,
  amount: number,
  sourceId: string,
): void {
  if (!targetId || amount <= 0) return;
  const previous = damageById.get(targetId);
  if (!previous) {
    damageById.set(targetId, { amount, sourceId });
    return;
  }
  damageById.set(targetId, {
    amount: previous.amount + amount,
    sourceId: previous.sourceId || sourceId,
  });
}

function fightSourceIsSelfReferent(step: Extract<OracleEffectStep, { kind: 'deal_damage' }>): boolean {
  const source = step.source as { kind?: string; text?: string } | undefined;
  const text = source?.kind === 'raw' ? String(source.text || '').trim().toLowerCase() : '';
  return text === 'it'
    || text === 'this creature'
    || text === 'this permanent'
    || text === 'that creature';
}

function resolveSourceCreatureId(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'deal_damage' }>,
  ctx: OracleIRExecutionContext,
): string {
  // "It fights …" is the trigger source, not the bound fight target in chosenObjectIds.
  if (fightSourceIsSelfReferent(step)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = findCreature(state, sourceId);
    if (source && isExecutorCreature(source)) return sourceId;
  }
  const fromSelector = resolveSingleCreatureTargetId(state, step.source as any, ctx);
  if (fromSelector) return fromSelector;
  const sourceId = String(ctx.sourceId || '').trim();
  const source = findCreature(state, sourceId);
  if (source && isExecutorCreature(source)) return sourceId;
  return '';
}

export function tryApplyFightDealDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'deal_damage' }>,
  ctx: OracleIRExecutionContext,
): FightDealDamageResult | null {
  const raw = normalizeRaw(step);
  if (!isFightDealDamageClause(raw)) return null;

  const targetText =
    step.target?.kind === 'raw' ? String(step.target.text || '').trim().toLowerCase() : '';
  const fightEachOther = /those creatures fight each other/.test(raw) || targetText === 'each other';

  if (fightEachOther) {
    const fighters = collectFightEachOtherIds(ctx)
      .map((id) => findCreature(state, id))
      .filter((entry) => entry && isExecutorCreature(entry));
    if (fighters.length < 2) {
      return {
        applied: true,
        state,
        log: ['Fight fizzled (fewer than two creatures)'],
        count: 0,
        excessDamageDealtThisWay: 0,
        lastDamagedBattlefieldPermanentIds: [],
      };
    }
    const damageById = new Map<string, { amount: number; sourceId: string }>();
    for (const attacker of fighters) {
      const attackerId = String(attacker?.id || '').trim();
      const power = readPower(attacker) ?? 0;
      for (const defender of fighters) {
        const defenderId = String(defender?.id || '').trim();
        if (!attackerId || !defenderId || attackerId === defenderId) continue;
        addFightDamage(damageById, defenderId, power, attackerId);
      }
    }
    const applied = applyDamageMap(state, damageById);
    return {
      applied: true,
      state: applied.state,
      log: [`${fighters.length} creature(s) fought each other`],
      count: applied.damageDealt,
      excessDamageDealtThisWay: applied.excessDamageDealtThisWay,
      lastDamagedBattlefieldPermanentIds: applied.damagedIds,
    };
  }

  const attackerId = resolveSourceCreatureId(state, step, ctx);
  const defenderId = String(resolveSingleCreatureTargetId(state, step.target as any, ctx) || '').trim();
  if (!attackerId || !defenderId) {
    return {
      applied: true,
      state,
      log: ['Fight fizzled (missing creature)'],
      count: 0,
      excessDamageDealtThisWay: 0,
      lastDamagedBattlefieldPermanentIds: [],
    };
  }

  const attacker = findCreature(state, attackerId);
  const defender = findCreature(state, defenderId);
  if (!attacker || !defender || !isExecutorCreature(attacker) || !isExecutorCreature(defender)) {
    return {
      applied: true,
      state,
      log: ['Fight fizzled (creature left battlefield)'],
      count: 0,
      excessDamageDealtThisWay: 0,
      lastDamagedBattlefieldPermanentIds: [],
    };
  }

  const damageById = new Map<string, { amount: number; sourceId: string }>();
  if (attackerId === defenderId) {
    addFightDamage(damageById, attackerId, (readPower(attacker) ?? 0) * 2, attackerId);
  } else {
    addFightDamage(damageById, defenderId, readPower(attacker) ?? 0, attackerId);
    addFightDamage(damageById, attackerId, readPower(defender) ?? 0, defenderId);
  }
  const applied = applyDamageMap(state, damageById);
  return {
    applied: true,
    state: applied.state,
    log: [`${attackerId} fought ${defenderId}`],
    count: applied.damageDealt,
    excessDamageDealtThisWay: applied.excessDamageDealtThisWay,
    lastDamagedBattlefieldPermanentIds: applied.damagedIds,
  };
}
