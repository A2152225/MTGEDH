// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applySuspectStep, applyDetainStep, applyCantBlockStep.
// Public entries: applySuspectStep, applyDetainStep, applyCantBlockStep.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  BattlefieldStepHandlerResult,
  RecentBattlefieldRuntime,
} from './oracleIRExecutorBattlefieldStepTypes';
import { resolveAttachedStaticAbilityGrantTargets } from './oracleIRExecutorBattlefieldAttachedGrantTargets';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { readCharacteristicNumber } from './oracleIRExecutorBattlefieldCharacteristicNumber';
import { buildContextualBattlefieldTargetIds } from './oracleIRExecutorBattlefieldContextualTargets';
import {
  battlefieldPermanentHasFlying,
  permanentHasColorLetter,
} from './oracleIRExecutorBattlefieldPermanentMatchers';
import { permanentIsMonocolored } from './oracleIRExecutorBattlefieldPermanentKindPredicates';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { resolveRecentlyMovedBattlefieldPermanents } from './oracleIRExecutorBattlefieldRecentlyMoved';
import { typeLineHasSubtype } from './oracleIRExecutorBattlefieldSubtypeUtils';
import { applyTemporaryEffectToPermanents } from './oracleIRExecutorBattlefieldTemporaryEffects';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { trySpecialSuspectStep } from './oracleIRExecutorSpecialTargetHandlers';
import { effectiveStepTarget } from './oracleIRExecutorExtendedTargetResolution';

export function applySuspectStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'suspect' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const special = trySpecialSuspectStep(state, step, ctx, runtime);
  if (special) return special;

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const effectiveTarget = effectiveStepTarget(step);
  const attachedTargets = resolveAttachedStaticAbilityGrantTargets(battlefield, effectiveTarget as any, ctx);
  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, effectiveTarget as any, runtime);
  const directTargets =
    attachedTargets.length > 0
      ? []
      : recentTargets.length > 0
        ? []
        : resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
  const targets = attachedTargets.length > 0 ? attachedTargets : [...recentTargets, ...directTargets];
  const targetIds = Array.from(
    new Set(targets.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean))
  );

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped suspect (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return perm;
    return {
      ...perm,
      isSuspected: true,
    } as BattlefieldPermanent;
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log: [`Suspected ${targetIds.length} permanent(s)`],
  };
}

