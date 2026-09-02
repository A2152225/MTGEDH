// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyDestroyStep.
// Public entry: applyDestroyStep.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { resolveDestroyTargets } from './oracleIRExecutorBattlefieldDestroyTargets';
import {
  buildPermanentCardWithStats,
  oracleIrBattlefieldRemovalOptions,
} from './oracleIRExecutorBattlefieldRemovalHelpers';
import { filterIllegalDirectTargetPermanents } from './oracleIRExecutorBattlefieldSubtypeCompoundResolvers';
import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';
import { finalizeBattlefieldRemoval } from './oracleIRExecutorBattlefieldOps';
import {
  getAvailableShields,
  processDestructionWithRegeneration,
} from './keywordAbilities/regeneration';
import { trySpecialDestroyStep } from './oracleIRExecutorSpecialTargetHandlers';
import { bridgedZoneStepResult } from './oracleIRStepLedgerRuntime';
import { executorPermanentHasIndestructible } from './oracleIRExecutorBattlefieldIndestructible';

export function applyDestroyStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'destroy' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const special = trySpecialDestroyStep(state, step, ctx);
  if (special) return special;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const resolvedTargets = resolveDestroyTargets(battlefield, step, ctx);
  const targetText = String((step.target as any)?.text || step.raw || '');
  // "Destroy target creature" is a targeted spell/ability, so hexproof, protection, and
  // color-qualified shields (Autumn's Veil, Spellbane Centaur) can make the bound object illegal.
  const toRemove = /\btarget\b/i.test(targetText)
    ? filterIllegalDirectTargetPermanents(resolvedTargets, ctx, state)
    : resolvedTargets;
  if (toRemove.length === 0) {
    const rawTargetText = String((step.target as any)?.text || step.raw || '');
    let targetText = normalizeBattlefieldTargetReferenceText(rawTargetText)
      .replace(/\s+unless\s+that\s+player\s+pays\b.*$/i, '')
      .replace(/,\s*where\s+x\s+is\b.*$/i, '')
      .replace(/\s+they can't be regenerated$/i, '')
      .trim();
    if (
      /^(?:all|each|up to (?:one|x)|the creature with the least power|one of them at random)\b/i.test(targetText) ||
      /^destroy all\b/i.test(String(step.raw || ''))
    ) {
      return { applied: true, state, log: ['No matching permanents to destroy'] };
    }
    if (
      /(?:destroy\s+)?two target (?:creatures?(?: and\/or lands)?|permanents?)(?: you control)?/i.test(
        `${targetText} ${String(step.raw || '')}`,
      )
    ) {
      return {
        applied: false,
        message: `Skipped destroy (requires choosing two targets): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (/\btarget\b/i.test(`${targetText} ${String(step.raw || '')}`)) {
      return {
        applied: false,
        message: `Skipped destroy (requires choosing a target): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (
      /if\s+it\s+has\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+or\s+more\b/i.test(
        rawTargetText
      )
    ) {
      return { applied: true, state, log: ['Destroy condition not met'] };
    }
    if (
      /\bif its mana value is (?:\d+|x) or less(?: instead)?$/i.test(targetText) ||
      /\bthat artifact if its mana value is (?:\d+|x) or less(?: instead)?$/i.test(rawTargetText)
    ) {
      return { applied: true, state, log: ['Destroy mana-value condition not met or artifact already gone'] };
    }
    return {
      applied: false,
      message: `Skipped destroy (unsupported target): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const log: string[] = [];
  // CR 702.12: indestructible is still a legal target; the destroy instruction is a no-op.
  // Special "destroy a permanent with indestructible" cards are handled above.
  const destroyable = toRemove.filter((perm) => {
    if (!executorPermanentHasIndestructible(perm, battlefield)) return true;
    const name = String((perm as any)?.card?.name || (perm as any)?.name || perm.id || 'permanent');
    log.push(`${name} is indestructible and wasn't destroyed`);
    return false;
  });
  if (destroyable.length === 0) {
    return { applied: true, state, log };
  }

  const removed: BattlefieldPermanent[] = [];
  const removedIds = new Set<string>();
  let nextShields = Array.isArray((state as any).regenerationShields)
    ? [...((state as any).regenerationShields as any[])]
    : [];
  const regeneratedById = new Map<string, BattlefieldPermanent>();

  for (const perm of destroyable) {
    const permanentId = String((perm as any)?.id || '').trim();
    if (step.cantBeRegenerated) {
      removed.push(perm);
      removedIds.add(permanentId);
      continue;
    }
    const availableShields = getAvailableShields(permanentId, nextShields as any);
    if (availableShields.length <= 0) {
      removed.push(perm);
      removedIds.add(permanentId);
      continue;
    }

    const damageMarked =
      Number((perm as any).markedDamage ?? (perm as any).damageMarked ?? (perm as any).damage ?? (perm as any).counters?.damage ?? 0) || 0;
    const isInCombat = Boolean(
      (perm as any)?.attacking ||
      (perm as any)?.attackingPlayerId ||
      (perm as any)?.defendingPlayerId ||
      (Array.isArray((perm as any)?.blocking) && (perm as any).blocking.length > 0) ||
      (Array.isArray((perm as any)?.blockedBy) && (perm as any).blockedBy.length > 0)
    );
    const regeneration = processDestructionWithRegeneration(
      permanentId,
      nextShields as any,
      Boolean((perm as any)?.tapped),
      damageMarked,
      isInCombat
    );

    nextShields = [...regeneration.updatedShields];
    if (!regeneration.wasRegenerated) {
      removed.push(perm);
      removedIds.add(permanentId);
      continue;
    }

    regeneratedById.set(permanentId, {
      ...(perm as any),
      tapped: regeneration.permanentTapped,
      markedDamage: 0,
      damageMarked: 0,
      damage: 0,
      counters: {
        ...(((perm as any)?.counters || {}) as Record<string, number>),
        damage: 0,
      },
      attacking: undefined,
      attackingPlayerId: undefined,
      defendingPlayerId: undefined,
      blocking: undefined,
      blockedBy: undefined,
    } as BattlefieldPermanent);
  }

  const kept = battlefield
    .filter(perm => !removedIds.has(String((perm as any)?.id || '').trim()))
    .map(perm => regeneratedById.get(String((perm as any)?.id || '').trim()) ?? perm);
  const stateWithShields = {
    ...(state as any),
    regenerationShields: nextShields,
  } as GameState;

  if (regeneratedById.size > 0) {
    log.push(`Regenerated ${regeneratedById.size} permanent(s) instead of destroying them`);
  }

  if (removed.length === 0) {
    return {
      applied: true,
      state: {
        ...(stateWithShields as any),
        battlefield: kept,
      } as GameState,
      log,
    };
  }

  const result = finalizeBattlefieldRemoval(stateWithShields, removed, removedIds, kept, 'graveyard', 'destroyed', oracleIrBattlefieldRemovalOptions(ctx, 'destroy'));
  const movedCards = removed
    .filter(perm => !(perm as any).isToken)
    .map(perm => buildPermanentCardWithStats(perm, 'graveyard'));
  return bridgedZoneStepResult(ctx, {
    applied: true,
    state: result.state,
    log: [...log, ...result.log],
    ...(movedCards.length > 0 ? { lastMovedCards: movedCards } : {}),
  });
}
