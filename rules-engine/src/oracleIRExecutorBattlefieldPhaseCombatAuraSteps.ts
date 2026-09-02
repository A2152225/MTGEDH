// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyRemoveFromCombatStep, applyPhaseOutStep, applyPutStickerStep,
// applyAssignNoCombatDamageStep, applyBecomeAuraStep, applyTapMatchingPermanentsStep
// plus private permanentMatchesTappedFilter they close over.
// Public entries: applyRemoveFromCombatStep, applyPhaseOutStep, applyPutStickerStep,
// applyAssignNoCombatDamageStep, applyBecomeAuraStep, applyTapMatchingPermanentsStep.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { parseSimplePermanentTypeFromText } from './oracleIRExecutorBattlefieldParser';
import {
  permanentMatchesType,
  resolveTapOrUntapTargetIds,
} from './oracleIRExecutorBattlefieldOps';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';
import { resolveOracleQuantity } from './oracleIRExecutorResolveQuantity';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly count?: number;
  readonly lastExiledCards?: readonly any[];
  readonly lastExiledCardCount?: number;
  readonly lastSacrificedCreaturesPowerTotal?: number;
  readonly lastSacrificedPermanents?: readonly any[];
  readonly lastMovedCards?: readonly any[];
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
  readonly lastAntecedentBattlefieldPermanentIds?: readonly string[];
  readonly lastTappedMatchingPermanentCount?: number;
  readonly lastTappedMatchingPermanentIds?: readonly string[];
  readonly skipLedgerFlush?: boolean;
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason:
    | 'no_deterministic_target'
    | 'unsupported_target'
    | 'unsupported_player_selector'
    | 'unsupported_object_selector'
    | 'player_choice_required'
    | 'impossible_action'
    | 'unsupported_condition'
    | 'condition_false';
  readonly options?: {
    readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly persist?: boolean;
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
  };
};

type BattlefieldStepHandlerResult = StepApplyResult | StepSkipResult;

/**
 * Rule 506.4: a creature removed from combat stops attacking/blocking. Preserve
 * the rest of the battlefield object and only clear combat relationships that
 * cannot survive the removal.
 */