export function applyDetainStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'detain' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const targets = resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped detain (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targets.length > 1 && /^target\b/i.test(String((step.target as any)?.text || '').trim())) {
    return {
      applied: false,
      message: `Skipped detain (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
    descriptions: ["can't attack", "can't block", "activated abilities can't be activated"],
    expiresAt: 'leaves_battlefield',
    expiresOnControllerTurn: controllerId,
  });

  return {
    applied: true,
    state: nextState,
    log: [`Detained ${targets.length} permanent(s)`],
  };
}

export function applyCantBlockStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'cant_block' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const duration = step.duration as 'end_of_turn' | 'static' | 'until_next_turn';
  if (
    duration &&
    duration !== 'end_of_turn' &&
    duration !== 'static' &&
    duration !== 'until_next_turn'
  ) {
    return {
      applied: false,
      message: `Skipped cant_block static restriction (continuous text handled elsewhere): ${step.raw}`,
      reason: 'unsupported_condition',
    };
  }

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const effectiveTarget = effectiveStepTarget(step);
  const targetText = String((effectiveTarget as any)?.text || '').trim().toLowerCase();

  if (
    /^beasts can't block$/i.test(targetText) ||
    targetText === 'beasts' ||
    /beasts can't block/i.test(String(step.raw || ''))
  ) {
    const creatures = battlefield.filter(
      (perm: any) => permanentMatchesType(perm, 'creature') && typeLineHasSubtype(perm, 'beast')
    );
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No Beasts to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return { applied: true, state: nextState, log: [`Applied can't-block to ${creatures.length} Beast(s)`] };
  }

  if (/creatures with flying can't block/i.test(String(step.raw || '')) || /^creatures with flying$/i.test(targetText)) {
    const creatures = battlefield.filter(
      (perm: any) => permanentMatchesType(perm, 'creature') && battlefieldPermanentHasFlying(perm)
    );
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No creatures with flying to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'leaves_battlefield',
    });
    return { applied: true, state: nextState, log: [`Applied can't-block to ${creatures.length} creature(s) with flying`] };
  }

  if (/sculptures you control can't block/i.test(String(step.raw || '')) || targetText === 'sculptures you control') {
    const controllerId = String(ctx.controllerId || '').trim();
    const creatures = battlefield.filter(
      (perm: any) =>
        String(perm?.controller || '').trim() === controllerId &&
        permanentMatchesType(perm, 'creature') &&
        typeLineHasSubtype(perm, 'sculpture')
    );
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No Sculptures you control to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'leaves_battlefield',
    });
    return { applied: true, state: nextState, log: [`Applied can't-block to ${creatures.length} Sculpture(s)`] };
  }

  if (/creatures with bribery counters on them can't block/i.test(String(step.raw || ''))) {
    const creatures = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Number(((perm as any)?.counters || {}).bribery ?? 0) > 0;
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No creatures with bribery counters to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'leaves_battlefield',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} creature(s) with bribery counters`],
    };
  }

  if (/enchanted creature is a spirit and can't block/i.test(String(step.raw || ''))) {
    const sourceId = String(ctx.sourceId || '').trim();
    const aura = sourceId ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) : undefined;
    const hostId = String((aura as any)?.attachedTo || (aura as any)?.enchanting || ctx.targetCreatureId || '').trim();
    const host = hostId ? battlefield.find((perm: any) => String(perm?.id || '').trim() === hostId) : undefined;
    if (!host) {
      return { applied: true, state, log: ['No enchanted creature host for Spirit block restriction'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, [host], ctx, {
      descriptions: ["can't block", 'is a Spirit'],
      expiresAt: 'leaves_battlefield',
    });
    return { applied: true, state: nextState, log: ['Applied Spirit block restriction to enchanted creature'] };
  }

  if (/nonartifact creatures can't block this turn/i.test(String(step.raw || ''))) {
    const creatures = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      return !permanentMatchesType(perm, 'artifact');
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No nonartifact creatures to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} nonartifact creature(s)`],
    };
  }

  if (/creatures that are enchanted can't block/i.test(String(step.raw || '')) || /^creatures that are enchanted can't block$/i.test(targetText)) {
    const enchantedHostIds = new Set(
      battlefield
        .filter((perm: any) => permanentMatchesType(perm, 'enchantment'))
        .map((perm: any) => String(perm?.attachedTo || perm?.enchanting || '').trim())
        .filter(Boolean)
    );
    const creatures = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      return permanentMatchesType(perm, 'creature') && enchantedHostIds.has(id);
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No enchanted creatures to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: step.duration === 'static' ? 'leaves_battlefield' : 'end_of_turn',
    });
    return { applied: true, state: nextState, log: [`Applied can't-block to ${creatures.length} enchanted creature(s)`] };
  }

  if (/creatures that player controls without flying can't block this turn/i.test(String(step.raw || ''))) {
    const playerId = String(ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2').trim();
    const creatures = battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== playerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return !battlefieldPermanentHasFlying(perm);
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No non-flying creatures to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return { applied: true, state: nextState, log: [`Applied can't-block to ${creatures.length} non-flying creature(s)`] };
  }

  if (/the other can't block this turn/i.test(String(step.raw || ''))) {
    const excludedIds = new Set(buildContextualBattlefieldTargetIds(battlefield, ctx, false));
    const creatures = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const id = String(perm?.id || '').trim();
      return !excludedIds.has(id);
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No other creatures to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return { applied: true, state: nextState, log: [`Applied can't-block to ${creatures.length} other creature(s)`] };
  }

  if (
    targetText === "creatures can't block this turn" ||
    targetText === "all creatures can't block this turn" ||
    targetText === "creatures can't block" ||
    targetText === "all creatures can't block" ||
    /^creatures can't block(?: this turn)?$/i.test(String(step.raw || '')) ||
    ((targetText === 'creatures' || targetText === 'all creatures') &&
      /can't block/i.test(String(step.raw || '')))
  ) {
    const creatures = battlefield.filter((perm: any) =>
      String(perm?.type_line || perm?.card?.type_line || '')
        .toLowerCase()
        .includes('creature')
    );
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No creatures to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: step.duration === 'static' ? 'leaves_battlefield' : 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} creature(s)`],
    };
  }
  if (
    /^any number of target creatures(?: can't block this turn)?$/i.test(String(step.raw || '')) ||
    targetText === 'any number of target creatures'
  ) {
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    const creatures = battlefield.filter((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      return boundIds.has(id) && permanentMatchesType(perm, 'creature');
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ["No bound creatures to restrict from blocking"] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} creature(s)`],
    };
  }
  if (/^creatures dealt damage this way can't block this turn$/i.test(String(step.raw || ''))) {
    const damagedIds = new Set([
      ...collectBoundBattlefieldIds(ctx),
      ...(Array.isArray((ctx as any).lastDamagedBattlefieldPermanentIds)
        ? ((ctx as any).lastDamagedBattlefieldPermanentIds as readonly string[])
        : []),
    ]);
    const creatures = battlefield.filter((perm: any) => damagedIds.has(String((perm as any)?.id || '').trim()));
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No damaged creatures to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} damaged creature(s)`],
    };
  }
  if (/^each creature with mana value x can't block this turn$/i.test(String(step.raw || ''))) {
    const xValue = Number(ctx.xValue);
    if (!Number.isFinite(xValue)) {
      return {
        applied: false,
        message: `Skipped cant_block (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const creatures = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const mv = getCardManaValue((perm as any)?.card || perm);
      return mv !== null && mv === Math.floor(xValue);
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No creatures with matching mana value to restrict'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} creature(s) with mana value ${Math.floor(xValue)}`],
    };
  }
  if (/^each creature with toughness greater than its power can't block this turn$/i.test(String(step.raw || ''))) {
    const creatures = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const power = readCharacteristicNumber(
        (perm as any)?.effectivePower,
        (perm as any)?.basePower,
        (perm as any)?.card?.power,
        (perm as any)?.power
      );
      const toughness = readCharacteristicNumber(
        (perm as any)?.effectiveToughness,
        (perm as any)?.baseToughness,
        (perm as any)?.card?.toughness,
        (perm as any)?.toughness
      );
      if (power === null || toughness === null) return false;
      return toughness > power;
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No creatures with toughness greater than power to restrict'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} creature(s) with toughness greater than power`],
    };
  }
  if (
    targetText === "black creatures can't block" ||
    (targetText === 'black creatures' && /can't block/i.test(String(step.raw || '')))
  ) {
    const creatures = battlefield.filter(
      (perm: any) => permanentMatchesType(perm, 'creature') && permanentHasColorLetter(perm, 'B')
    );
    if (creatures.length === 0) {
      return { applied: true, state, log: ["No black creatures to restrict from blocking"] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: step.duration === 'static' ? 'leaves_battlefield' : 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} black creature(s)`],
    };
  }
  if (
    /^goaded creatures your opponents control(?: can't block)?$/i.test(String(step.raw || '')) ||
    targetText === 'goaded creatures your opponents control'
  ) {
    const controllerId = String(ctx.controllerId || '').trim();
    const goadedIds = new Set(
      (Array.isArray(ctx.lastGoadedBattlefieldPermanentIds) ? ctx.lastGoadedBattlefieldPermanentIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    const creatures = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      if (String((perm as any)?.controller || '').trim() === controllerId) return false;
      const permanentId = String((perm as any)?.id || '').trim();
      return goadedIds.size === 0 || goadedIds.has(permanentId);
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ["No goaded opponent creatures to restrict from blocking"] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: step.duration === 'static' ? 'leaves_battlefield' : 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} goaded creature(s)`],
    };
  }

  if (/green creatures and white creatures can't block this turn/i.test(String(step.raw || ''))) {
    const creatures = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      return permanentHasColorLetter(perm, 'G') || permanentHasColorLetter(perm, 'W');
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No green or white creatures to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} green/white creature(s)`],
    };
  }

  if (/white creatures and blue creatures can't block/i.test(String(step.raw || ''))) {
    const creatures = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      return permanentHasColorLetter(perm, 'W') || permanentHasColorLetter(perm, 'U');
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No white or blue creatures to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: step.duration === 'static' ? 'leaves_battlefield' : 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} white/blue creature(s)`],
    };
  }

  if (/creatures your opponents control with counters on them can't block/i.test(String(step.raw || ''))) {
    const controllerId = String(ctx.controllerId || '').trim();
    const opponentIds = new Set(
      (state.players || [])
        .map((player: any) => String(player?.id || '').trim())
        .filter((playerId) => playerId && playerId !== controllerId)
    );
    const creatures = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      if (!opponentIds.has(String(perm?.controller || '').trim())) return false;
      const counters = ((perm as any)?.counters || {}) as Record<string, number>;
      return Object.values(counters).some((value) => Number(value) > 0);
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No opponent creatures with counters to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: step.duration === 'static' ? 'leaves_battlefield' : 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} opponent creature(s) with counters`],
    };
  }

  if (/^x target creatures(?: can't block this turn)?$/i.test(String(step.raw || '').trim())) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const maxCount = Number.isFinite(Number(ctx.xValue))
      ? Math.max(0, Math.floor(Number(ctx.xValue)))
      : boundIds.length;
    const creatures = battlefield
      .filter((perm: any) => {
        const id = String((perm as any)?.id || '').trim();
        return boundIds.includes(id) && permanentMatchesType(perm, 'creature');
      })
      .slice(0, maxCount || boundIds.length);
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No bound creatures to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} creature(s)`],
    };
  }

  if (/^ii\s*-\s*ice\s*-?\s*up to three target creatures can't block this turn$/i.test(String(step.raw || '').trim())) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const creatures = battlefield
      .filter((perm: any) => {
        const id = String((perm as any)?.id || '').trim();
        return boundIds.includes(id) && permanentMatchesType(perm, 'creature');
      })
      .slice(0, 3);
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No saga Ice targets to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} Ice saga target(s)`],
    };
  }

  if (/other creatures that player controls can't block this turn/i.test(String(step.raw || ''))) {
    const playerId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const excludedIds = new Set(collectBoundBattlefieldIds(ctx));
    const creatures = battlefield.filter((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      if (excludedIds.has(id)) return false;
      if (String(perm?.controller || '').trim() !== playerId) return false;
      return permanentMatchesType(perm, 'creature');
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No other creatures for Mark for Death block restriction'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} other creature(s)`],
    };
  }

  if (/^a creature dealt damage this way can't block this turn$/i.test(String(step.raw || '').trim())) {
    const damagedIds = new Set([
      ...collectBoundBattlefieldIds(ctx),
      ...(Array.isArray((ctx as any).lastDamagedBattlefieldPermanentIds)
        ? ((ctx as any).lastDamagedBattlefieldPermanentIds as readonly string[])
        : []),
    ]);
    const creatures = battlefield.filter((perm: any) => damagedIds.has(String((perm as any)?.id || '').trim()));
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No damaged creature to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures.slice(0, 1), ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to damaged creature`],
    };
  }

  if (/monocolored creatures can't block this turn/i.test(String(step.raw || ''))) {
    const creatures = battlefield.filter(
      (perm: any) => permanentMatchesType(perm, 'creature') && permanentIsMonocolored(perm)
    );
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No monocolored creatures to restrict from blocking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} monocolored creature(s)`],
    };
  }

  if (/^otherwise,? it can't block$/i.test(String(step.raw || '').trim()) || /^otherwise,? it$/i.test(targetText)) {
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, false);
    const otherwiseTargets = battlefield.filter((perm: any) =>
      contextualIds.includes(String((perm as any)?.id || '').trim())
    );
    if (otherwiseTargets.length === 0) {
      return {
        applied: false,
        message: `Skipped cant_block (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const nextState = applyTemporaryEffectToPermanents(state, otherwiseTargets, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${otherwiseTargets.length} permanent(s)`],
    };
  }
  if (targetText === 'cowards' || /^cowards can'?t block/.test(String(step.raw || '').toLowerCase())) {
    const creatures = battlefield.filter((perm: any) =>
      String(perm?.type_line || perm?.card?.type_line || '')
        .toLowerCase()
        .includes('creature')
    );
    if (creatures.length === 0) {
      return {
        applied: false,
        message: `Skipped cant_block (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't block"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-block to ${creatures.length} creature(s)`],
    };
  }
  const attachedTargets = resolveAttachedStaticAbilityGrantTargets(battlefield, effectiveTarget as any, ctx);
  let targets =
    attachedTargets.length > 0
      ? attachedTargets
      : resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
  const thoseCreaturesReference =
    /^those creatures$/i.test(String((effectiveTarget as any)?.text || '').trim()) ||
    /^until your next turn,\s*those creatures can'?t block/i.test(String(step.raw || ''));
  if (targets.length === 0 && thoseCreaturesReference) {
    const goadedIds = Array.isArray(ctx.lastGoadedBattlefieldPermanentIds)
      ? ctx.lastGoadedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];
    if (goadedIds.length > 0) {
      const goadedSet = new Set(goadedIds);
      targets = battlefield.filter((perm: any) => goadedSet.has(String(perm?.id || '').trim()));
    } else {
      const controllerId = String(ctx.controllerId || '').trim();
      targets = battlefield.filter(
        (perm: any) =>
          String((perm as any)?.controller || '').trim() !== controllerId &&
          permanentMatchesType(perm, 'creature')
      );
    }
  }
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped cant_block (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targets.length > 1 && /^target\b/i.test(String((step.target as any)?.text || '').trim())) {
    return {
      applied: false,
      message: `Skipped cant_block (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const cantBlockExpiresAt =
    duration === 'end_of_turn'
      ? 'end_of_turn'
      : duration === 'until_next_turn'
        ? 'leaves_battlefield'
        : 'leaves_battlefield';
  const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
    descriptions: ["can't block"],
    expiresAt: cantBlockExpiresAt,
    ...(duration === 'until_next_turn' && ctx.controllerId
      ? { expiresOnControllerTurn: ctx.controllerId }
      : {}),
  });

  return {
    applied: true,
    state: nextState,
    log: [`Applied can't-block to ${targets.length} permanent(s)`],
  };
}

