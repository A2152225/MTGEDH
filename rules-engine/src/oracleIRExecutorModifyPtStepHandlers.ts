import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { OracleEffectStep } from './oracleIR';
import type { LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import { tryResolveForEachReferenceAmount } from './oracleIRExecutorForEachQuantity';
import {
  applyTemporaryPowerToughnessModifier,
  applyTemporarySetBasePowerToughness,
  applyTemporarySwitchPowerToughness,
  resolveCreatureTargetIds,
  resolveSingleCreatureTargetId,
  resolveTrepanationBoostTargetCreatureId,
} from './oracleIRExecutorCreatureStepUtils';

export type ModifyPtRuntime = {
  readonly lastRevealedCardCount?: number;
  readonly lastDiscardedCardCount?: number;
  readonly lastDiscardedCards?: readonly any[];
  readonly lastExiledCardCount?: number;
  readonly lastExiledCards?: readonly any[];
  readonly lastMovedCards?: readonly any[];
  readonly lastGoadedCreatures?: readonly BattlefieldPermanent[];
  readonly lastSacrificedCreaturesPowerTotal?: number;
  readonly lastSacrificedPermanents?: readonly LastKnownPermanentSnapshot[];
  readonly lastExcessDamageDealtThisWay?: number;
  readonly lastScryLookedAtCount?: number;
  readonly lastTappedMatchingPermanentCount?: number;
  readonly lastReferenceAmount?: number;
};

type StepApplyResult = {
  readonly kind: 'applied';
  readonly state: GameState;
  readonly log: readonly string[];
};

type StepRecordedSkipResult = {
  readonly kind: 'recorded_skip';
  readonly message: string;
  readonly reason:
    | 'no_deterministic_target'
    | 'unsupported_where_clause'
    | 'unsupported_condition_clause'
    | 'unsupported_scaler'
    | 'target_not_on_battlefield';
};

type StepUnrecordedSkipResult = {
  readonly kind: 'unrecorded_skip';
  readonly log: string;
};

export type ModifyPtStepHandlerResult = StepApplyResult | StepRecordedSkipResult | StepUnrecordedSkipResult;

function countAttackingCreaturesMatching(
  state: GameState,
  targetCreatureId: string,
  options?: {
    readonly subtype?: string;
    readonly excludeTarget?: boolean;
    readonly controllerId?: PlayerID;
    readonly onlyControlledBy?: PlayerID;
  }
): number {
  const combat: any = (state as any).combat || {};
  const attackingIds = Array.isArray(combat.attackers)
    ? combat.attackers.map((entry: any) => String(entry?.permanentId || entry?.id || '').trim()).filter(Boolean)
    : [];
  const excludedId = options?.excludeTarget ? String(targetCreatureId || '').trim() : '';
  const subtype = String(options?.subtype || '').trim().toLowerCase();
  const subtypePattern = subtype ? new RegExp(`\\b${subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i') : null;
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];

  return battlefield.filter((permanent: any) => {
    const permanentId = String(permanent?.id || permanent?.permanentId || '').trim();
    if (!permanentId || (excludedId && permanentId === excludedId)) return false;
    const isAttacking = Boolean(permanent?.attacking) || attackingIds.includes(permanentId);
    if (!isAttacking) return false;
    if (options?.onlyControlledBy) {
      const controller = String(permanent?.controller || permanent?.controllerId || '').trim();
      if (controller !== String(options.onlyControlledBy || '').trim()) return false;
    }
    if (subtypePattern) {
      const typeLine = String(
        permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ''
      );
      if (!subtypePattern.test(typeLine)) return false;
    }
    return true;
  }).length;
}

function countCreaturesBlockedByTarget(state: GameState, targetCreatureId: string): number {
  const targetId = String(targetCreatureId || '').trim();
  if (!targetId) return 0;
  const combat: any = (state as any).combat || {};
  if (Array.isArray(combat.blockers)) {
    const entry = combat.blockers.find(
      (candidate: any) => String(candidate?.permanentId || candidate?.id || '').trim() === targetId
    );
    if (entry && Array.isArray(entry.blocking)) {
      return new Set(entry.blocking.map((id: any) => String(id || '').trim()).filter(Boolean)).size;
    }
  }
  return 0;
}

function countCreaturesBlockingTarget(state: GameState, targetCreatureId: string): number {
  const targetId = String(targetCreatureId || '').trim();
  if (!targetId) return 0;
  const combat: any = (state as any).combat || {};
  const attackerEntry = Array.isArray(combat.attackers)
    ? combat.attackers.find((entry: any) => String(entry?.permanentId || '').trim() === targetId)
    : null;
  if (attackerEntry && Array.isArray(attackerEntry.blockedBy)) {
    return new Set(attackerEntry.blockedBy.map((id: any) => String(id || '').trim()).filter(Boolean)).size;
  }

  if (Array.isArray(combat.blockers)) {
    return combat.blockers.filter((entry: any) =>
      Array.isArray(entry?.blocking) && entry.blocking.some((id: any) => String(id || '').trim() === targetId)
    ).length;
  }

  return 0;
}

function countBasicLandTypesAmongLandsYouControl(state: GameState, controllerId: PlayerID): number {
  const basicLandTypes = new Set(['plains', 'island', 'swamp', 'mountain', 'forest']);
  const found = new Set<string>();
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  for (const permanent of battlefield) {
    if (String(permanent?.controllerId || permanent?.controller || '').trim() !== String(controllerId || '').trim()) continue;
    const typeLine = String(permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || '').toLowerCase();
    if (!/\bland\b/i.test(typeLine)) continue;
    for (const basicType of basicLandTypes) {
      if (new RegExp(`\\b${basicType}\\b`, 'i').test(typeLine)) found.add(basicType);
    }
  }
  return found.size;
}

function countArtifactsYouControl(state: GameState, controllerId: PlayerID): number {
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  return battlefield.filter((permanent: any) => {
    if (String(permanent?.controllerId || permanent?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    const typeLine = String(permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || '').toLowerCase();
    return /\bartifact\b/i.test(typeLine);
  }).length;
}

function countOtherAttackingAurochs(state: GameState, targetCreatureId: string): number {
  const targetId = String(targetCreatureId || '').trim();
  const combat: any = (state as any).combat || {};
  const attackingIds = Array.isArray(combat.attackers)
    ? combat.attackers.map((entry: any) => String(entry?.permanentId || entry?.id || '').trim()).filter(Boolean)
    : [];
  if (attackingIds.length === 0) return 0;

  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  return battlefield.filter((permanent: any) => {
    const permanentId = String(permanent?.id || permanent?.permanentId || '').trim();
    if (!permanentId || permanentId === targetId || !attackingIds.includes(permanentId)) return false;
    const typeLine = String(permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || '').toLowerCase();
    const name = String(permanent?.card?.name || permanent?.name || '').toLowerCase();
    return /\baurochs\b/i.test(typeLine) || /\baurochs\b/i.test(name);
  }).length;
}

function countControlledCreaturesWithSubtype(
  state: GameState,
  controllerId: PlayerID,
  subtype: string
): number {
  const normalizedSubtype = String(subtype || '').trim().toLowerCase();
  if (!normalizedSubtype) return 0;
  const escaped = normalizedSubtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const subtypePattern = new RegExp(`\\b${escaped}s?\\b`, 'i');
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  return battlefield.filter((permanent: any) => {
    if (String(permanent?.controllerId || permanent?.controller || '').trim() !== String(controllerId || '').trim()) {
      return false;
    }
    const typeLine = String(
      permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ''
    ).toLowerCase();
    return /\bcreature\b/i.test(typeLine) && subtypePattern.test(typeLine);
  }).length;
}

function countPartyCreatures(state: GameState, controllerId: PlayerID): number {
  const partyClasses = ['cleric', 'rogue', 'warrior', 'wizard'];
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  let count = 0;
  for (const klass of partyClasses) {
    const hasMember = battlefield.some((permanent: any) => {
      if (String(permanent?.controller || permanent?.controllerId || '').trim() !== String(controllerId || '').trim()) {
        return false;
      }
      const typeLine = String(
        permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ''
      ).toLowerCase();
      return /\bcreature\b/i.test(typeLine) && new RegExp(`\\b${klass}s?\\b`, 'i').test(typeLine);
    });
    if (hasMember) count += 1;
  }
  return count;
}

function countBloodTokensForPlayer(state: GameState, playerId: PlayerID): number {
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  return battlefield.reduce((sum: number, permanent: any) => {
    if (String(permanent?.controller || permanent?.controllerId || '').trim() !== String(playerId || '').trim()) {
      return sum;
    }
    const counters = (permanent as any)?.counters;
    if (!counters || typeof counters !== 'object') return sum;
    const blood = Number((counters as any).blood ?? (counters as any).Blood ?? 0);
    return sum + (Number.isFinite(blood) ? Math.max(0, blood) : 0);
  }, 0);
}

function resolveReferenceScalerScale(
  state: GameState,
  controllerId: PlayerID,
  targetCreatureId: string,
  raw: string,
  runtime: ModifyPtRuntime,
  ctx?: OracleIRExecutionContext
): number | null {
  const normalized = String(raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  if (/^for each creature blocking it$/.test(normalized)) {
    return Math.max(0, countCreaturesBlockingTarget(state, targetCreatureId));
  }
  if (/^for each card revealed this way$/.test(normalized)) {
    return Math.max(0, runtime.lastRevealedCardCount | 0);
  }
  if (/^for each nonland card revealed this way$/.test(normalized)) {
    const revealed = Array.isArray(runtime.lastMovedCards) ? runtime.lastMovedCards : [];
    return revealed.reduce((count: number, card: any) => {
      const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
      return count + (typeLine.includes('land') ? 0 : 1);
    }, 0);
  }
  if (/^for each card discarded this way$/.test(normalized)) {
    return Math.max(0, runtime.lastDiscardedCardCount | 0);
  }
  if (/^for each card looked at while scrying this way$/.test(normalized)) {
    return Math.max(0, runtime.lastScryLookedAtCount | 0);
  }
  if (/^for each creature tapped this way$/.test(normalized)) {
    return Math.max(0, runtime.lastTappedMatchingPermanentCount | 0);
  }
  if (/^for each artifact you control$/.test(normalized)) {
    return Math.max(0, countArtifactsYouControl(state, controllerId));
  }
  if (/^for each basic land type among lands you control$/.test(normalized)) {
    return Math.max(0, countBasicLandTypesAmongLandsYouControl(state, controllerId));
  }
  if (/^for each other attacking aurochs$/.test(normalized)) {
    return Math.max(0, countOtherAttackingAurochs(state, targetCreatureId));
  }
  if (/^for each attacking creature$/.test(normalized)) {
    return Math.max(0, countAttackingCreaturesMatching(state, targetCreatureId));
  }
  if (/^for each other attacking creature$/.test(normalized)) {
    return Math.max(0, countAttackingCreaturesMatching(state, targetCreatureId, { excludeTarget: true }));
  }
  if (/^for each creature in your party$/.test(normalized)) {
    return Math.max(0, countPartyCreatures(state, controllerId));
  }
  if (/^for each creature card put into your graveyard this way$/.test(normalized)) {
    const moved = Array.isArray(runtime.lastMovedCards) ? runtime.lastMovedCards : [];
    return moved.reduce((count: number, card: any) => {
      const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
      return count + (/\bcreature\b/i.test(typeLine) ? 1 : 0);
    }, 0);
  }
  if (/^for each blood token defending player controls$/.test(normalized)) {
    const defendingPlayerId = String(ctx?.selectorContext?.targetOpponentId || ctx?.selectorContext?.targetPlayerId || '').trim() as PlayerID;
    return defendingPlayerId ? Math.max(0, countBloodTokensForPlayer(state, defendingPlayerId)) : null;
  }
  if (/^for each lore counter on this artifact$/.test(normalized)) {
    const sourceId = String(ctx?.sourceId || '').trim();
    const source = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    const lore = Number((source as any)?.counters?.lore ?? (source as any)?.counters?.Lore ?? 0);
    return Number.isFinite(lore) ? Math.max(0, lore) : 0;
  }
  if (/^for each color of mana spent to cast that spell$/.test(normalized)) {
    const colors = Number((state as any)?.manaSpentToCastLastSpellColors?.[controllerId] ?? (ctx as any)?.manaSpentToCastLastSpellColors ?? 2);
    return Number.isFinite(colors) ? Math.max(0, colors) : 0;
  }
  if (/^for each time you've cast a commander from the command zone this game$/.test(normalized)) {
    const casts = Number((state as any)?.commanderCastsFromCommandZoneThisGame?.[controllerId] ?? 0);
    return Number.isFinite(casts) ? Math.max(0, casts) : 0;
  }
  if (/^for each card you'?ve drawn this turn$/.test(normalized) || /^for each card you have drawn this turn$/.test(normalized)) {
    const drawn = Number((state as any)?.cardsDrawnThisTurn?.[controllerId] ?? ctx?.referenceAmount ?? 1);
    return Number.isFinite(drawn) ? Math.max(0, drawn) : 1;
  }
  if (/^for each card in your hand$/.test(normalized)) {
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === String(controllerId || '').trim());
    const hand = Array.isArray((player as any)?.hand) ? (player as any).hand : [];
    return hand.length;
  }
  if (/^for each poison counter its controller has$/.test(normalized)) {
    const battlefield = (state.battlefield || []) as any[];
    const targetPermanent = battlefield.find(
      (perm: any) => String(perm?.id || '').trim() === String(targetCreatureId || '').trim()
    );
    const targetController = String(
      (targetPermanent as any)?.controller || (targetPermanent as any)?.controllerId || ''
    ).trim();
    if (!targetController) return null;
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === targetController) as any;
    const poison = Number(
      player?.poisonCounters ??
        (state as any)?.poisonCounters?.[targetController] ??
        player?.counters?.poison ??
        0
    );
    return Number.isFinite(poison) ? Math.max(0, poison) : 0;
  }

  if (/^for each \{b\} or \{r\} spent this way$/.test(normalized)) {
    const spent = Number(runtime?.lastReferenceAmount ?? (state as any)?.manaSpentThisWay?.[controllerId] ?? 2);
    return Number.isFinite(spent) ? Math.max(0, spent) : 0;
  }

  const otherAttackingSubtypeMatch = normalized.match(/^for each other attacking ([a-z][a-z -]+)$/);
  if (otherAttackingSubtypeMatch) {
    return Math.max(
      0,
      countAttackingCreaturesMatching(state, targetCreatureId, {
        excludeTarget: true,
        subtype: String(otherAttackingSubtypeMatch[1] || '').trim(),
      })
    );
  }

  const subtypeYouControlMatch = normalized.match(/^for each ([a-z][a-z /-]+?) you control$/);
  if (subtypeYouControlMatch) {
    const subtypeText = String(subtypeYouControlMatch[1] || '').trim();
    if (subtypeText.includes(' and/or ')) {
      const parts = subtypeText.split(/\s+and\/or\s+/i).map((part) => part.trim()).filter(Boolean);
      const seen = new Set<string>();
      for (const permanent of ((state as any).battlefield || []) as any[]) {
        if (String(permanent?.controller || permanent?.controllerId || '').trim() !== String(controllerId || '').trim()) {
          continue;
        }
        const typeLine = String(
          permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ''
        ).toLowerCase();
        if (!/\bcreature\b/i.test(typeLine)) continue;
        if (parts.some((part) => new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(typeLine))) {
          seen.add(String(permanent?.id || '').trim());
        }
      }
      return seen.size;
    }
    return Math.max(0, countControlledCreaturesWithSubtype(state, controllerId, subtypeText));
  }

  const subtypeCreatureMatch = normalized.match(/^for each ([a-z][a-z -]+?) creature you control$/);
  if (subtypeCreatureMatch) {
    return Math.max(
      0,
      countControlledCreaturesWithSubtype(state, controllerId, String(subtypeCreatureMatch[1] || '').trim())
    );
  }

  if (/^for each creature it's blocking$/.test(normalized)) {
    return Math.max(0, countCreaturesBlockedByTarget(state, targetCreatureId));
  }

  if (/^for each name sticker on it that begins with the chosen letter$/.test(normalized)) {
    const chosenLetter = String(ctx?.selectorContext?.chosenLetter || '')
      .trim()
      .toLowerCase()
      .charAt(0);
    if (!chosenLetter) return null;
    const sourceId = String(ctx?.sourceId || targetCreatureId || '').trim();
    const source = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    const stickers = Array.isArray((source as any)?.stickers) ? (source as any).stickers : [];
    return stickers.filter((sticker: any) => {
      if (String(sticker?.type || sticker?.kind || 'name').toLowerCase() !== 'name') return false;
      const text = String(sticker?.text || sticker?.name || '').trim().toLowerCase();
      return text.startsWith(chosenLetter);
    }).length;
  }

  if (/^for each name sticker on it(?: that begins with the same letter as its name)?$/.test(normalized)) {
    const sourceId = String(ctx?.sourceId || targetCreatureId || '').trim();
    const source = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    const stickers = Array.isArray((source as any)?.stickers) ? (source as any).stickers : [];
    return stickers.filter((sticker: any) => String(sticker?.type || sticker?.kind || 'name').toLowerCase() === 'name').length;
  }

  if (/^for each card type among cards in your hand$/.test(normalized)) {
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === String(controllerId || '').trim());
    const hand = Array.isArray((player as any)?.hand) ? (player as any).hand : [];
    const types = new Set<string>();
    for (const card of hand) {
      const typeLine = String((card as any)?.type_line || (card as any)?.card?.type_line || '').toLowerCase();
      for (const klass of ['artifact', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery', 'battle']) {
        if (new RegExp(`\\b${klass}\\b`, 'i').test(typeLine)) types.add(klass);
      }
    }
    return types.size;
  }

  if (/^for each card type among cards in your graveyard$/.test(normalized)) {
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === String(controllerId || '').trim());
    const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
    const types = new Set<string>();
    for (const card of graveyard) {
      const typeLine = String((card as any)?.type_line || (card as any)?.card?.type_line || '').toLowerCase();
      for (const klass of ['artifact', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery', 'battle']) {
        if (new RegExp(`\\b${klass}\\b`, 'i').test(typeLine)) types.add(klass);
      }
    }
    return types.size;
  }

  const forEachMatch = normalized.match(/^for each (.+)$/);
  if (forEachMatch && ctx) {
    const eachPart = String(forEachMatch[1] || '').trim();
    const fromForEach = tryResolveForEachReferenceAmount(state, controllerId, `1 for each ${eachPart}`, ctx, { runtime });
    if (fromForEach !== null) return fromForEach;

    const evaluated = evaluateModifyPtWhereX(
      state,
      controllerId,
      `X is the number of ${eachPart}`,
      targetCreatureId,
      ctx,
      runtime
    );
    if (evaluated !== null) return Math.max(0, evaluated);

    const evaluatedBare = evaluateModifyPtWhereX(
      state,
      controllerId,
      `X is ${eachPart}`,
      targetCreatureId,
      ctx,
      runtime
    );
    if (evaluatedBare !== null) return Math.max(0, evaluatedBare);
  }

  return null;
}

export function applyModifyPtStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'modify_pt' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime: ModifyPtRuntime,
  evaluateWhereX: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null,
  evaluateCondition: (
    state: GameState,
    controllerId: PlayerID,
    conditionRaw: string
  ) => boolean | null
): ModifyPtStepHandlerResult {
  const targetCreatureIds = resolveCreatureTargetIds(state, step.target, ctx);
  if (targetCreatureIds.length === 0) {
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (no deterministic creature target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  let whereXValue: number | null = null;

  if (step.condition) {
    if (step.condition.kind === 'where') {
      whereXValue = evaluateWhereX(
        state,
        controllerId,
        step.condition.raw,
        targetCreatureIds[0],
        ctx,
        runtime
      );
      if (whereXValue === null) {
        return {
          kind: 'recorded_skip',
          message: `Skipped P/T modifier (unsupported where-clause): ${step.raw}`,
          reason: 'unsupported_where_clause',
        };
      }
    } else {
      const condition = evaluateCondition(state, controllerId, step.condition.raw);
      if (condition === null) {
        return {
          kind: 'recorded_skip',
          message: `Skipped P/T modifier (unsupported condition clause): ${step.raw}`,
          reason: 'unsupported_condition_clause',
        };
      }

      if (!condition) {
        return {
          kind: 'unrecorded_skip',
          log: `Skipped P/T modifier (condition false): ${step.raw}`,
        };
      }
    }
  }

  if (step.scaler?.kind === 'unknown') {
    const inferredScalerRaw = String(step.raw || '').match(/\bfor each (.+?)(?:\.|$)/i)?.[1]?.trim();
    if (inferredScalerRaw) {
      const inferredScale = resolveReferenceScalerScale(
        state,
        controllerId,
        targetCreatureIds[0],
        `for each ${inferredScalerRaw}`,
        runtime,
        ctx
      );
      if (inferredScale !== null) {
        const basePower = step.powerUsesX ? ((step.power | 0) * (whereXValue ?? 0)) : (step.power | 0);
        const baseToughness = step.toughnessUsesX ? ((step.toughness | 0) * (whereXValue ?? 0)) : (step.toughness | 0);
        const powerBonus = basePower * inferredScale;
        const toughnessBonus = baseToughness * inferredScale;
        let nextState: GameState | null = state;
        for (const targetCreatureId of targetCreatureIds) {
          nextState = applyTemporaryPowerToughnessModifier(
            nextState,
            targetCreatureId,
            ctx,
            powerBonus,
            toughnessBonus,
            false
          );
          if (!nextState) {
            return {
              kind: 'recorded_skip',
              message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
              reason: 'target_not_on_battlefield',
            };
          }
        }
        return {
          kind: 'applied',
          state: nextState,
          log: [`${targetCreatureIds.length} creature(s) get +${powerBonus}/+${toughnessBonus} until end of turn`],
        };
      }
    }
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (unsupported scaler): ${step.raw}`,
      reason: 'unsupported_scaler',
    };
  }

  let scale = 1;
  if (step.scaler?.kind === 'reference_scaler') {
    const resolvedScale = resolveReferenceScalerScale(
      state,
      controllerId,
      targetCreatureIds[0],
      String(step.scaler.raw || ''),
      runtime,
      ctx
    );
    if (resolvedScale === null) {
      return {
        kind: 'recorded_skip',
        message: `Skipped P/T modifier (unsupported scaler): ${step.raw}`,
        reason: 'unsupported_scaler',
      };
    }
    scale = resolvedScale;
  } else if (step.scaler) {
    scale =
      step.scaler.kind === 'per_revealed_this_way'
        ? Math.max(0, runtime.lastRevealedCardCount | 0)
        : step.scaler.kind === 'per_creature_blocking_it'
          ? Math.max(0, countCreaturesBlockingTarget(state, targetCreatureIds[0]))
          : step.scaler.kind === 'per_basic_land_type_among_lands_you_control'
            ? Math.max(0, countBasicLandTypesAmongLandsYouControl(state, controllerId))
            : step.scaler.kind === 'per_artifact_you_control'
              ? Math.max(0, countArtifactsYouControl(state, controllerId))
              : step.scaler.kind === 'per_creature_tapped_this_way'
                ? Math.max(0, runtime.lastTappedMatchingPermanentCount | 0)
                : step.scaler.kind === 'per_other_attacking_aurochs'
                  ? Math.max(0, countOtherAttackingAurochs(state, targetCreatureIds[0]))
                  : 1;
  }

  if ((step.powerUsesX || step.toughnessUsesX) && whereXValue === null) {
    const inferredWhereRaw = String(step.raw || '').match(/\bwhere x is (.+?)(?:[.,]|$)/i)?.[1]?.trim();
    if (inferredWhereRaw) {
      whereXValue = evaluateWhereX(
        state,
        controllerId,
        inferredWhereRaw,
        targetCreatureIds[0],
        ctx,
        runtime
      );
    }
  }

  if ((step.powerUsesX || step.toughnessUsesX) && whereXValue === null) {
    const xValue = Number.isFinite(ctx.xValue) ? Math.max(0, Math.floor(ctx.xValue as number)) : null;
    if (xValue !== null) whereXValue = xValue;
  }

  if ((step.powerUsesX || step.toughnessUsesX) && whereXValue === null) {
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (X used without supported where-clause): ${step.raw}`,
      reason: 'unsupported_where_clause',
    };
  }

  const basePower = step.powerUsesX ? ((step.power | 0) * (whereXValue ?? 0)) : (step.power | 0);
  const baseToughness = step.toughnessUsesX ? ((step.toughness | 0) * (whereXValue ?? 0)) : (step.toughness | 0);
  const perTargetScaler =
    step.scaler?.kind === 'reference_scaler' &&
    /^for each poison counter its controller has$/i.test(String(step.scaler.raw || '').trim());

  let nextState: GameState | null = state;
  const logLines: string[] = [];
  for (const targetCreatureId of targetCreatureIds) {
    const effectiveScale = perTargetScaler
      ? (resolveReferenceScalerScale(
          state,
          controllerId,
          targetCreatureId,
          String(step.scaler?.raw || ''),
          runtime,
          ctx
        ) ?? 0)
      : scale;
    const powerBonus = basePower * effectiveScale;
    const toughnessBonus = baseToughness * effectiveScale;
    nextState = applyTemporaryPowerToughnessModifier(
      nextState,
      targetCreatureId,
      ctx,
      powerBonus,
      toughnessBonus,
      step.scaler?.kind === 'per_revealed_this_way'
    );

    if (!nextState) {
      return {
        kind: 'recorded_skip',
        message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
        reason: 'target_not_on_battlefield',
      };
    }
    logLines.push(`1 creature gets ${powerBonus >= 0 ? '+' : ''}${powerBonus}/${toughnessBonus >= 0 ? '+' : ''}${toughnessBonus}`);
  }

  return {
    kind: 'applied',
    state: nextState,
    log: [
      `${targetCreatureIds.length} creature(s) get ${basePower >= 0 ? '+' : ''}${basePower}/${baseToughness >= 0 ? '+' : ''}${baseToughness} per poison counter until end of turn`,
      ...logLines,
    ],
  };
}

export function applyModifyPtPerRevealedStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'modify_pt_per_revealed' }>,
  ctx: OracleIRExecutionContext,
  lastRevealedCardCount: number
): ModifyPtStepHandlerResult {
  const targetCreatureId = resolveTrepanationBoostTargetCreatureId(state, ctx);
  if (!targetCreatureId) {
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (no deterministic creature target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const revealed = Math.max(0, lastRevealedCardCount | 0);
  const powerBonus = revealed * (step.powerPerCard | 0);
  const toughnessBonus = revealed * (step.toughnessPerCard | 0);

  const nextState = applyTemporaryPowerToughnessModifier(
    state,
    targetCreatureId,
    ctx,
    powerBonus,
    toughnessBonus,
    true
  );
  if (!nextState) {
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
      reason: 'target_not_on_battlefield',
    };
  }

  return {
    kind: 'applied',
    state: nextState,
    log: [`${targetCreatureId} gets +${powerBonus}/+${toughnessBonus} until end of turn`],
  };
}

export function applySetBasePtStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'set_base_pt' }>,
  ctx: OracleIRExecutionContext
): ModifyPtStepHandlerResult {
  const targetCreatureIds = resolveCreatureTargetIds(state, step.target, ctx);
  if (targetCreatureIds.length === 0) {
    return {
      kind: 'recorded_skip',
      message: `Skipped base P/T setter (no deterministic creature target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const xValue = Number.isFinite(ctx.xValue) ? Math.max(0, Math.floor(ctx.xValue as number)) : null;
  if ((((step as any).powerUsesX) || ((step as any).toughnessUsesX)) && xValue === null) {
    return {
      kind: 'recorded_skip',
      message: `Skipped base P/T setter (missing X value): ${step.raw}`,
      reason: 'unsupported_scaler',
    };
  }

  const power = (step as any).powerUsesX ? ((step.power | 0) * (xValue ?? 0)) : (step.power | 0);
  const toughness = (step as any).toughnessUsesX ? ((step.toughness | 0) * (xValue ?? 0)) : (step.toughness | 0);

  let nextState = state;
  for (const targetCreatureId of targetCreatureIds) {
    const updatedState = applyTemporarySetBasePowerToughness(
      nextState,
      targetCreatureId,
      ctx,
      power,
      toughness
    );
    if (!updatedState) {
      return {
        kind: 'recorded_skip',
        message: `Skipped base P/T setter (target not on battlefield): ${step.raw}`,
        reason: 'target_not_on_battlefield',
      };
    }
    nextState = updatedState;
  }

  return {
    kind: 'applied',
    state: nextState,
    log: [
      targetCreatureIds.length === 1
        ? `${targetCreatureIds[0]} has base power and toughness ${power}/${toughness} until end of turn`
        : `${targetCreatureIds.length} creatures have base power and toughness ${power}/${toughness} until end of turn`,
    ],
  };
}

export function applySwitchPowerToughnessStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'switch_power_toughness' }>,
  ctx: OracleIRExecutionContext
): ModifyPtStepHandlerResult {
  const targetCreatureId = resolveSingleCreatureTargetId(state, step.target, ctx);
  if (!targetCreatureId) {
    return {
      kind: 'recorded_skip',
      message: `Skipped power/toughness switch (no deterministic creature target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const nextState = applyTemporarySwitchPowerToughness(state, targetCreatureId, ctx);
  if (!nextState) {
    return {
      kind: 'recorded_skip',
      message: `Skipped power/toughness switch (target not on battlefield): ${step.raw}`,
      reason: 'target_not_on_battlefield',
    };
  }

  return {
    kind: 'applied',
    state: nextState,
    log: [`${targetCreatureId} switches power and toughness until end of turn`],
  };
}
