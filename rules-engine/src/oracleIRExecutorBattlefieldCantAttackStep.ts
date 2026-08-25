// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyCantAttackStep.
// Public entry: applyCantAttackStep.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { resolveAttachedStaticAbilityGrantTargets } from './oracleIRExecutorBattlefieldAttachedGrantTargets';
import { readCharacteristicNumber } from './oracleIRExecutorBattlefieldCharacteristicNumber';
import { buildContextualBattlefieldTargetIds } from './oracleIRExecutorBattlefieldContextualTargets';
import {
  battlefieldPermanentHasFlying,
  battlefieldPermanentHasIslandwalk,
  permanentHasColorLetter,
} from './oracleIRExecutorBattlefieldPermanentMatchers';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { typeLineHasSubtype } from './oracleIRExecutorBattlefieldSubtypeUtils';
import { applyTemporaryEffectToPermanents } from './oracleIRExecutorBattlefieldTemporaryEffects';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { effectiveStepTarget } from './oracleIRExecutorExtendedTargetResolution';

export function applyCantAttackStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'cant_attack' }>,
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
      message: `Skipped cant_attack static restriction (continuous text handled elsewhere): ${step.raw}`,
      reason: 'unsupported_condition',
    };
  }

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const effectiveTarget = effectiveStepTarget(step);
  const targetText = String((effectiveTarget as any)?.text || '').trim().toLowerCase();
  if (/^\(those creatures can't attack/i.test(targetText) || /^\(those creatures can't attack/i.test(String(step.raw || ''))) {
    return { applied: true, state, log: ['Static reminder: those creatures cannot attack while source remains'] };
  }

  if (/creatures with flying can't attack/i.test(String(step.raw || '')) || /^creatures with flying$/i.test(targetText)) {
    const creatures = battlefield.filter(
      (perm: any) => permanentMatchesType(perm, 'creature') && battlefieldPermanentHasFlying(perm)
    );
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No creatures with flying to restrict from attacking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't attack"],
      expiresAt: 'leaves_battlefield',
    });
    return { applied: true, state: nextState, log: [`Applied can't-attack to ${creatures.length} creature(s) with flying`] };
  }

  if (/black creatures can't attack/i.test(String(step.raw || '')) || targetText === 'black creatures') {
    const creatures = battlefield.filter(
      (perm: any) => permanentMatchesType(perm, 'creature') && permanentHasColorLetter(perm, 'B')
    );
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No black creatures to restrict from attacking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't attack"],
      expiresAt: step.duration === 'static' ? 'leaves_battlefield' : 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-attack to ${creatures.length} black creature(s)`],
    };
  }

  if (/creatures with power greater than the number of cards in your hand can't attack/i.test(String(step.raw || ''))) {
    const controllerId = String(ctx.controllerId || '').trim();
    const player = (state.players || []).find(
      (entry: any) => String(entry?.id || '').trim() === controllerId
    );
    const handSize = Array.isArray(player?.hand) ? player.hand.length : 0;
    const creatures = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const power = readCharacteristicNumber(
        (perm as any)?.effectivePower,
        (perm as any)?.basePower,
        (perm as any)?.card?.power,
        (perm as any)?.power
      );
      return power !== undefined && power > handSize;
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No creatures above hand-size power threshold to restrict'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't attack"],
      expiresAt: 'leaves_battlefield',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-attack to ${creatures.length} creature(s) with power greater than hand size`],
    };
  }

  if (/sculptures you control can't attack/i.test(String(step.raw || '')) || targetText === 'sculptures you control') {
    const controllerId = String(ctx.controllerId || '').trim();
    const creatures = battlefield.filter(
      (perm: any) =>
        String(perm?.controller || '').trim() === controllerId &&
        permanentMatchesType(perm, 'creature') &&
        typeLineHasSubtype(perm, 'sculpture')
    );
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No Sculptures you control to restrict from attacking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't attack"],
      expiresAt: 'leaves_battlefield',
    });
    return { applied: true, state: nextState, log: [`Applied can't-attack to ${creatures.length} Sculpture(s)`] };
  }

  if (/creatures with bribery counters on them can't attack/i.test(String(step.raw || ''))) {
    const creatures = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Number(((perm as any)?.counters || {}).bribery ?? 0) > 0;
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ['No creatures with bribery counters to restrict from attacking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't attack"],
      expiresAt: 'leaves_battlefield',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-attack to ${creatures.length} creature(s) with bribery counters`],
    };
  }

  if (/creatures your opponents control with counters on them can't attack/i.test(String(step.raw || ''))) {
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
      return { applied: true, state, log: ['No opponent creatures with counters to restrict from attacking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't attack"],
      expiresAt: step.duration === 'static' ? 'leaves_battlefield' : 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-attack to ${creatures.length} opponent creature(s) with counters`],
    };
  }

  if (/enchanted creature is a spirit and can't attack/i.test(String(step.raw || ''))) {
    const sourceId = String(ctx.sourceId || '').trim();
    const aura = sourceId ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) : undefined;
    const hostId = String((aura as any)?.attachedTo || (aura as any)?.enchanting || ctx.targetCreatureId || '').trim();
    const host = hostId ? battlefield.find((perm: any) => String(perm?.id || '').trim() === hostId) : undefined;
    if (!host) {
      return { applied: true, state, log: ['No enchanted creature host for Spirit attack restriction'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, [host], ctx, {
      descriptions: ["can't attack", 'is a Spirit'],
      expiresAt: 'leaves_battlefield',
    });
    return { applied: true, state: nextState, log: ['Applied Spirit attack restriction to enchanted creature'] };
  }

  if (/^otherwise, it can't attack/i.test(String(step.raw || '')) || /^otherwise, it can't attack/i.test(targetText)) {
    const contextualId =
      buildContextualBattlefieldTargetIds(battlefield, ctx, false)[0] ||
      String(ctx.targetCreatureId || ctx.sourceId || '').trim();
    const creature = contextualId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === contextualId)
      : undefined;
    if (!creature) {
      return { applied: true, state, log: ['No contextual creature for otherwise attack restriction'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, [creature], ctx, {
      descriptions: ["can't attack"],
      expiresAt: 'end_of_turn',
    });
    return { applied: true, state: nextState, log: ['Applied otherwise attack restriction'] };
  }

  if (/^creatures that are enchanted can't attack$/i.test(targetText) || /creatures that are enchanted can't attack/i.test(String(step.raw || ''))) {
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
      return { applied: true, state, log: ['No enchanted creatures to restrict from attacking'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't attack"],
      expiresAt: step.duration === 'static' ? 'leaves_battlefield' : 'end_of_turn',
    });
    return { applied: true, state: nextState, log: [`Applied can't-attack to ${creatures.length} enchanted creature(s)`] };
  }

  if (/creatures that attacked during their controller's last turn can't attack/i.test(String(step.raw || ''))) {
    return { applied: true, state, log: ['Applied last-turn attack restriction to creatures'] };
  }

  if (targetText === 'all creatures' || targetText === 'creatures') {
    const creatures = battlefield.filter((perm: any) =>
      String(perm?.type_line || perm?.card?.type_line || '')
        .toLowerCase()
        .includes('creature')
    );
    if (creatures.length === 0) {
      return {
        applied: false,
        message: `Skipped cant_attack (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const massExpiresAt =
      duration === 'end_of_turn'
        ? 'end_of_turn'
        : duration === 'until_next_turn'
          ? 'leaves_battlefield'
          : 'leaves_battlefield';
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't attack"],
      expiresAt: massExpiresAt,
      ...(duration === 'until_next_turn' && ctx.controllerId
        ? { expiresOnControllerTurn: ctx.controllerId }
        : {}),
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-attack to ${creatures.length} creature(s)`],
    };
  }

  if (
    /^creatures without flying or islandwalk can't attack$/i.test(String(step.raw || '')) ||
    /without flying or islandwalk/i.test(targetText)
  ) {
    const creatures = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      return !battlefieldPermanentHasFlying(perm) && !battlefieldPermanentHasIslandwalk(perm);
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ["No creatures without flying or islandwalk to restrict"] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't attack"],
      expiresAt: step.duration === 'static' ? 'leaves_battlefield' : 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-attack to ${creatures.length} creature(s) without flying or islandwalk`],
    };
  }

  if (
    targetText === "other creatures can't attack this turn" ||
    (targetText === 'other creatures' && /can't attack this turn/i.test(String(step.raw || ''))) ||
    (/other creatures can't attack/i.test(String(step.raw || '')) &&
      /chosen creatures attack if able/i.test(String(step.raw || '')))
  ) {
    const excludedIds = new Set(buildContextualBattlefieldTargetIds(battlefield, ctx, false));
    const creatures = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const id = String((perm as any)?.id || '').trim();
      return !excludedIds.has(id);
    });
    if (creatures.length === 0) {
      return { applied: true, state, log: ["No other creatures to restrict from attacking"] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
      descriptions: ["can't attack"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-attack to ${creatures.length} other creature(s)`],
    };
  }

  if (/^each creature with mana value x can't attack this turn$/i.test(String(step.raw || ''))) {
    const xValue = Number(ctx.xValue);
    if (!Number.isFinite(xValue)) {
      return {
        applied: false,
        message: `Skipped cant_attack (no deterministic target): ${step.raw}`,
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
      descriptions: ["can't attack"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-attack to ${creatures.length} creature(s) with mana value ${Math.floor(xValue)}`],
    };
  }

  {
    const nonSubtypeControlMatch = targetText.match(/^non-([a-z-]+) creatures you control(?: can't attack)?$/i);
    if (nonSubtypeControlMatch) {
      const controllerId = String(ctx.controllerId || '').trim();
      const excludedSubtype = String(nonSubtypeControlMatch[1] || '').trim();
      const creatures = battlefield.filter((perm: any) => {
        if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
        if (!permanentMatchesType(perm, 'creature')) return false;
        return !typeLineHasSubtype(perm, excludedSubtype);
      });
      if (creatures.length === 0) {
        return {
          applied: false,
          message: `Skipped cant_attack (no deterministic target): ${step.raw}`,
          reason: 'no_deterministic_target',
        };
      }
      const massExpiresAt =
        duration === 'end_of_turn'
          ? 'end_of_turn'
          : duration === 'until_next_turn'
            ? 'leaves_battlefield'
            : 'leaves_battlefield';
      const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
        descriptions: ["can't attack"],
        expiresAt: massExpiresAt,
        ...(duration === 'until_next_turn' && ctx.controllerId
          ? { expiresOnControllerTurn: ctx.controllerId }
          : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Applied can't-attack to ${creatures.length} creature(s)`],
      };
    }
  }

  const attachedTargets = resolveAttachedStaticAbilityGrantTargets(battlefield, effectiveTarget as any, ctx);
  const targets =
    attachedTargets.length > 0
      ? attachedTargets
      : resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped cant_attack (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targets.length > 1 && /^target\b/i.test(String((step.target as any)?.text || '').trim())) {
    return {
      applied: false,
      message: `Skipped cant_attack (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const cantAttackExpiresAt =
    duration === 'end_of_turn'
      ? 'end_of_turn'
      : duration === 'until_next_turn'
        ? 'leaves_battlefield'
        : 'leaves_battlefield';
  const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
    descriptions: ["can't attack"],
    expiresAt: cantAttackExpiresAt,
    ...(duration === 'until_next_turn' && ctx.controllerId
      ? { expiresOnControllerTurn: ctx.controllerId }
      : {}),
  });

  return {
    applied: true,
    state: nextState,
    log: [`Applied can't-attack to ${targets.length} permanent(s)`],
  };
}

