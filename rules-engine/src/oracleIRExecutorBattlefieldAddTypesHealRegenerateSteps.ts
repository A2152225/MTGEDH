// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyAddTypesStep, applyRemoveMarkedDamageStep, applyRegenerateStep.
// Public entries: those three apply* functions.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { resolveAttachedStaticAbilityGrantTargets } from './oracleIRExecutorBattlefieldAttachedGrantTargets';
import { appendPermanentTypes } from './oracleIRExecutorBattlefieldAppendPermanentTypes';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';
import { permanentMatchesSelector } from './oracleIRExecutorBattlefieldOps';
import { createRegenerationShield } from './keywordAbilities/regeneration';
import { trySpecialRegenerateStep } from './oracleIRExecutorSpecialTargetHandlers';

export function applyAddTypesStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_types' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const targets = resolveDirectBattlefieldPermanents((state.battlefield || []) as BattlefieldPermanent[], step.target as any, ctx);
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped add types (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const wantedIds = new Set(targets.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean));
  let changedCount = 0;

  for (let index = 0; index < battlefield.length; index += 1) {
    const permanent = battlefield[index] as BattlefieldPermanent;
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!wantedIds.has(permanentId)) continue;
    const nextPermanent = appendPermanentTypes(permanent, step.addTypes);
    if (nextPermanent !== permanent) {
      battlefield[index] = nextPermanent;
      changedCount += 1;
    }
  }

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield,
    } as GameState,
    log: [
      changedCount > 0
        ? `Added type(s) ${step.addTypes.join(', ')} to ${changedCount} permanent(s)`
        : `No type changes applied for ${step.raw}`,
    ],
  };
}

export function applyRemoveMarkedDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'remove_marked_damage' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult {
  const targets = resolveDirectBattlefieldPermanents(
    (state.battlefield || []) as BattlefieldPermanent[],
    step.target as any,
    ctx,
  );
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped heal (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const amount =
    step.amount === 'all'
      ? Number.POSITIVE_INFINITY
      : step.amount.kind === 'number'
        ? Math.max(0, step.amount.value)
        : null;
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped heal (unknown damage amount): ${step.raw}`,
      reason: 'unsupported_condition',
    };
  }

  const targetIds = new Set(targets.map((target: any) => String(target?.id || '').trim()).filter(Boolean));
  let healedCount = 0;
  const battlefield = ((state.battlefield || []) as BattlefieldPermanent[]).map((permanent: any) => {
    if (!targetIds.has(String(permanent?.id || '').trim())) return permanent;

    const reduceDamage = (value: unknown) => Math.max(0, (Number(value) || 0) - amount);
    const counters = { ...(permanent?.counters || {}) };
    if (Object.prototype.hasOwnProperty.call(counters, 'damage')) counters.damage = reduceDamage(counters.damage);
    healedCount += 1;
    return {
      ...permanent,
      ...(Object.prototype.hasOwnProperty.call(permanent, 'markedDamage')
        ? { markedDamage: reduceDamage(permanent.markedDamage) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(permanent, 'damageMarked')
        ? { damageMarked: reduceDamage(permanent.damageMarked) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(permanent, 'damage')
        ? { damage: reduceDamage(permanent.damage) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(counters, 'damage') ? { counters } : {}),
    } as BattlefieldPermanent;
  });

  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: [`Healed marked damage from ${healedCount} permanent(s)`],
  };
}

export { applyDestroyStep } from './oracleIRExecutorBattlefieldDestroyStep';


export function applyRegenerateStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'regenerate' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const special = trySpecialRegenerateStep(state, step, ctx);
  if (special) return special;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const attachedTargets = resolveAttachedStaticAbilityGrantTargets(battlefield, step.target as any, ctx);
  const selector = parseSimpleBattlefieldSelector(step.target as any);
  let targets = attachedTargets.length > 0
    ? attachedTargets
    : selector
    ? battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx))
    : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  if (targets.length === 0 && step.target?.kind === 'raw') {
    const targetText = normalizeBattlefieldTargetReferenceText(String(step.target.text || '')).trim();
    if (targetText) {
      const namedMatches = battlefield.filter((perm: any) => {
        const permName = String((perm as any)?.name || (perm as any)?.card?.name || '').trim().toLowerCase();
        const wanted = targetText.toLowerCase();
        return permName === wanted || permName.startsWith(`${wanted} `) || permName.includes(wanted);
      });
      if (namedMatches.length === 1) targets = namedMatches;
    }
  }
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped regenerate (unsupported target): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const controllerId = String(ctx.controllerId || '').trim();
  const existingShields = Array.isArray((state as any).regenerationShields)
    ? [...((state as any).regenerationShields as any[])]
    : [];
  const newShields = targets.map(perm =>
    createRegenerationShield(
      String((perm as any)?.id || '').trim(),
      controllerId || String((perm as any)?.controller || '').trim()
    )
  );

  return {
    applied: true,
    state: {
      ...(state as any),
      regenerationShields: [...existingShields, ...newShields],
    } as GameState,
    log: [`Created regeneration shield${newShields.length === 1 ? '' : 's'} for ${newShields.length} permanent(s)`],
  };
}