export function applyRemoveFromCombatStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'remove_from_combat' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const selectedIds = new Set(
    resolveTapOrUntapTargetIds(state, step.target as any, ctx)
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  );
  if (selectedIds.size === 0) {
    for (const id of [
      ctx.targetCreatureId,
      ctx.targetPermanentId,
      ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
    ]) {
      const normalized = String(id || '').trim();
      if (normalized) selectedIds.add(normalized);
    }
  }
  if (selectedIds.size === 0) {
    return {
      applied: false,
      message: `Skipped remove-from-combat (no bound creature): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const removedBlockerIds = new Set<string>();
  const unblockedAttackerIds = new Set<string>();
  for (const permanent of battlefield as any[]) {
    const id = String(permanent?.id || '').trim();
    if (!selectedIds.has(id)) continue;
    if (Array.isArray(permanent?.blocking)) {
      for (const attackerId of permanent.blocking) {
        const normalized = String(attackerId || '').trim();
        if (normalized) unblockedAttackerIds.add(normalized);
      }
    }
    removedBlockerIds.add(id);
  }

  const nextBattlefield = battlefield.map((permanent: any) => {
    const id = String(permanent?.id || '').trim();
    if (selectedIds.has(id)) {
      return {
        ...permanent,
        attacking: undefined,
        attackingPlayerId: undefined,
        isAttacking: false,
        blocking: [],
        blockedBy: [],
      };
    }

    const next = { ...permanent };
    if (Array.isArray(next.blockedBy)) {
      next.blockedBy = next.blockedBy.filter((blockerId: unknown) => !removedBlockerIds.has(String(blockerId || '').trim()));
    }
    if (step.unblockCreaturesBlockedOnlyByIt && unblockedAttackerIds.has(id) && (!next.blockedBy || next.blockedBy.length === 0)) {
      next.blockedBy = [];
      next.isBlocked = false;
      next.wasBlockedThisCombat = false;
    }
    return next;
  });

  return {
    applied: true,
    state: { ...(state as any), battlefield: nextBattlefield } as GameState,
    log: [`Removed ${selectedIds.size} creature(s) from combat`],
  };
}

export function applyPhaseOutStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'phase_out' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const simultaneousRaw = String(step.raw || '').replace(/\u2019/g, "'");
  if (
    /simultaneously,\s*all phased-out creatures phase in and all creatures with phasing phase out/i.test(
      simultaneousRaw,
    )
  ) {
    const hasPhasing = (permanent: any): boolean => {
      const typeLine = getExecutorTypeLineLower(permanent);
      const granted = Array.isArray((permanent as any)?.grantedAbilities)
        ? (permanent as any).grantedAbilities.join(' ')
        : '';
      const keywords = String((permanent as any)?.keywords || (permanent as any)?.card?.keywords || '');
      return /\bphasing\b/i.test(`${typeLine} ${granted} ${keywords}`);
    };
    const battlefield = ((state.battlefield || []) as any[]).map((permanent: any) => {
      if (!permanentMatchesType(permanent, 'creature')) return permanent;
      if (permanent?.phasedOut) {
        return {
          ...permanent,
          phasedOut: false,
          phasedOutBy: undefined,
          phasedOutControllerId: undefined,
        };
      }
      if (hasPhasing(permanent)) {
        return {
          ...permanent,
          phasedOut: true,
          phasedOutBy: 'effect',
          phasedOutControllerId: String(permanent?.controllerId || permanent?.ownerId || '').trim() || undefined,
        };
      }
      return permanent;
    });
    return {
      applied: true,
      state: { ...state, battlefield: getProcessedBattlefield({ ...state, battlefield } as any) as any },
      log: ['Simultaneously phased in phased-out creatures and phased out creatures with phasing'],
    };
  }

  let targetIds = resolveTapOrUntapTargetIds(state, step.target as any, ctx);
  if (targetIds.length === 0) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    targetIds = resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx)
      .map((perm: any) => String(perm?.id || '').trim())
      .filter(Boolean);
  }
  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped phase out (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const battlefield = ((state.battlefield || []) as any[]).map((permanent: any) => {
    const id = String(permanent?.id || '').trim();
    if (!targetIds.includes(id)) return permanent;
    return {
      ...permanent,
      phasedOut: true,
      phasedOutBy: 'effect',
      phasedOutControllerId: String(permanent?.controllerId || permanent?.ownerId || '').trim() || undefined,
    };
  });

  return {
    applied: true,
    state: { ...state, battlefield: getProcessedBattlefield({ ...state, battlefield } as any) as any },
    log: [`Phased out ${targetIds.length} permanent(s)`],
  };
}

export function applyPutStickerStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'put_sticker' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const targetIds = resolveTapOrUntapTargetIds(state, step.target, ctx);
  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped put sticker (requires target): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const wanted = new Set(targetIds);
  const battlefield = ((state.battlefield || []) as BattlefieldPermanent[]).map((perm: any) => {
    const permanentId = String(perm?.id || '').trim();
    if (!wanted.has(permanentId)) return perm;
    const stickers = Array.isArray(perm.stickers) ? [...perm.stickers] : [];
    return {
      ...perm,
      stickers: [
        ...stickers,
        {
          sourceId: ctx.sourceId,
          sourceName: ctx.sourceName,
          text: String(step.sticker?.kind === 'raw' ? step.sticker.text : step.raw || 'sticker'),
        },
      ],
    } as BattlefieldPermanent;
  });

  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: [`Put a sticker on ${targetIds.join(', ')}`],
  };
}

export function applyAssignNoCombatDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'assign_no_combat_damage' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const targetIds = resolveTapOrUntapTargetIds(state, step.target, ctx);
  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped assign no combat damage (requires target): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const wanted = new Set(targetIds);
  const turnNumber = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  const battlefield = ((state.battlefield || []) as BattlefieldPermanent[]).map((perm: any) => {
    const permanentId = String(perm?.id || '').trim();
    if (!wanted.has(permanentId)) return perm;
    return {
      ...perm,
      assignsNoCombatDamageUntilTurn: turnNumber,
    } as BattlefieldPermanent;
  });

  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: [`${targetIds.join(', ')} assigns no combat damage this turn`],
  };
}

export function applyBecomeAuraStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'become_aura' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const sourceTargetIds = resolveTapOrUntapTargetIds(state, step.target, ctx);
  const auraId = sourceTargetIds[0] || String(ctx.sourceId || '').trim();
  if (!auraId) {
    return {
      applied: false,
      message: `Skipped become Aura (requires source permanent): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const enchantTargetIds = resolveTapOrUntapTargetIds(state, step.enchant, {
    ...ctx,
    targetPermanentId: String((ctx.selectorContext as any)?.attachmentTargetId || ctx.targetPermanentId || '').trim() || undefined,
  });
  const enchantTargetId = enchantTargetIds.find(id => id !== auraId) || '';
  if (!enchantTargetId) {
    return {
      applied: false,
      message: `Skipped become Aura (requires enchant target): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const battlefield = ((state.battlefield || []) as BattlefieldPermanent[]).map((perm: any) => {
    const permanentId = String(perm?.id || '').trim();
    if (permanentId === auraId) {
      const card = { ...(perm.card || {}) };
      const typeLine = String(card.type_line || perm.type_line || '').includes('Aura')
        ? String(card.type_line || perm.type_line || '')
        : `${String(card.type_line || perm.type_line || 'Enchantment').trim()} Aura`.trim();
      return {
        ...perm,
        card: { ...card, type_line: typeLine },
        type_line: typeLine,
        attachedTo: enchantTargetId,
        isAura: true,
        enchantTarget: step.enchant,
        losesThisAbility: Boolean(step.losesThisAbility),
      } as BattlefieldPermanent;
    }
    if (permanentId === enchantTargetId) {
      const attachments = Array.isArray(perm.attachments) ? [...perm.attachments] : [];
      return {
        ...perm,
        attachments: attachments.includes(auraId) ? attachments : [...attachments, auraId],
      } as BattlefieldPermanent;
    }
    return perm;
  });

  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: [`${auraId} becomes an Aura attached to ${enchantTargetId}`],
  };
}

function permanentMatchesTappedFilter(perm: any, filterText: string): boolean {
  const normalizedFilter = String(filterText || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase()
    .replace(/^an?\s+/i, '')
    .replace(/\s+you control$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedFilter) return true;

  if (/\bartifacts?\s+and\/or\s+creatures?\b/i.test(normalizedFilter)) {
    return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'creature');
  }

  // Generic comma/or-separated type lists, e.g. "artifact, creature, or land" (Tangle Wire).
  // Checked before the single-type parse below, since that parse matches on substrings and
  // would otherwise resolve a list like this to just "creature".
  const listedTypeParts = normalizedFilter
    .split(/\s*,\s*|\s+and\/or\s+|\s+or\s+|\s+and\s+/i)
    .map(part => part.trim())
    .filter(Boolean);
  if (listedTypeParts.length > 1) {
    const listedTypes = listedTypeParts
      .map(part => parseSimplePermanentTypeFromText(part))
      .filter((type): type is NonNullable<typeof type> => Boolean(type));
    if (listedTypes.length === listedTypeParts.length && listedTypes.length > 0) {
      return listedTypes.some(type => {
        if (type === 'permanent') return true;
        if (type === 'nonland_permanent') return permanentMatchesType(perm, 'permanent') && !permanentMatchesType(perm, 'land');
        return permanentMatchesType(perm, type);
      });
    }
  }

  const simpleType = parseSimplePermanentTypeFromText(normalizedFilter);
  if (simpleType) {
    if (simpleType === 'permanent') return true;
    if (simpleType === 'nonland_permanent') return permanentMatchesType(perm, 'permanent') && !permanentMatchesType(perm, 'land');
    return permanentMatchesType(perm, simpleType);
  }

  const typeLine = getExecutorTypeLineLower(perm);
  return new RegExp(`\\b${normalizedFilter.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(typeLine);
}

export function applyTapMatchingPermanentsStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'tap_matching_permanents' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped tap matching permanents (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const controllerId = String(players[0] || '').trim();
  const battlefield = Array.isArray((state.battlefield || [])) ? (state.battlefield as any[]) : [];
  const eligible = battlefield.filter((perm: any) =>
    String(perm?.controller || '').trim() === controllerId &&
    !Boolean(perm?.tapped) &&
    permanentMatchesTappedFilter(perm, step.filter)
  );

  const explicitChosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const eligibleIdSet = new Set(eligible.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean));
  const chosenIds = explicitChosenIds.filter(id => eligibleIdSet.has(id));

  let selectedIds: string[] = [];
  if (chosenIds.length > 0) {
    selectedIds = Array.from(new Set(chosenIds));
  } else if (step.amount.kind === 'x') {
    selectedIds = eligible.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean);
  } else {
    const exactCount =
      step.amount.kind === 'number'
        ? Math.max(0, step.amount.value | 0)
        : (() => {
            const resolved = resolveOracleQuantity(state, controllerId as PlayerID, step.amount, ctx, { step });
            return resolved === null ? null : Math.max(0, resolved | 0);
          })();
    if (exactCount === null) {
      return {
        applied: false,
        message: `Skipped tap matching permanents (unsupported amount): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }
    if (eligible.length < exactCount) {
      return {
        applied: false,
        message: `Skipped tap matching permanents (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    if (
      exactCount > 1
      && ctx.interactivePlayerChoices !== false
    ) {
      return {
        applied: false,
        message: `Skipped tap matching permanents (needs player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    selectedIds = eligible.slice(0, exactCount).map((perm: any) => String(perm?.id || '').trim()).filter(Boolean);
  }

  const selectedIdSet = new Set(selectedIds);
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String(perm?.id || '').trim();
    if (!selectedIdSet.has(permanentId)) return perm;
    return { ...perm, tapped: true };
  });

  return {
    applied: true,
    state: { ...(state as any), battlefield: nextBattlefield } as GameState,
    log: [`Tapped ${selectedIds.length} matching permanent(s)`],
    lastTappedMatchingPermanentCount: selectedIds.length,
    lastTappedMatchingPermanentIds: selectedIds,
  };
}
