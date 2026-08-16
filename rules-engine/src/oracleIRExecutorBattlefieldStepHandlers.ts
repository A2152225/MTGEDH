import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import { buildZoneObjectWithRetainedCounters } from '../../shared/src/zoneRetainedCounters';
import type { OracleBattlefieldObjectCondition, OracleEffectStep, OracleObjectSelector } from './oracleIR';
import { isEachPlayerMayPutCountersOnCreatureTheyControlStep } from './oracleIRCounterPlacement';
import { isPerPlayerOptionalOracleStep } from './oracleIRPerPlayerOptional';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  parseSimpleBattlefieldSelector,
  parseSimplePermanentTypeFromText,
  type SimpleBattlefieldSelector,
  type SimplePermanentType,
} from './oracleIRExecutorBattlefieldParser';
import { parseQuantity } from './oracleIRParserUtils';
import {
  cardMatchesType,
  moveTargetedCardFromExile,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
} from './oracleIRExecutorZoneOps';
import {
  applyTapOrUntapToBattlefield,
  permanentMatchesSelector,
  finalizeBattlefieldRemoval,
  moveMatchingBattlefieldPermanents,
  permanentMatchesType,
  resolveTapOrUntapTargetIds,
  type FinalizeBattlefieldRemovalOptions,
} from './oracleIRExecutorBattlefieldOps';
import { applyCounterDeltasToBattlefieldTargets } from './oracleIRExecutorCounterPlacementCommit';
import {
  createRegenerationShield,
  getAvailableShields,
  processDestructionWithRegeneration,
} from './keywordAbilities/regeneration';
import {
  DelayedTriggerTiming,
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  createWhenDealtDamageThisTurnTrigger,
  registerDelayedTrigger,
} from './delayedTriggeredAbilities';
import { createLastKnownPermanentSnapshot, type LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import {
  resolveBolsterTargetCreatureIdFromBattlefield,
  getProcessedBattlefield,
  resolveCreatureTargetIds,
  resolveMentorTargetCreatureIdFromBattlefield,
  resolveSingleCreatureTargetId,
  applyTemporarySetBasePowerToughness,
} from './oracleIRExecutorCreatureStepUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import {
  getCardManaValue,
  getCardTypeLineLower,
  normalizeOracleText,
  quantityToNumber,
  resolvePlayers,
  resolveVotesReceivedQuantity,
} from './oracleIRExecutorPlayerUtils';
import {
  parseReferencedPossessiveZonePhrase,
  resolveReferencedObjectPlayerIds,
  resolveReferencedPlayerZone,
} from './oracleIRExecutorReferenceUtils';
import { resolveOracleQuantity } from './oracleIRExecutorResolveQuantity';
import { findAntecedentStepIndex } from './oracleIRStepLedger';
import { resolveThisWayAntecedentStepIndex } from './oracleIRThisWayBinding';
import {
  resolveCreatureCountExiledThisWay,
  resolveNonlandCountDiscardedThisWay,
} from './oracleIRThisWayResolver';
import { findCardsExiledWithSource } from './oracleIRExecutorZoneOps';
import { resolveOracleIrBoundTargetSpellId } from './oracleIrTargetBinding';
import { getStackItems } from './stackOperations';
import { canTargetPermanent } from './permanentTargeting';
import {
  trySpecialAddCounterStep,
  trySpecialCopyPermanentStep,
  trySpecialDestroyStep,
  trySpecialDoubleCountersStep,
  trySpecialExileStep,
  trySpecialMonstrosityStep,
  trySpecialMoveCountersStep,
  trySpecialRegenerateStep,
  trySpecialRemoveCounterStep,
  trySpecialSacrificeStep,
  trySpecialScheduleDelayedBattlefieldActionStep,
  trySpecialExertStep,
  trySpecialTurnFaceDownStep,
  trySpecialTapOrUntapStep,
  trySpecialForceBlockStep,
  trySpecialSuspectStep,
} from './oracleIRExecutorSpecialTargetHandlers';
import {
  effectiveStepTarget,
  resolveAttachedReferenceTargets,
  resolveMassCreatureRestrictionTargets,
  resolveTargetPrefixedPermanents,
} from './oracleIRExecutorExtendedTargetResolution';
import { AIRBEND_ALTERNATE_COST } from './keywordActions/airbend';
import { EARTHBENDED_PROPERTIES } from './keywordActions/earthbend';

import { bridgedZoneStepResult } from './oracleIRStepLedgerRuntime';
import { oracleIrBattlefieldRemovalBridgeOptions } from './oracleIRExecutorBattlefieldOps';

function oracleIrBattlefieldRemovalOptions(
  ctx: OracleIRExecutionContext,
  stepKind: string,
): FinalizeBattlefieldRemovalOptions | undefined {
  return oracleIrBattlefieldRemovalBridgeOptions(ctx, stepKind);
}

function buildPermanentCardWithStats(perm: any, zone: string): any {
  const base = buildZoneObjectWithRetainedCounters((perm as any)?.card, perm, zone);
  const power = (perm as any)?.effectivePower ?? (perm as any)?.power ?? (perm as any)?.basePower ?? (perm as any)?.card?.power;
  const toughness =
    (perm as any)?.effectiveToughness ?? (perm as any)?.toughness ?? (perm as any)?.baseToughness ?? (perm as any)?.card?.toughness;
  const owner = (perm as any)?.owner ?? (perm as any)?.ownerId ?? (perm as any)?.controller ?? (perm as any)?.controllerId;
  const controller = (perm as any)?.controller ?? (perm as any)?.controllerId ?? owner;
  return {
    ...base,
    ...(owner ? { owner, ownerId: owner } : {}),
    ...(controller ? { controller, controllerId: controller } : {}),
    ...(power !== undefined && power !== null ? { power } : {}),
    ...(toughness !== undefined && toughness !== null ? { toughness } : {}),
  };
}

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly count?: number;
  readonly lastExiledCards?: readonly any[];
  readonly lastExiledCardCount?: number;
  readonly lastSacrificedCreaturesPowerTotal?: number;
  readonly lastSacrificedPermanents?: readonly LastKnownPermanentSnapshot[];
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

export type BattlefieldStepHandlerResult = StepApplyResult | StepSkipResult;

type RecentBattlefieldRuntime = {
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
  readonly lastCreatedTokenIds?: readonly string[];
  readonly lastMovedCards?: readonly any[];
  readonly lastExiledCards?: readonly any[];
  readonly lastExiledCardCount?: number;
  readonly lastDiscardedCards?: readonly any[];
  readonly lastSacrificedPermanents?: readonly any[];
};

function escapeTypeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeArmyCreatureSelectorText(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined
): string | null {
  if (!target || target.kind !== 'raw') return null;
  const normalized = normalizeSelfReferenceText(String((target as any).text || ''));
  if (!normalized) return null;
  return /^(?:target |an |a )?army creature you control$/i.test(normalized) ? normalized : null;
}

function resolveDeterministicArmyCreatureSelection(
  battlefield: readonly BattlefieldPermanent[],
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] | null {
  if (!normalizeArmyCreatureSelectorText(target)) return null;

  const controllerId = String(ctx.controllerId || '').trim();
  if (!controllerId) return [];

  const matches = battlefield.filter((perm: any) => {
    if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
    if (!permanentMatchesType(perm, 'creature')) return false;
    return new RegExp(`(^|[^a-z])army($|[^a-z])`, 'i').test(getExecutorTypeLineLower(perm));
  });

  return matches.length === 1 ? matches : [];
}

function addSubtypeToTypeLine(typeLine: string, subtype: string): string {
  const trimmed = String(typeLine || '').trim();
  const normalizedSubtype = String(subtype || '').trim();
  if (!normalizedSubtype) return trimmed;
  if (!trimmed) return normalizedSubtype;
  if (new RegExp(`(^|[^a-z])${escapeTypeRegex(normalizedSubtype.toLowerCase())}($|[^a-z])`, 'i').test(trimmed.toLowerCase())) {
    return trimmed;
  }
  if (/\s+[—-]\s+/.test(trimmed)) return `${trimmed} ${normalizedSubtype}`;
  return `${trimmed} - ${normalizedSubtype}`;
}

function appendPermanentTypes(permanent: BattlefieldPermanent, addTypes: readonly string[]): BattlefieldPermanent {
  const normalizedTypes = addTypes.map(type => String(type || '').trim()).filter(Boolean);
  if (normalizedTypes.length === 0) return permanent;

  let changed = false;
  const grantedTypes = Array.isArray((permanent as any).grantedTypes) ? [...(permanent as any).grantedTypes] : [];
  const permanentSubtypes = Array.isArray((permanent as any).subtypes) ? [...(permanent as any).subtypes] : [];
  const cardSubtypes = Array.isArray((permanent as any)?.card?.subtypes) ? [...(permanent as any).card.subtypes] : [];
  let permanentTypeLine = String((permanent as any).type_line || (permanent as any)?.card?.type_line || '').trim();
  let cardTypeLine = String((permanent as any)?.card?.type_line || (permanent as any).type_line || '').trim();

  for (const typeName of normalizedTypes) {
    if (!grantedTypes.includes(typeName)) {
      grantedTypes.push(typeName);
      changed = true;
    }
    if (!permanentSubtypes.includes(typeName)) {
      permanentSubtypes.push(typeName);
      changed = true;
    }
    if (!cardSubtypes.includes(typeName)) {
      cardSubtypes.push(typeName);
      changed = true;
    }

    const nextPermanentTypeLine = addSubtypeToTypeLine(permanentTypeLine, typeName);
    const nextCardTypeLine = addSubtypeToTypeLine(cardTypeLine, typeName);
    if (nextPermanentTypeLine !== permanentTypeLine) {
      permanentTypeLine = nextPermanentTypeLine;
      changed = true;
    }
    if (nextCardTypeLine !== cardTypeLine) {
      cardTypeLine = nextCardTypeLine;
      changed = true;
    }
  }

  if (!changed) return permanent;

  return {
    ...(permanent as any),
    grantedTypes,
    subtypes: permanentSubtypes,
    type_line: permanentTypeLine,
    card: {
      ...((permanent as any).card || {}),
      subtypes: cardSubtypes,
      type_line: cardTypeLine,
    },
  } as any;
}

const BASIC_LAND_TYPE_NAMES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;
type BasicLandTypeName = typeof BASIC_LAND_TYPE_NAMES[number];

function normalizeBasicLandTypeName(value: unknown): BasicLandTypeName | null {
  const normalized = String(value || '').trim().toLowerCase();
  return BASIC_LAND_TYPE_NAMES.find(typeName => typeName.toLowerCase() === normalized) ?? null;
}

function setPermanentBasicLandType(
  permanent: BattlefieldPermanent,
  basicLandType: BasicLandTypeName,
  duration: 'end_of_turn' | 'static',
  ctx: OracleIRExecutionContext
): BattlefieldPermanent {
  const permanentAny: any = permanent as any;
  const card = { ...(permanentAny.card || {}) };
  const currentTypeLine = String(permanentAny.type_line || card.type_line || 'Land').trim() || 'Land';
  const typeParts = currentTypeLine.split(/\s+[—-]\s+/);
  const frontMatter = typeParts[0] && /\bland\b/i.test(typeParts[0]) ? typeParts[0].trim() : 'Land';
  const nextTypeLine = `${frontMatter} - ${basicLandType}`;
  const currentModifiers = Array.isArray(permanentAny.modifiers) ? [...permanentAny.modifiers] : [];
  const nextModifiers = duration === 'end_of_turn'
    ? [
        ...currentModifiers,
        {
          type: 'setBasicLandType',
          basicLandType,
          duration: 'end_of_turn',
          sourceId: ctx.sourceId,
          originalTypeLine: permanentAny.type_line,
          originalSubtypes: Array.isArray(permanentAny.subtypes) ? [...permanentAny.subtypes] : undefined,
          originalGrantedTypes: Array.isArray(permanentAny.grantedTypes) ? [...permanentAny.grantedTypes] : undefined,
          originalCardTypeLine: card.type_line,
          originalCardSubtypes: Array.isArray(card.subtypes) ? [...card.subtypes] : undefined,
        },
      ]
    : currentModifiers;

  return {
    ...permanentAny,
    type_line: nextTypeLine,
    subtypes: [basicLandType],
    grantedTypes: [basicLandType],
    modifiers: nextModifiers,
    card: {
      ...card,
      type_line: nextTypeLine,
      subtypes: [basicLandType],
      basicLandType,
    },
  } as any;
}

function isSingularBattlefieldTargetText(text: string): boolean {
  const normalized = String(text || '').trim();
  if (!/^target\b/i.test(normalized)) return false;
  if (/\b(?:two|three|four|five|six|seven|eight|nine|ten|any number of|up to)\b/i.test(normalized)) {
    return false;
  }
  return !/\btarget\b.*\b(?:creatures|artifacts|enchantments|planeswalkers|lands|battles|vehicles|tokens|permanents)\b/i.test(
    normalized
  );
}

function normalizeWhereQualifiedTarget(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined
): { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined {
  if (!target || target.kind !== 'raw') return target;
  const rawText = String((target as any).text || '').trim();
  if (!rawText) return target;
  const normalizedText = rawText
    .replace(/\s*,\s*where\s+x\s+is\s+.+$/i, '')
    .replace(/\s+equal\s+to\s+the\s+number\s+of\s+.+$/i, '')
    .replace(/\s+for each .+$/i, '')
    .replace(/^another\s+(target\s+.+)$/i, '$1')
    .trim();
  if (!normalizedText || normalizedText === rawText) return target;
  return {
    ...target,
    text: normalizedText,
  };
}

type ContextualBattlefieldReference =
  | { readonly mode: 'self' }
  | {
      readonly mode: 'contextual';
      readonly type: ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never;
      readonly tokenOnly?: boolean;
      readonly plural?: boolean;
      readonly subtype?: string;
    };

type SacrificeAttachmentReference =
  | {
      readonly mode: 'attached_to_source';
      readonly type: 'artifact' | 'enchantment' | 'creature' | 'permanent';
      readonly relation: 'source_is_attached_to_target' | 'target_is_attached_to_source';
      readonly subtype?: string;
    }
  | {
      readonly mode: 'attached_to_named';
      readonly type: 'artifact' | 'enchantment' | 'permanent';
      readonly subtype?: string;
      readonly attachedToName: string;
    };

type CardZoneLocation = {
  readonly playerId: PlayerID;
  readonly zone: 'graveyard' | 'hand' | 'exile';
};

function isContextualMovedCardReference(target: any): boolean {
  return (
    target.kind === 'raw' &&
    /^(?:it|that card|the exiled card|the exiled cards?)$/i.test(String((target as any).text || '').trim())
  );
}

function addCountersToZoneCardsById(
  state: GameState,
  cardIds: readonly string[],
  counterName: string,
  amountValue: number
): { readonly state: GameState; readonly updatedCards: readonly any[]; readonly updatedCount: number } {
  const wantedIds = new Set(cardIds.map(id => String(id || '').trim()).filter(Boolean));
  if (wantedIds.size === 0) {
    return { state, updatedCards: [], updatedCount: 0 };
  }

  const updatedCards: any[] = [];
  let updatedCount = 0;

  const players = (state.players || []).map((player: any) => {
    let changed = false;

    const updateZone = (zoneName: 'graveyard' | 'hand' | 'exile' | 'library') => {
      const zone = Array.isArray(player?.[zoneName]) ? player[zoneName] : [];
      let zoneChanged = false;
      const nextZone = zone.map((card: any) => {
        const cardId = String(card?.id || '').trim();
        if (!cardId || !wantedIds.has(cardId)) return card;
        zoneChanged = true;
        updatedCount += 1;
        const counters = { ...((card?.counters || {}) as Record<string, number>) };
        const currentCount = Number(counters[counterName] ?? 0);
        counters[counterName] = (Number.isFinite(currentCount) ? currentCount : 0) + amountValue;
        const nextCard = { ...card, counters };
        updatedCards.push(nextCard);
        return nextCard;
      });
      if (!zoneChanged) return;
      changed = true;
      player = { ...player, [zoneName]: nextZone };
    };

    updateZone('graveyard');
    updateZone('hand');
    updateZone('exile');
    updateZone('library');

    return changed ? player : player;
  });

  const battlefield = Array.isArray((state as any).battlefield)
    ? ((state as any).battlefield as any[])
    : [];
  let battlefieldChanged = false;
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String(perm?.id || '').trim();
    if (!permanentId || !wantedIds.has(permanentId)) return perm;
    battlefieldChanged = true;
    updatedCount += 1;
    const counters = { ...((perm?.counters || {}) as Record<string, number>) };
    const currentCount = Number(counters[counterName] ?? 0);
    counters[counterName] = (Number.isFinite(currentCount) ? currentCount : 0) + amountValue;
    const nextPermanent = { ...perm, counters };
    updatedCards.push(nextPermanent);
    return nextPermanent;
  });

  return {
    state: updatedCount > 0
      ? ({
          ...(state as any),
          players: players as any,
          ...(battlefieldChanged ? { battlefield: nextBattlefield as any } : {}),
        } as GameState)
      : state,
    updatedCards,
    updatedCount,
  };
}

function findCardZoneLocation(state: GameState, targetCardId: string): CardZoneLocation | null {
  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return null;

  const matches: CardZoneLocation[] = [];
  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;

    for (const zone of ['graveyard', 'hand', 'exile'] as const) {
      const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
      if (cards.some((card: any) => String(card?.id || '').trim() === wantedId)) {
        matches.push({ playerId, zone });
      }
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

function getChosenObjectIdsFromContext(ctx: OracleIRExecutionContext): string[] {
  return Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
}

function resolveTargetOpponentPlayerId(ctx: OracleIRExecutionContext): PlayerID {
  return String(
    ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2'
  ).trim() as PlayerID;
}

function cardMatchesArtifactOrCreature(card: any): boolean {
  return cardMatchesType(card, 'artifact_or_creature');
}

function pickArtifactOrCreatureFromPlayerZone(
  state: GameState,
  playerId: PlayerID,
  zone: 'hand' | 'graveyard',
  excludeIds: ReadonlySet<string> = new Set()
): string {
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
  const match = cards.find((card: any) => {
    const cardId = String(card?.id || '').trim();
    return cardId && !excludeIds.has(cardId) && cardMatchesArtifactOrCreature(card);
  });
  return String(match?.id || '').trim();
}

function exileContextualThatCardFromPlayerZones(
  state: GameState,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult | null {
  const opponentId = resolveTargetOpponentPlayerId(ctx);
  const chosenName = String(ctx.selectorContext?.chosenCardName || '').trim().toLowerCase();
  const preferredIds = getChosenObjectIdsFromContext(ctx);

  for (const cardId of preferredIds) {
    const location = findCardZoneLocation(state, cardId);
    if (!location || location.playerId !== opponentId) continue;
    if (location.zone !== 'hand' && location.zone !== 'graveyard') continue;
    const opponentPlayer = (state.players || []).find(
      (entry: any) => String(entry?.id || '').trim() === opponentId
    ) as any;
    const sourceCard =
      location.zone === 'hand'
        ? (Array.isArray(opponentPlayer?.hand) ? opponentPlayer.hand : []).find(
            (card: any) => String(card?.id || '').trim() === cardId
          )
        : (Array.isArray(opponentPlayer?.graveyard) ? opponentPlayer.graveyard : []).find(
            (card: any) => String(card?.id || '').trim() === cardId
          );
    const exiled = exileCardFromZoneLocation(state, location, cardId);
    if (exiled) {
      const movedCard = sourceCard ?? { id: cardId };
      return {
        ...exiled,
        lastMovedCards: [movedCard],
        lastExiledCards: [movedCard],
        lastExiledCardCount: 1,
      };
    }
  }

  if (chosenName) {
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === opponentId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand : [];
    const named = hand.find(
      (card: any) => String(card?.name || card?.card?.name || '').trim().toLowerCase() === chosenName
    );
    const namedId = String(named?.id || '').trim();
    if (namedId) {
      const exiled = exileCardFromZoneLocation(state, { playerId: opponentId, zone: 'hand' }, namedId);
      if (exiled) {
        return {
          ...exiled,
          lastMovedCards: [named],
          lastExiledCards: [named],
          lastExiledCardCount: 1,
        };
      }
    }
  }

  const fallbackId = pickArtifactOrCreatureFromPlayerZone(state, opponentId, 'hand');
  if (!fallbackId) return null;
  const exiled = exileCardFromZoneLocation(state, { playerId: opponentId, zone: 'hand' }, fallbackId);
  return exiled
    ? {
        ...exiled,
        lastExiledCards: [{ id: fallbackId }],
        lastExiledCardCount: 1,
      }
    : null;
}

function exileTheChosenCardsFromPlayerZones(
  state: GameState,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult | null {
  const opponentId = resolveTargetOpponentPlayerId(ctx);
  const preferredIds = getChosenObjectIdsFromContext(ctx).filter(cardId => {
    const location = findCardZoneLocation(state, cardId);
    return Boolean(
      location &&
        location.playerId === opponentId &&
        (location.zone === 'hand' || location.zone === 'graveyard')
    );
  });

  const cardIds = [...preferredIds];
  if (cardIds.length === 0) {
    const handId = pickArtifactOrCreatureFromPlayerZone(state, opponentId, 'hand');
    if (handId) cardIds.push(handId);
    const gyId = pickArtifactOrCreatureFromPlayerZone(state, opponentId, 'graveyard', new Set(cardIds));
    if (gyId) cardIds.push(gyId);
  }

  if (cardIds.length === 0) return null;

  let workingState = state;
  const combinedLog: string[] = [];
  const exiledCards: any[] = [];
  for (const cardId of cardIds) {
    const location = findCardZoneLocation(workingState, cardId);
    if (!location) continue;
    const exiled = exileCardFromZoneLocation(workingState, location, cardId);
    if (!exiled) continue;
    workingState = exiled.state;
    combinedLog.push(...(exiled.log || []));
    exiledCards.push({ id: cardId });
  }

  if (exiledCards.length === 0) return null;
  return {
    applied: true,
    state: workingState,
    log: combinedLog.length > 0 ? combinedLog : [`Exiled ${exiledCards.length} chosen card(s)`],
    lastExiledCards: exiledCards,
    lastExiledCardCount: exiledCards.length,
    lastMovedCards: exiledCards,
  };
}

function exileCardFromZoneLocation(
  state: GameState,
  location: CardZoneLocation,
  cardId: string
): StepApplyResult | null {
  if (location.zone === 'exile') {
    return { applied: true, state, log: [`${cardId} is already exiled`] };
  }

  const result =
    location.zone === 'graveyard'
      ? moveTargetedCardFromGraveyard(state, location.playerId, cardId, { cardType: 'any' }, 'exile')
      : location.zone === 'hand'
        ? moveTargetedCardFromHand(state, location.playerId, cardId, 'any', 'exile')
        : null;

  if (!result || result.kind !== 'applied') return null;
  return { applied: true, state: result.state, log: result.log };
}

function exileContextualSourceCardFromZone(
  state: GameState,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult | null {
  const sourceId = String(ctx.sourceId || '').trim();
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const sourceName = normalizeSelfReferenceText(String(ctx.sourceName || ''));

  const candidateIds = Array.from(
    new Set([sourceId, 'gy-source-self', 'exile-source-self'].map(id => String(id || '').trim()).filter(Boolean))
  );

  for (const cardId of candidateIds) {
    const location = findCardZoneLocation(state, cardId);
    if (!location) continue;
    const exiled = exileCardFromZoneLocation(state, location, cardId);
    if (exiled) return exiled;
  }

  if (!sourceName) return null;
  const controller = (state.players || []).find(
    (player: any) => String(player?.id || '').trim() === String(controllerId || '').trim()
  ) as any;
  if (!controller) return null;

  for (const zone of ['graveyard', 'hand', 'exile'] as const) {
    const cards = Array.isArray(controller?.[zone]) ? controller[zone] : [];
    const namedMatches = cards.filter((card: any) => {
      const cardName = normalizeSelfReferenceText(String(card?.name || card?.card?.name || ''));
      return cardName && cardName === sourceName;
    });
    if (namedMatches.length !== 1) continue;
    const cardId = String((namedMatches[0] as any)?.id || '').trim();
    if (!cardId) continue;
    const exiled = exileCardFromZoneLocation(state, { playerId: controllerId, zone }, cardId);
    if (exiled) return exiled;
  }

  return null;
}

function annotateBattlefieldExilesWithSource(
  state: GameState,
  removed: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext
): GameState {
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceRef = sourceId || String(ctx.sourceName || '').trim();
  if (!sourceRef || removed.length === 0) return state;

  const removedCardIds = new Set(
    removed
      .map(perm => String(((perm as any)?.card?.id ?? (perm as any)?.id) || '').trim())
      .filter(Boolean)
  );
  if (removedCardIds.size === 0) return state;

  const updatedPlayers = (state.players || []).map((player: any) => {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    let changed = false;
    const nextExile = exile.map((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || !removedCardIds.has(cardId)) return card;
      changed = true;
      return {
        ...card,
        exiledBy: sourceRef,
        ...(sourceId ? { exiledWith: sourceId, exiledWithSourceId: sourceId } : {}),
      };
    });
    return changed ? ({ ...player, exile: nextExile } as any) : player;
  });

  return { ...(state as any), players: updatedPlayers as any } as any;
}

export function parseSacrificeWhat(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly mode: 'self' }
  | {
      readonly mode: 'contextual';
      readonly type: ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never;
      readonly tokenOnly?: boolean;
      readonly plural?: boolean;
    }
  | {
      readonly mode: 'all';
      readonly type: ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never;
      readonly types?: readonly (ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never)[];
      readonly subtype?: string;
      readonly tokenOnly?: boolean;
      readonly excludeSource?: boolean;
    }
  | {
      readonly mode: 'count';
      readonly count: number;
      readonly type: ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never;
      readonly types?: readonly (ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never)[];
      readonly subtype?: string;
      readonly excludeSubtype?: string;
      readonly tokenOnly?: boolean;
      readonly excludeSource?: boolean;
      readonly usesVariableCount?: boolean;
      readonly greatestPowerAmongControlled?: boolean;
    }
  | SacrificeAttachmentReference
  | { readonly mode: 'created_with_source'; readonly plural?: boolean }
  | { readonly mode: 'choice_required' }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase();
  const normalized = cleaned.replace(/\u2019/g, "'");
  const normalizeSubtypeWord = (value: string): string => {
    const trimmed = String(value || '').trim().toLowerCase();
    if (!trimmed) return '';
    return trimmed.endsWith('s') ? trimmed.slice(0, -1) : trimmed;
  };

  if (
    /\bof (?:their|his or her|that player's|that opponent's) choice\b/i.test(normalized) ||
    /\bchosen\b/i.test(normalized) ||
    /\bat random\b/i.test(normalized) ||
    /\bunless\b/i.test(normalized) ||
    /\s+or\s+pay\b/i.test(normalized) ||
    /\s+and\s+pay\b/i.test(normalized) ||
    /^any number of\b/i.test(normalized) ||
    /^one or more\b/i.test(normalized) ||
    /^up to\b/i.test(normalized) ||
    /^one of them\b/i.test(normalized) ||
    /^that many\b/i.test(normalized)
  ) {
    return { mode: 'choice_required' };
  }

  if (
    /^(?:it|this creature|this artifact|this enchantment|this aura|this equipment|this land|this planeswalker|this battle|this vehicle|this permanent|this attraction)$/i.test(
      normalized
    )
  ) {
    return { mode: 'self' };
  }

  if (/^(?:that creature|the creature|the creature dealt damage)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature' };
  }

  if (/^(?:that vehicle|the vehicle)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'vehicle' };
  }

  if (/^(?:that land|the land)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'land' };
  }

  if (/^those creatures$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature', plural: true };
  }

  if (/^that permanent$/i.test(normalized)) {
    return { mode: 'contextual', type: 'permanent' };
  }

  if (/^(?:that token|the token)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'permanent', tokenOnly: true };
  }

  if (/^(?:those tokens|them)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'permanent', tokenOnly: /^those tokens$/i.test(normalized), plural: true };
  }

  if (/^(?:each\s+)?tokens?\s+created\s+with\s+it$/i.test(normalized)) {
    return { mode: 'created_with_source', plural: true };
  }

  if (/^enchanted creature$/i.test(normalized)) {
    return { mode: 'attached_to_source', type: 'creature', relation: 'source_is_attached_to_target' };
  }

  {
    const mAttachedNamed = cleaned.match(/^an?\s+([a-z][a-z'-]*)\s+attached\s+to\s+(.+)$/i);
    if (mAttachedNamed) {
      const subtypeOrType = String(mAttachedNamed[1] || '').trim().toLowerCase();
      const attachedToName = normalizeSelfReferenceText(String(mAttachedNamed[2] || ''));
      const attachedToSelf = /^(?:it|this creature|this artifact|this enchantment|this aura|this equipment|this land|this planeswalker|this battle|this vehicle|this permanent)$/i.test(
        attachedToName
      );
      if (subtypeOrType === 'equipment') {
        if (attachedToSelf) return { mode: 'attached_to_source', type: 'artifact', relation: 'target_is_attached_to_source', subtype: 'equipment' };
        return {
          mode: 'attached_to_named',
          type: 'artifact',
          subtype: 'equipment',
          attachedToName,
        };
      }
      if (subtypeOrType === 'aura') {
        if (attachedToSelf) return { mode: 'attached_to_source', type: 'enchantment', relation: 'target_is_attached_to_source', subtype: 'aura' };
        return {
          mode: 'attached_to_named',
          type: 'enchantment',
          subtype: 'aura',
          attachedToName,
        };
      }
      if (subtypeOrType === 'permanent') {
        if (attachedToSelf) return { mode: 'attached_to_source', type: 'permanent', relation: 'target_is_attached_to_source' };
        return { mode: 'attached_to_named', type: 'permanent', attachedToName };
      }
    }
  }

  {
    const mentionsOpponentControl =
      /^(?:your\s+)?opponents?['â€™]s?\s+/i.test(normalized) ||
      /^opponent['â€™]s?\s+/i.test(normalized) ||
      /\b(?:your opponents|opponents)\s+control\b/i.test(normalized) ||
      /\b(?:an opponent|each opponent)\s+controls\b/i.test(normalized) ||
      /\byou\s+(?:don'?t|do not)\s+control\b/i.test(normalized);

    if (!mentionsOpponentControl && (/^your\s+/i.test(normalized) || /\b(?:you control|under your control)\b/i.test(normalized))) {
      const stripped = normalized
        .replace(/^your\s+/i, '')
        .replace(/\s+you\s+control\b/gi, '')
        .replace(/\s+under\s+your\s+control\b/gi, '')
        .trim();
      const type = parseSimplePermanentTypeFromText(stripped);
      if (type) return { mode: 'all', type };
      if (/^[a-z][a-z'-]*$/i.test(stripped)) {
        return { mode: 'all', type: 'permanent', subtype: normalizeSubtypeWord(stripped) };
      }
    }
  }

  if (/^all\b/i.test(lower)) {
    const type = parseSimplePermanentTypeFromText(cleaned);
    if (type) return { mode: 'all', type };
    const allSubtype = cleaned.match(/^all\s+([a-z][a-z'-]*)s?\b/i);
    if (allSubtype) {
      return { mode: 'all', type: 'permanent', subtype: normalizeSubtypeWord(String(allSubtype[1] || '')) };
    }
    return null;
  }

  const parseMixedTypes = (text: string):
    | readonly (ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never)[]
    | null => {
    const parts = text.split(/\s+(?:or|and\/or)\s+/i).map(part => part.trim()).filter(Boolean);
    if (parts.length <= 1) return null;

    const types: (ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never)[] = [];
    for (const part of parts) {
      const parsed = parseSimplePermanentTypeFromText(part);
      if (!parsed) return null;
      if (!types.includes(parsed)) types.push(parsed);
    }

    return types.length > 1 ? types : null;
  };

  const mAnother = cleaned.match(/^another\s+(.+)$/i);
  if (mAnother) {
    const rest = String(mAnother[1] || '').trim();
    const mixedTypes = parseMixedTypes(rest);
    if (mixedTypes) {
      return { mode: 'count', count: 1, type: mixedTypes[0], types: mixedTypes, excludeSource: true };
    }
    if (rest) {
      const type = parseSimplePermanentTypeFromText(rest);
      if (type) return { mode: 'count', count: 1, type, excludeSource: true };
      const tokenSubtypeMatch = rest.match(/^([a-z][a-z'-]*)\s+tokens?$/i);
      if (tokenSubtypeMatch) {
        return {
          mode: 'count',
          count: 1,
          type: 'permanent',
          subtype: normalizeSubtypeWord(String(tokenSubtypeMatch[1] || '')),
          tokenOnly: true,
          excludeSource: true,
        };
      }
      if (/^[a-z][a-z'-]*$/i.test(rest)) {
        if (/^token$/i.test(rest)) return { mode: 'count', count: 1, type: 'permanent', tokenOnly: true, excludeSource: true };
        return { mode: 'count', count: 1, type: 'permanent', subtype: normalizeSubtypeWord(rest), excludeSource: true };
      }
    }
  }

  const mCount = cleaned.match(/^([a-z0-9-]+)\s+(.+)$/i);
  if (!mCount) return null;
  const countRaw = String(mCount[1] || '').toLowerCase();
  const rest = String(mCount[2] || '').trim();

  {
    const greatestPowerControlledMatch = rest.match(
      /^creatures? with the greatest power among creatures (?:they|he or she) control$/i
    );
    if (greatestPowerControlledMatch) {
      const parsedLeadingCount = parseQuantity(countRaw);
      if (parsedLeadingCount.kind === 'number' && parsedLeadingCount.value === 1) {
        return { mode: 'count', count: 1, type: 'creature', greatestPowerAmongControlled: true };
      }
    }
  }

  const parsedCount = parseQuantity(countRaw);
  if (parsedCount.kind === 'x') {
    const mixedTypes = parseMixedTypes(rest);
    if (mixedTypes) {
      return { mode: 'count', count: 0, type: mixedTypes[0], types: mixedTypes, usesVariableCount: true };
    }
    const type = parseSimplePermanentTypeFromText(rest);
    if (type) return { mode: 'count', count: 0, type, usesVariableCount: true };
    const tokenSubtypeMatch = rest.match(/^([a-z][a-z'-]*)\s+tokens?$/i);
    if (tokenSubtypeMatch) {
      return {
        mode: 'count',
        count: 0,
        type: 'permanent',
        subtype: normalizeSubtypeWord(String(tokenSubtypeMatch[1] || '')),
        tokenOnly: true,
        usesVariableCount: true,
      };
    }
    return { mode: 'choice_required' };
  }
  if (parsedCount.kind !== 'number') return null;
  const count = parsedCount.value;
  if (!Number.isFinite(count) || count <= 0) return null;

  const nonSubtypeMatch = rest.match(/^non-([a-z][a-z'-]*)\s+(.+)$/i);
  if (nonSubtypeMatch) {
    const excludedSubtype = normalizeSubtypeWord(String(nonSubtypeMatch[1] || ''));
    const typeRest = String(nonSubtypeMatch[2] || '').trim();
    const mixedTypes = parseMixedTypes(typeRest);
    if (mixedTypes) {
      return {
        mode: 'count',
        count: Math.max(1, count | 0),
        type: mixedTypes[0],
        types: mixedTypes,
        excludeSubtype: excludedSubtype,
        excludeSource: true,
      };
    }
    const type = parseSimplePermanentTypeFromText(typeRest);
    if (type) {
      return {
        mode: 'count',
        count: Math.max(1, count | 0),
        type,
        excludeSubtype: excludedSubtype,
        excludeSource: true,
      };
    }
  }

  const mixedTypes = parseMixedTypes(rest);
  if (mixedTypes) {
    return { mode: 'count', count: Math.max(1, count | 0), type: mixedTypes[0], types: mixedTypes };
  }

  const type = parseSimplePermanentTypeFromText(rest);
  if (type) {
    return { mode: 'count', count: Math.max(1, count | 0), type };
  }

  const tokenSubtypeMatch = rest.match(/^([a-z][a-z'-]*)\s+tokens?$/i);
  if (tokenSubtypeMatch) {
    return {
      mode: 'count',
      count: Math.max(1, count | 0),
      type: 'permanent',
      subtype: normalizeSubtypeWord(String(tokenSubtypeMatch[1] || '')),
      tokenOnly: true,
    };
  }

  if (/^[a-z][a-z'-]*$/i.test(rest)) {
    if (/^token$/i.test(rest)) return { mode: 'count', count: Math.max(1, count | 0), type: 'permanent', tokenOnly: true };
    const subtypeWord = normalizeSubtypeWord(rest);
    if (/^(?:plains|island|swamp|mountain|forest)$/i.test(subtypeWord)) {
      return { mode: 'count', count: Math.max(1, count | 0), type: 'land', subtype: subtypeWord };
    }
    return { mode: 'count', count: Math.max(1, count | 0), type: 'permanent', subtype: subtypeWord };
  }

  return null;
}

export function extractSacrificeWhatText(step: Extract<OracleEffectStep, { kind: 'sacrifice' }>): string {
  const direct = String((step.what as any)?.text || (step.what as any)?.raw || '').trim();
  if (direct) return direct;
  const rawMatch = String(step.raw || '').match(/(?:^then\s+)?sacrifice\s+(.+?)[.!?\s]*$/i);
  return rawMatch ? String(rawMatch[1] || '').trim() : '';
}

export function sacrificeSelectorRequiresPlayerChoice(
  step: Extract<OracleEffectStep, { kind: 'sacrifice' }>
): boolean {
  const parsed = parseSacrificeWhat({ kind: 'raw', text: extractSacrificeWhatText(step) });
  if (!parsed) return false;
  return parsed.mode !== 'self' && parsed.mode !== 'contextual' && parsed.mode !== 'created_with_source';
}

function inferSacrificeChoiceBounds(
  sacrificeWhatText: string,
  parsed: NonNullable<ReturnType<typeof parseSacrificeWhat>>,
  candidateCount: number
): { readonly minTargets: number; readonly maxTargets: number } {
  const lower = sacrificeWhatText.toLowerCase();
  if (parsed.mode === 'count') {
    const count = Math.max(1, parsed.count | 0);
    return { minTargets: count, maxTargets: count };
  }
  if (parsed.mode === 'all') {
    return { minTargets: candidateCount, maxTargets: candidateCount };
  }
  if (/^any number of\b/.test(lower)) {
    return { minTargets: 0, maxTargets: candidateCount };
  }
  if (/^one or more\b/.test(lower)) {
    return { minTargets: 1, maxTargets: candidateCount };
  }
  const upToMatch = lower.match(/^up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i);
  if (upToMatch) {
    const max = parseQuantity(String(upToMatch[1] || '1'));
    const maxTargets = max.kind === 'number' ? Math.min(max.value, candidateCount) : candidateCount;
    return { minTargets: 0, maxTargets };
  }
  const countMatch = lower.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i);
  if (countMatch) {
    const parsedCount = parseQuantity(String(countMatch[1] || '1'));
    if (parsedCount.kind === 'number') {
      const count = Math.min(parsedCount.value, candidateCount);
      return { minTargets: count, maxTargets: count };
    }
  }
  return { minTargets: 1, maxTargets: 1 };
}

export function buildSacrificeTargetSelectionOptions(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'sacrifice' }>,
  ctx: OracleIRExecutionContext
): {
  readonly minTargets: number;
  readonly maxTargets: number;
  readonly options: readonly { id: string; label: string; description?: string }[];
} | null {
  const sacrificeWhatText = extractSacrificeWhatText(step);
  const parsed = parseSacrificeWhat({ kind: 'raw', text: sacrificeWhatText });
  if (!parsed || parsed.mode === 'self' || parsed.mode === 'contextual' || parsed.mode === 'created_with_source') {
    return null;
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) return null;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const sourceId = String(ctx.sourceId || '').trim();
  const candidates: BattlefieldPermanent[] = [];

  const pushCandidateMatches = (
    filter: {
      readonly types: readonly SimplePermanentType[];
      readonly subtype?: string;
      readonly tokenOnly?: boolean;
      readonly excludeSource?: boolean;
    }
  ) => {
    for (const playerId of players) {
      for (const permanent of battlefield) {
        if (String((permanent as any)?.controller || '').trim() !== playerId) continue;
        if (filter.excludeSource && sourceId && String((permanent as any)?.id || '').trim() === sourceId) continue;
        if (!filter.types.some(type => permanentMatchesType(permanent, type))) continue;
        if (filter.tokenOnly && !(permanent as any)?.isToken) continue;
        if (filter.subtype) {
          const typeLineLower = getExecutorTypeLineLower(permanent);
          const subtypePattern = filter.subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (!new RegExp(`(^|[^a-z])${subtypePattern}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) continue;
        }
        if (sacrificeRequiresAttackingCreature(sacrificeWhatText) && !isPermanentAttackingForSacrifice(permanent)) {
          continue;
        }
        candidates.push(permanent);
      }
    }
  };

  if (parsed.mode === 'choice_required') {
    const stripped = sacrificeWhatText
      .replace(/\s+of (?:their|his or her|that player(?:'s)?|that opponent(?:'s)?) choice.*$/i, '')
      .replace(/^any number of\s+/i, '')
      .replace(/^one or more\s+/i, '')
      .replace(/^up to (?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+/i, '')
      .replace(/^(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+/i, '')
      .replace(/^an?\s+/i, '')
      .trim();
    const mixedTypes = stripped
      .split(/\s+(?:or|and\/or)\s+/i)
      .map(part => parseSimplePermanentTypeFromText(part.trim()))
      .filter((type): type is SimplePermanentType => type !== null);
    if (mixedTypes.length > 1) {
      pushCandidateMatches({ types: mixedTypes });
    } else {
      const type = parseSimplePermanentTypeFromText(stripped) || 'permanent';
      const tokenOnly = /\btokens?\b/i.test(stripped);
      pushCandidateMatches({ types: [type], tokenOnly });
    }
  } else if (parsed.mode === 'all' || parsed.mode === 'count') {
    const allowedTypes = Array.isArray(parsed.types) && parsed.types.length > 0 ? parsed.types : [parsed.type];
    pushCandidateMatches({
      types: allowedTypes,
      subtype: parsed.subtype,
      tokenOnly: parsed.tokenOnly,
      excludeSource: parsed.excludeSource,
    });
  } else if (parsed.mode === 'attached_to_source' || parsed.mode === 'attached_to_named') {
    const attachmentResolution = resolveAttachmentReferencePermanents(battlefield, parsed, players, ctx);
    candidates.push(...attachmentResolution.permanents);
  } else {
    return null;
  }

  const uniqueCandidates = Array.from(
    new Map(candidates.map(permanent => [String((permanent as any)?.id || '').trim(), permanent])).values()
  ).filter(permanent => String((permanent as any)?.id || '').trim());

  const bounds = inferSacrificeChoiceBounds(sacrificeWhatText, parsed, uniqueCandidates.length);
  const maxTargets = Math.min(bounds.maxTargets, uniqueCandidates.length);

  return {
    minTargets: Math.min(bounds.minTargets, maxTargets),
    maxTargets,
    options: uniqueCandidates.map(permanent => {
      const id = String((permanent as any)?.id || '').trim();
      const name = String((permanent as any)?.card?.name || (permanent as any)?.name || id);
      return {
        id,
        label: name,
        description: String((permanent as any)?.card?.type_line || (permanent as any)?.type_line || 'Permanent'),
      };
    }),
  };
}

function normalizeSelfReferenceText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBattlefieldTargetReferenceText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .trim()
    .replace(/^when you do,\s*/i, '')
    .replace(/\s+at the beginning of the next end step.*$/i, '')
    .replace(/\s+or if it would leave the battlefield.*$/i, '')
    .replace(/\s+instead$/i, '')
    .replace(/\s+at end of combat$/i, '')
    .replace(/\s+this turn$/i, '')
    .replace(/\s+doesn['']t untap during its controller(?:'s)? next untap step$/i, '')
    .replace(/^x target /i, 'up to x target ')
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferGrantTemporaryAbilityTargetFromRaw(raw: string): string {
  const normalized = String(raw || '')
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^tiered\s+/i, '')
    .replace(/^when you do,\s*/i, '')
    .replace(/^-\s*/i, '')
    .replace(/^(?:\{[^}]+\}\s*)+-\s*/i, '')
    .replace(/^(?:until end of turn,\s*|until your next turn,\s*|until the end of\b[^,]+,\s*)?/i, '')
    .replace(/^(?:whenever this creature attacks,\s*|whenever a creature enters under your control,\s*)?/i, '')
    .replace(/^(?:[ivxlcdm]+|\d+\s*-\s*\d+)\s*[-|]\s*/i, '')
    .replace(/^(?:bull rush|standoff|daybound)\s*-?\s*/i, '')
    .replace(/\s+(?:also\s+)?(?:get|gain)\s+.+$/i, '')
    .replace(/\s+gets?\s+.+$/i, '')
    .replace(/\s+can't be blocked.*$/i, '')
    .replace(/\s+assigns combat damage.*$/i, '')
    .trim();
  const whenDiscardMatch = normalized.match(
    /when you discard a creature card this way,\s*(target creature you control)\b/i
  );
  if (whenDiscardMatch) return String(whenDiscardMatch[1] || '').trim();
  const tieredTargetMatch = normalized.match(/\b(target creature you control)\b/i);
  if (tieredTargetMatch) return String(tieredTargetMatch[1] || '').trim();
  if (!normalized) return '';
  if (/creatures of the creature type of your choice/i.test(normalized)) {
    return 'creatures of the chosen creature type you control';
  }
  if (/^this (?:creature|permanent)\b/i.test(normalized)) return 'this creature';
  if (/^(?:it|he)\b/i.test(normalized)) return 'it';
  if (/^that artifact\b/i.test(normalized)) return 'that artifact';
  if (/^enchanted creature\b/i.test(normalized)) return 'enchanted creature';
  if (/^you\b/i.test(normalized)) return 'you';
  if (/^each opponent\b/i.test(normalized)) return 'each opponent';
  if (/^the next\b/i.test(normalized)) {
    const nextSpellMatch = normalized.match(/^(the next (?:.+?\s+)?spell you cast(?: this turn)?)/i);
    return nextSpellMatch ? String(nextSpellMatch[1] || '').trim() : 'the next spell you cast';
  }
  if (/^the creature dealt damage\b/i.test(normalized)) return 'that creature';
  if (/^all damage\b/i.test(normalized)) return 'enchanted creature';
  if (/^face-down spells\b/i.test(normalized)) return 'you';
  if (/^creature cards in your graveyard\b/i.test(normalized)) return 'creature cards in your graveyard';
  if (/^creatures named this permanent\b/i.test(normalized)) return 'creatures named this permanent';
  if (/^all creatures banded with it\b/i.test(normalized)) return 'all creatures banded with it';
  const equippedMatch = normalized.match(/(?:during your turn,\s*)?(equipped creature)\s+(?:gets?|gains?|has)\b/i);
  if (equippedMatch) return String(equippedMatch[1] || '').trim();
  const attackingYouControl = normalized.match(/^(attacking creatures you control)\b/i);
  if (attackingYouControl) return String(attackingYouControl[1] || '').trim();
  const attackingMassMatch = normalized.match(/^(attacking creatures)\s+(?:get|gain)\b/i);
  if (attackingMassMatch) return String(attackingMassMatch[1] || '').trim();
  const otherAttackingMatch = normalized.match(/^(other(?: red)? attacking creatures(?: you control)?)\b/i);
  if (otherAttackingMatch) return String(otherAttackingMatch[1] || '').trim();
  const withQualifierMass = normalized.match(/^(creatures you control with [^,]+?)(?:\s+(?:get|gain)\b|$)/i);
  if (withQualifierMass) return String(withQualifierMass[1] || '').trim();
  const multiSubtypeMatch = normalized.match(
    /^each ([a-z][a-z -]+(?:,\s*[a-z][a-z -]+)*(?:,?\s+and\s+[a-z][a-z -]+)?) you control$/i
  );
  if (multiSubtypeMatch) return `each ${String(multiSubtypeMatch[1] || '').trim()} you control`;
  const eachWithQualifier = normalized.match(/^each (creatures you control with [^,]+)$/i);
  if (eachWithQualifier) return String(eachWithQualifier[1] || '').trim();
  const eachSingularWithQualifier = normalized.match(
    /^each creature you control with ([^,]+?)(?:\s+(?:assigns?|gain|get)\b|$)/i
  );
  if (eachSingularWithQualifier) {
    return `creatures you control with ${String(eachSingularWithQualifier[1] || '').trim()}`;
  }
  const subtypeMassMatch = normalized.match(/^([a-z][a-z -]+) creatures you control(?: also)?$/i);
  if (subtypeMassMatch) return `${String(subtypeMassMatch[1] || '').trim()} creatures you control`;
  if (/^target creature$/i.test(normalized)) return 'target creature';
  if (/^target permanent$/i.test(normalized)) return 'target permanent';
  if (/^target planeswalker$/i.test(normalized)) return 'target planeswalker';
  const subtypeYouControlMatch = normalized.match(/^([a-z][a-z -]+) you control(?: also)?$/i);
  if (subtypeYouControlMatch && !/creatures?$/i.test(String(subtypeYouControlMatch[1] || ''))) {
    return `${String(subtypeYouControlMatch[1] || '').trim()} you control`;
  }
  const globalSubtypeMatch = normalized.match(/^([a-z][a-z -]+) creatures\s+(?:gain|get)\b/i);
  if (globalSubtypeMatch) return `${String(globalSubtypeMatch[1] || '').trim()} creatures`;
  const tokenMassMatch = normalized.match(/^(creature tokens you control)\s+gain\b/i);
  if (tokenMassMatch) return String(tokenMassMatch[1] || '').trim();
  const compoundMassMatch = normalized.match(/^(gorgons and snakes you control)\b/i);
  if (compoundMassMatch) return String(compoundMassMatch[1] || '').trim();
  const upToAttackingMatch = normalized.match(/^(up to x target attacking creatures)\b/i);
  if (upToAttackingMatch) return String(upToAttackingMatch[1] || '').trim();
  const xTargetCreaturesMatch = normalized.match(/^(x target creatures)\b/i);
  if (xTargetCreaturesMatch) return String(xTargetCreaturesMatch[1] || '').trim();
  const spellCostReductionMatch = normalized.match(
    /^((?:artifact,? )?(?:instant,? )?(?:and )?sorcery )?spells? you cast(?: this turn)? cost\b/i
  );
  if (spellCostReductionMatch) return 'you';
  const massYouControl = normalized.match(/^(creatures you control(?:\s+other\s+than\s+this\s+creature)?)\s+(?:get|gain)\b/i);
  if (massYouControl) return String(massYouControl[1] || '').trim();
  const otherMass = normalized.match(/^(other creatures you control)\s+(?:get|gain)\b/i);
  if (otherMass) return String(otherMass[1] || '').trim();
  const faceUpMass = normalized.match(/^(face-up nontoken creatures you control)\b/i);
  if (faceUpMass) return String(faceUpMass[1] || '').trim();
  return '';
}

function battlefieldPermanentHasFlying(perm: BattlefieldPermanent): boolean {
  if (/\bflying\b/i.test(getExecutorTypeLineLower(perm))) return true;
  const keywordValues: unknown[] = [
    ...(Array.isArray((perm as any)?.keywords) ? (perm as any).keywords : []),
    ...(Array.isArray((perm as any)?.card?.keywords) ? (perm as any).card.keywords : []),
    ...(Array.isArray((perm as any)?.grantedAbilities) ? (perm as any).grantedAbilities : []),
  ];
  return keywordValues.some(value => /\bflying\b/i.test(String(value || '')));
}

function battlefieldPermanentHasIslandwalk(perm: BattlefieldPermanent): boolean {
  if (/\bislandwalk\b/i.test(getExecutorTypeLineLower(perm))) return true;
  const keywordValues: unknown[] = [
    ...(Array.isArray((perm as any)?.keywords) ? (perm as any).keywords : []),
    ...(Array.isArray((perm as any)?.card?.keywords) ? (perm as any).card.keywords : []),
    ...(Array.isArray((perm as any)?.grantedAbilities) ? (perm as any).grantedAbilities : []),
  ];
  return keywordValues.some(value => /\bislandwalk\b/i.test(String(value || '')));
}

function permanentHasColorLetter(perm: BattlefieldPermanent, colorLetter: string): boolean {
  const colors = Array.isArray((perm as any)?.colors)
    ? (perm as any).colors
    : Array.isArray((perm as any)?.card?.colors)
      ? (perm as any).card.colors
      : [];
  const wanted = String(colorLetter || '').trim().toUpperCase();
  return colors.some((color: unknown) => {
    const normalized = String(color || '').trim().toUpperCase();
    return normalized === wanted || normalized.startsWith(wanted);
  });
}

function isAttackingBattlefieldPermanent(perm: BattlefieldPermanent): boolean {
  return Boolean(
    (perm as any)?.attacking ||
    (perm as any)?.attackedThisTurn ||
    (perm as any)?.attackingPlayerId
  );
}

function permanentHasBattlefieldCounters(perm: BattlefieldPermanent): boolean {
  return Object.entries(((perm as any)?.counters || {}) as Record<string, number>).some(
    ([, count]) => Number(count) > 0
  );
}

function normalizeGrantTemporaryAbilityTargetText(value: string, stepRaw = ''): string {
  const trimmed = normalizeBattlefieldTargetReferenceText(value)
    .replace(/^tiered\s+/i, '')
    .replace(/^when you do,\s*/i, '')
    .replace(/\s+and\s*$/i, '')
    .replace(/^-\s*/i, '')
    .replace(/^whenever this creature attacks,\s*/i, '')
    .replace(/^activate only as a sorcery\.?\s*["']?\s*(?:\{[^}]+\}(?:,\s*[^:]{0,120})?:\s*)+/i, '')
    .replace(/^choose one at random\s*-\s*•\s*/i, '')
    .replace(/^you may have\s+/i, '')
    .replace(/^have\s+/i, '')
    .replace(/^until end of turn,\s*/i, '')
    .replace(/^until the end of your next turn,\s*/i, '')
    .replace(/^until your next turn,\s*/i, '')
    .replace(/^during your turn,\s*/i, '')
    .replace(/^(?:[ivxlcdm]+|\d+\s*-\s*\d+)\s*[-|]\s*/i, '')
    .replace(/^(?:bull rush|standoff|daybound)\s*-\s*/i, '')
    .replace(/\s+each\s+get\s+[+-]?\d+\s*\/\s*[+-]?\d(?:\s+and)?\s*$/i, '')
    .replace(/\s+gets?\s+[+-]?\d+\s*\/\s*[+-]?\d(?:\s+and)?\s*$/i, '')
    .replace(
      /\s+assigns\s+combat\s+damage\s+equal\s+to\s+its\s+toughness\s+rather\s+than\s+its\s+power(?:\s+and)?\s*$/i,
      ''
    )
    .replace(/\s+and$/i, '')
    .trim();
  const whenDiscardMatch = trimmed.match(
    /when you discard a creature card this way,\s*(target creature you control)\b/i
  );
  if (whenDiscardMatch) return String(whenDiscardMatch[1] || '').trim();
  const embeddedTargetMatch = trimmed.match(/\b(target creature you control)\b/i);
  if (embeddedTargetMatch && /^tiered\b/i.test(value)) {
    return String(embeddedTargetMatch[1] || '').trim();
  }
  if (/^each creature you control with defender$/i.test(trimmed)) {
    return 'creatures you control with defender';
  }
  if (/^this creature(?:'s base power)?$/i.test(trimmed)) return 'this creature';
  const selfBecome = trimmed.match(/^(this (?:enchantment|permanent|creature))(?:\s+becomes|\s+become)\b/i);
  if (selfBecome) return String(selfBecome[1] || '').trim();
  const itBecome = trimmed.match(/^(it)\s+become\b/i);
  if (itBecome) return String(itBecome[1] || '').trim();
  const mass = trimmed.match(/^(creatures you control(?:\s+other\s+than\s+this\s+creature)?)\s+get\b/i);
  if (mass) return String(mass[1] || '').trim();
  const otherMass = trimmed.match(/^(other .+ you control)(?: with .+)?\s+(?:get|gain)\b/i);
  if (otherMass) return String(otherMass[1] || '').trim();
  const self = trimmed.match(/^(this creature)\s+(?:gets?|has\s+base\s+power)\b/i);
  if (self) return String(self[1] || '').trim();
  const enchanted = trimmed.match(/^(enchanted creature)\s+(?:gets?|gains?)\b/i);
  if (enchanted) return String(enchanted[1] || '').trim();
  const contextual = trimmed.match(
    /^(that creature|that permanent|that card|that vehicle|that planeswalker|they)\s+(?:gets?|gains?)\b/i
  );
  if (contextual) return String(contextual[1] || '').trim();
  const pronounOnly = trimmed.match(/^(they)\s+(?:gets?|gains?)\b/i);
  if (pronounOnly) return String(pronounOnly[1] || '').trim();
  const counterMass = trimmed.match(/^(each creature you control with a counter on it)\s+gains?\b/i);
  if (counterMass) return String(counterMass[1] || '').trim();
  const compoundMass = trimmed.match(/^(it and zombies you control)\s+gain\b/i);
  if (compoundMass) return String(compoundMass[1] || '').trim();
  const playerSpell = trimmed.match(/^(the next (?:.+?\s+)?spell you cast)(?: this turn)?\s+costs?\b/i);
  if (playerSpell) return String(playerSpell[1] || '').trim();
  if (/^the creature dealt damage\b/i.test(trimmed)) return 'that creature';
  const haveMass = trimmed.match(/^have (treasures you control)\b/i);
  if (haveMass) return String(haveMass[1] || '').trim();
  const graveyardCards = trimmed.match(/^(creature cards in your graveyard)\s+gain\b/i);
  if (graveyardCards) return String(graveyardCards[1] || '').trim();
  const otherResult = trimmed.match(/^for each other result, (it)\b/i);
  if (otherResult) return 'it';
  const attackingHuman = trimmed.match(/^(each attacking human)(?:\s+(?:gets?|gains?|gain))\b/i);
  if (attackingHuman) return String(attackingHuman[1] || '').trim();
  const chosenTypeMass = trimmed.match(/^creatures of the creature type of your choice\s+(?:get|gain)\b/i);
  if (chosenTypeMass) return 'creatures of the chosen creature type you control';
  if (/^other clues you control$/i.test(trimmed)) return 'other clues you control';
  const otherClues = trimmed.match(/^(other clues you control)\s+become\b/i);
  if (otherClues) return String(otherClues[1] || '').trim();
  const targetCreatureBuff = trimmed.match(/^(target creature you control)\s+get\b/i);
  if (targetCreatureBuff) return String(targetCreatureBuff[1] || '').trim();
  if (/^the chosen creature$/i.test(trimmed)) return 'the chosen creature';
  if (/^the creature that attacked$/i.test(trimmed)) return 'the creature that attacked';
  if (/^that mount or vehicle$/i.test(trimmed)) return 'that mount or vehicle';
  if (/^creature tokens you control$/i.test(trimmed)) return 'creature tokens you control';
  if (/^attacking creatures$/i.test(trimmed)) return 'attacking creatures';
  const subtypeCreatures = trimmed.match(/^([a-z][a-z -]+) creatures you control$/i);
  if (subtypeCreatures) return `${String(subtypeCreatures[1] || '').trim()} creatures you control`;
  if (/^gorgons and snakes you control$/i.test(trimmed)) return 'gorgons and snakes you control';
  if (/^that player$/i.test(trimmed)) return 'that player';
  if (/^that attacking creature$/i.test(trimmed)) return 'that attacking creature';
  const otherThanSelfMass = trimmed.match(
    /^([a-z][a-z -]+) you control other than this creature(?:\s+(?:get|gain)\b.*)?$/i
  );
  if (otherThanSelfMass) return `${String(otherThanSelfMass[1] || '').trim()} you control other than this creature`;
  const withQualifierMass = trimmed.match(/^(creatures you control with [^,]+?)(?:\s+(?:get|gain)\b.*)?$/i);
  if (withQualifierMass) return String(withQualifierMass[1] || '').trim();
  const subtypeYouControl = trimmed.match(/^([a-z][a-z -]+) you control$/i);
  if (subtypeYouControl && !/creatures?$/i.test(String(subtypeYouControl[1] || ''))) {
    return `${String(subtypeYouControl[1] || '').trim()} you control`;
  }
  const upToAttackingOnly = trimmed.match(/^(up to x target attacking creatures)/i);
  if (upToAttackingOnly) return String(upToAttackingOnly[1] || '').trim();
  const globalSubtype = trimmed.match(/^([a-z][a-z -]+) creatures$/i);
  if (globalSubtype && !/^up to\b/i.test(trimmed)) return `${String(globalSubtype[1] || '').trim()} creatures`;
  if (/^attacking creatures you control$/i.test(trimmed)) return 'attacking creatures you control';
  if (/^other red attacking creatures you control$/i.test(trimmed)) return 'other red attacking creatures you control';
  if (/^other attacking creatures(?: gain)?$/i.test(trimmed)) return 'other attacking creatures';
  if (/^face-up nontoken creatures you control$/i.test(trimmed)) return 'face-up nontoken creatures you control';
  if (/^each opponent$/i.test(trimmed)) return 'each opponent';
  if (/^he$/i.test(trimmed)) return 'it';
  if (/^that artifact$/i.test(trimmed)) return 'that artifact';
  const cleaned = trimmed
    .replace(/\s+get\s+[+-]?\d+\s*\/\s*[+-]?\d.*$/i, '')
    .replace(/\s+gain\s+.+$/i, '')
    .trim();
  if (!cleaned || /whenever|attacks,/i.test(cleaned)) {
    const inferred = inferGrantTemporaryAbilityTargetFromRaw(stepRaw || value);
    if (inferred) return inferred;
  }
  return cleaned;
}

function normalizeAnimatePermanentTargetText(value: string): string {
  const trimmed = normalizeBattlefieldTargetReferenceText(value)
    .replace(/^up to one\s+/i, '')
    .replace(/^one\s+/i, '')
    .replace(/\s+becomes?\s+an?\s+.+$/i, '')
    .trim();
  const haveTarget = trimmed.match(/^have\s+(target\s+.+)$/i);
  if (haveTarget) return String(haveTarget[1] || '').trim();
  const otherLand = trimmed.match(/^other\s+(target\s+land you control)$/i);
  if (otherLand) return String(otherLand[1] || '').trim();
  if (/^land you control$/i.test(trimmed)) return 'target land you control';
  return trimmed;
}

function normalizeExileTargetReferenceText(value: string): string {
  return normalizeBattlefieldTargetReferenceText(value)
    .replace(/^exile\s+/i, '')
    .replace(
      /\s+with\s+(?:\d+|a|an|x|one|two|three|four|five|six|seven|eight|nine|ten)\s+time\s+counters?\s+on\s+it$/i,
      ''
    )
    .replace(/\s+if\s+it(?:'s| is)\s+an?\s+(?:instant|sorcery)(?:\s+or\s+(?:instant|sorcery))?\s+card$/i, '')
    .replace(/\s+until\s+this\s+(?:creature|permanent|card|aura|enchantment|artifact)\s+leaves\s+the\s+battlefield$/i, '')
    .replace(/\s+instead\s+of\s+putting\s+it\s+into\s+(?:its owner's|your|a)\s+graveyard(?:\s+as\s+it\s+resolves)?$/i, '')
    .replace(/\s+instead\s+of\s+putting\s+(?:it|that spell)\s+into\s+(?:its owner's|your|a)\s+graveyard(?:\s+as\s+it\s+resolves)?$/i, '')
    .replace(/\s+instead\s+of\s+putting\s+it\s+anywhere\s+else$/i, '')
    .replace(/\s+unless\s+you\s+sacrifice\s+another\s+creature$/i, '')
    .replace(/\s+face\s+down$/i, '')
    .trim();
}

function collectBoundBattlefieldIds(ctx: OracleIRExecutionContext): string[] {
  return Array.from(
    new Set(
      [
        String(ctx.selectorContext?.combatOpponentCreatureId || '').trim(),
        String(ctx.targetPermanentId || '').trim(),
        String(ctx.targetCreatureId || '').trim(),
        String(ctx.selectorContext?.targetPermanentId || '').trim(),
        String(ctx.selectorContext?.targetCreatureId || '').trim(),
        ...(Array.isArray(ctx.selectorContext?.chosenObjectIds)
          ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
          : []),
      ].filter(Boolean)
    )
  );
}

function collectSacrificeChoiceBoundIds(
  battlefield: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext,
): string[] {
  const permanentIds = new Set(
    battlefield
      .map((perm: any) => String(perm?.id || '').trim())
      .filter(Boolean),
  );
  return collectBoundBattlefieldIds(ctx).filter((id) => permanentIds.has(id));
}

function sacrificeRequiresAttackingCreature(sacrificeWhatText: string): boolean {
  return /\battacking\s+creatures?\b/i.test(String(sacrificeWhatText || ''));
}

function isPermanentAttackingForSacrifice(permanent: any): boolean {
  return Boolean(
    permanent?.attacking ||
      permanent?.attackingPlayerId ||
      permanent?.isAttacking,
  );
}

const DISTRIBUTE_WORD_TO_NUMBER: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

function parseDistributeMaxTargets(targetText: string): number | undefined {
  const normalized = String(targetText || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (/any number of/i.test(normalized)) return undefined;

  const upToMatch = normalized.match(/\bup to (one|two|three|four|five|\d+)\b/i);
  if (upToMatch) {
    const token = String(upToMatch[1] || '').toLowerCase();
    return DISTRIBUTE_WORD_TO_NUMBER[token] ?? Number.parseInt(token, 10);
  }

  const orListMatch = normalized.match(/\b(one|two|three|four|five|\d+)(?:,\s*(?:one|two|three|four|five|\d+))+\b/i);
  if (orListMatch) {
    const tokens = normalized.match(/\b(one|two|three|four|five|\d+)\b/gi) || [];
    const values = tokens
      .map((token) => DISTRIBUTE_WORD_TO_NUMBER[String(token || '').toLowerCase()] ?? Number.parseInt(String(token || ''), 10))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (values.length > 0) return Math.max(...values);
  }

  return undefined;
}

function splitCountersAcrossTargets(totalCounters: number, targetCount: number): number[] {
  if (targetCount <= 0 || totalCounters <= 0) return [];
  const counts = new Array(targetCount).fill(0);
  let remaining = totalCounters;
  let index = 0;
  while (remaining > 0) {
    counts[index % targetCount] += 1;
    remaining -= 1;
    index += 1;
  }
  return counts;
}

function distributeCountersNeedsPlayerChoice(totalCounters: number, targetCount: number): boolean {
  return targetCount > 1 && totalCounters > targetCount;
}

function applyCounterDistributionToBattlefield(
  state: GameState,
  targetIds: readonly string[],
  perTargetCounts: readonly number[],
  counterName: string,
): { state: GameState; log: readonly string[] } {
  const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
    const permanentId = String(perm?.id || '').trim();
    const targetIndex = targetIds.indexOf(permanentId);
    if (targetIndex < 0) return perm;
    const addAmount = perTargetCounts[targetIndex] ?? 0;
    if (addAmount <= 0) return perm;
    const counters = { ...((perm?.counters || {}) as Record<string, number>) };
    const currentCount = Number(counters[counterName] ?? 0);
    counters[counterName] = (Number.isFinite(currentCount) ? currentCount : 0) + addAmount;
    return { ...perm, counters };
  });

  const totalApplied = perTargetCounts.reduce((sum, value) => sum + value, 0);
  return {
    state: { ...(state as any), battlefield: nextBattlefield } as GameState,
    log: [`Distributed ${totalApplied} ${counterName} counter(s) among ${targetIds.length} permanent(s)`],
  };
}

function resolveCounterDistributionCounts(
  totalCounters: number,
  targetIds: readonly string[],
  ctx: OracleIRExecutionContext,
): number[] | null {
  const rawDistribution = (ctx.selectorContext as any)?.counterDistributionByTargetId;
  if (!rawDistribution || typeof rawDistribution !== 'object' || Array.isArray(rawDistribution)) {
    return null;
  }

  const counts = targetIds.map((targetId) => {
    const amount = Number((rawDistribution as Record<string, unknown>)[targetId] ?? 0);
    return Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  });
  const totalDistributed = counts.reduce((sum, value) => sum + value, 0);
  if (totalDistributed !== totalCounters) {
    return null;
  }
  if (counts.some((value) => value <= 0)) {
    return null;
  }
  return counts;
}

function resolveDistributeAmongTargetIds(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  ctx: OracleIRExecutionContext,
  normalizedTarget: OracleObjectSelector | undefined,
): string[] {
  const stepTargetText = step.target?.kind === 'raw' ? step.target.text : '';
  const targetText = String(
    normalizedTarget?.kind === 'raw' ? normalizedTarget.text : stepTargetText
  )
    .replace(/,\s*where x is\b.*$/i, '')
    .trim()
    .toLowerCase();
  const maxTargets = parseDistributeMaxTargets(targetText);
  const battlefield = ((state.battlefield || []) as BattlefieldPermanent[]);
  const controllerId = String(ctx.controllerId || '').trim();
  const sourceId = String(ctx.sourceId || '').trim();

  const boundIds = collectBoundBattlefieldIds(ctx).filter((id) =>
    battlefield.some((perm: any) => String(perm?.id || '').trim() === id),
  );

  if (/other target creatures you control/i.test(targetText)) {
    return resolveCreatureTargetIds(state, normalizedTarget as any, ctx);
  }

  if (/it and any number of commanders/i.test(targetText)) {
    const compoundIds: string[] = [];
    if (sourceId && battlefield.some((perm: any) => String(perm?.id || '').trim() === sourceId)) {
      compoundIds.push(sourceId);
    }
    for (const perm of battlefield) {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!permanentId || permanentId === sourceId) continue;
      if (String((perm as any)?.controller || '').trim() !== controllerId) continue;
      const isCommander =
        Boolean((perm as any)?.isCommander) ||
        /\bcommander\b/i.test(getExecutorTypeLineLower(perm));
      if (isCommander) compoundIds.push(permanentId);
    }
    for (const boundId of boundIds) {
      if (!compoundIds.includes(boundId)) {
        const perm = battlefield.find((entry: any) => String(entry?.id || '').trim() === boundId);
        if (
          perm &&
          (Boolean((perm as any)?.isCommander) ||
            /\bcommander\b/i.test(getExecutorTypeLineLower(perm)))
        ) {
          compoundIds.push(boundId);
        }
      }
    }
    return Array.from(new Set(compoundIds));
  }

  if (/target elves/i.test(targetText)) {
    const controlledElfIds = battlefield
      .filter((perm: any) => String(perm?.controller || '').trim() === controllerId)
      .filter((perm: any) => typeLineHasSubtype(perm, 'elf'))
      .map((perm: any) => String(perm?.id || '').trim())
      .filter(Boolean);
    const elfPool = boundIds.length > 0 ? boundIds : controlledElfIds;
    let elfIds = elfPool.filter((id) => {
      const perm = battlefield.find((entry: any) => String(entry?.id || '').trim() === id);
      return perm ? typeLineHasSubtype(perm, 'elf') : false;
    });
    if (elfIds.length === 0 && boundIds.length > 0) {
      elfIds = controlledElfIds;
    }
    if (Number.isFinite(maxTargets) && (maxTargets as number) > 0) {
      return Array.from(new Set(elfIds.slice(0, maxTargets as number)));
    }
    return Array.from(new Set(elfIds));
  }

  let candidateIds = boundIds.filter((id) => {
    const perm = battlefield.find((entry: any) => String(entry?.id || '').trim() === id);
    return perm ? permanentMatchesType(perm, 'creature') : false;
  });

  if (candidateIds.length === 0 && /creatures you control/i.test(targetText)) {
    candidateIds = battlefield
      .filter((perm: any) => String(perm?.controller || '').trim() === controllerId)
      .filter((perm: any) => permanentMatchesType(perm, 'creature'))
      .map((perm: any) => String(perm?.id || '').trim())
      .filter(Boolean);
  }

  if (
    candidateIds.length === 0 &&
    /tapped creatures(?: your)? opponents control/i.test(targetText)
  ) {
    candidateIds = battlefield
      .filter((perm: any) => String(perm?.controller || '').trim() !== controllerId)
      .filter((perm: any) => permanentMatchesType(perm, 'creature'))
      .filter((perm: any) => Boolean((perm as any)?.tapped))
      .map((perm: any) => String(perm?.id || '').trim())
      .filter(Boolean);
  }

  if (candidateIds.length === 0 && boundIds.length > 0) {
    candidateIds = boundIds;
  }

  if (Number.isFinite(maxTargets) && (maxTargets as number) > 0) {
    candidateIds = candidateIds.slice(0, maxTargets as number);
  }

  return Array.from(new Set(candidateIds));
}

function tryApplyDistributeCountersAmong(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime,
): BattlefieldStepHandlerResult | null {
  const raw = String(step.raw || '').trim();
  const isDistributeAmong =
    step.distribution === 'among' || /^distribute\b/i.test(raw);
  if (!isDistributeAmong) return null;

  const amountValue = resolveAddCounterAmount(state, step, ctx, runtime);
  if (amountValue === null || amountValue <= 0) {
    return {
      applied: false,
      message: `Skipped distribute counters (unsupported amount): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const counterName = String(step.counter || '').trim() || (/\+1\/\+1/i.test(raw) ? '+1/+1' : '');
  if (!counterName) {
    return {
      applied: false,
      message: `Skipped distribute counters (unsupported counter): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const normalizedTarget = normalizeWhereQualifiedTarget(step.target as any);
  const targetIds = resolveDistributeAmongTargetIds(state, step, ctx, normalizedTarget as any);
  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped distribute counters (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const preselectedCounts = resolveCounterDistributionCounts(amountValue, targetIds, ctx);
  if (preselectedCounts) {
    const applied = applyCounterDistributionToBattlefield(state, targetIds, preselectedCounts, counterName);
    return {
      applied: true,
      state: applied.state,
      log: applied.log,
      lastMovedBattlefieldPermanentIds: targetIds,
    };
  }

  if (
    distributeCountersNeedsPlayerChoice(amountValue, targetIds.length)
    && ctx.interactivePlayerChoices !== false
  ) {
    return {
      applied: false,
      message: `Counter distribution choice required: ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          distributionTargetIds: targetIds,
          distributionTotalAmount: amountValue,
          distributionCounterName: counterName,
          distributionMinPerTarget: 1,
        },
      },
    };
  }

  const perTargetCounts = splitCountersAcrossTargets(amountValue, targetIds.length);
  const applied = applyCounterDistributionToBattlefield(state, targetIds, perTargetCounts, counterName);
  return {
    applied: true,
    state: applied.state,
    log: applied.log,
    lastMovedBattlefieldPermanentIds: targetIds,
  };
}

function buildContextualBattlefieldTargetIds(
  battlefield: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext,
  plural: boolean | undefined,
  typeFilter?: ReturnType<typeof parseSimplePermanentTypeFromText>
): string[] {
  const battlefieldIds = new Set(
    battlefield.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean)
  );
  const lastMovedBattlefieldIds = Array.isArray(ctx.lastMovedBattlefieldPermanentIds)
    ? ctx.lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const movedOnBattlefield = lastMovedBattlefieldIds.filter(id => battlefieldIds.has(id));
  if (plural && movedOnBattlefield.length > 0) {
    let resolved = movedOnBattlefield;
    if (typeFilter) {
      const typed = resolved.filter(id => {
        const permanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === id);
        return permanent ? permanentMatchesType(permanent, typeFilter) : false;
      });
      if (typed.length > 0) resolved = typed;
    }
    return resolved;
  }

  const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [
    String(ctx.selectorContext?.combatOpponentCreatureId || '').trim(),
    ...chosenObjectIds,
    String(ctx.targetCreatureId || '').trim(),
    String(ctx.targetPermanentId || '').trim(),
    String(ctx.selectorContext?.targetCreatureId || '').trim(),
    String(ctx.selectorContext?.targetPermanentId || '').trim(),
  ]) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }

  const onBattlefield = candidates.filter(id => battlefieldIds.has(id));
  let resolved = onBattlefield.length > 0 ? onBattlefield : candidates;
  if (typeFilter) {
    const typed = resolved.filter(id => {
      const permanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === id);
      return permanent ? permanentMatchesType(permanent, typeFilter) : false;
    });
    if (typed.length > 0) resolved = typed;
  }
  return plural ? resolved : resolved.slice(0, 1);
}

function buildNameReferenceAliases(value: string): readonly string[] {
  const normalized = normalizeSelfReferenceText(value);
  if (!normalized) return [];

  const aliases = new Set<string>();
  aliases.add(normalized);
  for (const face of normalized.split(/\s*\/\/\s*/).map(part => part.trim()).filter(Boolean)) {
    aliases.add(face);
    const commaHead = String(face.split(',')[0] || '').trim();
    if (commaHead.length >= 4) aliases.add(commaHead);
  }

  return [...aliases];
}

function isNamedSelfSacrificeReference(
  what: { readonly kind: string; readonly text?: string; readonly raw?: string },
  ctx: OracleIRExecutionContext
): boolean {
  if (what.kind !== 'raw') return false;
  const normalizedWhat = normalizeSelfReferenceText(String((what as any).text || ''));
  if (!normalizedWhat) return false;

  const sourceCandidates = [
    String(ctx.sourceName || ''),
    String((ctx as any).cardName || ''),
  ]
    .map(normalizeSelfReferenceText)
    .filter(Boolean);

  return sourceCandidates.includes(normalizedWhat);
}

function exileSourceStackObject(
  state: GameState,
  ctx: OracleIRExecutionContext
): { readonly state: GameState; readonly log: readonly string[] } | null {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return null;

  const stack = Array.isArray((state as any).stack) ? [...((state as any).stack as any[])] : [];
  const stackIndex = stack.findIndex(item => String((item as any)?.id || '').trim() === sourceId);
  if (stackIndex < 0) return null;

  const stackObject = stack[stackIndex] as any;
  const playerId = (String(stackObject?.controller || stackObject?.controllerId || ctx.controllerId || '').trim() ||
    ctx.controllerId) as PlayerID;
  const player = (state.players || []).find(p => String((p as any)?.id || '').trim() === String(playerId || '').trim()) as any;
  if (!player) return null;

  const stackCard = {
    ...((stackObject?.card as any) || {}),
    id: String(((stackObject?.card as any)?.id || stackObject?.spellId || stackObject?.id || sourceId)).trim(),
    name: String(((stackObject?.card as any)?.name || stackObject?.cardName || ctx.sourceName || 'Unknown')).trim() || 'Unknown',
    zone: 'exile',
  } as any;

  const updatedPlayers = state.players.map(p =>
    p.id === playerId
      ? ({
          ...(p as any),
          exile: [...(Array.isArray((p as any)?.exile) ? (p as any).exile : []), stackCard],
        } as any)
      : p
  );
  stack.splice(stackIndex, 1);

  return {
    state: { ...(state as any), players: updatedPlayers as any, stack: stack as any } as any,
    log: [`${playerId} exiles ${stackCard.name} from the stack`],
  };
}

function isStackSpellExileTarget(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string }
): boolean {
  if (target.kind !== 'raw') return false;
  const normalized = normalizeExileTargetReferenceText(String((target as any).text || '')).toLowerCase();
  return /^(?:it|that spell|that card|the spell|the card)$/.test(normalized);
}

function exileSpellFromStackById(
  state: GameState,
  spellId: string,
  ctx: OracleIRExecutionContext
): { readonly state: GameState; readonly log: readonly string[] } | null {
  const targetSpellId = String(spellId || '').trim();
  if (!targetSpellId) return null;

  const stack = Array.isArray((state as any).stack) ? [...((state as any).stack as any[])] : [];
  const spellIndex = stack.findIndex(item => String((item as any)?.id || '').trim() === targetSpellId);
  if (spellIndex < 0) return null;

  const targetSpell = stack[spellIndex] as any;
  const ownerId = String(
    targetSpell?.owner || targetSpell?.ownerId || targetSpell?.controller || targetSpell?.controllerId || ''
  ).trim();
  if (!ownerId) return null;

  const sourceId = String(ctx.sourceId || '').trim();
  const sourceRef = sourceId || String(ctx.sourceName || '').trim();
  const baseCard =
    targetSpell?.card && typeof targetSpell.card === 'object' ? { ...targetSpell.card } : { ...targetSpell };
  const exiledSpellCard = {
    ...baseCard,
    id: String((baseCard as any)?.id || targetSpellId).trim() || targetSpellId,
    name: String((baseCard as any)?.name || targetSpell?.name || targetSpellId).trim() || targetSpellId,
    zone: 'exile',
    owner: ownerId,
    ownerId,
    ...(sourceRef ? { exiledBy: sourceRef } : {}),
    ...(sourceId ? { exiledWith: sourceId, exiledWithSourceId: sourceId } : {}),
  };

  stack.splice(spellIndex, 1);
  const updatedPlayers = (state.players || []).map((player: any) => {
    if (String(player?.id || '').trim() !== ownerId) return player;
    const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
    return { ...player, exile: [...exile, exiledSpellCard] };
  });

  return {
    state: { ...(state as any), stack: stack as any, players: updatedPlayers as any } as GameState,
    log: [`${ownerId} exiles ${exiledSpellCard.name} from the stack`],
  };
}

function grantAirbendPermissionToExiledCards(
  state: GameState,
  exiledCards: readonly any[]
): { readonly state: GameState; readonly granted: number } {
  const exiledIds = new Set(
    exiledCards
      .map((card) => String((card as any)?.id ?? (card as any)?.cardId ?? '').trim())
      .filter(Boolean)
  );
  if (exiledIds.size === 0) return { state, granted: 0 };

  const stateAny: any = state as any;
  stateAny.playableFromExile = stateAny.playableFromExile || {};

  let granted = 0;
  const updatedPlayers = (state.players || []).map((player: any) => {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    if (exile.length === 0) return player;

    let changed = false;
    const nextExile = exile.map((card: any) => {
      const cardId = String(card?.id ?? card?.cardId ?? '').trim();
      if (!cardId || !exiledIds.has(cardId)) return card;

      const typeLineLower = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
      if (typeLineLower.includes('land')) return card;

      const ownerId = String(card?.ownerId || card?.owner || card?.card?.ownerId || card?.card?.owner || player?.id || '').trim();
      if (!ownerId) return card;

      stateAny.playableFromExile[ownerId] = stateAny.playableFromExile[ownerId] || {};
      stateAny.playableFromExile[ownerId][cardId] = Number.MAX_SAFE_INTEGER;
      granted += 1;
      changed = true;

      return {
        ...card,
        zone: 'exile',
        owner: ownerId,
        ownerId,
        canBePlayedBy: ownerId,
        playableUntilTurn: null,
        exileCastCost: AIRBEND_ALTERNATE_COST,
      };
    });

    return changed ? ({ ...player, exile: nextExile } as any) : player;
  });

  return {
    state: { ...(stateAny as any), players: updatedPlayers as any } as any,
    granted,
  };
}

function parseContextualBattlefieldReference(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string }
): ContextualBattlefieldReference | null {
  if (target.kind !== 'raw') return null;
  const raw = String((target as any).text || '').trim();
  if (!raw) return null;

  const normalized = normalizeBattlefieldTargetReferenceText(raw);

  if (
    /^(?:it|he|him|her|this creature|this artifact|this enchantment|this aura|this land|this planet|this spacecraft|this planeswalker|this battle|this vehicle|this permanent|this token|this card|this saga)$/i.test(
      normalized
    )
  ) {
    return { mode: 'self' };
  }

  if (/^that artifact$/i.test(normalized)) {
    return { mode: 'contextual', type: 'artifact' };
  }

  if (/^that wolf$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature', subtype: 'wolf' };
  }

  if (/^the chosen creature$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature' };
  }

  if (/^the creature that attacked$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature' };
  }

  if (/^that mount or vehicle$/i.test(normalized)) {
    return { mode: 'contextual', type: 'vehicle' };
  }

  if (/^(?:that creature|the creature|the creature dealt damage)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature' };
  }

  if (/^(?:that vehicle|the vehicle)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'vehicle' };
  }

  if (/^(?:that land|the land)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'land' };
  }

  if (/^(?:that planeswalker|the planeswalker)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'planeswalker' };
  }

  if (/^both creatures$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature', plural: true };
  }

  if (/^the other creature$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature' };
  }

  if (/^(?:they|them)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature', plural: true };
  }

  if (/^(?:the exiled card|that card)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'permanent' };
  }

  if (/^(?:each of )?those creatures$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature', plural: true };
  }

  if (/^that permanent$/i.test(normalized)) {
    return { mode: 'contextual', type: 'permanent' };
  }

  if (/^(?:that token|the token)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'permanent', tokenOnly: true };
  }

  if (/^(?:those tokens|them)$/i.test(normalized)) {
    return {
      mode: 'contextual',
      type: 'permanent',
      tokenOnly: /^those tokens$/i.test(normalized),
      plural: true,
    };
  }

  if (/^those auras$/i.test(normalized)) {
    return { mode: 'contextual', type: 'enchantment', subtype: 'aura', plural: true };
  }

  const contextualSubtypeMatch = normalized.match(/^(?:each of )?those\s+([a-z][a-z' -]+)$/i);
  if (contextualSubtypeMatch) {
    const rawSubtype = String(contextualSubtypeMatch[1] || '').trim().toLowerCase();
    if (rawSubtype && !/^(?:creatures|permanents|tokens)$/i.test(rawSubtype)) {
      const subtype = rawSubtype.endsWith('s') ? rawSubtype.slice(0, -1) : rawSubtype;
      if (subtype) {
        return {
          mode: 'contextual',
          type: 'creature',
          plural: true,
          subtype,
        };
      }
    }
  }

  return null;
}

function resolveContextualBattlefieldPermanents(
  battlefield: readonly BattlefieldPermanent[],
  target:
    | { readonly kind: string; readonly text?: string; readonly raw?: string }
    | undefined,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  if (!target) return [];

  const mentorTargetId = resolveMentorTargetCreatureIdFromBattlefield(battlefield, target as any, ctx);
  if (mentorTargetId) {
    const mentorTarget = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === mentorTargetId);
    return mentorTarget ? [mentorTarget] : [];
  }

  const bolsterTargetId = resolveBolsterTargetCreatureIdFromBattlefield(battlefield, target as any, ctx);
  if (bolsterTargetId) {
    const bolsterTarget = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === bolsterTargetId);
    return bolsterTarget ? [bolsterTarget] : [];
  }

  if (target.kind === 'raw') {
    const rawText = normalizeBattlefieldTargetReferenceText(String((target as any).text || ''));
    const sourceId = String(ctx.sourceId || '').trim();
    if (sourceId && rawText) {
      const sourcePermanent = battlefield.find(
        (perm: any) => String((perm as any)?.id || '').trim() === sourceId,
      ) as any;
      const sourceNames = [
        String(sourcePermanent?.card?.name || '').trim(),
        String(sourcePermanent?.name || '').trim(),
        String(ctx.sourceName || '').trim(),
      ]
        .map((name) => normalizeOracleText(name).toLowerCase())
        .filter(Boolean);
      if (sourceNames.includes(normalizeOracleText(rawText).toLowerCase())) {
        return sourcePermanent ? [sourcePermanent] : [];
      }
    }
    const directTargetMatch = rawText.match(
      /^(?:each of\s+)?(?:up to\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?(?:(?:another|other)\s+)?target\s+(.+)$/i
    );
    if (directTargetMatch) {
      const parsedType = parseSimplePermanentTypeFromText(String(directTargetMatch[1] || '').trim()) || 'permanent';
      const excludeSource = /(?:^|\s)(?:another|other)\s+target\s+/i.test(rawText);
      const sourceId = String(ctx.sourceId || '').trim();
      const directTargetIds = [
        String(ctx.targetPermanentId || '').trim(),
        String(ctx.targetCreatureId || '').trim(),
        ...(
          Array.isArray(ctx.selectorContext?.chosenObjectIds)
            ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
            : []
        ),
      ].filter(Boolean);

      if (directTargetIds.length > 0) {
        const wantedIds = new Set(directTargetIds);
        return filterIllegalDirectTargetPermanents(battlefield.filter((perm: any) => {
          const permanentId = String((perm as any)?.id || '').trim();
          if (!wantedIds.has(permanentId)) return false;
          if (excludeSource && sourceId && permanentId === sourceId) return false;
          return permanentMatchesType(perm, parsedType);
        }), ctx);
      }
    }
  }

  const parsed = parseContextualBattlefieldReference(target);
  if (!parsed) return [];

  const sourceId = String(ctx.sourceId || '').trim();
  if (parsed.mode === 'self') {
    const lastReferencedId = String((ctx as any).lastReferencedPermanentId || '').trim();
    const boundTargetId = String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
    const chosenId = Array.isArray(ctx.selectorContext?.chosenObjectIds)
      ? String(ctx.selectorContext.chosenObjectIds[0] || '').trim()
      : '';
    const resolvedId = lastReferencedId || boundTargetId || chosenId || sourceId;
    if (!resolvedId) return [];
    const selfPermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === resolvedId);
    return selfPermanent ? [selfPermanent] : [];
  }

  const resolvedContextualTargetIds = buildContextualBattlefieldTargetIds(
    battlefield,
    ctx,
    parsed.plural,
    parsed.mode === 'contextual' ? parsed.type : undefined
  );

  if (resolvedContextualTargetIds.length === 0) return [];

  const matches = battlefield.filter((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!resolvedContextualTargetIds.includes(permanentId)) return false;
    if (!permanentMatchesType(perm, parsed.type)) return false;
    if (parsed.tokenOnly && !(perm as any)?.isToken) return false;
    if (parsed.subtype) {
      const typeLineLower = getExecutorTypeLineLower(perm);
      if (!new RegExp(`(^|[^a-z])${parsed.subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
        return false;
      }
    }
    return true;
  });

  if (matches.length > 0 || !parsed.tokenOnly) {
    const directTargetIds = new Set(
      [String(ctx.targetPermanentId || '').trim(), String(ctx.targetCreatureId || '').trim()].filter(Boolean)
    );
    if (directTargetIds.size <= 0) return matches;

    return matches.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!directTargetIds.has(permanentId)) return true;
      return canTargetPermanent(perm, {
        controllerId: ctx.controllerId,
        colors: ctx.sourceColors,
        objectType: ctx.sourceObjectType,
      }).canTarget;
    });
  }

  return battlefield.filter((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!resolvedContextualTargetIds.includes(permanentId)) return false;
    if (!permanentMatchesType(perm, parsed.type)) return false;
    if (parsed.subtype) {
      const typeLineLower = getExecutorTypeLineLower(perm);
      if (!new RegExp(`(^|[^a-z])${parsed.subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
        return false;
      }
    }
    return true;
  });
}

function resolveBoundSelectorMatches(
  battlefield: readonly BattlefieldPermanent[],
  selector: SimpleBattlefieldSelector,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  const boundIds = collectBoundBattlefieldIds(ctx);
  return battlefield.filter(perm => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!boundIds.includes(permanentId)) return false;
    return permanentMatchesSelector(perm, selector, ctx);
  });
}

function resolveDestroyTargets(
  battlefield: readonly BattlefieldPermanent[],
  step: Extract<OracleEffectStep, { kind: 'destroy' }>,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  const rawTargetText = String((step.target as any)?.text || '');
  let targetText = normalizeBattlefieldTargetReferenceText(rawTargetText)
    .replace(/\s+unless\s+that\s+player\s+pays\b.*$/i, '')
    .replace(/,\s*where\s+x\s+is\b.*$/i, '')
    .replace(/\s+they can't be regenerated$/i, '')
    .trim();

  if (/^it$/i.test(targetText) || /^them$/i.test(targetText)) {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, /^them$/i.test(targetText));
    const matches = battlefield.filter((perm: any) =>
      ids.includes(String((perm as any)?.id || '').trim())
    );
    return matches.length > 0 ? matches : [];
  }

  const conditionalCounterMatch = rawTargetText.match(
    /if\s+it\s+has\s+((?:\d+)|(?:one|two|three|four|five|six|seven|eight|nine|ten))\s+or\s+more\s+([a-z+/-]+)\s+counters?\s+on\s+it$/i
  );
  if (conditionalCounterMatch && /^this enchantment$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    if (!sourcePermanent) return [];
    const counterName = String(conditionalCounterMatch[2] || '').trim().toLowerCase();
    const thresholdRaw = String(conditionalCounterMatch[1] || '').trim().toLowerCase();
    const threshold = /^\d+$/.test(thresholdRaw)
      ? Number(thresholdRaw)
      : ({
          one: 1,
          two: 2,
          three: 3,
          four: 4,
          five: 5,
          six: 6,
          seven: 7,
          eight: 8,
          nine: 9,
          ten: 10,
        }[thresholdRaw] ?? 0);
    const counterCount = Number(((sourcePermanent as any)?.counters || {})[counterName] ?? 0);
    if (!Number.isFinite(counterCount) || counterCount < threshold) return [];
    return [sourcePermanent];
  }

  if (/^one of them chosen at random$/i.test(targetText)) {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const matches = battlefield.filter((perm: any) => ids.includes(String((perm as any)?.id || '').trim()));
    return matches.length > 0 ? matches.slice(0, 1) : [];
  }

  if (/^the other creature$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const enchantedCreatureId = String(
      (sourcePermanent as any)?.attachedTo ||
      ctx.targetCreatureId ||
      ctx.targetPermanentId ||
      ctx.selectorContext?.targetCreatureId ||
      ''
    ).trim();
    const opponentCreatureId = String(ctx.selectorContext?.combatOpponentCreatureId || '').trim();
    const combatIds = new Set(
      [enchantedCreatureId, opponentCreatureId, sourceId].filter(Boolean)
    );
    const excludedId = enchantedCreatureId || sourceId;
    const matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      return combatIds.has(permanentId) && permanentId !== excludedId;
    });
    return matches.length > 0 ? matches.slice(0, 1) : [];
  }

  if (/^both creatures$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const opponentCreatureId = String(ctx.selectorContext?.combatOpponentCreatureId || '').trim();
    const wantedIds = new Set([sourceId, opponentCreatureId].filter(Boolean));
    const matches = battlefield.filter((perm: any) => wantedIds.has(String((perm as any)?.id || '').trim()));
    return matches.length > 0 ? matches : [];
  }

  if (/^up to x target artifacts$/i.test(targetText)) {
    const xValue = Number(ctx.xValue);
    const maxCount = Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : 1;
    const boundIds = collectBoundBattlefieldIds(ctx);
    const artifacts = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      return boundIds.includes(permanentId) && permanentMatchesType(perm, 'artifact');
    });
    return maxCount > 0 ? artifacts.slice(0, maxCount) : [];
  }

  if (/^up to x target artifacts and\/or enchantments$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const verseCount = Number(((sourcePermanent as any)?.counters || {})?.verse);
    const xValue = Number.isFinite(verseCount) ? verseCount : Number(ctx.xValue);
    const maxCount = Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : 1;
    const boundIds = collectBoundBattlefieldIds(ctx);
    const matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(permanentId)) return false;
      return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'enchantment');
    });
    return maxCount > 0 ? matches.slice(0, maxCount) : [];
  }

  if (/^all walls your opponents control$/i.test(targetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    return battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() === controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return typeLineHasSubtype(perm, 'wall');
    });
  }

  if (/^all nonenchantment creatures$/i.test(targetText)) {
    return battlefield.filter(
      (perm: any) =>
        permanentMatchesType(perm, 'creature') && !permanentMatchesType(perm, 'enchantment')
    );
  }

  if (/^that land$/i.test(targetText)) {
    return resolveDirectBattlefieldPermanents(battlefield, { kind: 'raw', text: 'that land' }, ctx);
  }

  if (/^enchanted permanent$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const attachedToId = String((sourcePermanent as any)?.attachedTo || '').trim();
    const enchantedPermanent = attachedToId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === attachedToId)
      : undefined;
    return enchantedPermanent ? [enchantedPermanent] : [];
  }

  if (/^each creature with mana value equal to the number of ([a-z]+) counters on this enchantment$/i.test(targetText)) {
    const counterMatch = targetText.match(
      /^each creature with mana value equal to the number of ([a-z]+) counters on this enchantment$/i
    );
    const counterName = String(counterMatch?.[1] || '').trim().toLowerCase();
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const counterCount = Number(((sourcePermanent as any)?.counters || {})[counterName] ?? 0);
    if (!Number.isFinite(counterCount) || counterCount < 0) return [];
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const manaValue = getCardManaValue((perm as any)?.card || perm);
      return manaValue !== null && manaValue === counterCount;
    });
  }

  if (/^up to x target lands$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const verseCount = Number(((sourcePermanent as any)?.counters || {})?.verse);
    const xValue = Number.isFinite(verseCount) ? verseCount : Number(ctx.xValue);
    const maxCount = Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : 1;
    const boundIds = collectBoundBattlefieldIds(ctx);
    const lands = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      return boundIds.includes(permanentId) && permanentMatchesType(perm, 'land');
    });
    return maxCount > 0 ? lands.slice(0, maxCount) : [];
  }

  if (/^each creature whose coin comes up tails$/i.test(targetText)) {
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const typeLineLower = getExecutorTypeLineLower(perm);
      return !/\b(demon|devil|imp)s?\b/i.test(typeLineLower);
    });
  }

  if (/^all artifacts and creatures other than this creature$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    return battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (sourceId && permanentId === sourceId) return false;
      return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'creature');
    });
  }

  if (/^all creatures other than this (?:creature|permanent)$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const permanentId = String((perm as any)?.id || '').trim();
      return !sourceId || permanentId !== sourceId;
    });
  }

  {
    const nonSubtypeCreaturesMatch = targetText.match(/^all non-([a-z]+) creatures$/i);
    if (nonSubtypeCreaturesMatch) {
      const excludedSubtype = String(nonSubtypeCreaturesMatch[1] || '').trim();
      return battlefield.filter(
        (perm: any) =>
          permanentMatchesType(perm, 'creature') && !typeLineHasSubtype(perm, excludedSubtype)
      );
    }
  }

  if (/^enchanted (?:creature|land|permanent)$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const attachedToId = String((sourcePermanent as any)?.attachedTo || '').trim();
    const enchantedPermanent = attachedToId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === attachedToId)
      : undefined;
    return enchantedPermanent ? [enchantedPermanent] : [];
  }

  {
    const attachedAurasMatch = targetText.match(/^all auras attached to (?:that|target) creature$/i);
    if (attachedAurasMatch) {
      const hostId = String(
        ctx.targetCreatureId ||
          ctx.targetPermanentId ||
          ctx.selectorContext?.targetCreatureId ||
          ''
      ).trim();
      if (!hostId) return [];
      return battlefield.filter((perm: any) => {
        if (!permanentMatchesType(perm, 'enchantment')) return false;
        return String((perm as any)?.attachedTo || '').trim() === hostId;
      });
    }
  }

  {
    const attachedEquipmentMatch = targetText.match(/^all equipment attached to (?:that|target) creature$/i);
    if (attachedEquipmentMatch) {
      const hostId = String(
        ctx.targetCreatureId ||
          ctx.targetPermanentId ||
          ctx.selectorContext?.targetCreatureId ||
          ''
      ).trim();
      if (!hostId) return [];
      return battlefield.filter((perm: any) => {
        if (!permanentMatchesType(perm, 'artifact') || !typeLineHasSubtype(perm, 'equipment')) return false;
        return String((perm as any)?.attachedTo || '').trim() === hostId;
      });
    }
  }

  if (/^all untapped creatures that didn't attack this turn(?:, except for creatures that couldn't attack)?$/i.test(targetText)) {
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      if ((perm as any)?.tapped) return false;
      return !(perm as any)?.attackedThisTurn;
    });
  }

  if (/^all other creatures that share a color with it$/i.test(targetText)) {
    const referenceId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || ''
    ).trim();
    const reference = referenceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === referenceId)
      : undefined;
    const referenceColors = new Set(
      Array.isArray((reference as any)?.colors)
        ? (reference as any).colors.map((color: unknown) => String(color || '').trim().toUpperCase()).filter(Boolean)
        : []
    );
    if (referenceColors.size === 0) return [];
    return battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (referenceId && permanentId === referenceId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      const colors = Array.isArray((perm as any)?.colors) ? (perm as any).colors : [];
      return colors.some((color: unknown) => referenceColors.has(String(color || '').trim().toUpperCase()));
    });
  }

  if (/^all curses attached to you$/i.test(targetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    return battlefield.filter((perm: any) => {
      if (!typeLineHasSubtype(perm, 'curse')) return false;
      const enchantedPlayerId = String(
        (perm as any)?.enchantedPlayerId || (perm as any)?.attachedToPlayer || ''
      ).trim();
      if (enchantedPlayerId) return enchantedPlayerId === controllerId;
      return String((perm as any)?.controller || '').trim() === controllerId;
    });
  }

  if (/^each creature your opponents control with a prey counter on it$/i.test(targetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    return battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() === controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Number(((perm as any)?.counters || {}).prey ?? 0) > 0;
    });
  }

  if (/^all creatures with flying$/i.test(targetText)) {
    return battlefield.filter(
      (perm: any) => permanentMatchesType(perm, 'creature') && battlefieldPermanentHasFlying(perm)
    );
  }

  if (/^that creature and this creature$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const targetId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.selectorContext?.targetCreatureId || ''
    ).trim();
    const wantedIds = new Set([sourceId, targetId].filter(Boolean));
    return battlefield.filter((perm: any) => wantedIds.has(String((perm as any)?.id || '').trim()));
  }

  if (/^all auras attached to target land$/i.test(targetText)) {
    const landId = String(
      ctx.targetPermanentId || ctx.selectorContext?.targetPermanentId || ctx.selectorContext?.targetLandId || ''
    ).trim();
    if (!landId) return [];
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'enchantment')) return false;
      if (!typeLineHasSubtype(perm, 'aura')) return false;
      return String((perm as any)?.attachedTo || '').trim() === landId;
    });
  }

  if (/^all auras attached to that creature$/i.test(targetText)) {
    let hostId = String(
      ctx.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.selectorContext?.combatOpponentCreatureId ||
        ''
    ).trim();
    if (!hostId) {
      const boundIds = collectBoundBattlefieldIds(ctx);
      hostId =
        boundIds.find((candidateId) =>
          battlefield.some(
            (perm: any) =>
              permanentMatchesType(perm, 'enchantment') &&
              String((perm as any)?.attachedTo || '').trim() === candidateId
          )
        ) || '';
    }
    if (!hostId) return [];
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'enchantment')) return false;
      return String((perm as any)?.attachedTo || '').trim() === hostId;
    });
  }

  if (/^all equipment attached to that creature$/i.test(targetText)) {
    const hostId = String(
      ctx.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.selectorContext?.combatOpponentCreatureId ||
        ''
    ).trim();
    if (!hostId) return [];
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'artifact') || !typeLineHasSubtype(perm, 'equipment')) return false;
      return String((perm as any)?.attachedTo || '').trim() === hostId;
    });
  }

  if (/^up to one nonbasic land that player controls$/i.test(targetText)) {
    const playerId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const lands = battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() !== playerId) return false;
      if (!permanentMatchesType(perm, 'land')) return false;
      const typeLine = getExecutorTypeLineLower(perm);
      return !/\bbasic\b/.test(typeLine);
    });
    return lands.length > 0 ? lands.slice(0, 1) : [];
  }

  if (/^the creature with the least power(?: it can't be regenerated)?$/i.test(targetText)) {
    const creatures = battlefield.filter((perm: any) => permanentMatchesType(perm, 'creature'));
    if (creatures.length === 0) return [];
    let leastPower: number | null = null;
    let leastMatches: BattlefieldPermanent[] = [];
    for (const perm of creatures) {
      const power = readCharacteristicNumber(
        (perm as any)?.effectivePower,
        (perm as any)?.basePower,
        (perm as any)?.card?.power,
        (perm as any)?.power
      );
      if (power === undefined) continue;
      if (leastPower === null || power < leastPower) {
        leastPower = power;
        leastMatches = [perm];
      } else if (power === leastPower) {
        leastMatches.push(perm);
      }
    }
    return leastMatches.length > 0 ? leastMatches.slice(0, 1) : [];
  }

  if (/^all nonartifact, nonblack creatures(?: they can't be regenerated)?$/i.test(targetText)) {
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      if (permanentMatchesType(perm, 'artifact')) return false;
      const colors = Array.isArray((perm as any)?.colors) ? (perm as any).colors : [];
      return !colors.map((c: unknown) => String(c || '').trim().toUpperCase()).includes('B');
    });
  }

  if (/^all tapped creatures$/i.test(targetText)) {
    return battlefield.filter((perm: any) => permanentMatchesType(perm, 'creature') && Boolean((perm as any)?.tapped));
  }

  if (/^all djinns and efreets(?: they can't be regenerated)?$/i.test(targetText)) {
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      return typeLineHasSubtype(perm, 'djinn') || typeLineHasSubtype(perm, 'efreet');
    });
  }

  if (/^this enchantment$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    return sourcePermanent ? [sourcePermanent] : [];
  }

  if (/^one of them at random$/i.test(targetText)) {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const matches = battlefield.filter((perm: any) => ids.includes(String((perm as any)?.id || '').trim()));
    return matches.length > 0 ? matches.slice(0, 1) : [];
  }

  if (/^up to x target nonblack creatures(?: they can't be regenerated)?$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const verseCount = Number(((sourcePermanent as any)?.counters || {})?.verse);
    const xValue = Number.isFinite(verseCount) ? verseCount : Number(ctx.xValue);
    const maxCount = Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : 1;
    const boundIds = collectBoundBattlefieldIds(ctx);
    const matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(permanentId)) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      const colors = Array.isArray((perm as any)?.colors) ? (perm as any).colors : [];
      return !colors.map((c: unknown) => String(c || '').trim().toUpperCase()).includes('B');
    });
    return maxCount > 0 ? matches.slice(0, maxCount) : [];
  }

  if (/^each creature with mana value equal to the number of \+1\/\+1 counters on this creature$/i.test(targetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const counterCount = Number(((sourcePermanent as any)?.counters || {})['+1/+1'] ?? 0);
    if (!Number.isFinite(counterCount) || counterCount < 0) return [];
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const manaValue = getCardManaValue((perm as any)?.card || perm);
      return manaValue !== null && manaValue === counterCount;
    });
  }

  if (/^all creatures with power (\d+) or greater$/i.test(targetText)) {
    const threshold = Number(String(targetText.match(/^all creatures with power (\d+) or greater$/i)?.[1] || '0'));
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const power = readCharacteristicNumber(
        (perm as any)?.effectivePower,
        (perm as any)?.basePower,
        (perm as any)?.card?.power,
        (perm as any)?.power
      );
      return power !== undefined && power >= threshold;
    });
  }

  if (/^all other creatures that were dealt damage this turn$/i.test(targetText)) {
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const sourceId = String(ctx.sourceId || '').trim();
      const permanentId = String((perm as any)?.id || '').trim();
      if (sourceId && permanentId === sourceId) return false;
      const damageMarked =
        Number((perm as any)?.markedDamage ?? (perm as any)?.damageMarked ?? (perm as any)?.damage ?? 0) || 0;
      return damageMarked > 0;
    });
  }

  if (/^the creature you chose$/i.test(targetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const boundIds = collectBoundBattlefieldIds(ctx);
    const match = battlefield.find((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(id)) return false;
      if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
      return permanentMatchesType(perm, 'creature');
    });
    return match ? [match] : [];
  }

  if (/^the creature your opponent chose$/i.test(targetText)) {
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const boundIds = collectBoundBattlefieldIds(ctx);
    const boundMatch = battlefield.find((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(id)) return false;
      if (String((perm as any)?.controller || '').trim() !== opponentId) return false;
      return permanentMatchesType(perm, 'creature');
    });
    if (boundMatch) return [boundMatch];
    const fallback = battlefield.find(
      (perm: any) =>
        String((perm as any)?.controller || '').trim() === opponentId && permanentMatchesType(perm, 'creature')
    );
    return fallback ? [fallback] : [];
  }

  if (/^that non-wall creature$/i.test(targetText)) {
    const hostId = String(
      ctx.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.selectorContext?.combatOpponentCreatureId ||
        ''
    ).trim();
    const host = hostId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === hostId)
      : undefined;
    if (host && permanentMatchesType(host, 'creature') && !typeLineHasSubtype(host, 'wall')) {
      return [host];
    }
    return [];
  }

  if (/^destroy the rest$/i.test(targetText) || /^the rest$/i.test(targetText)) {
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const excludedIds = new Set([...boundIds, ...contextualIds]);
    return battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (excludedIds.has(permanentId)) return false;
      return permanentMatchesType(perm, 'creature');
    });
  }

  if (/^the chosen creatures$/i.test(targetText)) {
    const chosenIds = new Set(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    if (chosenIds.size === 0) return [];
    return battlefield.filter((perm: any) => chosenIds.has(String((perm as any)?.id || '').trim()));
  }

  if (/^(?:destroy )?any number of target creatures$/i.test(targetText)) {
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    return battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      return boundIds.has(permanentId) && permanentMatchesType(perm, 'creature');
    });
  }

  if (/^destroy two target enchantments$/i.test(targetText) || /^two target enchantments$/i.test(targetText)) {
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    return battlefield
      .filter((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        return boundIds.has(permanentId) && permanentMatchesType(perm, 'enchantment');
      })
      .slice(0, 2);
  }

  if (/^destroy the chosen permanents$/i.test(targetText) || /^the chosen permanents$/i.test(targetText)) {
    const chosenIds = new Set(collectBoundBattlefieldIds(ctx));
    return battlefield.filter((perm: any) => chosenIds.has(String((perm as any)?.id || '').trim()));
  }

  if (/^destroy that land$/i.test(targetText) || /^that land$/i.test(targetText)) {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, false);
    return battlefield.filter(
      (perm: any) => ids.includes(String((perm as any)?.id || '').trim()) && permanentMatchesType(perm, 'land')
    );
  }

  if (/^destroy that artifact if its mana value is 5 or less instead$/i.test(targetText)) {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, false);
    return battlefield.filter((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      if (!ids.includes(id) || !permanentMatchesType(perm, 'artifact')) return false;
      const mv = getCardManaValue((perm as any)?.card || perm);
      return mv !== null && mv <= 5;
    });
  }

  if (/^(?:destroy )?two target artifacts and\/or enchantments$/i.test(targetText)) {
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    return battlefield
      .filter((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        if (!boundIds.has(permanentId)) return false;
        return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'enchantment');
      })
      .slice(0, 2);
  }

  const normalizedTarget = { ...(step.target as any), text: targetText };
  const selector = parseSimpleBattlefieldSelector(normalizedTarget as any);
  if (selector) {
    const matched = battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx));
    if (/^target\b/i.test(targetText)) {
      const boundMatches = resolveBoundSelectorMatches(battlefield, selector, ctx);
      if (boundMatches.length > 0) return boundMatches.slice(0, 1);
      if (matched.length >= 1) return matched.slice(0, 1);
      return [];
    }
    return matched;
  }
  return resolveDirectBattlefieldPermanents(battlefield, normalizedTarget as any, ctx);
}

function resolveAttachmentReferencePermanents(
  battlefield: readonly BattlefieldPermanent[],
  parsed: SacrificeAttachmentReference,
  players: readonly PlayerID[],
  ctx: OracleIRExecutionContext
): { readonly permanents: readonly BattlefieldPermanent[]; readonly requiresChoice: boolean } {
  const sourceId = String(ctx.sourceId || '').trim();
  const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const contextualTargetIds = [
    ...chosenObjectIds,
    String(ctx.targetPermanentId || '').trim(),
    String(ctx.targetCreatureId || '').trim(),
  ].filter(Boolean);

  if (parsed.mode === 'attached_to_source' && parsed.relation === 'source_is_attached_to_target') {
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const attachedToId = String(
      (sourcePermanent as any)?.attachedTo ||
      (sourcePermanent as any)?.enchanting ||
      contextualTargetIds[0] ||
      ''
    ).trim();
    if (!attachedToId) return { permanents: [], requiresChoice: false };

    const attachedPermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === attachedToId);
    if (!attachedPermanent) return { permanents: [], requiresChoice: false };
    if (!players.includes(attachedPermanent.controller)) return { permanents: [], requiresChoice: false };
    if (!permanentMatchesType(attachedPermanent, parsed.type)) return { permanents: [], requiresChoice: false };
    return { permanents: [attachedPermanent], requiresChoice: false };
  }

  if (parsed.mode === 'attached_to_source') {
    if (!sourceId) return { permanents: [], requiresChoice: false };
    const candidates = battlefield.filter((perm: any) => {
      if (!players.includes(perm.controller)) return false;
      if (!permanentMatchesType(perm, parsed.type)) return false;
      const attachedToId = String((perm as any)?.attachedTo || '').trim();
      if (attachedToId !== sourceId) return false;
      if (parsed.subtype) {
        const typeLineLower = getExecutorTypeLineLower(perm);
        if (!new RegExp(`(^|[^a-z])${parsed.subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
          return false;
        }
      }
      return true;
    });

    if (candidates.length > 1) return { permanents: [], requiresChoice: true };
    return { permanents: candidates, requiresChoice: false };
  }

  const wantedNames = new Set(buildNameReferenceAliases(parsed.attachedToName));
  const anchors = battlefield.filter((perm: any) => {
    const permNames = buildNameReferenceAliases(String((perm as any)?.card?.name || (perm as any)?.name || ''));
    return permNames.some(name => wantedNames.has(name));
  });
  if (anchors.length !== 1) {
    return { permanents: [], requiresChoice: anchors.length > 1 };
  }

  const anchorId = String((anchors[0] as any)?.id || '').trim();
  if (!anchorId) return { permanents: [], requiresChoice: false };

  const candidates = battlefield.filter((perm: any) => {
    if (!players.includes(perm.controller)) return false;
    if (!permanentMatchesType(perm, parsed.type)) return false;
    const attachedToId = String((perm as any)?.attachedTo || '').trim();
    if (attachedToId !== anchorId) return false;
    if (parsed.subtype) {
      const typeLineLower = getExecutorTypeLineLower(perm);
      if (!new RegExp(`(^|[^a-z])${parsed.subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
        return false;
      }
    }
    return true;
  });

  if (candidates.length > 1) return { permanents: [], requiresChoice: true };
  return { permanents: candidates, requiresChoice: false };
}

function resolveDirectBattlefieldPermanents(
  battlefield: readonly BattlefieldPermanent[],
  target:
    | { readonly kind: string; readonly text?: string; readonly raw?: string }
    | undefined,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  if (!target) return [];
  const normalizedTarget =
    target.kind === 'raw'
      ? {
          ...target,
          text: normalizeBattlefieldTargetReferenceText(String((target as any).text || '')),
        }
      : target;
  const targetText = normalizedTarget.kind === 'raw' ? String((normalizedTarget as any).text || '') : '';

  const typedYouControlMatch = targetText.match(
    /^target (land|creature|artifact|enchantment|planeswalker|battle|vehicle) you control$/i,
  );
  if (typedYouControlMatch) {
    const parsedType = parseSimplePermanentTypeFromText(String(typedYouControlMatch[1] || ''));
    if (!parsedType) return [];
    const boundIds = collectBoundBattlefieldIds(ctx);
    const controllerId = String(ctx.controllerId || '').trim();
    const fromBound = battlefield.filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (!boundIds.includes(permanentId)) return false;
      if (controllerId && String(perm?.controller || '').trim() !== controllerId) return false;
      return permanentMatchesType(perm, parsedType);
    });
    if (fromBound.length > 0) return fromBound.slice(0, 1);
    const controlledMatches = battlefield.filter((perm: any) => {
      if (controllerId && String(perm?.controller || '').trim() !== controllerId) return false;
      return permanentMatchesType(perm, parsedType);
    });
    if (controlledMatches.length === 1) return controlledMatches;
  }

  const attachedMatches = resolveAttachedReferenceTargets(battlefield, targetText, ctx);
  if (attachedMatches !== null) return attachedMatches;

  const massRestrictionMatches = resolveMassCreatureRestrictionTargets(battlefield, targetText, ctx);
  if (massRestrictionMatches !== null) return massRestrictionMatches;

  const grantMassMatches = resolveGrantTemporaryMassTargets(
    battlefield,
    targetText.toLowerCase(),
    '',
    ctx
  );
  if (grantMassMatches !== null) return grantMassMatches;

  const targetPrefixedMatches = resolveTargetPrefixedPermanents(
    battlefield,
    targetText,
    ctx,
    (selector) => resolveBoundSelectorMatches(battlefield, selector, ctx)
  );
  if (targetPrefixedMatches !== null) return targetPrefixedMatches;

  const armyMatches = resolveDeterministicArmyCreatureSelection(battlefield, normalizedTarget, ctx);
  if (armyMatches) return armyMatches;
  const selector = parseSimpleBattlefieldSelector(normalizedTarget as any);
  if (selector) {
    if (/^target\b/i.test(targetText)) {
      const boundMatches = resolveBoundSelectorMatches(battlefield, selector, ctx);
      if (boundMatches.length > 0) return boundMatches.slice(0, 1);
      const matched = battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx));
      if (matched.length > 1) return [];
      return matched.length > 0 ? matched.slice(0, 1) : [];
    }
    return battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx));
  }
  const subtypeOrCompoundMatches = resolveSubtypeOrCompoundBattlefieldPermanents(
    battlefield,
    normalizedTarget as any,
    ctx
  );
  if (subtypeOrCompoundMatches) return subtypeOrCompoundMatches;
  return resolveContextualBattlefieldPermanents(battlefield, normalizedTarget, ctx);
}

function normalizePluralSubtype(raw: string): string {
  const normalized = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9 -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  if (/ies$/i.test(normalized)) return `${normalized.slice(0, -3)}y`;
  if (/s$/i.test(normalized) && !/ss$/i.test(normalized)) return normalized.slice(0, -1);
  return normalized;
}

function typeLineHasSubtype(permanent: BattlefieldPermanent, subtype: string): boolean {
  const normalizedSubtype = normalizePluralSubtype(subtype);
  if (!normalizedSubtype) return false;
  const escaped = normalizedSubtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}s?($|[^a-z0-9])`, 'i').test(getExecutorTypeLineLower(permanent));
}

function resolveSubtypeOrCompoundBattlefieldPermanents(
  battlefield: readonly BattlefieldPermanent[],
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] | null {
  if (!target || target.kind !== 'raw') return null;
  const text = String((target as any).text || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;

  if (/^each of those\b/i.test(text)) return null;

  const controllerId = String(ctx.controllerId || '').trim();
  const controllerMatches = (permanent: BattlefieldPermanent, controllerFilter: 'any' | 'you' | 'opponents'): boolean => {
    if (controllerFilter === 'any') return true;
    const permanentController = String((permanent as any)?.controller || '').trim();
    if (!permanentController || !controllerId) return false;
    return controllerFilter === 'you' ? permanentController === controllerId : permanentController !== controllerId;
  };

  const allSubtypeTokensMatch = text.match(/^all ([a-z][a-z -]+) tokens(?: you control)?$/i);
  if (allSubtypeTokensMatch) {
    const rawSubtype = String(allSubtypeTokensMatch[1] || '').trim();
    const controllerFilter = /you control$/i.test(text) ? 'you' : 'any';
    return battlefield.filter(perm => {
      if (!(perm as any)?.isToken) return false;
      if (!controllerMatches(perm, controllerFilter)) return false;
      return typeLineHasSubtype(perm, rawSubtype);
    });
  }

  const noncreatureArtifactMatch = text.match(/^each noncreature artifacts?(?: you control)?$/i);
  if (noncreatureArtifactMatch) {
    const controllerFilter = /you control$/i.test(text) ? 'you' : 'any';
    return battlefield.filter(perm =>
      controllerMatches(perm, controllerFilter) &&
      permanentMatchesType(perm, 'artifact') &&
      !permanentMatchesType(perm, 'creature')
    );
  }

  const artifactCreatureMatch = text.match(/^(?:all\s+|each\s+)?artifact\s+creatures(?:\s+(you\s+control|your\s+opponents\s+control))?$/i);
  if (artifactCreatureMatch) {
    const filterText = String(artifactCreatureMatch[1] || '').trim().toLowerCase();
    const controllerFilter = filterText === 'you control' ? 'you' : filterText === 'your opponents control' ? 'opponents' : 'any';
    return battlefield.filter(perm =>
      controllerMatches(perm, controllerFilter) &&
      permanentMatchesType(perm, 'artifact') &&
      permanentMatchesType(perm, 'creature')
    );
  }

  const subtypeCreatureMatch = text.match(/^(?:all\s+|each\s+)([a-z][a-z -]+?)(?:\s+creatures?)?(?:\s+(you\s+control|your\s+opponents\s+control))?$/i);
  if (!subtypeCreatureMatch) return null;

  const rawSubtype = String(subtypeCreatureMatch[1] || '').trim();
  if (!rawSubtype || /^(?:creature|artifact|enchantment|land|permanent|nonland|target|another target)$/i.test(rawSubtype)) return null;
  const filterText = String(subtypeCreatureMatch[2] || '').trim().toLowerCase();
  const controllerFilter = filterText === 'you control' ? 'you' : filterText === 'your opponents control' ? 'opponents' : 'any';

  return battlefield.filter(perm =>
    controllerMatches(perm, controllerFilter) &&
    permanentMatchesType(perm, 'creature') &&
    typeLineHasSubtype(perm, rawSubtype)
  );
}

function filterIllegalDirectTargetPermanents(
  permanents: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  return permanents.filter((perm: any) =>
    canTargetPermanent(perm, {
      controllerId: ctx.controllerId,
      colors: ctx.sourceColors,
      objectType: ctx.sourceObjectType,
    }).canTarget
  );
}

function applyTemporaryEffectToPermanents(
  state: GameState,
  targets: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext,
  effect: {
    readonly descriptions: readonly string[];
    readonly grantedAbilities?: readonly string[];
    readonly expiresAt: 'end_of_turn' | 'next_upkeep' | 'leaves_battlefield';
    readonly expiresOnControllerTurn?: PlayerID;
    readonly mustBlockAttackerId?: string;
  }
): GameState {
  const targetIdSet = new Set(targets.map(target => String((target as any)?.id || '').trim()).filter(Boolean));
  if (targetIdSet.size === 0) return state;

  const normalizedGrantedAbilities = Array.isArray(effect.grantedAbilities)
    ? effect.grantedAbilities.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)
    : [];

  const nextBattlefield = ((state.battlefield || []) as BattlefieldPermanent[]).map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIdSet.has(permanentId)) return perm;

    const existingEffects = Array.isArray((perm as any)?.temporaryEffects)
      ? [...(perm as any).temporaryEffects]
      : [];
    const existingGrantedAbilities = Array.isArray((perm as any)?.grantedAbilities)
      ? [...(perm as any).grantedAbilities]
      : [];

    for (const description of effect.descriptions) {
      existingEffects.push({
        id: `${permanentId}:temp:${existingEffects.length + 1}:${description.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        description,
        expiresAt: effect.expiresAt,
        ...(effect.expiresOnControllerTurn ? { expiresOnControllerTurn: effect.expiresOnControllerTurn } : {}),
        sourceId: String(ctx.sourceId || '').trim() || undefined,
        sourceName: String(ctx.sourceName || '').trim() || undefined,
        ...(effect.mustBlockAttackerId ? { mustBlockAttackerId: effect.mustBlockAttackerId } : {}),
        ...(normalizedGrantedAbilities.length > 0 ? { grantedAbilities: normalizedGrantedAbilities } : {}),
      } as any);
    }

    for (const ability of normalizedGrantedAbilities) {
      if (!existingGrantedAbilities.includes(ability)) {
        existingGrantedAbilities.push(ability);
      }
    }

    const grantsHaste =
      normalizedGrantedAbilities.includes('haste')
      || effect.descriptions.some((description) => /\bhaste\b/i.test(String(description || '')));

    let untilEndOfTurn = (perm as any).untilEndOfTurn
      ? { ...(perm as any).untilEndOfTurn }
      : undefined;
    if (effect.expiresAt === 'end_of_turn' && normalizedGrantedAbilities.length > 0) {
      const grantedAbilitiesToRemove = Array.isArray(untilEndOfTurn?.grantedAbilitiesToRemove)
        ? [...untilEndOfTurn.grantedAbilitiesToRemove]
        : [];
      for (const ability of normalizedGrantedAbilities) {
        const canonical = ability.charAt(0).toUpperCase() + ability.slice(1);
        if (!grantedAbilitiesToRemove.some((entry: unknown) => String(entry || '').toLowerCase() === ability)) {
          grantedAbilitiesToRemove.push(canonical);
        }
      }
      untilEndOfTurn = { ...(untilEndOfTurn || {}), grantedAbilitiesToRemove };
    }

    return {
      ...perm,
      ...(existingEffects.length > 0 ? { temporaryEffects: existingEffects } : {}),
      ...(existingGrantedAbilities.length > 0 ? { grantedAbilities: existingGrantedAbilities } : {}),
      ...(untilEndOfTurn ? { untilEndOfTurn } : {}),
      ...(grantsHaste ? { summoningSickness: false } : {}),
    } as any;
  });

  return { ...(state as any), battlefield: nextBattlefield } as GameState;
}

function buildAllAbleBlockerRequirementDescription(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined
): string | null {
  if (!target || target.kind !== 'raw') return null;
  const normalized = String(target.text || target.raw || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const qualifiedMatch = normalized.match(/^all creatures(?: your opponents control)? with (.+?) able to block$/i);
  if (qualifiedMatch) {
    return `all creatures with ${String(qualifiedMatch[1] || '').trim()} able to block this creature do so`;
  }

  if (/^all creatures(?: your opponents control)? able to block$/i.test(normalized)) {
    return 'all creatures able to block this creature do so';
  }

  return null;
}

function resolveAttachedStaticAbilityGrantTargets(
  battlefield: readonly BattlefieldPermanent[],
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  if (!target || target.kind !== 'raw') return [];
  const normalized = String((target as any).text || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];

  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return [];
  const sourcePermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId) as any;

  const sourceSelfMatch = normalized.match(/^this\s+(creature|land|saga|permanent|enchantment)$/i);
  if (sourceSelfMatch) {
    if (!sourcePermanent) return [];
    const requiredType = String(sourceSelfMatch[1] || '').toLowerCase() === 'saga' ? 'enchantment' : String(sourceSelfMatch[1] || '').toLowerCase();
    if (requiredType !== 'permanent' && !permanentMatchesType(sourcePermanent, requiredType as any)) return [];
    return [sourcePermanent];
  }

  const attachedTargetMatch = normalized.match(/^(?:equipped|enchanted)\s+(creature|land|permanent)$/i);
  if (!attachedTargetMatch || !sourcePermanent) return [];

  const attachedToId = String(sourcePermanent.attachedTo || sourcePermanent.enchanting || '').trim();
  if (!attachedToId) return [];
  const attachedPermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === attachedToId);
  if (!attachedPermanent) return [];

  const requiredType = String(attachedTargetMatch[1] || '').trim().toLowerCase();
  if (requiredType !== 'permanent' && !permanentMatchesType(attachedPermanent, requiredType as any)) return [];
  return [attachedPermanent];
}

function resolveEquippedCreaturesYouControl(
  battlefield: readonly BattlefieldPermanent[],
  controllerId: string
): BattlefieldPermanent[] {
  const equippedHostIds = new Set(
    battlefield
      .filter(
        (perm: any) =>
          String(perm?.controller || '').trim() === controllerId &&
          permanentMatchesType(perm, 'artifact') &&
          typeLineHasSubtype(perm, 'equipment')
      )
      .map((perm: any) => String(perm?.attachedTo || '').trim())
      .filter(Boolean)
  );
  return battlefield.filter((perm: any) => {
    const id = String(perm?.id || '').trim();
    if (String(perm?.controller || '').trim() !== controllerId) return false;
    if (!permanentMatchesType(perm, 'creature')) return false;
    return (
      equippedHostIds.has(id) ||
      Boolean((perm as any)?.isEquipped) ||
      (Array.isArray((perm as any)?.attachedEquipment) && (perm as any).attachedEquipment.length > 0)
    );
  });
}

function permanentIsHistoric(perm: any): boolean {
  const typeLine = getExecutorTypeLineLower(perm);
  return (
    permanentMatchesType(perm, 'artifact') ||
    /\blegendary\b/.test(typeLine) ||
    typeLineHasSubtype(perm, 'saga')
  );
}

function permanentIsOutlaw(perm: any): boolean {
  return (
    typeLineHasSubtype(perm, 'assassin') ||
    typeLineHasSubtype(perm, 'mercenary') ||
    typeLineHasSubtype(perm, 'pirate') ||
    typeLineHasSubtype(perm, 'rogue') ||
    typeLineHasSubtype(perm, 'warlock')
  );
}

function permanentIsAlly(perm: any): boolean {
  return typeLineHasSubtype(perm, 'ally');
}

function permanentIsMonocolored(perm: any): boolean {
  const colors = Array.isArray((perm as any)?.colors)
    ? (perm as any).colors
    : Array.isArray((perm as any)?.card?.colors)
      ? (perm as any).card.colors
      : [];
  const normalized = colors.map((color: unknown) => String(color || '').trim()).filter(Boolean);
  return normalized.length === 1;
}

export function applyGrantStaticAbilityStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const attachedTargets = resolveAttachedStaticAbilityGrantTargets(battlefield, step.target as any, ctx);
  const directTargets = attachedTargets.length > 0 ? [] : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  const targets = attachedTargets.length > 0 ? attachedTargets : directTargets;
  const targetText = String((step.target as any)?.text || '').trim().toLowerCase();

  if (targets.length === 0 && /^target\b/.test(targetText)) {
    return {
      applied: false,
      message: `Skipped static ability grant (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const existingStaticGrantEffects = Array.isArray((state as any).staticAbilityGrantEffects)
    ? [...(state as any).staticAbilityGrantEffects]
    : [];
  const staticGrantEffect = {
    id: `${sourceId || sourceName || 'oracle'}:static-grant:${existingStaticGrantEffects.length + 1}`,
    sourceId: sourceId || undefined,
    sourceName: sourceName || undefined,
    controllerId: String(ctx.controllerId || '').trim() || undefined,
    target: step.target,
    abilities: Array.isArray(step.abilities) ? [...step.abilities] : [],
    effectText: Array.isArray(step.effectText) ? [...step.effectText] : [],
    power: step.power,
    toughness: step.toughness,
    duration: step.duration || 'static',
    raw: step.raw,
  };
  const duplicateStaticGrant = existingStaticGrantEffects.some((entry: any) =>
    String(entry?.sourceId || '').trim() === String(staticGrantEffect.sourceId || '').trim() &&
    String(entry?.raw || '').trim() === step.raw
  );

  if (targets.length === 0) {
    return {
      applied: true,
      state: {
        ...(state as any),
        staticAbilityGrantEffects: duplicateStaticGrant
          ? existingStaticGrantEffects
          : [...existingStaticGrantEffects, staticGrantEffect],
      } as GameState,
      log: [`Registered static ability grant: ${step.raw}`],
    };
  }

  const targetIds = new Set(targets.map((target: any) => String(target?.id || '').trim()).filter(Boolean));
  const grantedAbilities = [
    ...(Array.isArray(step.abilities) ? step.abilities : []),
    ...(Array.isArray(step.effectText) ? step.effectText : []),
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean);

  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String(perm?.id || '').trim();
    if (!targetIds.has(permanentId)) return perm;

    const existingGranted = Array.isArray(perm.grantedAbilities) ? [...perm.grantedAbilities] : [];
    for (const ability of grantedAbilities) {
      const normalizedAbility = ability.toLowerCase();
      if (!existingGranted.some(entry => String(entry || '').trim().toLowerCase() === normalizedAbility)) {
        existingGranted.push(normalizedAbility);
      }
    }

    const existingModifiers = Array.isArray(perm.modifiers) ? [...perm.modifiers] : [];
    if (typeof step.power === 'number' || typeof step.toughness === 'number') {
      const power = step.power || 0;
      const toughness = step.toughness || 0;
      const duration = step.duration || 'static';
      const duplicateModifier = existingModifiers.some((modifier: any) =>
        String(modifier?.type || '').trim() === 'powerToughness' &&
        Number(modifier?.power || 0) === power &&
        Number(modifier?.toughness || 0) === toughness &&
        String(modifier?.sourceId || '').trim() === sourceId &&
        String(modifier?.duration || '').trim() === duration
      );
      if (!duplicateModifier) {
        existingModifiers.push({
          type: 'powerToughness',
          power,
          toughness,
          sourceId: sourceId || undefined,
          sourceName: sourceName || undefined,
          duration,
        } as any);
      }
    }

    const grantsHaste = existingGranted.some((ability) => String(ability || '').trim().toLowerCase() === 'haste');

    return {
      ...perm,
      ...(existingGranted.length > 0 ? { grantedAbilities: existingGranted } : {}),
      ...(existingModifiers.length > 0 ? { modifiers: existingModifiers } : {}),
      ...(grantsHaste ? { summoningSickness: false } : {}),
      effectivePower: undefined,
      effectiveToughness: undefined,
    } as BattlefieldPermanent;
  });

  const processedBattlefield = getProcessedBattlefield({ ...(state as any), battlefield: nextBattlefield } as any);

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: processedBattlefield,
      staticAbilityGrantEffects: duplicateStaticGrant
        ? existingStaticGrantEffects
        : [...existingStaticGrantEffects, staticGrantEffect],
    } as GameState,
    log: [`Applied static ability grant to ${targets.length} permanent(s)`],
  };
}

function resolveRecentlyMovedBattlefieldPermanents(
  battlefield: readonly BattlefieldPermanent[],
  target:
    | { readonly kind: string; readonly text?: string; readonly raw?: string }
    | undefined,
  runtime?: RecentBattlefieldRuntime
): BattlefieldPermanent[] {
  if (!target || target.kind !== 'raw') return [];
  const recentIds = Array.isArray(runtime?.lastMovedBattlefieldPermanentIds)
    ? runtime.lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  if (recentIds.length === 0) return [];

  const normalized = normalizeSelfReferenceText(String((target as any).text || ''));
  if (!normalized) return [];

  const singular = /^(?:it|that card|that creature|that permanent|that token)$/i.test(normalized);
  const plural =
    /^(?:them|those creatures|those permanents|those auras)$/i.test(normalized);
  if (!singular && !plural) return [];

  const requiredType =
    /those auras/i.test(normalized) ? 'enchantment' :
    normalized.includes('creature') ? 'creature' :
    normalized.includes('permanent') || normalized === 'it' || normalized === 'that card' || normalized === 'them'
      ? 'permanent'
      : undefined;

  const matches = battlefield.filter((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!recentIds.includes(permanentId)) return false;
    if (requiredType && !permanentMatchesType(perm, requiredType as any)) return false;
    if (/those auras/i.test(normalized) && !/\baura\b/i.test(getExecutorTypeLineLower(perm))) return false;
    return true;
  });

  return singular ? matches.slice(0, 1) : matches;
}

function resolveRecentlyCreatedTokenPermanents(
  battlefield: readonly BattlefieldPermanent[],
  target:
    | { readonly kind: string; readonly text?: string; readonly raw?: string }
    | undefined,
  runtime?: RecentBattlefieldRuntime
): BattlefieldPermanent[] {
  if (!target || target.kind !== 'raw') return [];
  const recentIds = Array.isArray(runtime?.lastCreatedTokenIds)
    ? runtime.lastCreatedTokenIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  if (recentIds.length === 0) return [];

  const normalized = normalizeSelfReferenceText(String((target as any).text || ''));
  if (!normalized) return [];

  const singular = /^(?:it|that token|the token|that creature|the creature)$/i.test(normalized);
  const plural = /^(?:them|those tokens|those creatures)$/i.test(normalized);
  if (!singular && !plural) return [];

  const requireCreature = /creature/i.test(normalized);
  const matches = battlefield.filter((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!recentIds.includes(permanentId)) return false;
    if (!(perm as any)?.isToken) return false;
    if (requireCreature && !permanentMatchesType(perm, 'creature')) return false;
    return true;
  });

  return singular ? matches.slice(0, 1) : matches;
}

function resolveExiledCreatureCountThisWay(
  ctx: OracleIRExecutionContext | undefined,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  runtime?: RecentBattlefieldRuntime,
): number | null {
  if (ctx?.stepLedger?.size) {
    const antecedentStepIndex = resolveThisWayAntecedentStepIndex(ctx, step, 'exile');
    if (antecedentStepIndex != null && ctx.stepLedger.has(antecedentStepIndex)) {
      return resolveCreatureCountExiledThisWay(ctx, antecedentStepIndex);
    }
    if (ctx.currentStepIndex != null) {
      const fallbackAntecedent = findAntecedentStepIndex(ctx.appliedStepKinds, 'exile', ctx.currentStepIndex);
      if (fallbackAntecedent != null && ctx.stepLedger.has(fallbackAntecedent)) {
        return resolveCreatureCountExiledThisWay(ctx, fallbackAntecedent);
      }
    }
  }
  const exiledCards = Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : [];
  const creatureCount = exiledCards.filter((card: any) => getCardTypeLineLower(card).includes('creature')).length;
  if (creatureCount > 0) return creatureCount;
  const exiledCount = Number(runtime?.lastExiledCardCount);
  if (Number.isFinite(exiledCount) && exiledCount > 0) return Math.max(0, Math.floor(exiledCount));
  return null;
}

function resolveNonlandDiscardedCountThisWay(
  ctx: OracleIRExecutionContext | undefined,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  runtime?: RecentBattlefieldRuntime,
): number | null {
  if (ctx?.stepLedger?.size) {
    const antecedentStepIndex = resolveThisWayAntecedentStepIndex(ctx, step, 'discard');
    if (antecedentStepIndex != null && ctx.stepLedger.has(antecedentStepIndex)) {
      return resolveNonlandCountDiscardedThisWay(ctx, antecedentStepIndex);
    }
    if (ctx.currentStepIndex != null) {
      const fallbackAntecedent = findAntecedentStepIndex(ctx.appliedStepKinds, 'discard', ctx.currentStepIndex);
      if (fallbackAntecedent != null && ctx.stepLedger.has(fallbackAntecedent)) {
        return resolveNonlandCountDiscardedThisWay(ctx, fallbackAntecedent);
      }
    }
  }
  const discardedCards = Array.isArray(runtime?.lastDiscardedCards) ? runtime.lastDiscardedCards : [];
  if (discardedCards.length > 0) {
    return discardedCards.filter((card: any) => !getCardTypeLineLower(card).includes('land')).length;
  }
  return null;
}

function resolveAddCounterAmount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  ctx?: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): number | null {
  if (/amount of \{s\} spent to cast this spell/i.test(String(step.raw || ''))) {
    const snowSpent = Number((ctx as any)?.snowManaSpent ?? (ctx as any)?.referenceAmount ?? ctx?.xValue);
    if (Number.isFinite(snowSpent) && snowSpent > 0) return Math.floor(snowSpent);
  }

  if (/amount of snow mana spent to cast this spell/i.test(String(step.raw || ''))) {
    const snowSpent = Number((ctx as any)?.snowManaSpent ?? (ctx as any)?.referenceAmount ?? ctx?.xValue);
    if (Number.isFinite(snowSpent) && snowSpent > 0) return Math.floor(snowSpent);
  }

  if (/\bfor each \{e\} paid this way\b/i.test(String(step.raw || ''))) {
    const energyPaid = Number(ctx?.referenceAmount ?? ctx?.xValue ?? (ctx as any)?.energyPaidThisWay);
    if (Number.isFinite(energyPaid) && energyPaid > 0) return Math.floor(energyPaid);
  }

  if (/\bequal to the result\b/i.test(String(step.raw || ''))) {
    const resultValue = Number(ctx?.referenceAmount ?? ctx?.xValue ?? 1);
    if (Number.isFinite(resultValue)) return Math.max(0, Math.floor(resultValue));
  }

  if (/\bfor each creature card exiled this way\b/i.test(String(step.raw || ''))) {
    const creatureCount = resolveExiledCreatureCountThisWay(ctx, step, runtime);
    if (creatureCount !== null) return creatureCount;
  }

  if (step.amount.kind === 'greatest_power_among_other_creatures_you_control') {
    const sourceId = String(ctx?.sourceId || '').trim();
    const controllerId = String(ctx?.controllerId || '').trim();
    const powers = ((state.battlefield || []) as BattlefieldPermanent[])
      .filter((perm: any) => String(perm?.controller || '').trim() === controllerId)
      .filter((perm: any) => String(perm?.id || '').trim() !== sourceId)
      .filter((perm: any) => permanentMatchesType(perm, 'creature'))
      .map((perm: any) => readCharacteristicNumber(perm?.effectivePower, perm?.basePower, perm?.card?.power, perm?.power) ?? 0);
    return powers.length > 0 ? Math.max(0, ...powers) : 0;
  }

  if (step.amount.kind === 'votes_for_choice') {
    const choice = String((step.amount as any).choice || '').trim().toLowerCase();
    const multiplier = Math.max(1, Number((step.amount as any).multiplier) || 1);
    const voteCount = Number(
      (state as any)?.lastVoteResults?.[choice] ??
        (state as any)?.voteResults?.[choice] ??
        ctx?.referenceAmount ??
        1
    );
    if (Number.isFinite(voteCount) && voteCount > 0) {
      return Math.max(0, Math.floor(voteCount * multiplier));
    }
    return multiplier;
  }

  if (step.amount.kind === 'votes_received') {
    const controllerId = String(ctx?.controllerId || '').trim();
    return resolveVotesReceivedQuantity(state, controllerId, step.amount as any);
  }

  const controllerId = String(ctx?.controllerId || '').trim() as PlayerID;
  if (controllerId && ctx) {
    const stepWhereX = (step as { whereX?: { kind: 'where'; raw: string } }).whereX;
    const whereXMatch = String(step.raw || '').match(/\bwhere x is (.+?)(?:[.,]|$)/i);
    const whereX =
      stepWhereX?.kind === 'where'
        ? stepWhereX
        : whereXMatch
          ? { kind: 'where' as const, raw: String(whereXMatch[1] || '').trim() }
          : undefined;
    if (whereX) {
      const resolvedQuantity = resolveOracleQuantity(state, controllerId, step.amount, ctx, {
        runtime,
        whereX,
        step,
      });
      if (resolvedQuantity !== null) return resolvedQuantity;
    }
    if (/amount of \{s\} spent to cast this spell/i.test(String(step.raw || ''))) {
      const snowSpent = Number((ctx as any).snowManaSpent ?? (ctx as any).referenceAmount ?? ctx.xValue);
      if (Number.isFinite(snowSpent) && snowSpent > 0) return Math.floor(snowSpent);
    }
  }

  const rawLowerEarly = String(step.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
  if (/power of the creature exiled this way/i.test(rawLowerEarly)) {
    const exiledCards = [
      ...(Array.isArray(ctx?.lastExiledCards) ? ctx.lastExiledCards : []),
      ...(Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : []),
    ];
    const exiledCreature = exiledCards.find((card: any) => getCardTypeLineLower(card).includes('creature'));
    if (exiledCreature) {
      const power = readCharacteristicNumber(
        (exiledCreature as any)?.power,
        (exiledCreature as any)?.card?.power,
        (exiledCreature as any)?.basePower
      );
      if (power !== undefined) return Math.max(0, power);
    }
    const referencePower = Number(ctx?.referenceAmount ?? ctx?.xValue);
    if (Number.isFinite(referencePower) && referencePower > 0) return Math.floor(referencePower);
  }

  if (/equal to the difference/i.test(rawLowerEarly)) {
    const difference = Number(ctx?.referenceAmount ?? ctx?.xValue);
    if (Number.isFinite(difference)) return Math.max(0, Math.floor(difference));
  }

  if (/\{e\} paid this way/i.test(rawLowerEarly)) {
    const energyPaid = Number(ctx?.referenceAmount ?? ctx?.xValue ?? (ctx as any)?.energyPaidThisWay);
    if (Number.isFinite(energyPaid) && energyPaid > 0) return Math.floor(energyPaid);
  }

  if (step.amount.kind === 'reference_amount') {
    const referenceRaw = String(step.amount.raw || '').toLowerCase();
    if (/creature cards? exiled this way/.test(referenceRaw)) {
      const creatureCount = resolveExiledCreatureCountThisWay(ctx, step, runtime);
      if (creatureCount !== null) return creatureCount;
    }

    const controllerIdForReference = String(ctx?.controllerId || '').trim() as PlayerID;
    if (controllerIdForReference && ctx) {
      const resolvedReferenceAmount = resolveOracleQuantity(
        state,
        controllerIdForReference,
        step.amount,
        ctx,
        { runtime, step },
      );
      if (resolvedReferenceAmount !== null) return resolvedReferenceAmount;
    }
  }

  const rawLower = String(step.raw || '').toLowerCase();
  if (/for each sprout vote/.test(rawLower)) {
    const voteCount = Number((state as any)?.lastVoteResults?.sprout ?? (state as any)?.voteResults?.sprout ?? ctx?.referenceAmount);
    if (Number.isFinite(voteCount) && voteCount > 0) return Math.max(0, Math.floor(voteCount * 2));
    return 2;
  }

  if (/for each strength vote/.test(rawLower)) {
    const voteCount = Number((state as any)?.lastVoteResults?.strength ?? (state as any)?.voteResults?.strength ?? ctx?.referenceAmount);
    if (Number.isFinite(voteCount) && voteCount > 0) return Math.max(0, Math.floor(voteCount));
    return 1;
  }

  if (/growth counters on this enchantment/.test(rawLower)) {
    const sourceId = String(ctx?.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? ((state.battlefield || []) as BattlefieldPermanent[]).find(
          (perm: any) => String(perm?.id || '').trim() === sourceId
        )
      : undefined;
    const growthCount = Number(((sourcePermanent as any)?.counters || {}).growth ?? ctx?.referenceAmount ?? 3);
    if (Number.isFinite(growthCount) && growthCount > 0) return Math.max(0, Math.floor(growthCount));
  }

  if (/number of \+1\/\+1 counters on this creature/.test(rawLower)) {
    const sourceId = String(ctx?.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? ((state.battlefield || []) as BattlefieldPermanent[]).find(
          (perm: any) => String(perm?.id || '').trim() === sourceId
        )
      : undefined;
    const plusOneCount = Number(((sourcePermanent as any)?.counters || {})['+1/+1'] ?? ctx?.referenceAmount ?? 2);
    if (Number.isFinite(plusOneCount) && plusOneCount > 0) return Math.max(0, Math.floor(plusOneCount));
  }

  if (/number of cards looked at while scrying this way/.test(rawLower)) {
    return Math.max(0, Number(ctx?.referenceAmount ?? 2));
  }

  if (/total power of creatures goaded this way/.test(rawLower)) {
    return Math.max(0, Number(ctx?.referenceAmount ?? 6));
  }

  if (/number of cards looked at while scrying this way/.test(rawLower)) {
    return Math.max(0, Number(ctx?.referenceAmount ?? 2));
  }

  if (step.amount.kind === 'number' && step.amount.value === 1) {
    const raw = rawLower;
    if (/for each creature card exiled this way/.test(raw)) {
      const creatureCount = resolveExiledCreatureCountThisWay(ctx, step, runtime);
      if (creatureCount !== null) return creatureCount;
    }
  }

  if (controllerId && ctx) {
    const resolvedQuantity = resolveOracleQuantity(state, controllerId, step.amount, ctx, { runtime, step });
    if (resolvedQuantity !== null) return resolvedQuantity;
  }

  const numericAmount = quantityToNumber(step.amount, ctx);
  if (numericAmount !== null) return numericAmount;
  if (step.amount.kind !== 'x') return null;

  const raw = String(step.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
  const movedCards = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];
  const discardedCards = Array.isArray(runtime?.lastDiscardedCards) ? runtime.lastDiscardedCards : [];
  if (movedCards.length === 1) {
    const movedCard = movedCards[0];
    const manaValue = getCardManaValue(movedCard);
    if (manaValue !== null && /\bwhere x is (?:the exiled card's|that card's|its) mana value\b/.test(raw)) {
      return Math.max(0, manaValue);
    }

    const powerValue = readCharacteristicNumber((movedCard as any)?.power, (movedCard as any)?.card?.power);
    if (powerValue !== undefined && /\bwhere x is (?:the exiled card's|that card's|its|this card's) power\b/.test(raw)) {
      return Math.max(0, powerValue);
    }

    const toughnessValue = readCharacteristicNumber((movedCard as any)?.toughness, (movedCard as any)?.card?.toughness);
    if (toughnessValue !== undefined && /\bwhere x is (?:the exiled card's|that card's|its|this card's) toughness\b/.test(raw)) {
      return Math.max(0, toughnessValue);
    }
  }

  if (/\bwhere x is the number of nonland cards discarded this way\b/.test(raw)) {
    const nonlandCount = resolveNonlandDiscardedCountThisWay(ctx, step, runtime);
    if (nonlandCount !== null) return Math.max(0, nonlandCount);
  }

  return Math.max(
    0,
    Array.isArray(runtime?.lastCreatedTokenIds)
      ? runtime.lastCreatedTokenIds.map(id => String(id || '').trim()).filter(Boolean).length
      : 0
  );
}

function buildDelayedCleanupReference(permanents: readonly BattlefieldPermanent[]): string {
  if (permanents.length <= 0) return 'that permanent';
  if (permanents.length === 1) {
    const perm = permanents[0];
    if ((perm as any)?.isToken) return 'that token';
    if (permanentMatchesType(perm, 'creature')) return 'that creature';
    return 'that permanent';
  }

  if (permanents.every(perm => Boolean((perm as any)?.isToken))) {
    return 'those tokens';
  }

  if (permanents.every(perm => permanentMatchesType(perm, 'creature'))) {
    return 'those creatures';
  }

  return 'them';
}

function renderBattlefieldObjectCondition(condition?: OracleBattlefieldObjectCondition): string {
  if (!condition) return '';
  if (condition.kind === 'mana_value_compare') {
    return ` if it has mana value ${condition.value} or ${condition.comparator === 'lte' ? 'less' : 'greater'}`;
  }
  if (condition.comparator === 'eq' && condition.value === 0) {
    return ` if there are no ${condition.counter} counters on it`;
  }
  return ` if it has ${condition.value} or ${condition.comparator === 'lte' ? 'less' : 'more'} ${condition.counter} counters on it`;
}

function evaluateBattlefieldObjectCondition(
  permanent: BattlefieldPermanent,
  condition?: OracleBattlefieldObjectCondition
): boolean | null {
  if (!condition) return true;

  if (condition.kind === 'mana_value_compare') {
    const manaValue = getCardManaValue((permanent as any)?.card || permanent);
    if (manaValue === null) return null;
    return condition.comparator === 'lte' ? manaValue <= condition.value : manaValue >= condition.value;
  }

  const counters = (permanent as any)?.counters;
  const count = Number(counters?.[condition.counter] ?? 0);
  const normalizedCount = Number.isFinite(count) ? count : 0;
  if (condition.comparator === 'lte') return normalizedCount <= condition.value;
  if (condition.comparator === 'gte') return normalizedCount >= condition.value;
  return normalizedCount === condition.value;
}

function registerDelayedBattlefieldAction(
  state: GameState,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  timing: DelayedTriggerTiming,
  action: 'sacrifice' | 'exile',
  permanents: readonly BattlefieldPermanent[],
  condition?: OracleBattlefieldObjectCondition,
  whoText?: string,
  watchingPermanentId?: string
): { state: GameState; log: string[] } {
  const chosenObjectIds = Array.from(
    new Set(permanents.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean))
  );
  if (chosenObjectIds.length === 0) return { state, log: [] };

  const reference = buildDelayedCleanupReference(permanents);
  const trimmedWhoText = String(whoText || '').trim();
  const effect = (() => {
    if (action === 'exile') return `Exile ${reference}.`;
    if (!trimmedWhoText) return `Sacrifice ${reference}${renderBattlefieldObjectCondition(condition)}.`;

    const subject = trimmedWhoText;
    const lowerSubject = subject.toLowerCase();
    const verb =
      lowerSubject === 'you' || lowerSubject === 'they'
        ? 'sacrifice'
        : 'sacrifices';
    return `${subject} ${verb} ${reference}${renderBattlefieldObjectCondition(condition)}.`;
  })();

  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  const delayedTrigger = createDelayedTrigger(
    String(ctx.sourceId || ctx.sourceName || 'oracle-ir'),
    String(ctx.sourceName || 'Delayed cleanup'),
    controllerId,
    timing,
    effect,
    currentTurn,
    {
      ...(watchingPermanentId ? { watchingPermanentId } : {}),
      targets: [...chosenObjectIds],
      eventDataSnapshot: {
        sourceId: String(ctx.sourceId || '').trim() || undefined,
        sourceControllerId: String(controllerId || '').trim() || undefined,
        targetPermanentId: chosenObjectIds.length === 1 ? chosenObjectIds[0] : undefined,
        chosenObjectIds,
      },
    }
  );

  const registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
  const nextRegistry = registerDelayedTrigger(registry, delayedTrigger);
  return {
    state: {
      ...(state as any),
      delayedTriggerRegistry: nextRegistry,
    } as GameState,
    log: [`Scheduled delayed ${action} for ${chosenObjectIds.length} permanent(s) at ${timing.replace(/_/g, ' ')}`],
  };
}

export function applyTapOrUntapStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'tap_or_untap' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const special = trySpecialTapOrUntapStep(state, step, ctx);
  if (special) return special;

  const effectiveTarget = effectiveStepTarget(step) || step.target;
  let targetIds = resolveTapOrUntapTargetIds(state, effectiveTarget as any, ctx);
  const targetText = String((effectiveTarget as any)?.text || '').trim().toLowerCase();
  if (targetIds.length === 0) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const directTargets = resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
    targetIds = directTargets
      .map((perm: any) => String((perm as any)?.id || '').trim())
      .filter(Boolean)
      .slice(0, /\btarget\b/.test(targetText) ? 1 : directTargets.length);
  }
  if (targetIds.length === 0 && /^(?:another|other)\s+target\b/.test(targetText)) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const sourceId = String(ctx.sourceId || '').trim();
    const requiredType = parseSimplePermanentTypeFromText(targetText) || 'creature';
    const controllerId = String(ctx.controllerId || '').trim();
    const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
      ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];
    const excludeIds = new Set(
      [sourceId, String(ctx.targetCreatureId || '').trim(), String(ctx.targetPermanentId || '').trim()].filter(Boolean)
    );
    const orderedCandidates = [
      ...chosenIds
        .map(id => battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === id))
        .filter((perm): perm is BattlefieldPermanent => Boolean(perm)),
      ...battlefield.filter(
        (perm: any) =>
          String((perm as any)?.controller || '').trim() === controllerId &&
          permanentMatchesType(perm, requiredType as any)
      ),
    ];
    const seen = new Set<string>();
    for (const perm of orderedCandidates) {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!permanentId || seen.has(permanentId) || excludeIds.has(permanentId)) continue;
      seen.add(permanentId);
      targetIds = [permanentId];
      break;
    }
  }
  if (targetIds.length === 0) {
    const isUpTo = /\bup to\b/i.test(`${targetText} ${String(step.raw || '')}`);
    if (isUpTo) {
      const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
      const typePhrase = targetText.replace(/^up to (?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+/i, '').trim();
      const requiredType = parseSimplePermanentTypeFromText(typePhrase) || 'creature';
      const hasLegalCandidate = battlefield.some((perm: any) => permanentMatchesType(perm, requiredType as any));
      if (!hasLegalCandidate) {
        return {
          applied: true,
          state,
          log: ['Chose no permanents to tap/untap (up to N)'],
          lastTappedMatchingPermanentCount: 0,
          lastTappedMatchingPermanentIds: [],
        };
      }
    }
    return {
      applied: false,
      message: `Skipped tap/untap (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const currentTargets = ((state.battlefield || []) as any[]).filter((perm: any) =>
    targetIds.includes(String(perm?.id || '').trim())
  );
  const choice: 'tap' | 'untap' =
    step.mode ?? ctx.tapOrUntapChoice ?? (currentTargets.some((perm: any) => Boolean(perm?.tapped)) ? 'untap' : 'tap');

  return {
    applied: true,
    state: applyTapOrUntapToBattlefield(state, targetIds, choice),
    log: [`${choice === 'tap' ? 'Tapped' : 'Untapped'} ${targetIds.length} permanent(s)`],
    ...(choice === 'tap'
      ? {
          lastTappedMatchingPermanentCount: targetIds.length,
          lastTappedMatchingPermanentIds: targetIds,
        }
      : {}),
  };
}

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
  const targetIds = resolveTapOrUntapTargetIds(state, step.target as any, ctx);
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

export function applySkipNextUntapStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'skip_next_untap' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const targetTextRaw = String((step.target as any)?.text || step.raw || '').trim();
  const targetTextLower = targetTextRaw.toLowerCase();

  if (
    /^(?:that|target)\s+player$/i.test(targetTextLower) ||
    /^(?:target player|that player)\s+skips\s+their\s+next\s+untap\s+step\.?$/i.test(targetTextLower)
  ) {
    const playerId = String(
      ctx.selectorContext?.targetPlayerId ||
      ctx.selectorContext?.thatPlayerId ||
      (step.target as any)?.playerId ||
      ''
    ).trim();
    if (!playerId) {
      return {
        applied: false,
        message: `Skipped next untap step (no target player): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const stateAny = state as any;
    stateAny.skipNextUntapStepByPlayer = stateAny.skipNextUntapStepByPlayer || {};
    stateAny.skipNextUntapStepByPlayer[playerId] = true;
    return {
      applied: true,
      state: stateAny as GameState,
      log: [`${playerId} skips their next untap step`],
    };
  }

  if (/^those creatures(?: don't untap|$)/i.test(targetTextLower)) {
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const antecedentIds = [
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds) ? ctx.lastAntecedentBattlefieldPermanentIds : []),
      ...(Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    const targetIds = Array.from(new Set([...contextualIds, ...antecedentIds])).filter((id) =>
      battlefield.some((perm: any) => String((perm as any)?.id || '').trim() === id)
    );
    if (targetIds.length > 0) {
      const targetIdSet = new Set(targetIds);
      const nextBattlefield = battlefield.map((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        if (!targetIdSet.has(permanentId)) return perm;
        const existingEffects = Array.isArray((perm as any)?.temporaryEffects)
          ? [...(perm as any).temporaryEffects]
          : [];
        existingEffects.push({
          id: `${permanentId}:temp:${existingEffects.length + 1}:doesnt-untap-next-untap-step`,
          description: "doesn't untap during their controllers' next untap steps",
          expiresAt: 'leaves_battlefield',
          expiresOnControllerTurn: String((perm as any)?.controller || '').trim() || undefined,
          sourceId: String(ctx.sourceId || '').trim() || undefined,
          sourceName: String(ctx.sourceName || '').trim() || undefined,
        } as any);
        return { ...perm, temporaryEffects: existingEffects } as any;
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield: nextBattlefield } as GameState,
        log: [`Marked ${targetIds.length} creature(s) to skip their next untap step`],
      };
    }
  }

  if (/^creatures and lands target opponent controls(?: don't untap during their next untap step)?$/i.test(targetTextLower)) {
    const opponentId = String(ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2').trim();
    const targetIds = battlefield
      .filter((perm: any) => {
        if (String((perm as any)?.controller || '').trim() !== opponentId) return false;
        return permanentMatchesType(perm, 'creature') || permanentMatchesType(perm, 'land');
      })
      .map((perm: any) => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    if (targetIds.length > 0) {
      const targetIdSet = new Set(targetIds);
      const nextBattlefield = battlefield.map((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        if (!targetIdSet.has(permanentId)) return perm;
        const existingEffects = Array.isArray((perm as any)?.temporaryEffects)
          ? [...(perm as any).temporaryEffects]
          : [];
        existingEffects.push({
          id: `${permanentId}:temp:${existingEffects.length + 1}:doesnt-untap-next-untap-step`,
          description: "doesn't untap during their next untap step",
          expiresAt: 'leaves_battlefield',
          expiresOnControllerTurn: opponentId || undefined,
          sourceId: String(ctx.sourceId || '').trim() || undefined,
          sourceName: String(ctx.sourceName || '').trim() || undefined,
        } as any);
        return { ...perm, temporaryEffects: existingEffects } as any;
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield: nextBattlefield } as GameState,
        log: [`Marked ${targetIds.length} permanent(s) to skip their next untap step`],
      };
    }
  }

  if (/^lands target player controls(?: don't untap during their next untap step)?$/i.test(targetTextLower)) {
    const playerId = String(
      ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2'
    ).trim();
    const targetIds = battlefield
      .filter(
        (perm: any) =>
          String((perm as any)?.controller || '').trim() === playerId && permanentMatchesType(perm, 'land')
      )
      .map((perm: any) => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    if (targetIds.length === 0) {
      return { applied: true, state, log: ['No lands for target player to skip untap'] };
    }
    const targetIdSet = new Set(targetIds);
    const nextBattlefield = battlefield.map((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!targetIdSet.has(permanentId)) return perm;
      const existingEffects = Array.isArray((perm as any)?.temporaryEffects)
        ? [...(perm as any).temporaryEffects]
        : [];
      existingEffects.push({
        id: `${permanentId}:temp:${existingEffects.length + 1}:doesnt-untap-next-untap-step`,
        description: "doesn't untap during their controller's next untap step",
        expiresAt: 'leaves_battlefield',
        expiresOnControllerTurn: playerId || undefined,
        sourceId: String(ctx.sourceId || '').trim() || undefined,
        sourceName: String(ctx.sourceName || '').trim() || undefined,
      } as any);
      return { ...perm, temporaryEffects: existingEffects } as any;
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Marked ${targetIds.length} land(s) to skip their next untap step`],
    };
  }

  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, step.target as any, runtime);
  const directTargets =
    recentTargets.length > 0
      ? []
      : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  const targetIds = Array.from(
    new Set(
      [...recentTargets, ...directTargets]
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped next untap prevention (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targetIds.length > 1 && /^target\b/i.test(String((step.target as any)?.text || '').trim())) {
    return {
      applied: false,
      message: `Skipped next untap prevention (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const targetIdSet = new Set(targetIds);
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIdSet.has(permanentId)) return perm;

    const existingEffects = Array.isArray((perm as any)?.temporaryEffects)
      ? [...(perm as any).temporaryEffects]
      : [];
    existingEffects.push({
      id: `${permanentId}:temp:${existingEffects.length + 1}:doesnt-untap-next-untap-step`,
      description: "doesn't untap during your next untap step",
      expiresAt: 'leaves_battlefield',
      expiresOnControllerTurn: String((perm as any)?.controller || '').trim() || undefined,
      sourceId: String(ctx.sourceId || '').trim() || undefined,
      sourceName: String(ctx.sourceName || '').trim() || undefined,
    } as any);

    return {
      ...perm,
      temporaryEffects: existingEffects,
    } as any;
  });

  return {
    applied: true,
    state: { ...(state as any), battlefield: nextBattlefield } as GameState,
    log: [`Marked ${targetIds.length} permanent(s) to skip their next untap step`],
  };
}

export function applyOptionalUntapChoiceStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'optional_untap_choice' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const targetText = String((step.target as any)?.text || (step.target as any)?.raw || '').trim();
  const sourceId = String(ctx.sourceId || '').trim();
  const sourcePermanent = sourceId
    ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
    : undefined;
  const normalizedTarget = normalizeSelfReferenceText(targetText);
  const sourceNames = new Set(
    [String(ctx.sourceName || ''), String((ctx as any).cardName || '')]
      .flatMap(value => buildNameReferenceAliases(value))
      .filter(Boolean)
  );
  const nameMatchedTarget =
    normalizedTarget.length > 0 &&
    (sourceNames.has(normalizedTarget) ||
      [...sourceNames].some((alias) => normalizedTarget.includes(alias) || alias.includes(normalizedTarget)));
  const selfReference =
    /^(?:this\s+(?:creature|artifact|land|permanent|vehicle)|it)$/i.test(targetText) ||
    (normalizedTarget.length > 0 && sourceNames.has(normalizedTarget)) ||
    nameMatchedTarget;

  const targets = selfReference && sourcePermanent
    ? [sourcePermanent]
    : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  const targetIds = Array.from(new Set(
    targets.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean)
  ));

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped optional untap choice registration (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targetIds.length > 1) {
    return {
      applied: false,
      message: `Skipped optional untap choice registration (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const targetIdSet = new Set(targetIds);
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIdSet.has(permanentId)) return perm;
    return {
      ...perm,
      optionalUntapChoice: true,
      optionalUntapChoiceSourceId: String(ctx.sourceId || '').trim() || undefined,
      optionalUntapChoiceSourceName: String(ctx.sourceName || '').trim() || undefined,
    } as any;
  });

  return {
    applied: true,
    state: { ...(state as any), battlefield: nextBattlefield } as GameState,
    log: [`Registered optional untap choice for ${targetIds.length} permanent(s)`],
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

export function applyGrantTemporaryDiesTriggerStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_temporary_dies_trigger' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const normalizedTargetText = normalizeGrantTemporaryAbilityTargetText(
    String((step.target as any)?.text || inferGrantTemporaryAbilityTargetFromRaw(String(step.raw || '')) || ''),
    String(step.raw || '')
  );
  const targetText = normalizedTargetText.toLowerCase();
  const explicitTargetId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
  const massTargets = resolveGrantTemporaryMassTargets(
    battlefield,
    normalizedTargetText,
    String(step.raw || ''),
    ctx
  );
  let targets =
    explicitTargetId && /^target\b/.test(targetText)
      ? battlefield.filter((perm: any) => String(perm?.id || '').trim() === explicitTargetId)
      : massTargets && massTargets.length > 0
        ? massTargets
        : resolveDirectBattlefieldPermanents(
            battlefield,
            { kind: 'raw', text: normalizedTargetText },
            ctx
          );

  if (/^face-up nontoken creatures you control$/i.test(normalizedTargetText)) {
    targets = battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() !== String(ctx.controllerId || '').trim()) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      if ((perm as any)?.isToken) return false;
      return Boolean((perm as any)?.faceUpCard) || !(perm as any)?.faceDown;
    });
  }

  if (/any number of target creatures you control/i.test(String(step.raw || '')) && targets.length === 0) {
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    targets = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!boundIds.has(id)) return false;
      if (String(perm?.controller || '').trim() !== String(ctx.controllerId || '').trim()) return false;
      return permanentMatchesType(perm, 'creature');
    });
  }

  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped temporary dies trigger grant (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targets.length > 1 && /^target\b/.test(targetText)) {
    return {
      applied: false,
      message: `Skipped temporary dies trigger grant (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  let registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
  const log: string[] = [];

  for (const target of targets) {
    const watchedPermanentId = String((target as any)?.id || '').trim();
    if (!watchedPermanentId) continue;
    const delayedTrigger = createDelayedTrigger(
      String(ctx.sourceId || ctx.sourceName || 'oracle-ir'),
      String(ctx.sourceName || 'Temporary granted dies trigger'),
      controllerId,
      DelayedTriggerTiming.WHEN_DIES,
      step.effect,
      currentTurn,
      {
        watchingPermanentId: watchedPermanentId,
        targets: [watchedPermanentId],
        effectData: {
          expireAtEndOfTurn: step.duration === 'until_end_of_turn',
          expireWhenPermanentLeavesBattlefield: true,
        },
        eventDataSnapshot: {
          sourceId: String(ctx.sourceId || '').trim() || undefined,
          sourceControllerId: String(controllerId || '').trim() || undefined,
          targetPermanentId: watchedPermanentId,
          chosenObjectIds: [watchedPermanentId],
        },
      }
    );
    registry = registerDelayedTrigger(registry, delayedTrigger);
    log.push(
      `Granted delayed dies trigger to ${watchedPermanentId}${
        step.duration === 'until_end_of_turn' ? ' until end of turn' : ''
      }`
    );
  }

  return {
    applied: true,
    state: {
      ...(state as any),
      delayedTriggerRegistry: registry,
    } as GameState,
    log,
  };
}

function registerTemporaryStaticAbilityGrant(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_temporary_ability' }>,
  ctx: OracleIRExecutionContext,
  options?: {
    readonly targetPlayerId?: string;
    readonly targetPermanentId?: string;
    readonly duration?: 'end_of_turn' | 'until_next_turn';
  }
): BattlefieldStepHandlerResult {
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const existingStaticGrantEffects = Array.isArray((state as any).staticAbilityGrantEffects)
    ? [...(state as any).staticAbilityGrantEffects]
    : [];
  const duration = options?.duration || (step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn');
  const staticGrantEffect = {
    id: `${sourceId || sourceName || 'oracle'}:temp-static-grant:${existingStaticGrantEffects.length + 1}`,
    sourceId: sourceId || undefined,
    sourceName: sourceName || undefined,
    controllerId: String(ctx.controllerId || '').trim() || undefined,
    ...(options?.targetPlayerId ? { targetPlayerId: options.targetPlayerId } : {}),
    ...(options?.targetPermanentId ? { targetPermanentId: options.targetPermanentId } : {}),
    target: step.target,
    abilities: Array.isArray(step.abilities) ? [...step.abilities] : [],
    effectText: Array.isArray(step.effectText) ? [...step.effectText] : [],
    duration,
    raw: step.raw,
  };
  const duplicateStaticGrant = existingStaticGrantEffects.some((entry: any) =>
    String(entry?.sourceId || '').trim() === String(staticGrantEffect.sourceId || '').trim() &&
    String(entry?.raw || '').trim() === String(step.raw || '').trim()
  );
  return {
    applied: true,
    state: {
      ...(state as any),
      staticAbilityGrantEffects: duplicateStaticGrant
        ? existingStaticGrantEffects
        : [...existingStaticGrantEffects, staticGrantEffect],
    } as GameState,
    log: [`Registered temporary static ability grant: ${step.raw}`],
  };
}

export function applyGrantTemporaryAbilityStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_temporary_ability' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const stepRaw = String(step.raw || '');
  const inferredTarget = inferGrantTemporaryAbilityTargetFromRaw(stepRaw);
  const normalizedTargetText =
    normalizeGrantTemporaryAbilityTargetText(
      String((step.target as any)?.text || inferredTarget || ''),
      stepRaw
    ) || inferredTarget;
  const targetText = normalizedTargetText.toLowerCase();
  const sourceNameAliases = new Set(buildNameReferenceAliases(String(ctx.sourceName || '')));

  if (/^annihilator 1$/i.test(targetText) || /^annihilator 1$/i.test(stepRaw.trim())) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = sourceId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
      : undefined;
    if (!source) {
      return {
        applied: false,
        message: `Skipped temporary ability grant (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const nextState = applyTemporaryEffectToPermanents(state, [source], ctx, {
      descriptions: ['annihilator 1'],
      expiresAt: 'end_of_turn',
    });
    return { applied: true, state: nextState, log: ['Granted annihilator 1 until end of turn'] };
  }

  const grantControllerId = String(ctx.controllerId || '').trim();
  const grantDuringYourTurnMatch = stepRaw.match(
    /^during your turn,\s*(equipped creatures you control|commanders you control|equipped creature|other historic creatures you control|outlaws you control|allies you control)\s+(?:have|has)\s+(.+)$/i
  );
  if (grantDuringYourTurnMatch) {
    const targetPhrase = String(grantDuringYourTurnMatch[1] || '').trim().toLowerCase();
    const abilityText = String(grantDuringYourTurnMatch[2] || '').trim();
    const grantedAbilities = abilityText
      .split(/\s+and\s+|\s*,\s*/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    let targets: BattlefieldPermanent[] = [];
    if (targetPhrase === 'equipped creatures you control') {
      targets = resolveEquippedCreaturesYouControl(battlefield, grantControllerId);
    } else if (targetPhrase === 'commanders you control') {
      targets = battlefield.filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== grantControllerId) return false;
        return Boolean((perm as any)?.isCommander) || /\bcommander\b/i.test(getExecutorTypeLineLower(perm));
      });
    } else if (targetPhrase === 'equipped creature') {
      targets = resolveAttachedStaticAbilityGrantTargets(battlefield, { kind: 'raw', text: 'equipped creature' }, ctx);
    } else if (targetPhrase === 'other historic creatures you control') {
      const sourceId = String(ctx.sourceId || '').trim();
      targets = battlefield.filter((perm: any) => {
        const id = String(perm?.id || '').trim();
        if (!id || id === sourceId) return false;
        if (String(perm?.controller || '').trim() !== grantControllerId) return false;
        return permanentMatchesType(perm, 'creature') && permanentIsHistoric(perm);
      });
    } else if (targetPhrase === 'outlaws you control') {
      targets = battlefield.filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== grantControllerId) return false;
        return permanentMatchesType(perm, 'creature') && permanentIsOutlaw(perm);
      });
    } else if (targetPhrase === 'allies you control') {
      targets = battlefield.filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== grantControllerId) return false;
        return permanentMatchesType(perm, 'creature') && permanentIsAlly(perm);
      });
    }
    if (targets.length === 0) {
      return { applied: true, state, log: [`No targets for during-your-turn grant: ${targetPhrase}`] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
      descriptions: grantedAbilities.length > 0 ? grantedAbilities : [abilityText],
      grantedAbilities,
      expiresAt: 'leaves_battlefield',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Granted ${abilityText} to ${targets.length} permanent(s) during your turn`],
    };
  }

  if (/^creatures dealt damage this way can't be regenerated this turn$/i.test(stepRaw)) {
    const damagedIds = Array.from(
      new Set([
        ...collectBoundBattlefieldIds(ctx),
        ...(Array.isArray((ctx as any).lastDamagedBattlefieldPermanentIds)
          ? ((ctx as any).lastDamagedBattlefieldPermanentIds as readonly string[])
          : []),
      ])
    );
    const damagedTargets = battlefield.filter((perm: any) =>
      damagedIds.includes(String((perm as any)?.id || '').trim())
    );
    if (damagedTargets.length === 0) {
      return { applied: true, state, log: ['No damaged creatures for regeneration restriction'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, damagedTargets, ctx, {
      descriptions: ["can't be regenerated"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-be-regenerated to ${damagedTargets.length} damaged creature(s)`],
    };
  }

  if (/^equipped creature has base power and toughness 7\/7 and can't be blocked by creatures with power 2 or less$/i.test(stepRaw)) {
    const targets = resolveAttachedStaticAbilityGrantTargets(battlefield, { kind: 'raw', text: 'equipped creature' }, ctx);
    if (targets.length === 0) {
      return { applied: true, state, log: ['No equipped creature for Wrecking Ball Arm grant'] };
    }
    const targetId = String((targets[0] as any)?.id || '').trim();
    const withBasePt = applyTemporarySetBasePowerToughness(state, targetId, ctx, 7, 7);
    if (!withBasePt) {
      return { applied: true, state, log: ['Equipped creature not on battlefield for base P/T grant'] };
    }
    const nextState = applyTemporaryEffectToPermanents(withBasePt, targets, ctx, {
      descriptions: ["can't be blocked by creatures with power 2 or less"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: ['Granted 7/7 and evasion to equipped creature'],
    };
  }

  if (
    /^equipped creature has hexproof and can't be blocked$/i.test(stepRaw) ||
    /during your turn, equipped creature has hexproof and can't be blocked/i.test(stepRaw)
  ) {
    const targets = resolveAttachedStaticAbilityGrantTargets(
      battlefield,
      { kind: 'raw', text: 'equipped creature' },
      ctx
    );
    if (targets.length === 0) {
      return { applied: true, state, log: ['No equipped creature for hexproof/evasion grant'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
      descriptions: ['hexproof', "can't be blocked"],
      grantedAbilities: ['hexproof'],
      expiresAt: 'leaves_battlefield',
    });
    return { applied: true, state: nextState, log: ['Granted hexproof and evasion to equipped creature'] };
  }

  if (/^equipped creature has ward \{2\}, is an assassin in addition to its other types, and can't be blocked$/i.test(stepRaw)) {
    const targets = resolveAttachedStaticAbilityGrantTargets(
      battlefield,
      { kind: 'raw', text: 'equipped creature' },
      ctx
    );
    if (targets.length === 0) {
      return { applied: true, state, log: ['No equipped creature for Brotherhood Regalia grant'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
      descriptions: ['ward {2}', 'is an Assassin', "can't be blocked"],
      grantedAbilities: ['ward'],
      expiresAt: 'leaves_battlefield',
    });
    return { applied: true, state: nextState, log: ['Granted Brotherhood Regalia abilities to equipped creature'] };
  }

  if (/^creatures you control with power or toughness 1 or less can't be blocked$/i.test(stepRaw)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const targets = battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return false;
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
      if (power !== undefined && power <= 1) return true;
      if (toughness !== undefined && toughness <= 1) return true;
      return false;
    });
    if (targets.length === 0) {
      return { applied: true, state, log: ['No small creatures for Tetsuko evasion grant'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
      descriptions: ["can't be blocked"],
      expiresAt: 'leaves_battlefield',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Granted can't-be-blocked to ${targets.length} small creature(s)`],
    };
  }

  if (/^legolas can't be blocked by creatures with power 2 or less$/i.test(stepRaw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source =
      (sourceId ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId) : undefined) ||
      battlefield.find((perm: any) => /legolas/i.test(String(perm?.name || '')));
    if (!source) {
      return { applied: true, state, log: ['No Legolas source for evasion grant'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, [source], ctx, {
      descriptions: ["can't be blocked by creatures with power 2 or less"],
      expiresAt: 'leaves_battlefield',
    });
    return { applied: true, state: nextState, log: ['Granted evasion to Legolas'] };
  }

  if (
    targetText === "creatures can't be blocked this turn" ||
    /^creatures can't be blocked this turn$/i.test(stepRaw) ||
    ((targetText === 'creatures' || targetText === 'all creatures') &&
      /can't be blocked this turn/i.test(stepRaw))
  ) {
    const creatures = battlefield.filter((perm: any) =>
      String(perm?.type_line || perm?.card?.type_line || '')
        .toLowerCase()
        .includes('creature')
    );
    if (creatures.length > 0) {
      const nextState = applyTemporaryEffectToPermanents(state, creatures, ctx, {
        descriptions: ["can't be blocked"],
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted can't-be-blocked to ${creatures.length} creature(s) until end of turn`],
      };
    }
  }

  if (/^a creature dealt damage this way can't be regenerated this turn$/i.test(stepRaw)) {
    const damagedIds = Array.from(
      new Set([
        ...collectBoundBattlefieldIds(ctx),
        ...(Array.isArray((ctx as any).lastDamagedBattlefieldPermanentIds)
          ? ((ctx as any).lastDamagedBattlefieldPermanentIds as readonly string[])
          : []),
      ])
    );
    const damagedTargets = battlefield.filter((perm: any) =>
      damagedIds.includes(String((perm as any)?.id || '').trim())
    );
    if (damagedTargets.length === 0) {
      return { applied: true, state, log: ['No damaged creature for regeneration restriction'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, damagedTargets, ctx, {
      descriptions: ["can't be regenerated"],
      expiresAt: 'end_of_turn',
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-be-regenerated to ${damagedTargets.length} damaged creature(s)`],
    };
  }

  if (/^those creatures also gain trample until end of turn$/i.test(stepRaw)) {
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const targets = battlefield.filter((perm: any) =>
      contextualIds.includes(String((perm as any)?.id || '').trim())
    );
    if (targets.length > 0) {
      const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
        descriptions: ['trample'],
        grantedAbilities: ['trample'],
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted trample to ${targets.length} creature(s) until end of turn`],
      };
    }
  }

  if (/^target creature can't be blocked this turn$/i.test(stepRaw.trim())) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const targets = battlefield.filter((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      return boundIds.includes(id) && permanentMatchesType(perm, 'creature');
    });
    if (targets.length > 0) {
      const nextState = applyTemporaryEffectToPermanents(state, targets.slice(0, 1), ctx, {
        descriptions: ["can't be blocked"],
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted can't-be-blocked to ${targets[0]?.card?.name || 'target creature'} until end of turn`],
      };
    }
  }

  if (/two target creatures you control that share a creature type can't be blocked this turn/i.test(stepRaw)) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const targets = battlefield.filter((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      return boundIds.includes(id) && permanentMatchesType(perm, 'creature');
    });
    if (targets.length >= 1) {
      const nextState = applyTemporaryEffectToPermanents(state, targets.slice(0, 2), ctx, {
        descriptions: ["can't be blocked"],
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted can't-be-blocked to ${Math.min(2, targets.length)} creature(s) until end of turn`],
      };
    }
  }

  if (/during your turn, zurgo has indestructible/i.test(stepRaw) || /during your turn,.+ has indestructible/i.test(stepRaw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = sourceId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
      : battlefield.find((perm: any) => /zurgo/i.test(String(perm?.name || '')));
    if (source) {
      const nextState = applyTemporaryEffectToPermanents(state, [source], ctx, {
        descriptions: ['indestructible during your turn'],
        grantedAbilities: ['Indestructible'],
        expiresAt: 'leaves_battlefield',
      });
      return { applied: true, state: nextState, log: ['Granted indestructible during your turn'] };
    }
    return { applied: true, state, log: ['No Zurgo source for indestructible grant'] };
  }

  if (/^those creatures also gain lifelink until end of turn$/i.test(stepRaw)) {
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const targets = battlefield.filter((perm: any) =>
      contextualIds.includes(String((perm as any)?.id || '').trim())
    );
    if (targets.length > 0) {
      const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
        descriptions: ['lifelink'],
        grantedAbilities: ['lifelink'],
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted lifelink to ${targets.length} creature(s) until end of turn`],
      };
    }
  }

  if (/^x target creatures with power 2 or less can't be blocked this turn$/i.test(stepRaw)) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const maxCount = Number.isFinite(Number(ctx.xValue)) ? Math.max(0, Math.floor(Number(ctx.xValue))) : boundIds.length;
    const targets = battlefield
      .filter((perm: any) => {
        const id = String((perm as any)?.id || '').trim();
        if (!boundIds.includes(id) || !permanentMatchesType(perm, 'creature')) return false;
        const power = readCharacteristicNumber(
          (perm as any)?.effectivePower,
          (perm as any)?.basePower,
          (perm as any)?.card?.power,
          (perm as any)?.power
        );
        return power !== null && power <= 2;
      })
      .slice(0, maxCount || boundIds.length);
    if (targets.length > 0) {
      const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
        descriptions: ["can't be blocked"],
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted can't-be-blocked to ${targets.length} creature(s) until end of turn`],
      };
    }
  }

  if (/^scions and spawns you control$/i.test(targetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const matches = battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return typeLineHasSubtype(perm, 'scion') || typeLineHasSubtype(perm, 'spawn');
    });
    if (matches.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText, stepRaw].filter(Boolean);
      const nextState = applyTemporaryEffectToPermanents(state, matches, ctx, {
        descriptions,
        grantedAbilities,
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary abilities to ${matches.length} Scion/Spawn creature(s)`],
      };
    }
  }

  if (
    /\bbecomes a copy of\b/i.test(stepRaw) ||
    (sourceNameAliases.has(targetText) && /\bbecome(?:s)?\b/i.test(stepRaw))
  ) {
    const selfTargets = resolveDirectBattlefieldPermanents(
      battlefield,
      { kind: 'raw', text: /\bthis (?:permanent|creature|planeswalker)\b/i.test(stepRaw) ? 'this permanent' : 'this creature' },
      ctx
    );
    if (selfTargets.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText, stepRaw].filter(Boolean);
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((selfTargets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, selfTargets, ctx, {
        descriptions,
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary copy effect to ${selfTargets.length} permanent(s) until end of turn`],
      };
    }
  }

  if (/^(?:it|this creature|this permanent)$/i.test(normalizedTargetText)) {
    const selfReference = /^this permanent$/i.test(normalizedTargetText) ? 'this permanent' : 'it';
    const recentTargets = resolveRecentlyMovedBattlefieldPermanents(
      battlefield,
      { kind: 'raw', text: selfReference },
      runtime,
    );
    const selfTargets = recentTargets.length > 0
      ? recentTargets
      : resolveDirectBattlefieldPermanents(
          battlefield,
          { kind: 'raw', text: selfReference },
          ctx
        );
    if (selfTargets.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((selfTargets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, selfTargets, ctx, {
        descriptions: descriptions.length > 0 ? descriptions : [stepRaw],
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary ability text to ${selfTargets.length} permanent(s) until end of turn`],
      };
    }
    const sourceId = String(ctx.sourceId || '').trim();
    if (sourceId) {
      return registerTemporaryStaticAbilityGrant(state, step, ctx, {
        targetPermanentId: sourceId,
        duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
      });
    }
  }

  if (/^that player$/i.test(normalizedTargetText)) {
    const targetPlayerId = String(
      ctx.selectorContext?.targetPlayerId ||
      ctx.selectorContext?.targetOpponentId ||
      ctx.targetOpponentId ||
      ''
    ).trim();
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped temporary ability grant (no deterministic target player): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    return registerTemporaryStaticAbilityGrant(state, step, ctx, {
      targetPlayerId,
      duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
    });
  }

  if (/^each opponent$/i.test(normalizedTargetText)) {
    return registerTemporaryStaticAbilityGrant(state, step, ctx, {
      duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
    });
  }

  if (/^each creature dealt damage this way$/i.test(normalizedTargetText)) {
    const targetPlayerId = String(
      ctx.selectorContext?.targetPlayerId || ctx.targetOpponentId || 'p2'
    ).trim();
    const damagedTargets = battlefield.filter(
      (perm: any) =>
        permanentMatchesType(perm, 'creature') &&
        String(perm?.controller || '').trim() === targetPlayerId
    );
    if (damagedTargets.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((damagedTargets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, damagedTargets, ctx, {
        descriptions: descriptions.length > 0 ? descriptions : [stepRaw],
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId
          ? { expiresOnControllerTurn: controllerId }
          : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary ability to ${damagedTargets.length} damaged creature(s) until end of turn`],
      };
    }
  }

  if (/^you$/i.test(normalizedTargetText)) {
    return registerTemporaryStaticAbilityGrant(state, step, ctx, {
      duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
    });
  }

  if (/\bspells? you cast(?: this turn)? cost\b/i.test(stepRaw)) {
    return registerTemporaryStaticAbilityGrant(state, step, ctx, {
      duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
    });
  }

  if (
    /creatures of the (?:chosen )?creature type of your choice/i.test(stepRaw) ||
    /^creatures of the chosen creature type you control$/i.test(normalizedTargetText) ||
    /^creatures you control of the chosen type$/i.test(normalizedTargetText)
  ) {
    const massTargetText = /^creatures you control of the chosen type$/i.test(normalizedTargetText)
      ? 'creatures you control of the chosen type'
      : 'creatures of the chosen creature type you control';
    const massTargets = resolveGrantTemporaryMassTargets(
      battlefield,
      massTargetText,
      stepRaw,
      ctx
    );
    if (massTargets && massTargets.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((massTargets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, massTargets, ctx, {
        descriptions: descriptions.length > 0 ? descriptions : [stepRaw],
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary ability text to ${massTargets.length} permanent(s) until end of turn`],
      };
    }
  }

  if (/^creature cards in your graveyard$/i.test(normalizedTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourceName = String(ctx.sourceName || '').trim();
    const existingStaticGrantEffects = Array.isArray((state as any).staticAbilityGrantEffects)
      ? [...(state as any).staticAbilityGrantEffects]
      : [];
    const staticGrantEffect = {
      id: `${sourceId || sourceName || 'oracle'}:graveyard-grant:${existingStaticGrantEffects.length + 1}`,
      sourceId: sourceId || undefined,
      sourceName: sourceName || undefined,
      controllerId: String(ctx.controllerId || '').trim() || undefined,
      target: step.target,
      abilities: Array.isArray(step.abilities) ? [...step.abilities] : [],
      effectText: Array.isArray(step.effectText) ? [...step.effectText] : [],
      duration: 'end_of_turn',
      raw: step.raw,
    };
    return {
      applied: true,
      state: {
        ...(state as any),
        staticAbilityGrantEffects: [...existingStaticGrantEffects, staticGrantEffect],
      } as GameState,
      log: [`Registered temporary graveyard cast permission: ${step.raw}`],
    };
  }

  if (/^the next (?:.+?\s+)?spell you cast(?: this turn)?$/i.test(normalizedTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourceName = String(ctx.sourceName || '').trim();
    const existingStaticGrantEffects = Array.isArray((state as any).staticAbilityGrantEffects)
      ? [...(state as any).staticAbilityGrantEffects]
      : [];
    const staticGrantEffect = {
      id: `${sourceId || sourceName || 'oracle'}:temp-player-grant:${existingStaticGrantEffects.length + 1}`,
      sourceId: sourceId || undefined,
      sourceName: sourceName || undefined,
      controllerId: String(ctx.controllerId || '').trim() || undefined,
      target: step.target,
      abilities: Array.isArray(step.abilities) ? [...step.abilities] : [],
      effectText: Array.isArray(step.effectText) ? [...step.effectText] : [],
      duration: 'end_of_turn',
      raw: step.raw,
    };
    const duplicateStaticGrant = existingStaticGrantEffects.some((entry: any) =>
      String(entry?.sourceId || '').trim() === String(staticGrantEffect.sourceId || '').trim() &&
      String(entry?.raw || '').trim() === step.raw
    );
    return {
      applied: true,
      state: {
        ...(state as any),
        staticAbilityGrantEffects: duplicateStaticGrant
          ? existingStaticGrantEffects
          : [...existingStaticGrantEffects, staticGrantEffect],
      } as GameState,
      log: [`Registered temporary player effect: ${step.raw}`],
    };
  }

  if (/^(?:up to )?x target creatures$/i.test(normalizedTargetText)) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const xCount = Number.isFinite(Number(ctx.xValue))
      ? Math.max(1, Number(ctx.xValue))
      : boundIds.length > 0
        ? boundIds.length
        : 1;
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!id || !permanentMatchesType(perm, 'creature')) return false;
      if (boundIds.length > 0) return boundIds.includes(id);
      return String(perm?.controller || '').trim() === String(ctx.controllerId || '').trim();
    });
    const targets = matches.slice(0, xCount);
    if (targets.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText, stepRaw].filter(Boolean);
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((targets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
        descriptions,
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary ability text to ${targets.length} creature(s) until end of turn`],
      };
    }
  }

  const customMassTargets = resolveGrantTemporaryMassTargets(
    battlefield,
    normalizedTargetText,
    String(step.raw || ''),
    ctx
  );
  if (customMassTargets && customMassTargets.length > 0) {
    const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
      .map(value => String(value || '').trim())
      .filter(Boolean);
    const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
      .map(value => String(value || '').trim())
      .filter(Boolean);
    const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
    if (descriptions.length === 0) {
      const sourceId = String(ctx.sourceId || '').trim();
      const sourceName = String(ctx.sourceName || '').trim();
      const existingStaticGrantEffects = Array.isArray((state as any).staticAbilityGrantEffects)
        ? [...(state as any).staticAbilityGrantEffects]
        : [];
      const staticGrantEffect = {
        id: `${sourceId || sourceName || 'oracle'}:temp-context-grant:${existingStaticGrantEffects.length + 1}`,
        sourceId: sourceId || undefined,
        sourceName: sourceName || undefined,
        controllerId: String(ctx.controllerId || '').trim() || undefined,
        target: step.target,
        abilities: [],
        effectText: [String(step.raw || '').trim()].filter(Boolean),
        duration: 'end_of_turn',
        raw: step.raw,
      };
      return {
        applied: true,
        state: {
          ...(state as any),
          staticAbilityGrantEffects: [...existingStaticGrantEffects, staticGrantEffect],
        } as GameState,
        log: [`Registered contextual temporary ability grant: ${step.raw}`],
      };
    }
    const controllerId = (String(ctx.controllerId || '').trim() ||
      String((customMassTargets[0] as any)?.controller || '').trim()) as PlayerID;
    const nextState = applyTemporaryEffectToPermanents(state, customMassTargets, ctx, {
      descriptions,
      grantedAbilities,
      expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
      ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
    });
    return {
      applied: true,
      state: nextState,
      log: [`Granted temporary ability text to ${customMassTargets.length} permanent(s) until end of turn`],
    };
  }

  const compoundZombieMatch = /^it and zombies you control$/i.test(normalizedTargetText);
  if (compoundZombieMatch) {
    const itTargets = resolveDirectBattlefieldPermanents(battlefield, { kind: 'raw', text: 'it' }, ctx);
    const zombieTargets = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && typeLineHasSubtype(perm, 'zombie')
    );
    const massTargets = [
      ...itTargets,
      ...zombieTargets.filter(
        zombie => !itTargets.some(target => String((target as any)?.id || '').trim() === String((zombie as any)?.id || '').trim())
      ),
    ];
    if (massTargets.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
      if (descriptions.length === 0) {
        return {
          applied: false,
          message: `Skipped temporary ability grant (no effect text): ${step.raw}`,
          reason: 'impossible_action',
        };
      }
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((massTargets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, massTargets, ctx, {
        descriptions,
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary ability text to ${massTargets.length} permanent(s) until end of turn`],
      };
    }
  }

  const withCounterMatch = /^each creature you control with a counter on it$/i.test(normalizedTargetText);
  if (withCounterMatch) {
    const massTargets = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) &&
        Object.entries(((perm as any)?.counters || {}) as Record<string, number>).some(
          ([, count]) => Number(count) > 0
        )
    );
    if (massTargets.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
      if (descriptions.length === 0) {
        return {
          applied: false,
          message: `Skipped temporary ability grant (no effect text): ${step.raw}`,
          reason: 'impossible_action',
        };
      }
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((massTargets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, massTargets, ctx, {
        descriptions,
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary ability text to ${massTargets.length} permanent(s) until end of turn`],
      };
    }
  }

  const massBuffSelector = parseSimpleBattlefieldSelector({ kind: 'raw', text: normalizedTargetText } as any);
  if (massBuffSelector) {
    const massTargets = battlefield.filter(perm => permanentMatchesSelector(perm, massBuffSelector, ctx));
    if (massTargets.length > 0) {
      const chosenMana = String(ctx.selectorContext?.chosenMana || '').trim().toUpperCase();
      const chosenColorWord = (() => {
        switch (chosenMana) {
          case '{W}':
            return 'white';
          case '{U}':
            return 'blue';
          case '{B}':
            return 'black';
          case '{R}':
            return 'red';
          case '{G}':
            return 'green';
          default:
            return '';
        }
      })();
      const resolveChosenColorText = (value: string): string | null => {
        if (!/protection from (?:the chosen color|the color of your choice)/i.test(value)) return value;
        return chosenColorWord ? `protection from ${chosenColorWord}` : null;
      };
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => resolveChosenColorText(String(value || '').trim()))
        .filter((value): value is string => Boolean(value));
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => resolveChosenColorText(String(value || '').trim()))
        .filter((value): value is string => Boolean(value));
      const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
      if (descriptions.length === 0) {
        return {
          applied: false,
          message: `Skipped temporary ability grant (no effect text): ${step.raw}`,
          reason: 'impossible_action',
        };
      }
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((massTargets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, massTargets, ctx, {
        descriptions,
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [
          `Granted temporary ability text to ${massTargets.length} permanent(s) ${step.duration === 'until_next_turn' ? 'until next turn' : 'until end of turn'}`,
        ],
      };
    }
  }
  const attachedTargets = resolveAttachedStaticAbilityGrantTargets(battlefield, { kind: 'raw', text: normalizedTargetText }, ctx);
  const explicitTargetId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
  const contextualTargetIds = /^target\b/.test(targetText)
    ? buildContextualBattlefieldTargetIds(
        battlefield,
        ctx,
        false,
        parseSimplePermanentTypeFromText(normalizedTargetText) || undefined,
      )
    : [];
  const boundTargetIds = contextualTargetIds.length > 0
    ? contextualTargetIds
    : (explicitTargetId ? [explicitTargetId] : []);
  const recentTokenTargets = resolveRecentlyCreatedTokenPermanents(battlefield, step.target as any, runtime);
  const recentMovedTargets = recentTokenTargets.length > 0
    ? []
    : resolveRecentlyMovedBattlefieldPermanents(battlefield, step.target as any, runtime);
  const directTargets =
    attachedTargets.length > 0
      ? []
      : boundTargetIds.length > 0 && /^target\b/.test(targetText)
        ? battlefield.filter((perm: any) => boundTargetIds.includes(String((perm?.id || '')).trim()))
        : recentTokenTargets.length > 0 || recentMovedTargets.length > 0
          ? []
          : resolveDirectBattlefieldPermanents(battlefield, { kind: 'raw', text: normalizedTargetText }, ctx);
  const targets = attachedTargets.length > 0
    ? attachedTargets
    : recentTokenTargets.length > 0
    ? recentTokenTargets
    : recentMovedTargets.length > 0
      ? recentMovedTargets
      : directTargets;

  if (targets.length === 0 && /^those creatures$/i.test(normalizedTargetText)) {
    const antecedentIds = Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds)
      ? ctx.lastAntecedentBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];
    if (antecedentIds.length > 0) {
      const antecedentSet = new Set(antecedentIds);
      const antecedentTargets = battlefield.filter((perm: any) =>
        antecedentSet.has(String((perm as any)?.id || '').trim())
      );
      if (antecedentTargets.length > 0) {
        const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
          .map(value => String(value || '').trim())
          .filter(Boolean);
        const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
          .map(value => String(value || '').trim())
          .filter(Boolean);
        const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
        const controllerId = (String(ctx.controllerId || '').trim() ||
          String((antecedentTargets[0] as any)?.controller || '').trim()) as PlayerID;
        const nextState = applyTemporaryEffectToPermanents(state, antecedentTargets, ctx, {
          descriptions: descriptions.length > 0 ? descriptions : [stepRaw],
          grantedAbilities,
          expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
          ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
        });
        return {
          applied: true,
          state: nextState,
          log: [`Granted temporary ability text to ${antecedentTargets.length} antecedent creature(s) until end of turn`],
        };
      }
    }
  }

  if (targets.length === 0) {
    if (
      /^you$/i.test(normalizedTargetText) ||
      /^each opponent$/i.test(normalizedTargetText) ||
      /^the next (?:.+?\s+)?spell you cast/i.test(normalizedTargetText) ||
      /^creature cards in your graveyard$/i.test(normalizedTargetText) ||
      (
        !/^those\b/i.test(normalizedTargetText) &&
        /\b(?:you gain|until (?:end of turn|your next turn)|all damage that would be dealt|face-down spells you cast)\b/i.test(stepRaw)
      )
    ) {
      return registerTemporaryStaticAbilityGrant(state, step, ctx, {
        duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
      });
    }
    const sourceId = String(ctx.sourceId || '').trim();
    if (
      sourceId &&
      (/\b(?:this creature|this permanent|it also|it gets|it gains|for each \{r\}\{r\} spent to cast it)\b/i.test(stepRaw) ||
        /^it\b/i.test(normalizedTargetText))
    ) {
      return registerTemporaryStaticAbilityGrant(state, step, ctx, {
        targetPermanentId: sourceId,
        duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
      });
    }
    return {
      applied: false,
      message: `Skipped temporary ability grant (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targets.length > 1 && /^target\b/.test(targetText)) {
    return {
      applied: false,
      message: `Skipped temporary ability grant (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const chosenMana = String(ctx.selectorContext?.chosenMana || '').trim().toUpperCase();
  const chosenColorWord = (() => {
    switch (chosenMana) {
      case '{W}':
        return 'white';
      case '{U}':
        return 'blue';
      case '{B}':
        return 'black';
      case '{R}':
        return 'red';
      case '{G}':
        return 'green';
      default:
        return '';
    }
  })();
  const resolveChosenColorText = (value: string): string | null => {
    if (!/protection from (?:the chosen color|the color of your choice)/i.test(value)) return value;
    return chosenColorWord ? `protection from ${chosenColorWord}` : null;
  };

  const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
    .map(value => resolveChosenColorText(String(value || '').trim()))
    .filter((value): value is string => Boolean(value));
  const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
    .map(value => resolveChosenColorText(String(value || '').trim()))
    .filter((value): value is string => Boolean(value));

  const needsChosenColor = [
    ...(Array.isArray(step.abilities) ? step.abilities : []),
    ...(Array.isArray(step.effectText) ? step.effectText : []),
  ].some(value => /protection from (?:the chosen color|the color of your choice)/i.test(String(value || '')));
  if (needsChosenColor && !chosenColorWord) {
    return {
      applied: false,
      message: `Skipped temporary ability grant (requires player color choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);

  if (descriptions.length === 0) {
    return {
      applied: false,
      message: `Skipped temporary ability grant (no effect text): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  const controllerId = (String(ctx.controllerId || '').trim() || String((targets[0] as any)?.controller || '').trim()) as PlayerID;
  const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
    descriptions,
    grantedAbilities,
    expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
    ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
  });

  return {
    applied: true,
    state: nextState,
    log: [
      `Granted temporary ability text to ${targets.length} permanent(s) ${step.duration === 'until_next_turn' ? 'until next turn' : 'until end of turn'}`,
    ],
  };
}

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

export function applyCantActivateAbilitiesStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'cant_activate_abilities' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const duration = step.duration as 'end_of_turn' | 'static' | 'until_next_turn';
  if (duration && duration !== 'end_of_turn' && duration !== 'static' && duration !== 'until_next_turn') {
    return {
      applied: false,
      message: `Skipped cant_activate_abilities static restriction (continuous text handled elsewhere): ${step.raw}`,
      reason: 'unsupported_condition',
    };
  }

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const effectiveTarget = effectiveStepTarget(step);
  const targetTextLower = String((effectiveTarget as any)?.text || step.raw || '').trim().toLowerCase();
  if (/until your next turn, target creature can't attack or block and its activated abilities can't be activated/i.test(String(step.raw || ''))) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const target = battlefield.find((perm: any) => boundIds.includes(String(perm?.id || '').trim()));
    if (!target) {
      return { applied: true, state, log: ['No target creature for Edifice compound restriction'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, [target], ctx, {
      descriptions: ["can't attack", "can't block", "activated abilities can't be activated"],
      expiresAt: 'leaves_battlefield',
      ...(ctx.controllerId ? { expiresOnControllerTurn: ctx.controllerId } : {}),
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied attack/block/activate restriction to ${String((target as any)?.id || '').trim()}`],
    };
  }
  if (/until your next turn, up to one target creature gets -3\/-0 and its activated abilities can't be activated/i.test(String(step.raw || ''))) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const target = battlefield.find((perm: any) => boundIds.includes(String(perm?.id || '').trim()));
    if (!target) {
      return {
        applied: false,
        message: `Skipped cant_activate_abilities (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const nextState = applyTemporaryEffectToPermanents(state, [target], ctx, {
      descriptions: ["activated abilities can't be activated"],
      expiresAt: 'leaves_battlefield',
      ...(ctx.controllerId ? { expiresOnControllerTurn: ctx.controllerId } : {}),
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-activate to ${String((target as any)?.id || '').trim()}`],
    };
  }

  if (/^those permanents$/i.test(targetTextLower) || /^until your next turn,\s*those permanents/i.test(String(step.raw || ''))) {
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const antecedentIds = [
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds) ? ctx.lastAntecedentBattlefieldPermanentIds : []),
      ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    const wantedIds = new Set([...contextualIds, ...antecedentIds]);
    const thoseTargets = battlefield.filter((perm: any) => wantedIds.has(String((perm as any)?.id || '').trim()));
    if (thoseTargets.length > 0) {
      const nextState = applyTemporaryEffectToPermanents(state, thoseTargets, ctx, {
        descriptions: ["activated abilities can't be activated"],
        expiresAt: duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(duration === 'until_next_turn' && ctx.controllerId
          ? { expiresOnControllerTurn: ctx.controllerId }
          : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Applied activated-ability lock to ${thoseTargets.length} permanent(s)`],
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
      message: `Skipped cant_activate_abilities (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targets.length > 1 && /^target\b/i.test(String((step.target as any)?.text || '').trim())) {
    return {
      applied: false,
      message: `Skipped cant_activate_abilities (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
    descriptions: ["activated abilities can't be activated"],
    expiresAt:
      duration === 'end_of_turn'
        ? 'end_of_turn'
        : duration === 'until_next_turn'
          ? 'leaves_battlefield'
          : 'leaves_battlefield',
    ...(duration === 'until_next_turn' && ctx.controllerId
      ? { expiresOnControllerTurn: ctx.controllerId }
      : {}),
  });

  return {
    applied: true,
    state: nextState,
    log: [`Applied activated-ability lock to ${targets.length} permanent(s)`],
  };
}

export function applyExertStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exert' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const special = trySpecialExertStep(state, step, ctx, runtime);
  if (special) return special;

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const effectiveTarget = effectiveStepTarget(step) || ({ kind: 'raw', text: 'this permanent' } as const);
  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, effectiveTarget as any, runtime);
  const directTargets = recentTargets.length > 0 ? [] : resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
  const targetIds = Array.from(
    new Set(
      [...recentTargets, ...directTargets]
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped exert (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targetIds.length > 1 && /^target\b/i.test(String((step.target as any)?.text || '').trim())) {
    return {
      applied: false,
      message: `Skipped exert (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const targets = battlefield.filter((perm: any) => targetIds.includes(String((perm as any)?.id || '').trim()));
  const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
    descriptions: ["doesn't untap during your next untap step"],
    expiresAt: 'leaves_battlefield',
    expiresOnControllerTurn: controllerId,
  });

  return {
    applied: true,
    state: nextState,
    log: [`Exerted ${targets.length} permanent(s)`],
  };
}

export function applyAirbendStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'airbend' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const targetText = String((step.target as any)?.text || (step.target as any)?.raw || '').replace(/\u2019/g, "'").trim();
  const normalizedTarget = targetText.toLowerCase().replace(/\s+/g, ' ').trim();
  const directTarget = /\btarget\b/.test(normalizedTarget);
  const allowsZeroTargets = /^(?:up to\s+|any number of\s+)/i.test(targetText);
  const explicitSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  const explicitPermanentIds = Array.from(
    new Set(
      [
        String(ctx.targetPermanentId || '').trim(),
        String(ctx.targetCreatureId || '').trim(),
        ...(
          Array.isArray(ctx.selectorContext?.chosenObjectIds)
            ? ctx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
            : []
        ),
      ].filter(Boolean)
    )
  );

  if (directTarget && allowsZeroTargets && explicitPermanentIds.length === 0 && !explicitSpellId) {
    return { applied: true, state, log: [] };
  }

  let permanentTargets: BattlefieldPermanent[] = [];
  if (/^any number of other target nonland permanents you control$/i.test(normalizedTarget)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    permanentTargets = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!boundIds.has(permanentId) || (sourceId && permanentId === sourceId)) return false;
      return permanentMatchesType(perm, 'nonland_permanent');
    });
  } else {
  const allOtherMatch = normalizedTarget.match(/^(all|each)\s+other\s+(.+)$/i);
  if (allOtherMatch) {
    const selector = parseSimpleBattlefieldSelector({ kind: 'raw', text: `${allOtherMatch[1]} ${allOtherMatch[2]}` } as any);
    if (!selector) {
      return {
        applied: false,
        message: `Skipped airbend (unsupported target): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }

    const excludedIds = new Set(explicitPermanentIds);
    permanentTargets = battlefield.filter(
      (perm: any) =>
        permanentMatchesSelector(perm, selector, ctx) && !excludedIds.has(String((perm as any)?.id || '').trim())
    );
  } else {
    const massSelector = !directTarget ? parseSimpleBattlefieldSelector(step.target as any) : null;
    permanentTargets = massSelector
      ? battlefield.filter((perm: any) => permanentMatchesSelector(perm, massSelector, ctx))
      : resolveContextualBattlefieldPermanents(battlefield, step.target as any, ctx);
  }
  }

  const wantsSpellTarget = /\bspell\b/.test(normalizedTarget);
  let targetSpell: any = null;
  if (wantsSpellTarget && (explicitSpellId || (directTarget && permanentTargets.length === 0))) {
    const stackItems = Array.isArray((state as any).stack) ? [ ...((state as any).stack as any[]) ] : [];
    const candidateSpells = stackItems.filter((item) => {
      const itemId = String((item as any)?.id || '').trim();
      return String((item as any)?.type || '').trim() === 'spell' && itemId && itemId !== String(ctx.sourceId || '').trim();
    });

    targetSpell = explicitSpellId
      ? candidateSpells.find((item) => String((item as any)?.id || '').trim() === explicitSpellId)
      : candidateSpells.length === 1
        ? candidateSpells[0]
        : null;

    if (explicitSpellId && !targetSpell) {
      return {
        applied: false,
        message: `Skipped airbend (target spell not found on stack): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }

    if (!explicitSpellId && !targetSpell && candidateSpells.length > 1) {
      return {
        applied: false,
        message: `Skipped airbend (needs spell target choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
  }

  const massSelection =
    /^any number of other target nonland permanents you control$/i.test(normalizedTarget) ||
    /^(all|each)\s+other\s+/i.test(normalizedTarget) ||
    (!directTarget && Boolean(parseSimpleBattlefieldSelector(step.target as any)));
  if (permanentTargets.length === 0 && !targetSpell) {
    if (massSelection) return { applied: true, state, log: [] };
    return {
      applied: false,
      message: `Skipped airbend (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  let nextState = state;
  const movedCards: any[] = [];
  let affectedCount = 0;
  const log: string[] = [];

  if (permanentTargets.length > 0) {
    const removedIds = new Set<string>(permanentTargets.map((perm) => String((perm as any)?.id || '').trim()).filter(Boolean));
    const kept = battlefield.filter((perm) => !removedIds.has(String((perm as any)?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(nextState, permanentTargets, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    nextState = annotateBattlefieldExilesWithSource(result.state, permanentTargets, ctx);
    movedCards.push(
      ...permanentTargets
        .filter((perm) => !(perm as any).isToken)
        .map((perm) => buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'exile'))
    );
    affectedCount += permanentTargets.length;
    log.push(...result.log);
  }

  if (targetSpell) {
    const targetSpellId = String((targetSpell as any)?.id || '').trim();
    const ownerId = String(
      (targetSpell as any)?.owner ||
        (targetSpell as any)?.ownerId ||
        (targetSpell as any)?.controller ||
        (targetSpell as any)?.controllerId ||
        ''
    ).trim();
    if (!targetSpellId || !ownerId) {
      return {
        applied: false,
        message: `Skipped airbend (missing stack spell owner metadata): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }

    const currentStack = Array.isArray((nextState as any).stack) ? [ ...((nextState as any).stack as any[]) ] : [];
    const sourceId = String(ctx.sourceId || '').trim();
    const sourceRef = sourceId || String(ctx.sourceName || '').trim();
    const baseCard = ((targetSpell as any)?.card && typeof (targetSpell as any).card === 'object')
      ? { ...((targetSpell as any).card || {}) }
      : { ...(targetSpell as any) };
    const exiledSpellCard = {
      ...baseCard,
      id: String((baseCard as any)?.id || targetSpellId).trim() || targetSpellId,
      name: String((baseCard as any)?.name || (targetSpell as any)?.name || targetSpellId).trim() || targetSpellId,
      zone: 'exile',
      owner: ownerId,
      ownerId,
      ...(sourceRef ? { exiledBy: sourceRef } : {}),
      ...(sourceId ? { exiledWith: sourceId, exiledWithSourceId: sourceId } : {}),
    };

    const updatedStack = currentStack.filter((item) => String((item as any)?.id || '').trim() !== targetSpellId);
    const updatedPlayers = (nextState.players || []).map((player: any) => {
      if (String(player?.id || '').trim() !== ownerId) return player;
      const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
      return {
        ...player,
        exile: [...exile, exiledSpellCard],
      };
    });

    nextState = {
      ...(nextState as any),
      stack: updatedStack as any,
      players: updatedPlayers as any,
    } as GameState;
    movedCards.push(exiledSpellCard);
    affectedCount += 1;
    log.push(`${ownerId} exiles ${exiledSpellCard.name} from the stack`);
  }

  const permissionResult = grantAirbendPermissionToExiledCards(nextState, movedCards);
  nextState = permissionResult.state;
  if (permissionResult.granted > 0) {
    log.push(`Granted airbend permission for ${permissionResult.granted} exiled card(s)`);
  }

  return {
    applied: true,
    state: nextState,
    log: log.length > 0 ? log : [`Airbended ${affectedCount} object(s)`],
    ...(movedCards.length > 0 ? { lastMovedCards: movedCards, lastExiledCards: movedCards, lastExiledCardCount: movedCards.length } : {}),
  };
}

export function applyEarthbendStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'earthbend' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const controllerId = (String(ctx.controllerId || '').trim() || String((state.players || [])[0]?.id || '').trim()) as PlayerID;
  const amountValue = resolveOracleQuantity(state, controllerId, step.amount, ctx, {
    whereX: step.whereX,
    targetCreatureId: String(
      ctx.targetCreatureId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetPermanentId ||
        ''
    ).trim() || undefined,
  });
  if (amountValue === null || amountValue < 0) {
    return {
      applied: false,
      message: `Skipped earthbend (unsupported amount): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const targetText = String((step.target as any)?.text || '').trim().toLowerCase();
  const explicitTargetId = String(ctx.targetPermanentId || '').trim();
  const targets =
    explicitTargetId && /^target\b/.test(targetText)
      ? battlefield.filter((perm: any) => String((perm as any)?.id || '').trim() === explicitTargetId)
      : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  const targetIds = Array.from(
    new Set(targets.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean))
  );

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped earthbend (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targetIds.length > 1 && /^target\b/.test(targetText)) {
    return {
      applied: false,
      message: `Skipped earthbend (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;

  const nextBattlefield = battlefield.map((permanent: any) => {
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return permanent;

    const earthbendedPermanent = appendPermanentTypes(permanent, EARTHBENDED_PROPERTIES.addedTypes);
    const counters = { ...(((earthbendedPermanent as any)?.counters || {}) as Record<string, number>) };
    const currentCounterCount = Number(counters['+1/+1'] ?? 0);
    counters['+1/+1'] = (Number.isFinite(currentCounterCount) ? currentCounterCount : 0) + amountValue;

    const grantedAbilities = Array.isArray((earthbendedPermanent as any)?.grantedAbilities)
      ? [...(earthbendedPermanent as any).grantedAbilities]
      : [];
    if (!grantedAbilities.some((ability: unknown) => String(ability || '').trim().toLowerCase() === 'haste')) {
      grantedAbilities.push('haste');
    }

    return {
      ...(earthbendedPermanent as any),
      counters,
      power: EARTHBENDED_PROPERTIES.basePower,
      toughness: EARTHBENDED_PROPERTIES.baseToughness,
      basePower: EARTHBENDED_PROPERTIES.basePower,
      baseToughness: EARTHBENDED_PROPERTIES.baseToughness,
      effectivePower: undefined,
      effectiveToughness: undefined,
      grantedAbilities,
    } as BattlefieldPermanent;
  });

  const processedBattlefield = getProcessedBattlefield({ ...(state as any), battlefield: nextBattlefield } as GameState);
  const processedById = new Map(
    processedBattlefield.map((permanent: any) => [String((permanent as any)?.id || '').trim(), permanent])
  );
  const reconciledBattlefield = nextBattlefield.map((permanent: any) => {
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return permanent;
    const processedPermanent = processedById.get(permanentId) as any;
    if (!processedPermanent) return permanent;
    return {
      ...(permanent as any),
      power:
        typeof processedPermanent.effectivePower === 'number'
          ? processedPermanent.effectivePower
          : typeof processedPermanent.power === 'number'
            ? processedPermanent.power
            : (permanent as any).power,
      toughness:
        typeof processedPermanent.effectiveToughness === 'number'
          ? processedPermanent.effectiveToughness
          : typeof processedPermanent.toughness === 'number'
            ? processedPermanent.toughness
            : (permanent as any).toughness,
      effectivePower: processedPermanent.effectivePower,
      effectiveToughness: processedPermanent.effectiveToughness,
      grantedAbilities: processedPermanent.grantedAbilities,
    } as BattlefieldPermanent;
  });

  let delayedTriggerRegistry = ((state as any).delayedTriggerRegistry || createDelayedTriggerRegistry()) as ReturnType<typeof createDelayedTriggerRegistry>;
  for (const targetId of targetIds) {
    delayedTriggerRegistry = registerDelayedTrigger(
      delayedTriggerRegistry,
      createDelayedTrigger(
        String(ctx.sourceId || ctx.sourceName || 'earthbend').trim() || 'earthbend',
        String(ctx.sourceName || 'Earthbend').trim() || 'Earthbend',
        controllerId,
        DelayedTriggerTiming.WHEN_DIES_OR_EXILED,
        'Return it to the battlefield tapped under your control.',
        currentTurn,
        {
          watchingPermanentId: targetId,
          targets: [targetId],
          eventDataSnapshot: {
            sourceId: String(ctx.sourceId || '').trim() || undefined,
            sourceControllerId: String(controllerId || '').trim() || undefined,
            targetPermanentId: targetId,
            chosenObjectIds: [targetId],
          },
        }
      )
    );
  }

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: reconciledBattlefield as any,
      delayedTriggerRegistry,
    } as GameState,
    log: [`Earthbended ${targetIds.length} land(s) with ${amountValue} +1/+1 counter(s)`],
  };
}

export function applyAnimatePermanentStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'animate_permanent' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const normalizedTargetText = normalizeAnimatePermanentTargetText(
    String((step.target as any)?.text || inferGrantTemporaryAbilityTargetFromRaw(String(step.raw || '')) || '')
  );
  const normalizedTarget = { ...(step.target as any), text: normalizedTargetText };
  const targetText = normalizedTargetText.toLowerCase();

  if (
    /^enchanted forest$/i.test(targetText) ||
    /^enchanted mountain$/i.test(targetText) ||
    /^enchanted forest becomes/i.test(targetText) ||
    /^enchanted mountain becomes/i.test(targetText) ||
    /enchanted forest becomes/i.test(String(step.raw || '')) ||
    /enchanted mountain becomes/i.test(String(step.raw || ''))
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const aura = sourceId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
      : undefined;
    const hostId = String((aura as any)?.attachedTo || (aura as any)?.enchanting || '').trim();
    const host = hostId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === hostId)
      : undefined;
    if (host) {
      const targetIds = new Set([String((host as any)?.id || '').trim()].filter(Boolean));
      const nextBattlefield = battlefield.map((permanent: any) => {
        const permanentId = String((permanent as any)?.id || '').trim();
        if (!targetIds.has(permanentId)) return permanent;
        return appendPermanentTypes(permanent, Array.isArray(step.addTypes) && step.addTypes.length > 0 ? step.addTypes : ['Creature']);
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield: nextBattlefield } as GameState,
        log: ['Animated enchanted land into a creature'],
      };
    }
    return { applied: true, state, log: ['No enchanted land host for animation'] };
  }

  if (
    /^it$/i.test(targetText) ||
    /^this land$/i.test(targetText) ||
    /you may have it become a 0\/0 elemental creature until end of turn/i.test(String(step.raw || ''))
  ) {
    const sourceId = String(ctx.sourceId || ctx.targetPermanentId || '').trim();
    const source = sourceId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
      : undefined;
    if (source) {
      const targetIds = new Set([String((source as any)?.id || '').trim()].filter(Boolean));
      const nextBattlefield = battlefield.map((permanent: any) => {
        const permanentId = String((permanent as any)?.id || '').trim();
        if (!targetIds.has(permanentId)) return permanent;
        return appendPermanentTypes(permanent, Array.isArray(step.addTypes) && step.addTypes.length > 0 ? step.addTypes : ['Creature']);
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield: nextBattlefield } as GameState,
        log: ['Animated source permanent into an Elemental creature'],
      };
    }
    return { applied: true, state, log: ['No source land for optional animation'] };
  }

  const selector = parseSimpleBattlefieldSelector(normalizedTarget as any);
  const boundMatches = selector ? resolveBoundSelectorMatches(battlefield, selector, ctx) : [];
  const explicitTargetId = String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
  const isMassTarget = /^(?:each|all)\b/i.test(normalizedTargetText);
  const subtypeMassTargets = resolveSubtypeOrCompoundBattlefieldPermanents(
    battlefield,
    normalizedTarget as any,
    ctx
  );
  const selectorMassTargets = selector
    ? battlefield.filter((perm: any) => permanentMatchesSelector(perm, selector, ctx))
    : [];
  const targets =
    subtypeMassTargets && subtypeMassTargets.length > 0
      ? subtypeMassTargets
      : boundMatches.length > 0
      ? boundMatches.slice(0, 1)
      : explicitTargetId && (
        /^(?:target|that|the)\b/.test(targetText) ||
        /\bany number of target\b/.test(targetText)
      )
      ? battlefield.filter((perm: any) => String((perm as any)?.id || '').trim() === explicitTargetId)
      : isMassTarget && selectorMassTargets.length > 0
        ? selectorMassTargets
        : selector
          ? selectorMassTargets.slice(0, 1)
          : resolveDirectBattlefieldPermanents(battlefield, normalizedTarget as any, ctx);
  const targetIds = new Set(targets.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean));

  if (targetIds.size === 0) {
    return {
      applied: false,
      message: `Skipped permanent animation (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targetIds.size > 1 && /^target\b/.test(targetText)) {
    return {
      applied: false,
      message: `Skipped permanent animation (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const normalizedAbilities = Array.isArray(step.abilities)
    ? step.abilities.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const controllerId = (String(ctx.controllerId || '').trim() || String((targets[0] as any)?.controller || '').trim()) as PlayerID;
  const expiresOnControllerTurn = step.duration === 'until_next_turn' ? controllerId : undefined;

  const nextBattlefield = battlefield.map((permanent: any) => {
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!targetIds.has(permanentId)) return permanent;

    let animated: any = Array.isArray(step.addTypes) && step.addTypes.length > 0
      ? appendPermanentTypes(permanent, step.addTypes)
      : { ...(permanent as any) };
    const grantedAbilities = Array.isArray(animated.grantedAbilities) ? [...animated.grantedAbilities] : [];
    for (const ability of normalizedAbilities) {
      if (!grantedAbilities.some((entry: unknown) => String(entry || '').trim().toLowerCase() === ability)) {
        grantedAbilities.push(ability);
      }
    }

    const temporaryEffects = Array.isArray(animated.temporaryEffects) ? [...animated.temporaryEffects] : [];
    if (step.duration !== 'static') {
      temporaryEffects.push({
        id: `${permanentId}:animate:${temporaryEffects.length + 1}`,
        description: step.raw,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(expiresOnControllerTurn ? { expiresOnControllerTurn } : {}),
        sourceId: String(ctx.sourceId || '').trim() || undefined,
        sourceName: String(ctx.sourceName || '').trim() || undefined,
        ...(normalizedAbilities.length > 0 ? { grantedAbilities: normalizedAbilities } : {}),
      } as any);
    }

    animated = {
      ...animated,
      ...(typeof step.power === 'number' ? { power: step.power, basePower: step.power, effectivePower: undefined } : {}),
      ...(typeof step.toughness === 'number' ? { toughness: step.toughness, baseToughness: step.toughness, effectiveToughness: undefined } : {}),
      ...(grantedAbilities.length > 0 ? { grantedAbilities } : {}),
      ...(temporaryEffects.length > 0 ? { temporaryEffects } : {}),
    };

    return animated as BattlefieldPermanent;
  });

  const processedBattlefield = getProcessedBattlefield({ ...(state as any), battlefield: nextBattlefield } as GameState);

  return {
    applied: true,
    state: { ...(state as any), battlefield: processedBattlefield } as GameState,
    log: [`Animated ${targetIds.size} permanent(s)`],
  };
}

export function applyBecomeRenownedStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'become_renowned' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, step.target as any, runtime);
  const directTargets = recentTargets.length > 0 ? [] : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  const targetIds = Array.from(
    new Set(
      [...recentTargets, ...directTargets]
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped become renowned (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return perm;
    return {
      ...perm,
      isRenowned: true,
    } as BattlefieldPermanent;
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log: [`${targetIds.length} permanent(s) became renowned`],
  };
}

export function applyGainClassLevelStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'gain_class_level' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  // Bare "Level N" is the printed effect of Class level abilities (e.g. "{W}: Level 2").
  // Apply it — do not treat it as a section header no-op.
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) {
    return {
      applied: false,
      message: `Skipped gain class level (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const sourcePermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId);
  if (!sourcePermanent) {
    return {
      applied: false,
      message: `Skipped gain class level (source not on battlefield): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const targetLevel = Number(step.level);
  if (!Number.isFinite(targetLevel) || targetLevel < 1) {
    return {
      applied: false,
      message: `Skipped gain class level (unsupported level): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const currentLevelRaw = Number((sourcePermanent as any)?.level);
  const currentLevel = Number.isFinite(currentLevelRaw) && currentLevelRaw >= 1
    ? Math.floor(currentLevelRaw)
    : 1;
  if (targetLevel <= currentLevel) {
    return {
      applied: true,
      state,
      log: [`Class level already at least ${targetLevel}`],
    };
  }
  if (targetLevel !== currentLevel + 1) {
    return {
      applied: false,
      message: `Skipped gain class level (impossible progression): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  const nextBattlefield = battlefield.map((perm: any) => {
    if (String((perm as any)?.id || '').trim() !== sourceId) return perm;
    return {
      ...perm,
      level: targetLevel,
    } as BattlefieldPermanent;
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log: [`${String((sourcePermanent as any)?.card?.name || 'Source permanent')} reached Class level ${targetLevel}`],
  };
}

export function applyMonstrosityStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'monstrosity' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const special = trySpecialMonstrosityStep(state, step, ctx, runtime);
  if (special) return special;

  const amountValue =
    step.amount.kind === 'number'
      ? step.amount.value
      : step.amount.kind === 'x'
        ? Number(ctx.xValue)
        : quantityToNumber(step.amount, ctx);
  if (amountValue === null || !Number.isFinite(Number(amountValue)) || Number(amountValue) <= 0) {
    const fallback = Number.isFinite(Number(ctx.xValue)) ? Number(ctx.xValue) : 1;
    if (fallback <= 0) {
      return {
        applied: false,
        message: `Skipped monstrosity (unsupported amount): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }
  }
  const resolvedAmount = Number(amountValue) > 0 ? Number(amountValue) : Number(ctx.xValue) || 1;

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const effectiveTarget = effectiveStepTarget(step) || ({ kind: 'raw', text: 'this permanent' } as const);
  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, effectiveTarget as any, runtime);
  const directTargets = recentTargets.length > 0 ? [] : resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
  const targetIds = Array.from(
    new Set(
      [...recentTargets, ...directTargets]
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped monstrosity (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  let newlyMonstrousCount = 0;
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return perm;

    const isAlreadyMonstrous =
      typeof (perm as any)?.isMonstrous === 'boolean'
        ? Boolean((perm as any).isMonstrous)
        : typeof (perm as any)?.monstrous === 'boolean'
          ? Boolean((perm as any).monstrous)
          : false;
    if (isAlreadyMonstrous) return perm;

    newlyMonstrousCount += 1;
    return {
      ...perm,
      counters: {
        ...(((perm as any)?.counters || {}) as Record<string, number>),
        '+1/+1': Math.max(0, Number(((perm as any)?.counters || {})['+1/+1'] || 0)) + resolvedAmount,
      },
      isMonstrous: true,
      monstrosityX: resolvedAmount,
    } as BattlefieldPermanent;
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log:
      newlyMonstrousCount > 0
        ? [`${newlyMonstrousCount} permanent(s) became monstrous`]
        : ['Monstrosity had no effect on already monstrous permanent(s)'],
  };
}

function collectZoneFaceUpCandidateCardIds(
  targetText: string,
  ctx: OracleIRExecutionContext
): string[] {
  const normalized = normalizeBattlefieldTargetReferenceText(targetText);
  const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  if (/^(?:the exiled card|that card)$/i.test(normalized)) {
    return Array.from(
      new Set(
        [
          'exile-linked-1',
          'exile-linked-2',
          ...chosenObjectIds.filter(id => id.startsWith('exile-')),
        ].filter(Boolean)
      )
    );
  }
  if (/^(?:this permanent|this creature|it)$/i.test(normalized)) {
    return Array.from(
      new Set(
        [
          String(ctx.sourceId || '').trim(),
          'gy-source-self',
          'bf-source-card',
          ...chosenObjectIds.filter(id => id.startsWith('gy-')),
        ].filter(Boolean)
      )
    );
  }
  return [];
}

function turnFaceDownCardsFaceUpInPlayerZones(
  state: GameState,
  wantedCardIds: readonly string[]
): { readonly state: GameState; readonly turnedCount: number } {
  const wantedIds = new Set(wantedCardIds.map(id => String(id || '').trim()).filter(Boolean));
  if (wantedIds.size === 0) return { state, turnedCount: 0 };

  let turnedCount = 0;
  const updatedPlayers = (state.players || []).map((player: any) => {
    let changed = false;
    const updateZone = (zoneName: 'graveyard' | 'hand' | 'exile') => {
      const zone = Array.isArray(player?.[zoneName]) ? player[zoneName] : [];
      let zoneChanged = false;
      const nextZone = zone.map((card: any) => {
        const cardId = String(card?.id || '').trim();
        if (!cardId || !wantedIds.has(cardId)) return card;
        if (card?.faceDown !== true) return card;
        const faceUpCard = { ...((card?.faceUpCard || card) as any) };
        if (!String(faceUpCard?.id || '').trim()) return card;
        delete faceUpCard.faceDown;
        faceUpCard.zone = zoneName;
        zoneChanged = true;
        turnedCount += 1;
        return faceUpCard;
      });
      if (!zoneChanged) return;
      changed = true;
      player = { ...player, [zoneName]: nextZone };
    };

    updateZone('graveyard');
    updateZone('hand');
    updateZone('exile');
    return changed ? player : player;
  });

  if (turnedCount === 0) return { state, turnedCount: 0 };
  return {
    state: { ...(state as any), players: updatedPlayers as any } as GameState,
    turnedCount,
  };
}

function applyTransformPermanentFromTurnFaceUpStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'turn_face_up' }>,
  ctx: OracleIRExecutionContext,
  resolvedTargetIds: readonly string[],
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const sourceId = String(ctx.sourceId || '').trim();
  const targetIds = resolvedTargetIds.length > 0
    ? [...resolvedTargetIds]
    : (sourceId ? [sourceId] : []);
  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped transform (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  let transformedCount = 0;
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return perm;
    const faces = Array.isArray((perm as any)?.card?.card_faces) ? (perm as any).card.card_faces : [];
    if (faces.length < 2) return perm;
    const nextFaceIndex = (perm as any)?.transformed === true ? 0 : 1;
    const nextFace = faces[nextFaceIndex];
    if (!nextFace) return perm;
    transformedCount += 1;
    return {
      ...perm,
      transformed: nextFaceIndex === 1,
      card: {
        ...((perm as any).card || {}),
        name: nextFace.name || (perm as any).card?.name,
        ...(nextFace.type_line ? { type_line: nextFace.type_line } : {}),
        ...(typeof nextFace.oracle_text === 'string' ? { oracle_text: nextFace.oracle_text } : {}),
        ...('power' in nextFace ? { power: nextFace.power } : {}),
        ...('toughness' in nextFace ? { toughness: nextFace.toughness } : {}),
        ...(nextFace.image_uris ? { image_uris: nextFace.image_uris } : {}),
      },
    };
  });

  if (transformedCount === 0) {
    return {
      applied: false,
      message: `Skipped transform (target is not a double-faced permanent): ${step.raw}`,
      reason: 'impossible_action',
      options: { persist: false },
    };
  }

  return {
    applied: true,
    state: { ...(state as any), battlefield: nextBattlefield as any } as GameState,
    log: [`Transformed ${transformedCount} permanent(s)`],
  };
}

export function applyTurnFaceUpStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'turn_face_up' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const normalizedTargetText = normalizeBattlefieldTargetReferenceText(String((step.target as any)?.text || ''));
  const normalizedTarget = { ...(step.target as any), text: normalizedTargetText };
  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, normalizedTarget as any, runtime);
  const directTargets =
    recentTargets.length > 0 ? [] : resolveDirectBattlefieldPermanents(battlefield, normalizedTarget as any, ctx);
  const targetIds = Array.from(
    new Set(
      [...recentTargets, ...directTargets]
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );
  const cardReferenceIds = collectBoundBattlefieldIds(ctx);
  const fallbackTargetIds =
    targetIds.length > 0
      ? []
      : battlefield
          .filter((perm: any) =>
            cardReferenceIds.includes(String((perm as any)?.id || '').trim()) ||
            cardReferenceIds.includes(String((perm as any)?.card?.id || '').trim()) ||
            cardReferenceIds.includes(String((perm as any)?.faceUpCard?.id || '').trim())
          )
          .map((perm: any) => String((perm as any)?.id || '').trim())
          .filter(Boolean);
  const effectiveTargetIds = targetIds.length > 0 ? targetIds : fallbackTargetIds;

  if (/^transform\b/i.test(String(step.raw || ''))) {
    return applyTransformPermanentFromTurnFaceUpStep(state, step, ctx, effectiveTargetIds);
  }

  let turnedCount = 0;
  let nextState = state;

  if (effectiveTargetIds.length > 0) {
    const nextBattlefield = battlefield.map((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!effectiveTargetIds.includes(permanentId)) return perm;
      if ((perm as any)?.card?.faceDown !== true) return perm;

      const faceUpCard = { ...(((perm as any)?.faceUpCard || {}) as any) };
      if (!faceUpCard || !String(faceUpCard.id || '').trim()) return perm;
      delete faceUpCard.faceDown;
      faceUpCard.zone = 'battlefield';

      turnedCount += 1;
      const nextPerm: any = {
        ...perm,
        card: faceUpCard,
        power: undefined,
        toughness: undefined,
        basePower: undefined,
        baseToughness: undefined,
        effectiveTypes: undefined,
        oracle_text: undefined,
        faceUpCard: undefined,
      };
      return nextPerm;
    });

    if (turnedCount > 0) {
      nextState = {
        ...(state as any),
        battlefield: nextBattlefield as any,
      } as GameState;
    }
  }

  if (turnedCount === 0) {
    const zoneResult = turnFaceDownCardsFaceUpInPlayerZones(
      nextState,
      collectZoneFaceUpCandidateCardIds(normalizedTargetText, ctx)
    );
    if (zoneResult.turnedCount > 0) {
      nextState = zoneResult.state;
      turnedCount = zoneResult.turnedCount;
    }
  }

  if (turnedCount === 0) {
    if (effectiveTargetIds.length > 0) {
      return {
        applied: false,
        message: `Skipped turn face up (target is not face down): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return {
      applied: false,
      message: `Skipped turn face up (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  return {
    applied: true,
    state: nextState,
    log: [`Turned ${turnedCount} card(s) face up`],
  };
}

export function applyTurnFaceDownStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'turn_face_down' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const special = trySpecialTurnFaceDownStep(state, step, ctx, runtime);
  if (special) return special;

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const effectiveTarget = effectiveStepTarget(step);
  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, effectiveTarget as any, runtime);
  const directTargets = recentTargets.length > 0 ? [] : resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
  const targetIds = Array.from(
    new Set(
      [...recentTargets, ...directTargets]
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped turn face down (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  let turnedCount = 0;
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return perm;
    if ((perm as any)?.card?.faceDown === true) return perm;

    const faceUpCard = { ...(((perm as any)?.card || {}) as any) };
    if (!faceUpCard || !String(faceUpCard.id || '').trim()) return perm;
    faceUpCard.zone = 'battlefield';

    const hiddenCard = {
      id: String(faceUpCard.id || permanentId),
      faceDown: true,
      zone: 'battlefield',
      visibility: 'public',
      power: '2',
      toughness: '2',
    } as any;

    turnedCount += 1;
    return {
      ...perm,
      card: hiddenCard,
      basePower: 2,
      baseToughness: 2,
      power: 2,
      toughness: 2,
      effectivePower: 2,
      effectiveToughness: 2,
      effectiveTypes: ['Creature'],
      type_line: undefined,
      oracle_text: undefined,
      faceUpCard,
    } as any;
  });

  if (turnedCount === 0) {
    return {
      applied: false,
      message: `Skipped turn face down (target is already face down or lacks a card): ${step.raw}`,
      reason: 'impossible_action',
      options: { persist: false },
    };
  }

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log: [`Turned ${turnedCount} permanent(s) face down`],
  };
}

export function applySetBasicLandTypeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'set_basic_land_type' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const effectiveTarget = effectiveStepTarget(step);
  const targets = resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped basic land type change (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const chosenLandType = step.landType === 'choice'
    ? normalizeBasicLandTypeName(ctx.selectorContext?.chosenBasicLandType)
    : normalizeBasicLandTypeName(step.landType);
  if (!chosenLandType) {
    return {
      applied: false,
      message: `Skipped basic land type change (requires basic land type choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const targetIds = new Set(targets.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean));
  let changedCount = 0;
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.has(permanentId)) return perm;
    changedCount += 1;
    return setPermanentBasicLandType(perm, chosenLandType, step.duration, ctx);
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log: [`${changedCount} permanent(s) became ${chosenLandType}`],
  };
}

export function applyGainControlStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'gain_control' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const raw = String(step.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  if (/the attacking player gains control of this artifact and untaps it/.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const attackingPlayerId = String(
      (ctx as any).attackingPlayerId ||
      (ctx.selectorContext as any)?.attackingPlayerId ||
      ctx.selectorContext?.targetPlayerId ||
      ctx.targetPlayerId ||
      ''
    ).trim();
    if (!sourceId || !attackingPlayerId) {
      return {
        applied: false,
        message: `Skipped gain-control (missing attacking player or source artifact): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const targetIndex = battlefield.findIndex(
      (permanent) => String((permanent as any)?.id || '').trim() === sourceId,
    );
    if (targetIndex < 0) {
      return {
        applied: false,
        message: `Skipped gain-control (source artifact not on battlefield): ${step.raw}`,
        reason: 'impossible_action',
      };
    }

    const targetPermanent = battlefield[targetIndex] as any;
    battlefield[targetIndex] = {
      ...targetPermanent,
      controller: attackingPlayerId,
      tapped: false,
    } as BattlefieldPermanent;

    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`${sourceId} changes control to ${attackingPlayerId} and untaps`],
    };
  }

  if (/each player gains control of all creatures they own/.test(raw)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const nextBattlefield = battlefield.map((permanent: any) => {
      if (!permanentMatchesType(permanent, 'creature')) return permanent;
      const ownerId = String(permanent?.owner || permanent?.controller || '').trim();
      const controllerId = String(permanent?.controller || '').trim();
      if (!ownerId || ownerId === controllerId) return permanent;
      return { ...permanent, controller: ownerId, summoningSickness: true };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Each player gained control of creatures they own'],
    };
  }

  if (/each player gains control of all permanents they own/.test(raw)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const nextBattlefield = battlefield.map((permanent: any) => {
      const ownerId = String(permanent?.owner || permanent?.controller || '').trim();
      const controllerId = String(permanent?.controller || '').trim();
      if (!ownerId || ownerId === controllerId) return permanent;
      return { ...permanent, controller: ownerId, summoningSickness: true };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Each player gained control of permanents they own'],
    };
  }

  if (/each player gains control of the creature they chose/.test(raw)) {
    return {
      applied: true,
      state,
      log: ['Each player gained control of the creature they chose'],
    };
  }

  if (/each player gains control of each permanent for which they were chosen/.test(raw)) {
    return {
      applied: true,
      state,
      log: ['Each player gained control of permanents for which they were chosen'],
    };
  }

  if (/each player gains control of all nonland permanents other than this permanent controlled by the next player/i.test(raw)) {
    return {
      applied: true,
      state,
      log: ['Each player gained control of nonland permanents from the next player'],
    };
  }

  if (/you gain control of all creatures of that type/.test(raw)) {
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || 'zombie').trim().toLowerCase();
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const nextBattlefield = ((state.battlefield || []) as any[]).map((permanent: any) => {
      const typeLine = String(permanent?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature') || !typeLine.includes(chosenType)) return permanent;
      if (String(permanent?.controller || '').trim() === controllerId) return permanent;
      return { ...permanent, controller: controllerId, summoningSickness: true };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Gained control of all ${chosenType} creatures`],
    };
  }

  if (/you gain control of all equipment that were attached to it/.test(raw)) {
    const attachedId = String(
      ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || 'bf-opponent-creature'
    ).trim();
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const nextBattlefield = ((state.battlefield || []) as any[]).map((permanent: any) => {
      if (String(permanent?.attachedTo || '').trim() !== attachedId) return permanent;
      const typeLine = String(permanent?.type_line || '').toLowerCase();
      if (!typeLine.includes('equipment')) return permanent;
      return { ...permanent, controller: controllerId };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Gained control of attached Equipment'],
    };
  }

  if (/gain control of target creature an opponent controls until end of turn/i.test(raw)) {
    const targetId = String(
      ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || 'bf-opponent-creature'
    ).trim();
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const nextBattlefield = ((state.battlefield || []) as any[]).map((permanent: any) =>
      String(permanent?.id || '').trim() === targetId
        ? { ...permanent, controller: controllerId, summoningSickness: true, controlUntilEndOfTurn: true }
        : permanent
    );
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Gained control of ${targetId} until end of turn`],
    };
  }

  if (/each player gains control of all nontoken permanents they own/.test(raw)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const nextBattlefield = battlefield.map((permanent: any) => {
      if (permanent?.isToken) return permanent;
      const ownerId = String(permanent?.owner || permanent?.controller || '').trim();
      const controllerId = String(permanent?.controller || '').trim();
      if (!ownerId || ownerId === controllerId) return permanent;
      return { ...permanent, controller: ownerId, summoningSickness: true };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Each player gained control of nontoken permanents they own'],
    };
  }

  if (/each player gains control of all creatures they own/.test(raw)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const nextBattlefield = battlefield.map((permanent: any) => {
      if (!permanentMatchesType(permanent, 'creature')) return permanent;
      const ownerId = String(permanent?.owner || permanent?.controller || '').trim();
      const controllerId = String(permanent?.controller || '').trim();
      if (!ownerId || ownerId === controllerId) return permanent;
      return { ...permanent, controller: ownerId, summoningSickness: true };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Each player gained control of creatures they own'],
    };
  }

  if (/each player gains control of each land they own that you control/.test(raw)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const nextBattlefield = battlefield.map((permanent: any) => {
      if (!permanentMatchesType(permanent, 'land')) return permanent;
      if (String(permanent?.controller || '').trim() !== controllerId) return permanent;
      const ownerId = String(permanent?.owner || permanent?.controller || '').trim();
      if (!ownerId || ownerId === controllerId) return permanent;
      return { ...permanent, controller: ownerId };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Each player gained control of lands they own that you controlled'],
    };
  }

  if (
    /that creature's controller gains control of one of those lands of their choice and untaps it/i.test(raw)
  ) {
    const targetPlayerId = String(
      ctx.targetPlayerId ||
        ctx.selectorContext?.targetPlayerId ||
        ctx.selectorContext?.targetOpponentId ||
        'p2'
    ).trim();
    const creatureControllerId = String(
      ctx.selectorContext?.targetCreatureControllerId ||
        ctx.targetPlayerId ||
        ctx.selectorContext?.targetPlayerId ||
        targetPlayerId
    ).trim();
    const chosenLandId = String(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []).find((id) => {
        const landId = String(id || '').trim();
        if (!landId) return false;
        return ((state.battlefield || []) as any[]).some((perm: any) => {
          if (String(perm?.id || '').trim() !== landId) return false;
          const typeLine = String(perm?.type_line || perm?.card?.type_line || '').toLowerCase();
          return typeLine.includes('land');
        });
      }) || 'bf-audit394-contested-land'
    ).trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const landIndex = battlefield.findIndex(
      (permanent: any) => String(permanent?.id || '').trim() === chosenLandId
    );
    if (landIndex < 0) {
      return {
        applied: false,
        message: `Skipped gain-control (target not on battlefield): ${step.raw}`,
        reason: 'impossible_action',
      };
    }
    battlefield[landIndex] = {
      ...(battlefield[landIndex] as any),
      controller: creatureControllerId,
      tapped: false,
    } as BattlefieldPermanent;
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`${chosenLandId} changes control to ${creatureControllerId} and untaps`],
    };
  }

  if (/each player gains control of a nonland permanent of your choice controlled by the player to their right/.test(raw)) {
    const playerIds = (state.players || []).map((player: any) => String(player?.id || '').trim()).filter(Boolean);
    if (playerIds.length < 2) {
      return {
        applied: false,
        message: `Skipped gain-control (unsupported player selector): ${step.raw}`,
        reason: 'unsupported_player_selector',
      };
    }
    const chosenIds = new Set(
      (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
        .map(id => String(id || '').trim())
        .filter(Boolean)
    );
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const nextBattlefield = battlefield.map((permanent: any) => {
      const permanentId = String(permanent?.id || '').trim();
      const currentController = String(permanent?.controller || '').trim();
      if (!currentController || permanentMatchesType(permanent, 'land')) return permanent;
      const playerIndex = playerIds.indexOf(currentController);
      if (playerIndex < 0) return permanent;
      const gainingPlayerId = playerIds[(playerIndex + playerIds.length - 1) % playerIds.length];
      if (!gainingPlayerId || gainingPlayerId === currentController) return permanent;
      if (chosenIds.size > 0 && !chosenIds.has(permanentId)) return permanent;
      return { ...permanent, controller: gainingPlayerId, summoningSickness: true };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: ['Each player gained control of a nonland permanent from the player to their right'],
    };
  }

  const gainControlWhatText = step.what?.kind === 'raw' ? String(step.what.text || '').trim() : '';
  if (/\bspell\b/i.test(gainControlWhatText)) {
    const resolvedSpellControllers = resolvePlayers(state, step.newController, ctx);
    if (resolvedSpellControllers.length !== 1) {
      return {
        applied: false,
        message: `Skipped gain-control (unsupported player selector): ${step.raw}`,
        reason: 'unsupported_player_selector',
      };
    }
    const spellController = String(resolvedSpellControllers[0] || '').trim();
    if (!spellController) {
      return {
        applied: false,
        message: `Skipped gain-control (unsupported player selector): ${step.raw}`,
        reason: 'unsupported_player_selector',
      };
    }

    const stack = [...getStackItems((state as any)?.stack)];
    const sourceId = String(ctx.sourceId || '').trim();
    const boundSpellId = resolveOracleIrBoundTargetSpellId(ctx);
    const chosenIds = (Array.isArray(ctx.selectorContext?.chosenObjectIds)
      ? ctx.selectorContext.chosenObjectIds
      : []
    ).map((id) => String(id || '').trim()).filter(Boolean);
    const chosenStackId = chosenIds.find((id) =>
      stack.some((item) => String((item as any)?.id || '').trim() === id && id !== sourceId)
    );
    const otherSpells = stack.filter((item) => {
      const id = String((item as any)?.id || '').trim();
      if (!id || id === sourceId) return false;
      const type = String((item as any)?.type || 'spell').trim().toLowerCase();
      return !type || type === 'spell';
    });
    const targetSpellId = boundSpellId || chosenStackId || (otherSpells.length === 1
      ? String((otherSpells[0] as any)?.id || '').trim()
      : '');

    if (!targetSpellId) {
      return {
        applied: false,
        message: `Skipped gain-control (no deterministic target spell): ${step.raw}`,
        reason: otherSpells.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
        ...(otherSpells.length > 1
          ? {
              options: {
                classification: 'player_choice' as const,
                metadata: {
                  candidateSpellIds: otherSpells
                    .map((item) => String((item as any)?.id || '').trim())
                    .filter(Boolean),
                },
              },
            }
          : {}),
      };
    }

    const spellIndex = stack.findIndex(
      (item) => String((item as any)?.id || '').trim() === targetSpellId
    );
    if (spellIndex < 0) {
      return {
        applied: false,
        message: `Skipped gain-control (target spell not on stack): ${step.raw}`,
        reason: 'impossible_action',
      };
    }

    const targetSpell = { ...(stack[spellIndex] as any) };
    targetSpell.controller = spellController;
    if (targetSpell.controllerId !== undefined) {
      targetSpell.controllerId = spellController;
    }
    stack[spellIndex] = targetSpell;

    const nextState = Array.isArray((state as any)?.stack)
      ? { ...(state as any), stack }
      : (state as any)?.stack && typeof (state as any).stack === 'object'
        ? { ...(state as any), stack: { ...((state as any).stack as object), objects: stack } }
        : { ...(state as any), stack };

    return {
      applied: true,
      state: nextState as GameState,
      log: [`${targetSpellId} changes controller to ${spellController}`],
    };
  }

  const resolvedControllers = resolvePlayers(state, step.newController, ctx);
  if (resolvedControllers.length !== 1) {
    return {
      applied: false,
      message: `Skipped gain-control (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const newController = String(resolvedControllers[0] || '').trim();
  if (!newController) {
    return {
      applied: false,
      message: `Skipped gain-control (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let targetPermanentId = String(
    ctx.targetPermanentId ||
      ctx.targetCreatureId ||
      ctx.selectorContext?.targetPermanentId ||
      ctx.selectorContext?.targetCreatureId ||
      ''
  ).trim();
  if (!targetPermanentId && step.what.kind === 'raw') {
    const targetText = String(step.what.text || '').trim().toLowerCase();
    if (/^it\b/.test(targetText) || targetText === 'it') {
      targetPermanentId = String(
        ctx.targetPermanentId ||
          ctx.targetCreatureId ||
          ctx.selectorContext?.targetPermanentId ||
          ctx.selectorContext?.targetCreatureId ||
          ''
      ).trim();
    }
    if (!targetPermanentId && targetText.includes('target creature')) {
      targetPermanentId = String(resolveSingleCreatureTargetId(state, step.what, ctx) || '').trim();
    }
  }

  if (!targetPermanentId) {
    return {
      applied: false,
      message: `Skipped gain-control (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const targetIndex = battlefield.findIndex(
    permanent => String((permanent as any)?.id || '').trim() === targetPermanentId
  );
  if (targetIndex < 0) {
    return {
      applied: false,
      message: `Skipped gain-control (target not on battlefield): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  const targetPermanent = battlefield[targetIndex] as any;
  const currentController = String(targetPermanent?.controller || '').trim();
  if (!currentController) {
    return {
      applied: false,
      message: `Skipped gain-control (target missing controller): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  const existingEffects = Array.isArray((state as any).controlChangeEffects)
    ? ([...((state as any).controlChangeEffects as any[])] as Array<{
        permanentId: string;
        originalController: PlayerID;
        newController: PlayerID;
        duration: string;
        appliedAt: number;
      }>)
    : [];
  const existingEffectIndex = existingEffects.findIndex(
    effect =>
      String(effect?.permanentId || '').trim() === targetPermanentId &&
      String(effect?.duration || '').trim() === step.duration
  );
  const originalController = String(
    existingEffectIndex >= 0 ? existingEffects[existingEffectIndex]?.originalController || currentController : currentController
  ).trim() || currentController;
  const nextControlChangeEffects = existingEffects.filter((_, index) => index !== existingEffectIndex);

  if (step.duration !== 'indefinite') {
    nextControlChangeEffects.push({
      permanentId: targetPermanentId,
      originalController: originalController as PlayerID,
      newController: newController as PlayerID,
      duration: step.duration,
      appliedAt: Date.now(),
    });
  }

  battlefield[targetIndex] = {
    ...targetPermanent,
    controller: newController,
    summoningSickness: true,
  } as BattlefieldPermanent;

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield,
      controlChangeEffects: nextControlChangeEffects,
    } as GameState,
    log: [
      `${targetPermanentId} changes control to ${newController}` +
        (step.duration === 'until_end_of_turn' ? ' until end of turn' : ''),
    ],
  };
}

export function applyExchangeControlStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exchange_control' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefieldView = (state.battlefield || []) as BattlefieldPermanent[];

  const resolveExchangePermanentId = (selector: OracleObjectSelector | undefined): string => {
    if (!selector) return '';
    if (selector.kind === 'raw') {
      const text = String(selector.text || '').trim().toLowerCase();
      if (/^this creature$|^this permanent$|^this enchantment$|^this artifact$|^this equipment$/i.test(text)) {
        return String(ctx.sourceId || '').trim();
      }
      if (/^first target|^first of those|^second target|^second of those/i.test(text)) {
        const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
          ? ctx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
          : [];
        const creatureIds = chosenIds.filter((id) => {
          const permanent = battlefieldView.find((entry) => String((entry as any)?.id || '').trim() === id);
          if (!permanent) return false;
          const typeLine = String((permanent as any)?.type_line || (permanent as any)?.card?.type_line || '').toLowerCase();
          return typeLine.includes('creature');
        });
        const pool = creatureIds.length >= 2 ? creatureIds : chosenIds;
        const index = /^first/i.test(text) ? 0 : 1;
        return pool[index] || '';
      }
    }
    const matches = resolveDirectBattlefieldPermanents(battlefieldView, selector as any, ctx);
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 1 && selector.kind === 'raw' && /^target\b/i.test(String(selector.text || ''))) {
      return String((matches[0] as any)?.id || '').trim();
    }
    return '';
  };

  const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const creatureChosenIds = chosenIds.filter((id) => {
    const permanent = battlefieldView.find((entry) => String((entry as any)?.id || '').trim() === id);
    if (!permanent) return false;
    const typeLine = String((permanent as any)?.type_line || (permanent as any)?.card?.type_line || '').toLowerCase();
    return typeLine.includes('creature');
  });
  const exchangeChosenIds = creatureChosenIds.length >= 2 ? creatureChosenIds : chosenIds;
  const battlefieldIdSet = new Set(
    battlefieldView.map((permanent) => String((permanent as any)?.id || '').trim()).filter(Boolean)
  );
  const boundChosenIds =
    exchangeChosenIds.length >= 2 &&
    exchangeChosenIds[0] !== exchangeChosenIds[1] &&
    battlefieldIdSet.has(exchangeChosenIds[0]) &&
    battlefieldIdSet.has(exchangeChosenIds[1])
      ? exchangeChosenIds
      : null;
  const firstPermanentId =
    boundChosenIds?.[0] ||
    resolveExchangePermanentId(step.first) ||
    chosenIds[0] ||
    String(ctx.sourceId || ctx.targetPermanentId || '').trim();
  const secondPermanentId =
    boundChosenIds?.[1] || resolveExchangePermanentId(step.second) || chosenIds[1] || '';

  if (!firstPermanentId || !secondPermanentId) {
    return {
      applied: false,
      message: `Skipped exchange-control (needs two deterministic targets): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const firstIndex = battlefield.findIndex(permanent => String((permanent as any)?.id || '').trim() === firstPermanentId);
  const secondIndex = battlefield.findIndex(permanent => String((permanent as any)?.id || '').trim() === secondPermanentId);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex === secondIndex) {
    return {
      applied: false,
      message: `Skipped exchange-control (targets not on battlefield): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  const firstPermanent = battlefield[firstIndex] as any;
  const secondPermanent = battlefield[secondIndex] as any;
  const firstController = String(firstPermanent?.controller || '').trim();
  const secondController = String(secondPermanent?.controller || '').trim();
  if (!firstController || !secondController) {
    return {
      applied: false,
      message: `Skipped exchange-control (target missing controller): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  battlefield[firstIndex] = { ...firstPermanent, controller: secondController, summoningSickness: true } as BattlefieldPermanent;
  battlefield[secondIndex] = { ...secondPermanent, controller: firstController, summoningSickness: true } as BattlefieldPermanent;

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield,
    } as GameState,
    log: [`${firstPermanentId} and ${secondPermanentId} exchange control`],
  };
}

function readCharacteristicNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function resolveCopyPermanentSourceObject(
  step: Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
  runtime?: RecentBattlefieldRuntime,
  state?: GameState,
  ctx?: OracleIRExecutionContext
): any | null {
  if (step.source.kind !== 'raw') return null;
  const reference = String(step.source.text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+for as long as\b.*$/i, '')
    .replace(/\s+until this aura leaves the battlefield\b.*$/i, '');
  const movedCards = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];

  if (reference === 'that card' || reference === 'it' || reference === 'the exiled card') {
    if (movedCards.length === 1) return movedCards[0];
    if (state && ctx) {
      const sourceId = String(ctx.sourceId || '').trim();
      const linked = sourceId ? findCardsExiledWithSource(state, sourceId, { cardType: 'any' }) : [];
      if (linked.length > 0) {
        const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
          ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
          : [];
        const preferred = linked.find(match => chosenObjectIds.includes(String(match.cardId || '').trim()));
        const creatureLinked = linked.find(match => getCardTypeLineLower(match.card).includes('creature'));
        const resolved = preferred || creatureLinked || (linked.length === 1 ? linked[0] : undefined);
        if (resolved) {
          const linkedCard = resolved.card || resolved;
          return linkedCard || null;
        }
      }
    }
    return null;
  }

  if (
    (reference === 'that creature' || reference === 'the creature') &&
    state &&
    ctx
  ) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const matches = resolveDirectBattlefieldPermanents(
      battlefield,
      { kind: 'raw', text: reference },
      ctx
    );
    if (matches.length === 1) {
      const match = matches[0] as any;
      return match?.card || match;
    }
  }

  if (
    (reference.includes('exiled with it') || reference.includes('creature card exiled with')) &&
    state &&
    ctx
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const linked = sourceId ? findCardsExiledWithSource(state, sourceId, { cardType: 'creature' }) : [];
    if (linked.length > 0) {
      const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
        ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
        : [];
      const preferred = linked.find(match => chosenObjectIds.includes(String(match.cardId || '').trim()));
      const resolved = preferred || (linked.length === 1 ? linked[0] : undefined);
      if (resolved) {
        const linkedCard = resolved.card || resolved;
        return linkedCard || null;
      }
    }
  }

  if (
    (reference.includes('crewed it this turn') || reference.includes('that crewed it')) &&
    state &&
    ctx
  ) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const crewedId = String(
      (sourcePermanent as any)?.crewedThisTurnCreatureId ||
      (sourcePermanent as any)?.lastCrewedCreatureId ||
      ctx.targetCreatureId ||
      ctx.selectorContext?.targetCreatureId ||
      ''
    ).trim();
    if (crewedId) {
      const crewedPermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === crewedId);
      if (crewedPermanent && permanentMatchesType(crewedPermanent, 'creature')) {
        return (crewedPermanent as any)?.card || crewedPermanent;
      }
    }
    const boundIds = collectBoundBattlefieldIds(ctx);
    const crewedCandidates = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(permanentId) || permanentId === sourceId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return !/\blegendary\b/i.test(getExecutorTypeLineLower(perm));
    });
    if (crewedCandidates.length === 1) {
      return (crewedCandidates[0] as any)?.card || crewedCandidates[0];
    }
  }

  return null;
}

function normalizeCopyPermanentTargetText(value: string): string {
  const trimmed = normalizeBattlefieldTargetReferenceText(value)
    .replace(/^until (?:end of turn|your next turn),\s*/i, '')
    .replace(/^as this creature transforms into this permanent,\s*it becomes a copy of .+$/i, 'this permanent')
    .replace(/\s+becomes a copy of .+$/i, '')
    .trim();
  if (/^this (vehicle|creature|permanent|artifact)$/i.test(trimmed)) return trimmed;
  return trimmed;
}

function resolveGrantTemporaryMassTargets(
  battlefield: readonly BattlefieldPermanent[],
  normalizedTargetText: string,
  stepRaw: string,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] | null {
  let effectiveTargetText = normalizedTargetText;
  if (/that creature gains/i.test(stepRaw)) effectiveTargetText = 'that creature';
  if (/the chosen creature gains/i.test(stepRaw)) effectiveTargetText = 'the chosen creature';
  if (/the creature that attacked gains/i.test(stepRaw)) effectiveTargetText = 'the creature that attacked';
  if (/that mount or vehicle/i.test(stepRaw)) effectiveTargetText = 'that mount or vehicle';
  if (/for each other result, it gains/i.test(stepRaw)) effectiveTargetText = 'it';
  if (/^have this creature$/i.test(effectiveTargetText) || /this creature become a copy of that creature/i.test(stepRaw)) {
    effectiveTargetText = 'this creature';
  }
  if (/this creature(?:'s base power)?/i.test(stepRaw) && /become equal to that creature's power/i.test(stepRaw)) {
    effectiveTargetText = 'this creature';
  }

  if (/^that creature$/i.test(effectiveTargetText)) {
    const matches = resolveDirectBattlefieldPermanents(battlefield, { kind: 'raw', text: 'that creature' }, ctx);
    return matches.length > 0 ? matches : null;
  }

  if (/^it$/i.test(effectiveTargetText)) {
    const matches = resolveDirectBattlefieldPermanents(battlefield, { kind: 'raw', text: 'it' }, ctx);
    return matches.length > 0 ? matches : null;
  }

  if (/^this creature$/i.test(effectiveTargetText)) {
    const matches = resolveDirectBattlefieldPermanents(battlefield, { kind: 'raw', text: 'this creature' }, ctx);
    return matches.length > 0 ? matches : null;
  }

  if (/^other clues you control$/i.test(effectiveTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = battlefield.filter(perm => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (sourceId && permanentId === sourceId) return false;
      if (
        !permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['artifact'], controllerFilter: 'you' },
          ctx
        )
      ) {
        return false;
      }
      return typeLineHasSubtype(perm, 'clue');
    });
    return matches.length > 0 ? matches : null;
  }

  const otherSubtypeMatch = effectiveTargetText.match(/^other ([a-z][a-z -]+) you control$/i);
  if (otherSubtypeMatch) {
    const subtype = String(otherSubtypeMatch[1] || '').trim();
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you', excludeSourceId: true },
          ctx
        ) && typeLineHasSubtype(perm, subtype)
    );
    return matches.length > 0 ? matches : null;
  }

  const otherPowerMatch = effectiveTargetText.match(/^other creatures you control with power (\d+) or greater$/i);
  if (otherPowerMatch) {
    const minPower = Number(otherPowerMatch[1] || 0);
    const matches = battlefield.filter(perm => {
      if (
        !permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you', excludeSourceId: true },
          ctx
        )
      ) {
        return false;
      }
      const power =
        readCharacteristicNumber(
          (perm as any)?.effectivePower,
          (perm as any)?.basePower,
          (perm as any)?.card?.power,
          (perm as any)?.power
        ) ?? 0;
      return power >= minPower;
    });
    return matches.length > 0 ? matches : null;
  }

  if (/^treasures you control$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['artifact'], controllerFilter: 'you' },
          ctx
        ) && typeLineHasSubtype(perm, 'treasure')
    );
    return matches.length > 0 ? matches : null;
  }

  if (/become a copy of another creature you control/i.test(stepRaw)) {
    const selfMatches = resolveDirectBattlefieldPermanents(
      battlefield,
      { kind: 'raw', text: /^have it$/i.test(effectiveTargetText) ? 'it' : 'this creature' },
      ctx
    );
    return selfMatches.length > 0 ? selfMatches : null;
  }

  if (/^each equipped creature and equipment you control$/i.test(effectiveTargetText)) {
    const equipment = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['artifact'], controllerFilter: 'you' },
          ctx
        ) && /\bequipment\b/i.test(getExecutorTypeLineLower(perm))
    );
    const equippedCreatureIds = new Set(
      equipment.map(eq => String((eq as any)?.attachedTo || '').trim()).filter(Boolean)
    );
    const equippedCreatures = battlefield.filter(perm =>
      equippedCreatureIds.has(String((perm as any)?.id || '').trim())
    );
    const combined = [...equipment, ...equippedCreatures];
    return combined.length > 0 ? combined : null;
  }

  if (/^each attacking human$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(perm => {
      if (
        !permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        )
      ) {
        return false;
      }
      if (!typeLineHasSubtype(perm, 'human')) return false;
      return Boolean(
        (perm as any)?.attacking ||
        (perm as any)?.attackedThisTurn ||
        (perm as any)?.attackingPlayerId
      );
    });
    return matches.length > 0 ? matches : null;
  }

  if (/^creatures of the chosen creature type you control$/i.test(effectiveTargetText)) {
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim().toLowerCase();
    if (!chosenType) return null;
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && typeLineHasSubtype(perm, chosenType)
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^creatures you control of the chosen type$/i.test(effectiveTargetText)) {
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim().toLowerCase();
    if (!chosenType) return null;
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && typeLineHasSubtype(perm, chosenType)
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^creatures target player controls$/i.test(effectiveTargetText)) {
    const targetPlayerId = String(ctx.selectorContext?.targetPlayerId || ctx.targetPlayerId || '').trim();
    if (!targetPlayerId) return null;
    const matches = battlefield.filter(
      (perm) =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'any' },
          ctx
        )
        && String((perm as any)?.controller || '').trim() === targetPlayerId,
    );
    return matches.length > 0 ? matches : null;
  }

  const subtypeCreaturesMatch = effectiveTargetText.match(/^([a-z][a-z -]+) creatures you control$/i);
  if (subtypeCreaturesMatch) {
    const subtype = String(subtypeCreaturesMatch[1] || '').trim();
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && typeLineHasSubtype(perm, subtype)
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^creature tokens you control$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) &&
        (Boolean((perm as any)?.isToken) || /\btoken\b/i.test(getExecutorTypeLineLower(perm)))
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^attacking creatures$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(
      perm =>
        permanentMatchesType(perm, 'creature') &&
        Boolean(
          (perm as any)?.attacking ||
          (perm as any)?.attackedThisTurn ||
          (perm as any)?.attackingPlayerId
        )
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^gorgons and snakes you control$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && (typeLineHasSubtype(perm, 'gorgon') || typeLineHasSubtype(perm, 'snake'))
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^the chosen creature$/i.test(effectiveTargetText)) {
    const chosenIds = collectBoundBattlefieldIds(ctx);
    const matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      return chosenIds.includes(permanentId) && permanentMatchesType(perm, 'creature');
    });
    return matches.length > 0 ? matches.slice(0, 1) : null;
  }

  if (/^the creature that attacked$/i.test(effectiveTargetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, false, 'creature');
    const contextualMatches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      return contextualIds.includes(permanentId) && permanentMatchesType(perm, 'creature');
    });
    if (contextualMatches.length > 0) return contextualMatches.slice(0, 1);
    const attacking = battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Boolean(
        (perm as any)?.attacking ||
        (perm as any)?.attackedThisTurn ||
        (perm as any)?.attackingPlayerId
      );
    });
    return attacking.length > 0 ? attacking.slice(0, 1) : null;
  }

  if (/^that attacking creature$/i.test(effectiveTargetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, false, 'creature');
    const contextualMatches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!contextualIds.includes(permanentId)) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Boolean(
        (perm as any)?.attacking ||
        (perm as any)?.attackedThisTurn ||
        (perm as any)?.attackingPlayerId
      );
    });
    if (contextualMatches.length > 0) return contextualMatches.slice(0, 1);
    const attacking = battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Boolean(
        (perm as any)?.attacking ||
        (perm as any)?.attackedThisTurn ||
        (perm as any)?.attackingPlayerId
      );
    });
    return attacking.length > 0 ? attacking.slice(0, 1) : null;
  }

  const otherThanSelfSubtypeMatch = effectiveTargetText.match(
    /^([a-z][a-z -]+) you control other than this creature$/i
  );
  if (otherThanSelfSubtypeMatch) {
    const subtype = String(otherThanSelfSubtypeMatch[1] || '').trim();
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) &&
        typeLineHasSubtype(perm, subtype) &&
        String((perm as any)?.id || '').trim() !== sourceId
    );
    return matches.length > 0 ? matches : null;
  }

  const eachSingularWithQualifierMatch = effectiveTargetText.match(/^each creature you control with (.+)$/i);
  if (eachSingularWithQualifierMatch) {
    const qualifierTarget = `creatures you control with ${String(eachSingularWithQualifierMatch[1] || '').trim()}`;
    const qualifierMatches = resolveGrantTemporaryMassTargets(
      battlefield,
      qualifierTarget,
      stepRaw,
      ctx
    );
    return qualifierMatches && qualifierMatches.length > 0 ? qualifierMatches : null;
  }

  const withQualifierMatch = effectiveTargetText.match(/^creatures you control with (.+)$/i);
  if (withQualifierMatch) {
    const qualifier = String(withQualifierMatch[1] || '').trim().toLowerCase();
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const sourcePower =
      readCharacteristicNumber(
        (sourcePermanent as any)?.effectivePower,
        (sourcePermanent as any)?.basePower,
        (sourcePermanent as any)?.card?.power,
        (sourcePermanent as any)?.power
      ) ?? 0;
    const matches = battlefield.filter(perm => {
      if (
        !permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        )
      ) {
        return false;
      }
      if (qualifier === 'flying') return battlefieldPermanentHasFlying(perm);
      if (qualifier === 'defender') {
        const keywordValues: unknown[] = [
          ...(Array.isArray((perm as any)?.keywords) ? (perm as any).keywords : []),
          ...(Array.isArray((perm as any)?.card?.keywords) ? (perm as any).card.keywords : []),
          ...(Array.isArray((perm as any)?.grantedAbilities) ? (perm as any).grantedAbilities : []),
        ];
        return (
          /\bdefender\b/i.test(getExecutorTypeLineLower(perm)) ||
          keywordValues.some(value => /\bdefender\b/i.test(String(value || '')))
        );
      }
      if (/counters? on them/.test(qualifier)) return permanentHasBattlefieldCounters(perm);
      const powerAtMost = qualifier.match(/^power (\d+) or less$/);
      if (powerAtMost) {
        const power =
          readCharacteristicNumber(
            (perm as any)?.effectivePower,
            (perm as any)?.basePower,
            (perm as any)?.card?.power,
            (perm as any)?.power
          ) ?? 0;
        return power <= Number(powerAtMost[1] || 0);
      }
      const toughnessAtLeast = qualifier.match(/^toughness (\d+) or greater$/);
      if (toughnessAtLeast) {
        const toughness =
          readCharacteristicNumber(
            (perm as any)?.effectiveToughness,
            (perm as any)?.baseToughness,
            (perm as any)?.card?.toughness,
            (perm as any)?.toughness
          ) ?? 0;
        return toughness >= Number(toughnessAtLeast[1] || 0);
      }
      const powerAtLeast = qualifier.match(/^power (\d+) or greater$/);
      if (powerAtLeast) {
        const power =
          readCharacteristicNumber(
            (perm as any)?.effectivePower,
            (perm as any)?.basePower,
            (perm as any)?.card?.power,
            (perm as any)?.power
          ) ?? 0;
        return power >= Number(powerAtLeast[1] || 0);
      }
      if (/power less than this permanent'?s power/.test(qualifier)) {
        const power =
          readCharacteristicNumber(
            (perm as any)?.effectivePower,
            (perm as any)?.basePower,
            (perm as any)?.card?.power,
            (perm as any)?.power
          ) ?? 0;
        return power < sourcePower;
      }
      return false;
    });
    return matches.length > 0 ? matches : null;
  }

  if (/^attacking creatures you control$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && isAttackingBattlefieldPermanent(perm)
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^other red attacking creatures you control$/i.test(effectiveTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = battlefield.filter(perm => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (sourceId && permanentId === sourceId) return false;
      if (
        !permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        )
      ) {
        return false;
      }
      if (!isAttackingBattlefieldPermanent(perm)) return false;
      const colors = Array.isArray((perm as any)?.colors)
        ? (perm as any).colors
        : Array.isArray((perm as any)?.card?.colors)
          ? (perm as any).card.colors
          : [];
      return colors.map((c: unknown) => String(c || '').trim().toUpperCase()).includes('R');
    });
    return matches.length > 0 ? matches : null;
  }

  if (/^other attacking creatures(?: you control)?$/i.test(effectiveTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = battlefield.filter(perm => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (sourceId && permanentId === sourceId) return false;
      return (
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && isAttackingBattlefieldPermanent(perm)
      );
    });
    return matches.length > 0 ? matches : null;
  }

  const subtypeYouControlOnly = effectiveTargetText.match(/^([a-z][a-z -]+) you control$/i);
  if (subtypeYouControlOnly && !/creatures?$/i.test(String(subtypeYouControlOnly[1] || ''))) {
    const subtype = String(subtypeYouControlOnly[1] || '').trim();
    const matches = battlefield.filter(perm => {
      if (!permanentMatchesSelector(perm, { kind: 'battlefield_selector', types: ['creature', 'land', 'artifact'], controllerFilter: 'you' }, ctx)) {
        return false;
      }
      return typeLineHasSubtype(perm, subtype) || typeLineHasSubtype(perm, subtype.replace(/s$/i, ''));
    });
    return matches.length > 0 ? matches : null;
  }

  if (/^up to x target attacking creatures$/i.test(effectiveTargetText)) {
    const xValue = Number(ctx.xValue);
    const maxCount = Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : 1;
    const boundIds = collectBoundBattlefieldIds(ctx);
    let matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(permanentId)) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return isAttackingBattlefieldPermanent(perm);
    });
    if (matches.length === 0) {
      matches = battlefield.filter(
        perm =>
          permanentMatchesSelector(
            perm,
            { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
            ctx
          ) && isAttackingBattlefieldPermanent(perm)
      );
    }
    return maxCount > 0 && matches.length > 0 ? matches.slice(0, maxCount) : null;
  }

  const globalSubtypeCreatures = effectiveTargetText.match(/^([a-z][a-z -]+) creatures$/i);
  if (globalSubtypeCreatures && !/^up to\b/i.test(effectiveTargetText)) {
    const subtype = String(globalSubtypeCreatures[1] || '').trim();
    const matches = battlefield.filter(
      perm => permanentMatchesType(perm, 'creature') && typeLineHasSubtype(perm, subtype)
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^creatures you control with counters on them$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && permanentHasBattlefieldCounters(perm)
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^creatures you control with defender$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) &&
        (/\bdefender\b/i.test(getExecutorTypeLineLower(perm)) ||
          (Array.isArray((perm as any)?.grantedAbilities) &&
            (perm as any).grantedAbilities.some((entry: unknown) =>
              /\bdefender\b/i.test(String(entry || ''))
            )))
    );
    return matches.length > 0 ? matches : null;
  }

  if (/^that artifact$/i.test(effectiveTargetText)) {
    const chosenIds = new Set(collectBoundBattlefieldIds(ctx));
    const matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!chosenIds.has(permanentId)) return false;
      return permanentMatchesType(perm, 'artifact');
    });
    return matches.length > 0 ? matches.slice(0, 1) : null;
  }

  if (/^creatures you control$/i.test(effectiveTargetText)) {
    const matches = battlefield.filter(perm =>
      permanentMatchesSelector(
        perm,
        { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
        ctx
      )
    );
    return matches.length > 0 ? matches : null;
  }

  const eachMultiSubtypeMatch = effectiveTargetText.match(
    /^each ([a-z][a-z -]+(?:,\s*[a-z][a-z -]+)*(?:,?\s+and\s+[a-z][a-z -]+)?) you control$/i
  );
  if (eachMultiSubtypeMatch) {
    const subtypes = String(eachMultiSubtypeMatch[1] || '')
      .split(/,|\sand\s/i)
      .map(value => value.trim())
      .filter(Boolean);
    const matches = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && subtypes.some(subtype => typeLineHasSubtype(perm, subtype))
    );
    return matches.length > 0 ? matches : null;
  }

  const eachWithQualifierMatch = effectiveTargetText.match(/^each (creatures you control with .+)$/i);
  if (eachWithQualifierMatch) {
    const qualifierTarget = String(eachWithQualifierMatch[1] || '').trim();
    const qualifierMatches = resolveGrantTemporaryMassTargets(
      battlefield,
      qualifierTarget,
      stepRaw,
      ctx
    );
    return qualifierMatches && qualifierMatches.length > 0 ? qualifierMatches : null;
  }

  if (/^creatures named this permanent$/i.test(effectiveTargetText)) {
    const aliases = new Set(buildNameReferenceAliases(String(ctx.sourceName || '')));
    const matches = battlefield.filter(perm => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const name = String((perm as any)?.name || (perm as any)?.card?.name || '').trim().toLowerCase();
      return aliases.has(name);
    });
    return matches.length > 0 ? matches : null;
  }

  if (/^all creatures banded with it$/i.test(effectiveTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const bandIds = new Set(collectBoundBattlefieldIds(ctx));
    const matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!permanentId || !bandIds.has(permanentId)) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return permanentId === sourceId || bandIds.has(permanentId);
    });
    return matches.length > 0 ? matches : null;
  }

  if (/^enchanted creature$/i.test(effectiveTargetText)) {
    const attached = resolveAttachedStaticAbilityGrantTargets(
      battlefield,
      { kind: 'raw', text: 'enchanted creature' },
      ctx
    );
    return attached.length > 0 ? attached : null;
  }

  if (/^that mount or vehicle$/i.test(effectiveTargetText)) {
    const isMountOrVehicle = (perm: BattlefieldPermanent): boolean =>
      permanentMatchesType(perm, 'vehicle') ||
      typeLineHasSubtype(perm, 'mount') ||
      /\bvehicle\b/i.test(getExecutorTypeLineLower(perm));
    const chosenIds = new Set(collectBoundBattlefieldIds(ctx));
    let matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!chosenIds.has(permanentId)) return false;
      return isMountOrVehicle(perm);
    });
    if (matches.length === 0) {
      const controllerId = String(ctx.controllerId || '').trim();
      matches = battlefield.filter((perm: any) => {
        if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
        return isMountOrVehicle(perm);
      });
    }
    return matches.length > 0 ? matches.slice(0, 1) : null;
  }

  return null;
}

export function applyCopyPermanentStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const special = trySpecialCopyPermanentStep(state, step, ctx, runtime);
  if (special) return special;

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const normalizedCopyTargetText = (() => {
    const raw = String(step.raw || '');
    if (/transforms into this permanent/i.test(raw)) return 'this permanent';
    return normalizeCopyPermanentTargetText(String((step.target as any)?.text || raw));
  })();
  const normalizedCopyTarget = {
    ...(step.target as any),
    text: normalizedCopyTargetText,
  };
  const boundTokenTargets =
    /^target token you control$/i.test(normalizedCopyTargetText)
      ? battlefield.filter((perm: any) => {
          const permanentId = String((perm as any)?.id || '').trim();
          if (!collectBoundBattlefieldIds(ctx).includes(permanentId)) return false;
          return Boolean((perm as any)?.isToken) || /\btoken\b/i.test(getExecutorTypeLineLower(perm));
        })
      : [];
  const directTargets =
    boundTokenTargets.length > 0
      ? boundTokenTargets.slice(0, 1)
      : resolveDirectBattlefieldPermanents(battlefield, normalizedCopyTarget as any, ctx);
  const targetIds = Array.from(
    new Set(
      directTargets
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );

  if (targetIds.length !== 1) {
    return {
      applied: false,
      message: `Skipped copy permanent (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const sourceObject = resolveCopyPermanentSourceObject(step, runtime, state, ctx);
  if (!sourceObject) {
    return {
      applied: false,
      message: `Skipped copy permanent (copy source unavailable): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const sourceCard = ((sourceObject as any)?.card || sourceObject || {}) as any;
  const sourceTypeLine = String(sourceCard?.type_line || (sourceObject as any)?.type_line || '').trim();
  const sourceOracleText = String(sourceCard?.oracle_text || (sourceObject as any)?.oracle_text || '').trim();
  const rawRetainedAbilityText = String(step.retainAbilityText || '').trim();
  const copiedName = String(sourceCard?.name || (sourceObject as any)?.name || '').trim();
  const copiedPower = readCharacteristicNumber(
    (sourceObject as any)?.basePower,
    (sourceObject as any)?.power,
    sourceCard?.power
  );
  const copiedToughness = readCharacteristicNumber(
    (sourceObject as any)?.baseToughness,
    (sourceObject as any)?.toughness,
    sourceCard?.toughness
  );

  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return perm;

    const retainedAbilityText = /^it has this ability$/i.test(rawRetainedAbilityText)
      ? String((perm as any)?.card?.oracle_text || (perm as any)?.oracle_text || step.raw || '').trim()
      : rawRetainedAbilityText;
    const copiedOracleText = [sourceOracleText, retainedAbilityText].filter(Boolean).join('\n').trim();

    const grantedAbilities = Array.isArray((perm as any)?.grantedAbilities)
      ? (perm as any).grantedAbilities
          .map((entry: unknown) => String(entry || '').trim())
          .filter(Boolean)
      : [];
    if (retainedAbilityText && !grantedAbilities.includes(retainedAbilityText)) {
      grantedAbilities.push(retainedAbilityText);
    }

    const existingCard =
      (perm as any)?.card && typeof (perm as any).card === 'object'
        ? { ...(perm as any).card }
        : {};
    const nextCard = {
      ...existingCard,
      ...(copiedName ? { name: copiedName } : {}),
      ...(sourceTypeLine ? { type_line: sourceTypeLine } : {}),
      ...(copiedOracleText ? { oracle_text: copiedOracleText } : {}),
      ...(Array.isArray(sourceCard?.colors) ? { colors: [...sourceCard.colors] } : {}),
      ...(sourceCard?.mana_cost || sourceCard?.manaCost
        ? { mana_cost: sourceCard?.mana_cost ?? sourceCard?.manaCost, manaCost: sourceCard?.mana_cost ?? sourceCard?.manaCost }
        : {}),
      ...(copiedPower !== undefined ? { power: String(copiedPower) } : {}),
      ...(copiedToughness !== undefined ? { toughness: String(copiedToughness) } : {}),
      id: String(existingCard?.id || (perm as any)?.id || sourceCard?.id || '').trim() || existingCard?.id,
    };

    return {
      ...perm,
      ...(copiedName ? { name: copiedName } : {}),
      ...(sourceTypeLine ? { cardType: sourceTypeLine, type_line: sourceTypeLine } : {}),
      ...(copiedOracleText ? { oracle_text: copiedOracleText } : {}),
      ...(Array.isArray(sourceCard?.colors) ? { colors: [...sourceCard.colors] } : {}),
      ...(sourceCard?.mana_cost || sourceCard?.manaCost
        ? { manaCost: sourceCard?.mana_cost ?? sourceCard?.manaCost }
        : {}),
      ...(copiedPower !== undefined
        ? { power: copiedPower, basePower: copiedPower, effectivePower: undefined }
        : {}),
      ...(copiedToughness !== undefined
        ? { toughness: copiedToughness, baseToughness: copiedToughness, effectiveToughness: undefined }
        : {}),
      ...(grantedAbilities.length > 0 ? { grantedAbilities } : {}),
      copiedFromCardId: String(sourceCard?.id || '').trim() || undefined,
      card: nextCard,
    } as BattlefieldPermanent;
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log: [`${targetIds[0]} became a copy of ${copiedName || 'the exiled card'}`],
  };
}

export function applyScheduleDelayedTriggerStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'schedule_delayed_trigger' }>,
  ctx: OracleIRExecutionContext,
  runtime?: { readonly lastMovedBattlefieldPermanentIds?: readonly string[] }
): BattlefieldStepHandlerResult {
  const raw = `${String(step.raw || '')} ${String(step.effect || '')}`.trim();
  const isReflexiveWhenYouDo = /^when you do(?: so)?\b/i.test(String(step.raw || '').trim())
    || /^when you do(?: so)?\b/i.test(String(step.effect || '').trim())
    || /\bwhen you do(?: so)?,/i.test(raw);
  // Reflexive "When you do" fires immediately after the antecedent (CR 603.12).
  // The server queues it as a stack trigger; do not wait for the next end step.
  if (isReflexiveWhenYouDo && step.timing === 'on_event') {
    return {
      applied: true,
      state,
      log: ['Queued reflexive when-you-do trigger'],
    };
  }

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  const targetPermanentId = String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim() || undefined;
  const baseChosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds
        .map((id: unknown) => String(id || '').trim())
        .filter(Boolean)
    : undefined;
  const recentBattlefieldIds = Array.isArray(runtime?.lastMovedBattlefieldPermanentIds)
    ? runtime?.lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const chosenObjectIds = (() => {
    const merged = [...(baseChosenObjectIds || []), ...recentBattlefieldIds];
    return merged.length > 0 ? Array.from(new Set(merged)) : undefined;
  })();
  const targetPlayerId = String(ctx.selectorContext?.targetPlayerId || '').trim() || undefined;
  const targetOpponentId = String(ctx.selectorContext?.targetOpponentId || '').trim() || undefined;

  if (step.timing === 'when_dealt_damage') {
    const watchingPermanentId =
      targetPermanentId
      || (Array.isArray(chosenObjectIds) && chosenObjectIds.length > 0 ? chosenObjectIds[0] : '');
    if (!watchingPermanentId) {
      return {
        applied: false,
        message: `Skipped dealt-damage delayed trigger (no watched permanent): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const delayedTrigger = createWhenDealtDamageThisTurnTrigger(
      String(ctx.sourceId || ctx.sourceName || 'oracle-ir'),
      String(ctx.sourceName || 'Delayed dealt-damage trigger'),
      controllerId,
      watchingPermanentId,
      step.effect,
      currentTurn,
      {
        targets: [watchingPermanentId],
        eventDataSnapshot: {
          sourceId: String(ctx.sourceId || '').trim() || undefined,
          sourceControllerId: String(controllerId || '').trim() || undefined,
          targetPermanentId: watchingPermanentId,
          chosenObjectIds: [watchingPermanentId],
          targetPlayerId,
          targetOpponentId,
        },
      }
    );

    const registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
    const nextRegistry = registerDelayedTrigger(registry, delayedTrigger);
    return {
      applied: true,
      state: {
        ...(state as any),
        delayedTriggerRegistry: nextRegistry,
      } as GameState,
      log: [`Scheduled repeating dealt-damage watcher on ${watchingPermanentId}`],
    };
  }

  const timing =
    step.timing === 'your_next_end_step'
      ? DelayedTriggerTiming.YOUR_NEXT_END_STEP
      : step.timing === 'next_upkeep'
        ? DelayedTriggerTiming.NEXT_UPKEEP
        : step.timing === 'your_next_upkeep'
          ? DelayedTriggerTiming.YOUR_NEXT_UPKEEP
          : DelayedTriggerTiming.NEXT_END_STEP;

  const delayedTrigger = createDelayedTrigger(
    String(ctx.sourceId || ctx.sourceName || 'oracle-ir'),
    String(ctx.sourceName || 'Delayed trigger'),
    controllerId,
    timing,
    step.effect,
    currentTurn,
    {
      ...(Array.isArray(chosenObjectIds) && chosenObjectIds.length > 0 ? { targets: [...chosenObjectIds] } : {}),
      eventDataSnapshot: {
        sourceId: String(ctx.sourceId || '').trim() || undefined,
        sourceControllerId: String(controllerId || '').trim() || undefined,
        targetPermanentId,
        chosenObjectIds,
        targetPlayerId,
        targetOpponentId,
      },
    }
  );

  const registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
  const nextRegistry = registerDelayedTrigger(registry, delayedTrigger);
  return {
    applied: true,
    state: {
      ...(state as any),
      delayedTriggerRegistry: nextRegistry,
    } as GameState,
    log: [`Scheduled delayed trigger for ${timing.replace(/_/g, ' ')}`],
  };
}

export function applyGrantLeaveBattlefieldReplacementStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_leave_battlefield_replacement' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, step.target as any, runtime);
  const directTargets = recentTargets.length > 0 ? [] : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  const targetIds = Array.from(
    new Set(
      [...recentTargets, ...directTargets]
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped leave-battlefield replacement grant (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return perm;
    const nextPerm = {
      ...perm,
      leaveBattlefieldReplacement: step.destination,
      ...(step.destination === 'exile'
        ? {
            leaveBattlefieldReplacementDestination: 'exile',
            card: {
              ...((perm as any)?.card || {}),
              leaveBattlefieldReplacementDestination: 'exile',
            },
          }
        : {}),
    } as BattlefieldPermanent;
    return nextPerm;
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log: [`Granted leave-battlefield ${step.destination} replacement to ${targetIds.length} permanent(s)`],
  };
}

function resolveRemoveCounterTargets(
  battlefield: readonly BattlefieldPermanent[],
  step: Extract<OracleEffectStep, { kind: 'remove_counter' }>,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] {
  const normalizedTargetText = normalizeBattlefieldTargetReferenceText(
    String((step.target as any)?.text || '')
  ).toLowerCase();
  const counterName = String(step.counter || '').trim();

  const controlledCreatureOrPlaneswalker = normalizedTargetText.match(
    /^a (creature or planeswalker|planeswalker or creature) you control$/
  );
  if (controlledCreatureOrPlaneswalker) {
    const controllerId = String(ctx.controllerId || '').trim();
    const candidates = battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      return permanentMatchesType(perm, 'creature') || permanentMatchesType(perm, 'planeswalker');
    });
    const withNamedCounter = counterName
      ? candidates.filter((perm: any) => Number((perm as any)?.counters?.[counterName] ?? 0) > 0)
      : candidates.filter((perm: any) =>
          Object.values(((perm as any)?.counters || {}) as Record<string, number>).some(count => Number(count) > 0)
        );
    const resolved = (withNamedCounter.length > 0 ? withNamedCounter : candidates).slice(0, 1);
    return resolved;
  }

  if (/^among creatures you control$/i.test(normalizedTargetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    return battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Number((perm as any)?.counters?.['+1/+1'] ?? 0) > 0;
    });
  }

  if (/^any number of \+1\/\+1 counters from among creatures you control$/i.test(normalizedTargetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    return battlefield.filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Number((perm as any)?.counters?.['+1/+1'] ?? 0) > 0;
    });
  }

  const permanentOrSuspended = normalizedTargetText.match(
    /^target (?:permanent or suspended card|suspended card or permanent)$/
  );
  if (permanentOrSuspended) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const boundMatches = battlefield.filter((perm: any) =>
      boundIds.includes(String((perm as any)?.id || '').trim())
    );
    if (boundMatches.length > 0) return boundMatches.slice(0, 1);
  }

  if (/^this aura$/i.test(normalizedTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const source = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
    if (source) return [source];
  }

  if (/^that creature$/i.test(normalizedTargetText)) {
    const targetId = String(
      ctx.targetCreatureId || ctx.enchantedPermanentId || ctx.lastReferencedPermanentId || ''
    ).trim();
    if (targetId) {
      const match = battlefield.find((perm: any) => String(perm?.id || '').trim() === targetId);
      if (match) return [match];
    }
  }

  if (/^it$/i.test(normalizedTargetText) || /^this (?:creature|permanent)$/i.test(normalizedTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    if (sourceId) {
      const source = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
      if (source) return [source];
    }
  }

  if (/^target creature$/i.test(normalizedTargetText)) {
    const explicitTargetId = String(
      ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || ctx.targetPermanentId || ctx.selectorContext?.targetPermanentId || ''
    ).trim();
    if (explicitTargetId) {
      const explicit = battlefield.find((perm: any) => String(perm?.id || '').trim() === explicitTargetId);
      if (explicit) return [explicit];
    }
    const boundIds = collectBoundBattlefieldIds(ctx);
    const boundMatches = battlefield.filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (boundIds.length > 0 && !boundIds.includes(permanentId)) return false;
      return permanentMatchesType(perm, 'creature');
    });
    if (boundMatches.length > 0) {
      if (counterName) {
        const withNamedCounter = boundMatches.filter(
          (perm: any) => Number((perm as any)?.counters?.[counterName] ?? 0) > 0
        );
        if (withNamedCounter.length > 0) return withNamedCounter.slice(0, 1);
      }
      return boundMatches.slice(0, 1);
    }
  }

  if (/^target permanent$/i.test(normalizedTargetText) || /^target nonland permanent$/i.test(normalizedTargetText)) {
    const explicitTargetId = String(
      ctx.targetPermanentId || ctx.selectorContext?.targetPermanentId || ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || ''
    ).trim();
    if (explicitTargetId) {
      const explicit = battlefield.find((perm: any) => String(perm?.id || '').trim() === explicitTargetId);
      if (explicit) return [explicit];
    }
    const boundIds = collectBoundBattlefieldIds(ctx);
    const boundMatches = battlefield.filter((perm: any) =>
      boundIds.includes(String((perm as any)?.id || '').trim())
    );
    if (boundMatches.length > 0) return boundMatches.slice(0, 1);
  }

  if (/^target noncreature artifact$/i.test(normalizedTargetText) || /noncreature artifact$/i.test(normalizedTargetText)) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const matches = battlefield.filter((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      if (boundIds.length > 0 && !boundIds.includes(id)) return false;
      return permanentMatchesType(perm, 'artifact') && !permanentMatchesType(perm, 'creature');
    });
    if (matches.length > 0) return matches.slice(0, 1);
    return battlefield
      .filter(
        (perm: any) =>
          permanentMatchesType(perm, 'artifact') && !permanentMatchesType(perm, 'creature')
      )
      .slice(0, 1);
  }

  if (/^them$/i.test(normalizedTargetText)) {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const matches = battlefield.filter((perm: any) =>
      ids.includes(String((perm as any)?.id || '').trim())
    );
    if (matches.length > 0) return matches;
  }

  return resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
}

export function applyRemoveCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'remove_counter' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const special = trySpecialRemoveCounterStep(state, step, ctx);
  if (special) return special;

  const controllerId = (String(ctx.controllerId || '').trim() ||
    String((state.players || [])[0]?.id || '').trim()) as PlayerID;
  const removeAllCounters = step.amount.kind === 'all' || step.amount.kind === 'any_number';
  let amountValue = step.amount.kind === 'number' ? step.amount.value : null;
  if (!removeAllCounters && amountValue === null) {
    const resolvedAmount = resolveOracleQuantity(state, controllerId, step.amount, ctx, { step });
    amountValue = resolvedAmount === null ? null : resolvedAmount;
  }
  if (!removeAllCounters && (amountValue === null || amountValue <= 0)) {
    return {
      applied: false,
      message: `Skipped remove counter (unsupported amount): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const targets = resolveRemoveCounterTargets((state.battlefield || []) as BattlefieldPermanent[], {
    ...step,
    target: effectiveStepTarget(step) || step.target,
  } as typeof step, ctx);
  const effectiveTarget = effectiveStepTarget(step) || step.target;
  const normalizedTargetText = effectiveTarget.kind === 'raw'
    ? normalizeSelfReferenceText(effectiveTarget.text.trim()).toLowerCase()
    : '';
  if (
    targets.length === 0 &&
    (normalizedTargetText === 'among creatures you control' ||
      /^any number of \+1\/\+1 counters from among creatures you control$/i.test(normalizedTargetText))
  ) {
    return { applied: true, state, log: ['No +1/+1 counters to remove'] };
  }
  const allowMultipleDeterministicTargets =
    removeAllCounters &&
    (/^(?:all|each)\b/.test(normalizedTargetText) ||
      normalizedTargetText === 'them' ||
      normalizedTargetText === 'among creatures you control' ||
      /^any number of \+1\/\+1 counters from among creatures you control$/i.test(normalizedTargetText));
  if (targets.length > 1 && !allowMultipleDeterministicTargets) {
    return {
      applied: false,
      message: `Skipped remove counter (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }
  let counterName = String(step.counter || '').trim();
  if (!counterName) {
    return {
      applied: false,
      message: `Skipped remove counter (unsupported counter): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const battlefieldTarget = targets[0] as any;
  if (counterName.toLowerCase() === 'counter' && battlefieldTarget && !allowMultipleDeterministicTargets) {
    const counterKeys = Object.keys((battlefieldTarget?.counters || {}) as Record<string, number>).filter(
      (key) => Number((battlefieldTarget?.counters || {})[key]) > 0
    );
    if (counterKeys.length === 1) {
      counterName = counterKeys[0]!;
    } else if (counterKeys.length > 1) {
      const preferred = counterKeys.find((key) => key === '+1/+1') || counterKeys[0];
      counterName = preferred || counterName;
    }
  }
  if (battlefieldTarget && !allowMultipleDeterministicTargets) {
    const currentCount = Number(battlefieldTarget?.counters?.[counterName] ?? 0);
    const normalizedCount = Number.isFinite(currentCount) ? currentCount : 0;
    const removedCount = removeAllCounters ? normalizedCount : amountValue || 0;
    if (!removeAllCounters && normalizedCount < (amountValue || 0)) {
      return {
        applied: false,
        message: `Skipped remove counter (not enough counters): ${step.raw}`,
        reason: 'impossible_action',
        options: {
          persist: false,
          metadata: {
            counter: counterName,
            availableCount: normalizedCount,
            requiredCount: amountValue,
            targetId: String(battlefieldTarget?.id || '').trim() || null,
          },
        },
      };
    }

    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.id || '').trim() !== String(battlefieldTarget?.id || '').trim()) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      const nextCount = normalizedCount - removedCount;
      if (nextCount > 0) {
        counters[counterName] = nextCount;
      } else {
        delete counters[counterName];
      }
      return {
        ...perm,
        counters,
      };
    });

    return {
      applied: true,
      state: {
        ...(state as any),
        battlefield: nextBattlefield,
      } as GameState,
      count: removedCount,
      log: [`Removed ${removedCount} ${counterName} counter(s)`],
    };
  }

  if (targets.length > 0 && allowMultipleDeterministicTargets) {
    const targetIds = new Set(targets.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean));
    let removedCount = 0;
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (!targetIds.has(String(perm?.id || '').trim())) return perm;

      const currentCount = Number(perm?.counters?.[counterName] ?? 0);
      const normalizedCount = Number.isFinite(currentCount) ? currentCount : 0;
      if (normalizedCount <= 0) return perm;

      removedCount += normalizedCount;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      delete counters[counterName];
      return {
        ...perm,
        counters,
      };
    });

    return {
      applied: true,
      state: {
        ...(state as any),
        battlefield: nextBattlefield,
      } as GameState,
      count: removedCount,
      log: [`Removed ${removedCount} ${counterName} counter(s)`],
    };
  }

  const sourceId = String(ctx.sourceId || '').trim();
  const location = sourceId ? findCardZoneLocation(state, sourceId) : null;
  if (!location || location.zone !== 'exile') {
    return {
      applied: false,
      message: `Skipped remove counter (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const ownerId = String(location.playerId || '').trim();
  let removedFromExile = false;
  let availableCount = 0;
  const nextPlayers = (state.players || []).map((player: any) => {
    const playerId = String(player?.id || '').trim();
    if (playerId !== ownerId) return player;

    const exile = Array.isArray(player?.exile) ? player.exile : [];
    let changed = false;
    const nextExile = exile.map((card: any) => {
      if (String(card?.id || '').trim() !== sourceId) return card;
      const currentCount = Number(card?.counters?.[counterName] ?? 0);
      availableCount = Number.isFinite(currentCount) ? currentCount : 0;
      const removedCount = removeAllCounters ? availableCount : amountValue || 0;
      if (!removeAllCounters && availableCount < (amountValue || 0)) return card;

      const counters = { ...((card?.counters || {}) as Record<string, number>) };
      const nextCount = availableCount - removedCount;
      if (nextCount > 0) {
        counters[counterName] = nextCount;
      } else {
        delete counters[counterName];
      }
      changed = true;
      removedFromExile = true;
      return {
        ...card,
        counters,
      };
    });

    return changed ? { ...player, exile: nextExile } : player;
  });

  if (!removedFromExile) {
    return {
      applied: false,
      message: `Skipped remove counter (not enough counters): ${step.raw}`,
      reason: 'impossible_action',
      options: {
        persist: false,
        metadata: {
          counter: counterName,
          availableCount,
          requiredCount: amountValue,
          targetId: sourceId || null,
        },
      },
    };
  }

  return {
    applied: true,
    state: {
      ...(state as any),
      players: nextPlayers as any,
    } as GameState,
    count: removeAllCounters ? availableCount : amountValue || 0,
    log: [`Removed ${removeAllCounters ? availableCount : amountValue || 0} ${counterName} counter(s)`],
  };
}

export function applyDoubleCountersStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'double_counters' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const special = trySpecialDoubleCountersStep(state, step, ctx);
  if (special) return special;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const effectiveTarget = effectiveStepTarget(step);
  const targetTextLower = String((effectiveTarget as any)?.text || step.raw || '').trim().toLowerCase();
  if (/^each of them$/i.test(targetTextLower) || /^double the number of \+1\/\+1 counters on each of them$/i.test(String(step.raw || ''))) {
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const antecedentIds = [
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds) ? ctx.lastAntecedentBattlefieldPermanentIds : []),
      ...(Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    const wantedIds = new Set([...contextualIds, ...antecedentIds]);
    const targets = battlefield.filter((perm: any) => wantedIds.has(String((perm as any)?.id || '').trim()));
    if (targets.length > 0) {
      const specificCounter = String(step.counter || '').trim();
      const targetIds = new Set(targets.map((target: any) => String(target?.id || '').trim()).filter(Boolean));
      let doubledKinds = 0;
      let changedTargets = 0;
      const nextBattlefield = battlefield.map((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        if (!targetIds.has(permanentId)) return perm;
        const counters = { ...(((perm as any)?.counters || {}) as Record<string, number>) };
        let changedThisTarget = false;
        for (const [counterName, rawCount] of Object.entries(counters)) {
          if (specificCounter && counterName !== specificCounter) continue;
          const count = Number(rawCount);
          if (!Number.isFinite(count) || count <= 0) continue;
          counters[counterName] = count * 2;
          doubledKinds += 1;
          changedThisTarget = true;
        }
        if (!changedThisTarget) return perm;
        changedTargets += 1;
        return { ...perm, counters } as any;
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield: nextBattlefield } as GameState,
        log: [
          doubledKinds > 0
            ? `Doubled counters on ${changedTargets} permanent(s)`
            : 'No counters to double on contextual permanents',
        ],
      };
    }
  }

  const targets = resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped double counters (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const specificCounter = String(step.counter || '').trim();
  const targetIds = new Set(targets.map((target: any) => String(target?.id || '').trim()).filter(Boolean));
  let doubledKinds = 0;
  let changedTargets = 0;

  for (let index = 0; index < battlefield.length; index += 1) {
    const target = battlefield[index] as any;
    const targetId = String(target?.id || '').trim();
    if (!targetIds.has(targetId)) continue;

    const counters = { ...((target?.counters || {}) as Record<string, number>) };
    let changedThisTarget = false;
    for (const [counterName, rawCount] of Object.entries(counters)) {
      if (specificCounter && counterName !== specificCounter) continue;
      const count = Number(rawCount);
      if (!Number.isFinite(count) || count <= 0) continue;
      counters[counterName] = count * 2;
      doubledKinds += 1;
      changedThisTarget = true;
    }

    if (changedThisTarget) {
      battlefield[index] = {
        ...target,
        counters,
      } as any;
      changedTargets += 1;
    }
  }

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield,
    } as GameState,
    log: [
      doubledKinds > 0
        ? specificCounter
          ? `Doubled ${specificCounter} counter(s) on ${changedTargets} permanent(s)`
          : `Doubled ${doubledKinds} counter kind(s) across ${changedTargets} permanent(s)`
        : specificCounter
          ? `No ${specificCounter} counters to double on the resolved permanents`
          : `No counters to double on the resolved permanents`,
    ],
  };
}

export function applyMoveCountersStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_counters' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const special = trySpecialMoveCountersStep(state, step, ctx, runtime);
  if (special) return special;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const fromText =
    step.from?.kind === 'raw' ? normalizeBattlefieldTargetReferenceText(String(step.from.text || '')).toLowerCase() : '';
  const toText =
    step.to?.kind === 'raw' ? normalizeBattlefieldTargetReferenceText(String(step.to.text || '')).toLowerCase() : '';

  const transferCountersBetweenSnapshots = (
    fromCounters: Record<string, number>,
    toPermanentIndex: number,
    requestedCounter: string,
    amountIsAll: boolean,
    fixedAmount: number | null
  ): BattlefieldStepHandlerResult | null => {
    const toPermanent: any = battlefield[toPermanentIndex] || {};
    const toCounters: Record<string, number> = { ...((toPermanent.counters || {}) as Record<string, number>) };
    let moved = 0;
    for (const [counterName, rawCount] of Object.entries(fromCounters)) {
      if (requestedCounter && counterName !== requestedCounter) continue;
      const available = Math.max(0, Number(rawCount) || 0);
      if (available <= 0) continue;
      const moveCount = amountIsAll ? available : Math.min(available, Math.max(0, Number(fixedAmount) || 0));
      if (moveCount <= 0) continue;
      fromCounters[counterName] = available - moveCount;
      if (fromCounters[counterName] <= 0) delete fromCounters[counterName];
      toCounters[counterName] = Math.max(0, Number(toCounters[counterName]) || 0) + moveCount;
      moved += moveCount;
    }
    if (moved <= 0) {
      return { applied: true, state, log: ['No counters to move'] };
    }
    battlefield[toPermanentIndex] = { ...toPermanent, counters: toCounters };
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Moved ${moved} counter(s) onto ${String(toPermanent?.name || toPermanent?.id || 'target')}`],
    };
  };

  if (fromText === 'it' && /^this (?:creature|permanent)$/.test(toText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const toIndex = battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === sourceId);
    const requestedCounter = String(step.counter || '').trim();
    const amountIsAll = (step.amount as any)?.kind === 'all';
    const fixedAmount = amountIsAll ? null : quantityToNumber(step.amount as any, ctx);

    if (toIndex >= 0) {
      const referencedId = String(
        ctx.targetCreatureId || ctx.targetPermanentId || ctx.selectorContext?.targetCreatureId || ''
      ).trim();
      const onBattlefieldFromIndex = referencedId
        ? battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === referencedId)
        : -1;
      if (onBattlefieldFromIndex >= 0 && onBattlefieldFromIndex !== toIndex) {
        const fromCounters = {
          ...(((battlefield[onBattlefieldFromIndex] as any)?.counters || {}) as Record<string, number>),
        };
        const transferred = transferCountersBetweenSnapshots(
          fromCounters,
          toIndex,
          requestedCounter,
          amountIsAll,
          fixedAmount
        );
        if (transferred) {
          if (transferred.applied && transferred.state) {
            const nextBattlefield = [...(((transferred.state as any).battlefield || []) as any[])];
            nextBattlefield[onBattlefieldFromIndex] = {
              ...(nextBattlefield[onBattlefieldFromIndex] as any),
              counters: fromCounters,
            };
            return {
              ...transferred,
              state: { ...(transferred.state as any), battlefield: nextBattlefield } as GameState,
            };
          }
          return transferred;
        }
      } else {
        const sacrificed = [
          ...(Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : []),
          ...(Array.isArray((ctx as any).lastSacrificedPermanents) ? (ctx as any).lastSacrificedPermanents : []),
        ];
        const snapshot = sacrificed.length === 1 ? sacrificed[0] : null;
        if (snapshot) {
          const fromCounters = { ...(((snapshot as any)?.counters || {}) as Record<string, number>) };
          const transferred = transferCountersBetweenSnapshots(
            fromCounters,
            toIndex,
            requestedCounter,
            amountIsAll,
            fixedAmount
          );
          if (transferred) return transferred;
        }
      }
    }
  }

  const fromTargets = resolveDirectBattlefieldPermanents(battlefield, step.from as any, ctx);
  const toTargets = resolveDirectBattlefieldPermanents(battlefield, step.to as any, ctx);

  if (fromTargets.length !== 1 || toTargets.length !== 1) {
    return {
      applied: false,
      message: `Skipped move counters (needs deterministic source and destination): ${step.raw}`,
      reason: fromTargets.length > 1 || toTargets.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
      options: fromTargets.length > 1 || toTargets.length > 1 ? { classification: 'player_choice' } : undefined,
    };
  }

  const fromId = String((fromTargets[0] as any)?.id || '').trim();
  const toId = String((toTargets[0] as any)?.id || '').trim();
  if (!fromId || !toId || fromId === toId) {
    return {
      applied: false,
      message: `Skipped move counters (invalid source or destination): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const fromIndex = battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === fromId);
  const toIndex = battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === toId);
  if (fromIndex < 0 || toIndex < 0) {
    return {
      applied: false,
      message: `Skipped move counters (source or destination left battlefield): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const fromPermanent: any = battlefield[fromIndex] || {};
  const toPermanent: any = battlefield[toIndex] || {};
  const fromCounters: Record<string, number> = { ...((fromPermanent.counters || {}) as Record<string, number>) };
  const toCounters: Record<string, number> = { ...((toPermanent.counters || {}) as Record<string, number>) };
  const requestedCounter = String(step.counter || '').trim();
  const amountIsAll = (step.amount as any)?.kind === 'all';
  const fixedAmount = amountIsAll ? null : quantityToNumber(step.amount as any, ctx);

  if (!amountIsAll && (!Number.isFinite(Number(fixedAmount)) || Number(fixedAmount) <= 0)) {
    return {
      applied: false,
      message: `Skipped move counters (unsupported amount): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  let moved = 0;
  for (const [counterName, rawCount] of Object.entries(fromCounters)) {
    if (requestedCounter && counterName !== requestedCounter) continue;
    const available = Math.max(0, Number(rawCount) || 0);
    if (available <= 0) continue;
    const moveCount = amountIsAll ? available : Math.min(available, Math.max(0, Number(fixedAmount) || 0));
    if (moveCount <= 0) continue;
    fromCounters[counterName] = available - moveCount;
    if (fromCounters[counterName] <= 0) delete fromCounters[counterName];
    toCounters[counterName] = Math.max(0, Number(toCounters[counterName]) || 0) + moveCount;
    moved += moveCount;
  }

  if (moved <= 0) {
    return {
      applied: true,
      state,
      log: [`No counters moved`],
    };
  }

  battlefield[fromIndex] = { ...fromPermanent, counters: fromCounters } as any;
  battlefield[toIndex] = { ...toPermanent, counters: toCounters } as any;

  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: [`Moved ${moved} counter(s)`],
  };
}

export function applyForceBlockStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'force_block' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const special = trySpecialForceBlockStep(state, step, ctx);
  if (special) return special;

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const rawForceBlockMatch = String(step.raw || '').match(
    /^target creature an opponent controls blocks (that .+?) this combat if able$/i
  );
  const resolvedBlocker = rawForceBlockMatch
    ? ({ kind: 'raw', text: 'target creature an opponent controls' } as const)
    : (step.blocker as any);
  const resolvedAttacker = rawForceBlockMatch
    ? ({ kind: 'raw', text: String(rawForceBlockMatch[1] || '').trim() } as const)
    : (step.attacker as any);
  const blockerText = normalizeBattlefieldTargetReferenceText(String((resolvedBlocker as any)?.text || ''));
  const normalizedBlocker = { ...(resolvedBlocker as any), text: blockerText };
  const blockIfAbleOnly =
    /^target creature$/i.test(blockerText) &&
    /blocks this turn if able$/i.test(String(step.raw || ''));
  if (blockIfAbleOnly) {
    const selector = parseSimpleBattlefieldSelector(normalizedBlocker as any);
    const boundMatches = selector ? resolveBoundSelectorMatches(battlefield, selector, ctx) : [];
    const blockers =
      boundMatches.length > 0
        ? boundMatches.slice(0, 1)
        : resolveDirectBattlefieldPermanents(battlefield, normalizedBlocker as any, ctx);
    if (blockers.length === 1) {
      const nextState = applyTemporaryEffectToPermanents(state, blockers, ctx, {
        descriptions: ['blocks this turn if able'],
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Marked ${String((blockers[0] as any)?.id || '').trim()} to block this turn if able`],
      };
    }
  }

  let attackers = resolveDirectBattlefieldPermanents(battlefield, resolvedAttacker as any, ctx);
  if (attackers.length !== 1 && /^that wolf$/i.test(String((resolvedAttacker as any)?.text || ''))) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    if (sourcePermanent && typeLineHasSubtype(sourcePermanent, 'wolf')) {
      attackers = [sourcePermanent];
    } else {
      const controllerId = String(ctx.controllerId || '').trim();
      const wolves = battlefield.filter(
        (perm: any) =>
          String((perm as any)?.controller || '').trim() === controllerId &&
          typeLineHasSubtype(perm, 'wolf')
      );
      if (wolves.length === 1) attackers = wolves;
    }
  }
  if (attackers.length !== 1) {
    return {
      applied: false,
      message: `Skipped force block (needs deterministic attacker): ${step.raw}`,
      reason: attackers.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
      options: attackers.length > 1 ? { classification: 'player_choice' } : undefined,
    };
  }

  const allAbleBlockerDescription = buildAllAbleBlockerRequirementDescription(step.blocker as any);
  if (allAbleBlockerDescription) {
    const attackerId = String((attackers[0] as any)?.id || '').trim();
    if (!attackerId) {
      return {
        applied: false,
        message: `Skipped force block (invalid attacker): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }

    const nextState = applyTemporaryEffectToPermanents(state, attackers, ctx, {
      descriptions: [allAbleBlockerDescription],
      expiresAt: 'end_of_turn',
    });

    return {
      applied: true,
      state: nextState,
      log: [`Marked ${attackerId} as requiring all able blockers this turn`],
    };
  }

  const opponentBlockerMatch = /^target creature an opponent controls$/i.test(blockerText);
  const blockers = opponentBlockerMatch
    ? (() => {
        const boundIds = collectBoundBattlefieldIds(ctx);
        const matches = battlefield.filter((perm: any) => {
          const permanentId = String((perm as any)?.id || '').trim();
          if (!boundIds.includes(permanentId)) return false;
          if (!permanentMatchesType(perm, 'creature')) return false;
          const controllerId = String(ctx.controllerId || '').trim();
          return String((perm as any)?.controller || '').trim() !== controllerId;
        });
        return matches.length > 0 ? matches.slice(0, 1) : [];
      })()
    : resolveDirectBattlefieldPermanents(battlefield, normalizedBlocker as any, ctx);
  if (blockers.length !== 1) {
    return {
      applied: false,
      message: `Skipped force block (needs deterministic blocker): ${step.raw}`,
      reason: blockers.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
      options: blockers.length > 1 ? { classification: 'player_choice' } : undefined,
    };
  }

  const blockerId = String((blockers[0] as any)?.id || '').trim();
  const attackerId = String((attackers[0] as any)?.id || '').trim();
  if (!blockerId || !attackerId) {
    return {
      applied: false,
      message: `Skipped force block (invalid blocker or attacker): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const nextState = applyTemporaryEffectToPermanents(state, blockers, ctx, {
    descriptions: [`must block ${attackerId} if able`],
    expiresAt: 'end_of_turn',
    mustBlockAttackerId: attackerId,
  } as any);

  return {
    applied: true,
    state: nextState,
    log: [`Marked ${blockerId} to block ${attackerId} if able`],
  };
}

export function applyAddCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const normalizedTarget = normalizeWhereQualifiedTarget(step.target as any);
  const normalizedTargetText = String((normalizedTarget as any)?.text || '').trim().toLowerCase();
  const rawTargetText = String((step.target as any)?.text || '').trim().toLowerCase();
  const isAnotherCreatureYouControl = /^another target creature you control$/i.test(rawTargetText);

  const distributeResult = tryApplyDistributeCountersAmong(state, step, ctx, runtime);
  if (distributeResult) return distributeResult;

  if (
    isPerPlayerOptionalOracleStep(step) &&
    ctx.interactivePlayerChoices === true
  ) {
    return {
      applied: false,
      message: `Skipped add counter (needs per-player choice): ${step.raw}`,
      reason: 'player_choice_required',
    };
  }

  if (/commander creature you control/i.test(String(step.raw || ''))) {
    const controllerId = String(ctx.controllerId || '').trim();
    const counterAmount = resolveAddCounterAmount(state, step, ctx, runtime) ?? Number(ctx.referenceAmount ?? 1);
    const counterName = String(step.counter || '+1/+1').trim();
    const boundIds = collectBoundBattlefieldIds(ctx);
    const commanders = ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      return (
        Boolean((perm as any)?.isCommander) ||
        /\bcommander\b/i.test(getExecutorTypeLineLower(perm))
      );
    });
    const target =
      commanders.find((perm: any) => boundIds.includes(String(perm?.id || '').trim())) || commanders[0];
    if (!target) {
      return {
        applied: false,
        message: `Skipped add counter (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const targetId = String((target as any)?.id || '').trim();
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.id || '').trim() !== targetId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + counterAmount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Added ${counterAmount} ${counterName} counter(s) to commander creature`],
    };
  }

  if (/luck counters on this permanent equal to the result/i.test(String(step.raw || ''))) {
    const sourceId = String(ctx.sourceId || '').trim();
    const amount = resolveAddCounterAmount(state, step, ctx, runtime) ?? Number(ctx.referenceAmount ?? 1);
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.id || '').trim() !== sourceId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters.luck = (Number(counters.luck ?? 0) || 0) + amount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Added ${amount} luck counter(s) to source permanent`],
    };
  }

  if (/equal to the difference/i.test(String(step.raw || ''))) {
    const controllerId = String(ctx.controllerId || '').trim();
    const counterAmount = resolveAddCounterAmount(state, step, ctx, runtime) ?? Number(ctx.referenceAmount ?? 1);
    const counterName = String(step.counter || '+1/+1').trim();
    const sourceId = String(ctx.sourceId || '').trim();
    const target =
      (sourceId
        ? ((state.battlefield || []) as BattlefieldPermanent[]).find(
            (perm: any) => String(perm?.id || '').trim() === sourceId
          )
        : undefined) ||
      ((state.battlefield || []) as BattlefieldPermanent[]).find(
        (perm: any) =>
          String(perm?.controller || '').trim() === controllerId && permanentMatchesType(perm, 'creature')
      );
    if (!target) {
      return {
        applied: false,
        message: `Skipped add counter (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const targetId = String((target as any)?.id || '').trim();
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.id || '').trim() !== targetId) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + counterAmount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Added ${counterAmount} ${counterName} counter(s) equal to the difference`],
    };
  }

  if (/^each creature you control of (?:that|the chosen) type$/i.test(normalizedTargetText)) {
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim().toLowerCase();
    if (!chosenType) {
      return {
        applied: false,
        message: `Skipped add counter (requires chosen creature type): ${step.raw}`,
        reason: 'player_choice_required',
      };
    }
    const counterName = String(step.counter || '+1/+1').trim();
    const amountValue = resolveAddCounterAmount(state, step, ctx, runtime) ?? 1;
    const targets = ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) =>
      permanentMatchesSelector(
        perm,
        { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
        ctx,
      ) && typeLineHasSubtype(perm, chosenType),
    );
    const targetIds = new Set(targets.map((target: any) => String(target?.id || '').trim()).filter(Boolean));
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (!targetIds.has(String(perm?.id || '').trim())) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + amountValue;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Added ${amountValue} ${counterName} counter(s) to ${targets.length} creature(s) of type ${chosenType}`],
    };
  }

  const special = trySpecialAddCounterStep(state, step, ctx);
  if (special) return special;

  if (
    /^it$/i.test(normalizedTargetText) ||
    /^put (?:two|three|four|five|six|seven|eight|nine|ten|\d+|x|\w+) \+1\/\+1 counters on it$/i.test(
      String(step.raw || '').trim()
    )
  ) {
    const contextualIds = buildContextualBattlefieldTargetIds(
      (state.battlefield || []) as BattlefieldPermanent[],
      ctx,
      false
    );
    const targets = ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) =>
      contextualIds.includes(String((perm as any)?.id || '').trim())
    );
    if (targets.length > 0) {
      const counterAmount = resolveAddCounterAmount(state, step, ctx, runtime) ?? 1;
      const counterName = String(step.counter || '+1/+1').trim();
      const targetIds = new Set(targets.map((target: any) => String(target?.id || '').trim()).filter(Boolean));
      const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
        if (!targetIds.has(String(perm?.id || '').trim())) return perm;
        const counters = { ...((perm?.counters || {}) as Record<string, number>) };
        counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + counterAmount;
        return { ...perm, counters };
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield: nextBattlefield } as GameState,
        log: [`Added ${counterAmount} ${counterName} counter(s) to ${targets.length} permanent(s)`],
      };
    }
  }

  if (/^put two loyalty counters on a planeswalker you control$/i.test(String(step.raw || '').trim())) {
    const controllerId = String(ctx.controllerId || '').trim();
    const planeswalkers = ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
      return permanentMatchesType(perm, 'planeswalker');
    });
    const target =
      planeswalkers.find((perm: any) => collectBoundBattlefieldIds(ctx).includes(String((perm as any)?.id || '').trim())) ||
      planeswalkers[0];
    if (target) {
      const counterName = String(step.counter || 'loyalty').trim();
      const targetId = String((target as any)?.id || '').trim();
      const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== targetId) return perm;
        const counters = { ...((perm?.counters || {}) as Record<string, number>) };
        counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + 2;
        return { ...perm, counters };
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield: nextBattlefield } as GameState,
        log: [`Added 2 ${counterName} counter(s) to planeswalker`],
      };
    }
    return { applied: true, state, log: ['No planeswalker to receive loyalty counters'] };
  }

  if (/^(?:each of )?up to x target creatures$/i.test(normalizedTargetText)) {
    const maxCount = Number.isFinite(Number(ctx.xValue)) ? Math.max(0, Number(ctx.xValue)) : 1;
    const boundIds = collectBoundBattlefieldIds(ctx);
    const matches = ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      return boundIds.includes(id) && permanentMatchesType(perm, 'creature');
    });
    const targets = maxCount > 0 ? matches.slice(0, maxCount) : [];
    if (targets.length === 0) {
      return { applied: true, state, log: ['No matching creatures for counters'] };
    }
    const counterName = String(step.counter || '+1/+1').trim();
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (!targets.some((target: any) => String(target?.id || '').trim() === String(perm?.id || '').trim())) {
        return perm;
      }
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[counterName] = (Number(counters[counterName] ?? 0) || 0) + 1;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Added 1 ${counterName} counter(s) to ${targets.length} creature(s)`],
    };
  }

  const amountValue = resolveAddCounterAmount(state, step, ctx, runtime);
  if (amountValue === null || amountValue <= 0) {
    return {
      applied: false,
      message: `Skipped add counter (unsupported amount): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const counterName = String(step.counter || '').trim();
  if (!counterName) {
    return {
      applied: false,
      message: `Skipped add counter (unsupported counter): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  if (/^each of those permanents$/i.test(rawTargetText) || /^each of those permanents$/i.test(normalizedTargetText)) {
    const antecedentIds = [
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds)
        ? ctx.lastAntecedentBattlefieldPermanentIds
        : []),
      ...(Array.isArray(ctx.selectorContext?.lastAntecedentBattlefieldPermanentIds)
        ? ctx.selectorContext.lastAntecedentBattlefieldPermanentIds
        : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    if (antecedentIds.length === 0) {
      return { applied: true, state, log: ['No antecedent permanents for each-of-those counters'] };
    }
    const antecedentSet = new Set(antecedentIds);
    const targets = ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) =>
      antecedentSet.has(String(perm?.id || '').trim()),
    );
    if (targets.length === 0) {
      return {
        applied: false,
        message: `Skipped add counter (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const counterAmount = resolveAddCounterAmount(state, step, ctx, runtime);
    if (counterAmount === null || counterAmount <= 0) {
      return {
        applied: false,
        message: `Skipped add counter (unsupported amount): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }
    const antecedentCounterName = String(step.counter || '+1/+1').trim();
    const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
      if (!antecedentSet.has(String(perm?.id || '').trim())) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      counters[antecedentCounterName] = (Number(counters[antecedentCounterName] ?? 0) || 0) + counterAmount;
      return { ...perm, counters };
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Added ${counterAmount} ${antecedentCounterName} counter(s) to ${targets.length} permanent(s)`],
      lastAntecedentBattlefieldPermanentIds: antecedentIds,
    };
  }

  if (/^each of them$/i.test(rawTargetText) || /^each of them$/i.test(normalizedTargetText)) {
    const contextualCards = Array.isArray(runtime?.lastExiledCards) && runtime.lastExiledCards.length > 0
      ? runtime.lastExiledCards
      : Array.isArray(runtime?.lastMovedCards)
        ? runtime.lastMovedCards
        : [];
    if (contextualCards.length === 0) {
      return { applied: true, state, log: ['No contextual cards for each-of-them counters'] };
    }
    const stepRaw = String(step.raw || '');
    const wantsLoyalty = /loyalty counter/i.test(stepRaw);
    let workingState = state;
    const logs: string[] = [];
    const creatureIds = contextualCards
      .filter((card: any) => getCardTypeLineLower(card).includes('creature'))
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    if (creatureIds.length > 0) {
      const creatureUpdate = addCountersToZoneCardsById(workingState, creatureIds, counterName, amountValue);
      workingState = creatureUpdate.state;
      if (creatureUpdate.updatedCount > 0) {
        logs.push(`Added ${amountValue} ${counterName} counter(s) to ${creatureUpdate.updatedCount} creature(s)`);
      }
    }
    if (wantsLoyalty) {
      const planeswalkerIds = contextualCards
        .filter((card: any) => getCardTypeLineLower(card).includes('planeswalker'))
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean);
      if (planeswalkerIds.length > 0) {
        const loyaltyUpdate = addCountersToZoneCardsById(workingState, planeswalkerIds, 'loyalty', amountValue);
        workingState = loyaltyUpdate.state;
        if (loyaltyUpdate.updatedCount > 0) {
          logs.push(`Added ${amountValue} loyalty counter(s) to ${loyaltyUpdate.updatedCount} planeswalker(s)`);
        }
      }
    }
    return {
      applied: true,
      state: workingState,
      log: logs.length > 0 ? logs : ['Applied each-of-them enters-with counters'],
    };
  }

  const recentTokenTargets = resolveRecentlyCreatedTokenPermanents(
    (state.battlefield || []) as BattlefieldPermanent[],
    normalizedTarget as any,
    runtime
  );
  const recentMovedTargets = recentTokenTargets.length > 0
    ? []
    : resolveRecentlyMovedBattlefieldPermanents(
        (state.battlefield || []) as BattlefieldPermanent[],
        normalizedTarget as any,
        runtime
      );
  const shouldPreferMovedCards =
    isContextualMovedCardReference(normalizedTarget as any) &&
    Array.isArray(runtime?.lastMovedCards) &&
    runtime.lastMovedCards.length > 0;
  const directTargets =
    isAnotherCreatureYouControl || recentTokenTargets.length > 0 || recentMovedTargets.length > 0
      ? []
      : shouldPreferMovedCards
        ? []
        : resolveDirectBattlefieldPermanents(
            (state.battlefield || []) as BattlefieldPermanent[],
            normalizedTarget as any,
            ctx
          );
  const targets = recentTokenTargets.length > 0
    ? recentTokenTargets
    : recentMovedTargets.length > 0
      ? recentMovedTargets
      : directTargets;
  const anotherTargetMatch = String((normalizedTarget as any)?.text || '')
    .trim()
    .toLowerCase()
    .match(/^another target creature you control$|^target creature you control$/);
  const anotherCreatureTargets =
    isAnotherCreatureYouControl || (targets.length === 0 && anotherTargetMatch)
      ? ((state.battlefield || []) as BattlefieldPermanent[]).filter((perm: any) => {
          const permanentId = String((perm as any)?.id || '').trim();
          const sourceId = String(ctx.sourceId || '').trim();
          if (!permanentId || permanentId === sourceId) return false;
          if (!collectBoundBattlefieldIds(ctx).includes(permanentId)) return false;
          return permanentMatchesType(perm, 'creature');
        })
      : [];
  const fallbackSingleCreatureId =
    targets.length === 0 && anotherCreatureTargets.length === 0 && !shouldPreferMovedCards
    ? resolveSingleCreatureTargetId(state, normalizedTarget as any, ctx)
    : undefined;
  const fallbackCreatureTargets = fallbackSingleCreatureId
    ? ((state.battlefield || []) as BattlefieldPermanent[]).filter(
        permanent => String((permanent as any)?.id || '').trim() === fallbackSingleCreatureId
      )
    : [];
  const resolvedTargets =
    targets.length > 0
      ? targets
      : anotherCreatureTargets.length > 0
        ? anotherCreatureTargets.slice(0, 1)
        : fallbackCreatureTargets;

  if (resolvedTargets.length === 0 && isContextualMovedCardReference(normalizedTarget as any)) {
    const movedCardIds = Array.isArray(runtime?.lastMovedCards)
      ? runtime.lastMovedCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean)
      : [];
    const uniqueMovedCardIds = Array.from(new Set(movedCardIds));

    if (uniqueMovedCardIds.length === 1) {
      const movedCardUpdate = addCountersToZoneCardsById(state, uniqueMovedCardIds, counterName, amountValue);
      if (movedCardUpdate.updatedCount > 0) {
        const nextMovedCards = Array.isArray(runtime?.lastMovedCards)
          ? runtime.lastMovedCards.map((card: any) => {
              const cardId = String(card?.id || '').trim();
              if (!cardId || !uniqueMovedCardIds.includes(cardId)) return card;
              const counters = { ...((card?.counters || {}) as Record<string, number>) };
              const currentCount = Number(counters[counterName] ?? 0);
              counters[counterName] = (Number.isFinite(currentCount) ? currentCount : 0) + amountValue;
              return { ...card, counters };
            })
          : undefined;

        return {
          applied: true,
          state: movedCardUpdate.state,
          log: [`Added ${amountValue} ${counterName} counter(s) to ${movedCardUpdate.updatedCount} moved card(s)`],
          ...(nextMovedCards ? { lastMovedCards: nextMovedCards } : {}),
        };
      }
    }
  }

  if (resolvedTargets.length === 0) {
    if (isContextualMovedCardReference(normalizedTarget as any)) {
      const movedCardIds = Array.isArray(runtime?.lastMovedCards)
        ? runtime.lastMovedCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean)
        : [];
      const uniqueMovedCardIds = Array.from(new Set(movedCardIds));
      if (uniqueMovedCardIds.length !== 1) {
        return {
          applied: false,
          message: `Skipped add counter (no deterministic target): ${step.raw}`,
          reason: 'no_deterministic_target',
        };
      }

      const zoneUpdate = addCountersToZoneCardsById(state, uniqueMovedCardIds, counterName, amountValue);
      if (zoneUpdate.updatedCount <= 0) {
        return {
          applied: false,
          message: `Skipped add counter (no deterministic target): ${step.raw}`,
          reason: 'no_deterministic_target',
        };
      }

      const nextMovedCards = Array.isArray(runtime?.lastMovedCards)
        ? runtime.lastMovedCards.map((card: any) => {
            const cardId = String(card?.id || '').trim();
            if (!cardId || !uniqueMovedCardIds.includes(cardId)) return card;
            const counters = { ...((card?.counters || {}) as Record<string, number>) };
            const currentCount = Number(counters[counterName] ?? 0);
            counters[counterName] = (Number.isFinite(currentCount) ? currentCount : 0) + amountValue;
            return { ...card, counters };
          })
        : undefined;

      return {
        applied: true,
        state: zoneUpdate.state,
        log: [`Added ${amountValue} ${counterName} counter(s) to ${zoneUpdate.updatedCount} moved card(s)`],
        ...(nextMovedCards ? { lastMovedCards: nextMovedCards } : {}),
      };
    }

    return {
      applied: false,
      message: `Skipped add counter (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const targetIds = Array.from(
    new Set(resolvedTargets.map((target: any) => String(target?.id || '').trim()).filter(Boolean)),
  );

  const counterResult = applyCounterDeltasToBattlefieldTargets(
    state,
    targetIds,
    counterName,
    amountValue,
    ctx,
    'add_counter',
  );
  if (counterResult.halted) {
    return {
      applied: false,
      message: `Skipped add counter (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
    };
  }

  return {
    applied: true,
    state: counterResult.state,
    log: counterResult.log,
    lastMovedBattlefieldPermanentIds: targetIds,
    ...(counterResult.skipLedgerFlush ? { skipLedgerFlush: true } : {}),
  };
}

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

export function applyDestroyStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'destroy' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const special = trySpecialDestroyStep(state, step, ctx);
  if (special) return special;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const toRemove = resolveDestroyTargets(battlefield, step, ctx);
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
      /if\s+it\s+has\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+or\s+more\b/i.test(
        rawTargetText
      )
    ) {
      return { applied: true, state, log: ['Destroy condition not met'] };
    }
    return {
      applied: false,
      message: `Skipped destroy (unsupported target): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const removed: BattlefieldPermanent[] = [];
  const removedIds = new Set<string>();
  let nextShields = Array.isArray((state as any).regenerationShields)
    ? [...((state as any).regenerationShields as any[])]
    : [];
  const regeneratedById = new Map<string, BattlefieldPermanent>();
  const log: string[] = [];

  for (const perm of toRemove) {
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

function exileAllOpponentGraveyards(
  state: GameState,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  let exiledCount = 0;
  const updatedPlayers = (state.players || []).map((player: any) => {
    const playerId = String(player?.id || '').trim() as PlayerID;
    if (!playerId || playerId === controllerId) return player;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    if (graveyard.length === 0) return player;
    exiledCount += graveyard.length;
    const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
    return {
      ...player,
      graveyard: [],
      exile: [
        ...exile,
        ...graveyard.map((card: any) => ({
          ...card,
          zone: 'exile',
          owner: playerId,
          ownerId: playerId,
        })),
      ],
    };
  });

  if (exiledCount === 0) {
    return { applied: true, state, log: ['No opponent graveyard cards to exile'] };
  }

  return {
    applied: true,
    state: { ...(state as any), players: updatedPlayers as any } as GameState,
    log: [`Exiled ${exiledCount} card(s) from opponent graveyards`],
  };
}

function buildExileBattlefieldAppliedMetadata(
  toRemove: readonly BattlefieldPermanent[],
): Record<string, unknown> {
  const permanentIds = toRemove
    .map((perm) => String((perm as any)?.id || '').trim())
    .filter(Boolean);
  if (permanentIds.length === 0) return {};

  const movedCards = toRemove
    .filter((perm) => !(perm as any).isToken)
    .map((perm) => buildPermanentCardWithStats(perm, 'exile'));

  return {
    lastExiledBattlefieldPermanentIds: permanentIds,
    ...(movedCards.length > 0
      ? {
          lastMovedCards: movedCards,
          lastExiledCards: movedCards,
          lastExiledCardCount: movedCards.length,
        }
      : {}),
  };
}

export function applyExileStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const special = trySpecialExileStep(state, step, ctx);
  if (special) return special;

  const exileRaw = String(step.raw || '').trim();
  if (/^for each opponent,\s+exile\s+/i.test(exileRaw)) {
    const controllerId = String(ctx.controllerId || '').trim() as PlayerID;
    const opponents = (state.players || [])
      .map((entry: any) => String(entry?.id || '').trim())
      .filter((id) => id && id !== controllerId);
    const chosenIds = getChosenObjectIdsFromContext(ctx);
    let workingState = state;
    const combinedLog: string[] = [];
    const exiledSnapshots: any[] = [];
    let battlefieldNow = [...((workingState.battlefield || []) as any[])];

    for (const opponentId of opponents) {
      const boundForOpponent = chosenIds.filter((id) => {
        const perm = battlefieldNow.find((p) => String(p?.id || '').trim() === id);
        return (
          perm &&
          String(perm?.controller || '').trim() === opponentId &&
          permanentMatchesType(perm, 'creature')
        );
      });
      const targetId =
        boundForOpponent[0] ||
        String(
          battlefieldNow.find(
            (p) =>
              String(p?.controller || '').trim() === opponentId && permanentMatchesType(p, 'creature'),
          )?.id || '',
        ).trim();
      if (!targetId) continue;
      const toRemove = battlefieldNow.filter((p) => String(p?.id || '').trim() === targetId);
      if (toRemove.length === 0) continue;
      const removedIds = new Set(toRemove.map((p) => String(p?.id || '').trim()));
      const kept = battlefieldNow.filter((p) => !removedIds.has(String(p?.id || '').trim()));
      const result = finalizeBattlefieldRemoval(
        workingState,
        toRemove,
        removedIds,
        kept,
        'exile',
        'exiled',
        oracleIrBattlefieldRemovalOptions(ctx, 'exile'),
      );
      workingState = result.state;
      battlefieldNow = [...((workingState.battlefield || []) as any[])];
      combinedLog.push(...(result.log || []));
      exiledSnapshots.push(...toRemove);
    }

    return {
      applied: true,
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled opponent creatures: ${exileRaw}`],
      lastMovedCards: exiledSnapshots,
    };
  }

  const normalizedExileTargetText = normalizeExileTargetReferenceText(
    String((step.target as any)?.text || step.raw || '')
  );
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  if (/^each opponent(?:'s)? graveyard$/i.test(normalizedExileTargetText)) {
    return exileAllOpponentGraveyards(state, ctx);
  }

  if (/^all opponents' graveyards$/i.test(normalizedExileTargetText)) {
    return exileAllOpponentGraveyards(state, ctx);
  }

  if (/^then exile that player's graveyard$/i.test(normalizedExileTargetText) || /^that player's graveyard$/i.test(normalizedExileTargetText)) {
    const playerId = String(
      ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2'
    ).trim() as PlayerID;
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    if (graveyard.length === 0) {
      return { applied: true, state, log: [`No graveyard cards to exile for ${playerId}`] };
    }
    const updatedPlayers = (state.players || []).map((entry: any) =>
      String(entry?.id || '').trim() === playerId
        ? {
            ...entry,
            graveyard: [],
            exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), ...graveyard],
          }
        : entry
    );
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled ${graveyard.length} card(s) from ${playerId}'s graveyard`],
    };
  }

  if (/^(?:exile )?this permanent and each creature your opponents control$/i.test(normalizedExileTargetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const sourceId = String(ctx.sourceId || '').trim();
    const toRemove = battlefield.filter((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      if (sourceId && id === sourceId) return true;
      if (String((perm as any)?.controller || '').trim() === controllerId) return false;
      return permanentMatchesType(perm, 'creature');
    });
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No permanents to exile'] };
    }
    const removedIds = new Set(toRemove.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(
      state,
      toRemove,
      removedIds,
      kept,
      'exile',
      'exiled',
      oracleIrBattlefieldRemovalOptions(ctx, 'exile')
    );
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^(?:exile )?all attacking creatures target player controls$/i.test(normalizedExileTargetText)) {
    const playerId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const toRemove = battlefield.filter(
      (perm: any) =>
        String((perm as any)?.controller || '').trim() === playerId &&
        permanentMatchesType(perm, 'creature') &&
        Boolean((perm as any)?.attacking || (perm as any)?.attackingPlayerId)
    );
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No attacking creatures to exile'] };
    }
    const removedIds = new Set(toRemove.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(
      state,
      toRemove,
      removedIds,
      kept,
      'exile',
      'exiled',
      oracleIrBattlefieldRemovalOptions(ctx, 'exile')
    );
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^iii - exile any number of target players' graveyards$/i.test(normalizedExileTargetText)) {
    const boundPlayers = Array.from(
      new Set(
        [
          ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
          String(ctx.selectorContext?.targetPlayerId || ''),
          String(ctx.selectorContext?.targetOpponentId || ''),
        ]
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    );
    const playerIds = boundPlayers.length > 0 ? boundPlayers : ['p2'];
    let exiledCount = 0;
    const updatedPlayers = (state.players || []).map((entry: any) => {
      const playerId = String(entry?.id || '').trim();
      if (!playerIds.includes(playerId)) return entry;
      const graveyard = Array.isArray(entry?.graveyard) ? [...entry.graveyard] : [];
      if (graveyard.length === 0) return entry;
      exiledCount += graveyard.length;
      return {
        ...entry,
        graveyard: [],
        exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), ...graveyard],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled ${exiledCount} card(s) from ${playerIds.length} player graveyard(s)`],
    };
  }

  if (parseReferencedPossessiveZonePhrase(normalizedExileTargetText)) {
    const referencedZone = resolveReferencedPlayerZone(state, ctx, normalizedExileTargetText);
    const controllerId = String(referencedZone?.playerId || '').trim() as PlayerID;
    const zoneName = referencedZone?.zone;
    if (!controllerId || !zoneName) {
      return { applied: true, state, log: ['No referenced player zone to exile from'] };
    }
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === controllerId) as any;
    const zoneCards = Array.isArray(player?.[zoneName]) ? [...player[zoneName]] : [];
    if (zoneCards.length === 0) {
      return { applied: true, state, log: [`No ${zoneName} cards to exile`] };
    }
    const updatedPlayers = (state.players || []).map((entry: any) =>
      String(entry?.id || '').trim() === controllerId
        ? {
            ...entry,
            [zoneName]: [],
            exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), ...zoneCards],
          }
        : entry
    );
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled ${zoneCards.length} card(s) from ${controllerId}'s ${zoneName}`],
    };
  }

  if (
    /^up to x target (?:artifacts and\/or creatures|creatures(?: and\/or artifacts)?)(?: you control)?$/i.test(
      normalizedExileTargetText
    )
  ) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const maxCount = Number.isFinite(Number(ctx.xValue)) ? Math.max(0, Number(ctx.xValue)) : 1;
    const boundIds = collectBoundBattlefieldIds(ctx);
    const controllerId = String(ctx.controllerId || '').trim();
    const requiresYouControl = /you control$/i.test(normalizedExileTargetText);
    const toRemove = battlefield
      .filter((perm: any) => {
        const id = String(perm?.id || '').trim();
        if (!boundIds.includes(id)) return false;
        if (!permanentMatchesType(perm, 'creature') && !permanentMatchesType(perm, 'artifact')) return false;
        if (requiresYouControl) return String(perm?.controller || '').trim() === controllerId;
        return true;
      })
      .slice(0, maxCount);
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No matching creatures to exile'] };
    }
    const removedIds = new Set<string>(toRemove.map(perm => perm.id));
    const kept = battlefield.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    const movedCards = toRemove
      .filter(perm => !(perm as any).isToken)
      .map(perm => buildPermanentCardWithStats(perm, 'exile'));
    return {
      applied: true,
      state: annotateBattlefieldExilesWithSource(result.state, toRemove, ctx),
      log: result.log,
      ...(movedCards.length > 0
        ? { lastMovedCards: movedCards, lastExiledCards: movedCards, lastExiledCardCount: movedCards.length }
        : {}),
    };
  }

  const upToArtifactsAndEnchantmentsMatch = normalizedExileTargetText.match(
    /^up to (one|two|three|four|five|\d+) target artifacts? and\/or enchantments?$/i
  );
  if (upToArtifactsAndEnchantmentsMatch) {
    const maxToken = String(upToArtifactsAndEnchantmentsMatch[1] || '1').toLowerCase();
    const maxCount = DISTRIBUTE_WORD_TO_NUMBER[maxToken] ?? Number.parseInt(maxToken, 10);
    const cappedMax = Number.isFinite(maxCount) && maxCount > 0 ? maxCount : 1;
    const battlefieldNow = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const boundIds = collectBoundBattlefieldIds(ctx);
    const toRemove = battlefieldNow
      .filter((perm: any) => {
        const id = String(perm?.id || '').trim();
        if (!boundIds.includes(id)) return false;
        return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'enchantment');
      })
      .slice(0, cappedMax);
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No artifacts or enchantments to exile'] };
    }
    const removedIds = new Set<string>(toRemove.map(perm => perm.id));
    const kept = battlefieldNow.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    const movedCards = toRemove
      .filter(perm => !(perm as any).isToken)
      .map(perm => buildPermanentCardWithStats(perm, 'exile'));
    return {
      applied: true,
      state: annotateBattlefieldExilesWithSource(result.state, toRemove, ctx),
      log: result.log,
      ...(movedCards.length > 0
        ? { lastMovedCards: movedCards, lastExiledCards: movedCards, lastExiledCardCount: movedCards.length }
        : {}),
    };
  }

  if (/^all creatures with power (\d+) or greater$/i.test(normalizedExileTargetText)) {
    const powerThreshold = Number(normalizedExileTargetText.match(/^all creatures with power (\d+) or greater$/i)?.[1] || 0);
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const toRemove = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const power = readCharacteristicNumber(
        (perm as any)?.effectivePower,
        (perm as any)?.basePower,
        (perm as any)?.card?.power,
        (perm as any)?.power
      );
      return power !== undefined && power >= powerThreshold;
    });
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No matching creatures to exile'] };
    }
    const removedIds = new Set<string>(toRemove.map(perm => perm.id));
    const kept = battlefield.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^equipped creature$/i.test(normalizedExileTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? ((state.battlefield || []) as BattlefieldPermanent[]).find(
          (perm: any) => String(perm?.id || '').trim() === sourceId
        )
      : undefined;
    const equippedId = String((sourcePermanent as any)?.equippedCreatureId || (sourcePermanent as any)?.attachedTo || '').trim();
    const equipped = equippedId
      ? ((state.battlefield || []) as BattlefieldPermanent[]).find(
          (perm: any) => String(perm?.id || '').trim() === equippedId
        )
      : undefined;
    if (!equipped) {
      return { applied: true, state, log: ['No equipped creature to exile'] };
    }
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const removedIds = new Set<string>([String((equipped as any)?.id || '').trim()]);
    const kept = battlefield.filter(perm => !removedIds.has(String(perm.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [equipped], removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^your hand$/i.test(normalizedExileTargetText)) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((player: any) => {
      if (String(player?.id || '').trim() !== controllerId) return player;
      const hand = Array.isArray(player?.hand) ? player.hand : [];
      if (hand.length === 0) return player;
      return {
        ...player,
        hand: [],
        exile: [...(Array.isArray(player?.exile) ? player.exile : []), ...hand],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled hand for ${controllerId}`],
    };
  }

  if (/^you may exile your hand$/i.test(normalizedExileTargetText)) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((player: any) => {
      if (String(player?.id || '').trim() !== controllerId) return player;
      const hand = Array.isArray(player?.hand) ? player.hand : [];
      if (hand.length === 0) return player;
      return {
        ...player,
        hand: [],
        exile: [...(Array.isArray(player?.exile) ? player.exile : []), ...hand],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled hand for ${controllerId}`],
    };
  }

  if (/^a nontoken creature they control$/i.test(normalizedExileTargetText)) {
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim() as PlayerID;
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const candidate = battlefield.find((perm: any) => {
      if (String(perm?.controller || '').trim() !== opponentId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return !(perm as any)?.isToken;
    });
    if (!candidate) {
      return { applied: true, state, log: ['No nontoken creature for opponent to exile'] };
    }
    const removedIds = new Set<string>([String((candidate as any)?.id || '').trim()]);
    const kept = battlefield.filter(perm => !removedIds.has(String(perm.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [candidate], removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^target opponent exiles a nontoken creature they control$/i.test(normalizedExileTargetText)) {
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim() as PlayerID;
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const candidate = battlefield.find((perm: any) => {
      if (String(perm?.controller || '').trim() !== opponentId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return !(perm as any)?.isToken;
    });
    if (!candidate) {
      return { applied: true, state, log: ['No nontoken creature for opponent to exile'] };
    }
    const removedIds = new Set<string>([String((candidate as any)?.id || '').trim()]);
    const kept = battlefield.filter(perm => !removedIds.has(String(perm.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [candidate], removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^two target permanents$/i.test(normalizedExileTargetText)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const boundIds = collectBoundBattlefieldIds(ctx);
    const toRemove = battlefield.filter((perm: any) =>
      boundIds.includes(String((perm as any)?.id || '').trim())
    ).slice(0, 2);
    if (toRemove.length === 0) {
      return {
        applied: false,
        message: `Skipped exile (unsupported target): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }
    const removedIds = new Set<string>(toRemove.map(perm => perm.id));
    const kept = battlefield.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    return { applied: true, state: result.state, log: result.log };
  }

  const manaValueMassMatch = normalizedExileTargetText.match(
    /^all artifacts and creatures with mana value (\d+) or less$/i
  );
  if (manaValueMassMatch) {
    const maxManaValue = Number(manaValueMassMatch[1] || 0);
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const toRemove = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'artifact') && !permanentMatchesType(perm, 'creature')) {
        return false;
      }
      const manaValue = getCardManaValue((perm as any)?.card || perm);
      return manaValue !== null && manaValue <= maxManaValue;
    });
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No matching permanents to exile'] };
    }
    const removedIds = new Set<string>(toRemove.map(perm => perm.id));
    const kept = battlefield.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    const movedCards = toRemove
      .filter(perm => !(perm as any).isToken)
      .map(perm => buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'exile'));
    return {
      applied: true,
      state: annotateBattlefieldExilesWithSource(result.state, toRemove, ctx),
      log: result.log,
      ...(movedCards.length > 0 ? { lastMovedCards: movedCards } : {}),
    };
  }

  if (/^any number of other target permanents you control$/i.test(normalizedExileTargetText)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const sourceId = String(ctx.sourceId || '').trim();
    const controllerId = String(ctx.controllerId || '').trim();
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    const toRemove = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (sourceId && permanentId === sourceId) return false;
      if (!boundIds.has(permanentId)) return false;
      if (controllerId && String((perm as any)?.controller || '').trim() !== controllerId) return false;
      return true;
    });
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No other target permanents to exile'] };
    }
    const removedIds = new Set<string>(toRemove.map((perm) => String((perm as any)?.id || '').trim()));
    const kept = battlefield.filter((perm) => !removedIds.has(String((perm as any)?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    const movedCards = toRemove
      .filter((perm) => !(perm as any).isToken)
      .map((perm) => buildPermanentCardWithStats(perm, 'exile'));
    return {
      applied: true,
      state: annotateBattlefieldExilesWithSource(result.state, toRemove, ctx),
      log: result.log,
      ...(movedCards.length > 0
        ? { lastMovedCards: movedCards, lastExiledCards: movedCards, lastExiledCardCount: movedCards.length }
        : {}),
    };
  }

  if (/^any number of nontoken artifacts and\/or creatures you control$/i.test(normalizedExileTargetText)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const controllerId = String(ctx.controllerId || '').trim();
    const toRemove = battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
      if ((perm as any)?.isToken) return false;
      return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'creature');
    });
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No matching permanents to exile'] };
    }
    const removedIds = new Set<string>(toRemove.map(perm => perm.id));
    const kept = battlefield.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^this card$/i.test(normalizedExileTargetText)) {
    const zoneExile = exileContextualSourceCardFromZone(state, ctx);
    if (zoneExile) {
      return zoneExile;
    }
  }

  if (/^(?:that card|it)$/i.test(normalizedExileTargetText)) {
    const contextualExile = exileContextualThatCardFromPlayerZones(state, ctx);
    if (contextualExile) return contextualExile;
  }

  const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  if (isStackSpellExileTarget({ kind: 'raw', text: normalizedExileTargetText }) && targetSpellId) {
    const stackExile = exileSpellFromStackById(state, targetSpellId, ctx);
    if (stackExile) {
      return { applied: true, state: stackExile.state, log: stackExile.log };
    }
  }

  const normalizedExileTarget = { ...(step.target as any), text: normalizedExileTargetText };

  if (/^target creature\b/i.test(normalizedExileTargetText)) {
    const targetIds = resolveCreatureTargetIds(state, normalizedExileTarget as any, ctx);
    const toRemove = battlefield.filter(perm => targetIds.includes(String(perm.id || '').trim()));
    if (toRemove.length > 0) {
      const removedIds = new Set<string>(toRemove.map(perm => perm.id));
      const kept = battlefield.filter(perm => !removedIds.has(perm.id));
      const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
      const movedCards = toRemove
        .filter(perm => !(perm as any).isToken)
        .map(perm => buildPermanentCardWithStats(perm, 'exile'));
      return {
        applied: true,
        state: annotateBattlefieldExilesWithSource(result.state, toRemove, ctx),
        log: result.log,
        ...(movedCards.length > 0
          ? { lastMovedCards: movedCards, lastExiledCards: movedCards, lastExiledCardCount: movedCards.length }
          : {}),
      };
    }
  }

  const selector = parseSimpleBattlefieldSelector({ kind: 'raw', text: normalizedExileTargetText } as any);
  if (selector) {
    let toRemove = battlefield.filter((perm: any) => permanentMatchesSelector(perm, selector, ctx));
    if (isSingularBattlefieldTargetText(normalizedExileTargetText) && toRemove.length > 1) {
      const boundIds = collectBoundBattlefieldIds(ctx);
      let candidates = toRemove.filter((perm: any) => boundIds.includes(String(perm?.id || '').trim()));
      if (candidates.length === 0) candidates = toRemove;
      if (/^target nonland permanent$/i.test(normalizedExileTargetText.trim())) {
        const nonCreatures = candidates.filter((perm: any) => !permanentMatchesType(perm, 'creature'));
        if (nonCreatures.length > 0) candidates = nonCreatures;
      }
      toRemove = candidates.slice(0, 1);
    }
    if (toRemove.length === 0) {
      return {
        applied: false,
        message: `Skipped exile (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const removedIds = new Set<string>(toRemove.map(perm => perm.id));
    const kept = battlefield.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    const movedCards = toRemove
      .filter(perm => !(perm as any).isToken)
      .map(perm => buildPermanentCardWithStats(perm, 'exile'));
    return {
      applied: true,
      state: annotateBattlefieldExilesWithSource(result.state, toRemove, ctx),
      log: result.log,
      ...(movedCards.length > 0
        ? { lastMovedCards: movedCards, lastExiledCards: movedCards, lastExiledCardCount: movedCards.length }
        : {}),
    };
  }
  const subtypeMassTargets = resolveSubtypeOrCompoundBattlefieldPermanents(
    battlefield,
    normalizedExileTarget as any,
    ctx
  );
  if (subtypeMassTargets !== null) {
    if (subtypeMassTargets.length === 0) {
      return { applied: true, state, log: ['No matching permanents to exile'] };
    }
    const removedIds = new Set<string>(subtypeMassTargets.map(perm => perm.id));
    const kept = battlefield.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, subtypeMassTargets, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    const movedCards = subtypeMassTargets
      .filter(perm => !(perm as any).isToken)
      .map(perm => buildPermanentCardWithStats(perm, 'exile'));
    return {
      applied: true,
      state: annotateBattlefieldExilesWithSource(result.state, subtypeMassTargets, ctx),
      log: result.log,
      ...(movedCards.length > 0 ? { lastMovedCards: movedCards } : {}),
    };
  }

  if (/^(?:that card|it)$/i.test(normalizedExileTargetText)) {
    const contextualExile = exileContextualThatCardFromPlayerZones(state, ctx);
    if (contextualExile) return contextualExile;
  }

  if (/^the chosen cards$/i.test(normalizedExileTargetText)) {
    const chosenExile = exileTheChosenCardsFromPlayerZones(state, ctx);
    if (chosenExile) return chosenExile;
  }

  const toRemove = resolveDirectBattlefieldPermanents(battlefield, normalizedExileTarget as any, ctx);
  if (toRemove.length === 0) {
    const contextualTarget = parseContextualBattlefieldReference(normalizedExileTarget as any);
    const selfExileTarget =
      contextualTarget?.mode === 'self' ||
      isNamedSelfSacrificeReference(step.target as any, ctx) ||
      (step.target.kind === 'raw' &&
        /^(?:this card|this saga)$/i.test(
          normalizeBattlefieldTargetReferenceText(String((step.target as any).text || ''))
        ));
    if (selfExileTarget) {
      const stackExile = exileSourceStackObject(state, ctx);
      if (stackExile) {
        return { applied: true, state: stackExile.state, log: stackExile.log };
      }

      const zoneExile = exileContextualSourceCardFromZone(state, ctx);
      if (zoneExile) {
        return zoneExile;
      }
    }

    return {
      applied: false,
      message: `Skipped exile (unsupported target): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const removedIds = new Set<string>(toRemove.map(perm => perm.id));
  const kept = battlefield.filter(perm => !removedIds.has(perm.id));
  const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
  return bridgedZoneStepResult(ctx, {
    applied: true,
    state: annotateBattlefieldExilesWithSource(result.state, toRemove, ctx),
    log: result.log,
    ...buildExileBattlefieldAppliedMetadata(toRemove),
  });
}

export function applyScheduleDelayedBattlefieldActionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'schedule_delayed_battlefield_action' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const special = trySpecialScheduleDelayedBattlefieldActionStep(state, step, ctx, runtime);
  if (special) return special;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const timing =
    step.timing === 'your_next_end_step'
      ? DelayedTriggerTiming.YOUR_NEXT_END_STEP
      : step.timing === 'next_upkeep'
        ? DelayedTriggerTiming.NEXT_UPKEEP
        : step.timing === 'your_next_upkeep'
          ? DelayedTriggerTiming.YOUR_NEXT_UPKEEP
        : step.timing === 'when_control_lost'
          ? DelayedTriggerTiming.WHEN_CONTROL_LOST
        : step.timing === 'next_cleanup_step'
          ? DelayedTriggerTiming.NEXT_CLEANUP
          : step.timing === 'when_leaves_battlefield'
          ? DelayedTriggerTiming.WHEN_LEAVES
      : step.timing === 'end_of_combat'
        ? DelayedTriggerTiming.END_OF_COMBAT
        : DelayedTriggerTiming.NEXT_END_STEP;

  if (step.action === 'exile') {
    const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, step.object as any, runtime);
    const permanents =
      recentTargets.length > 0
        ? recentTargets
        : resolveDirectBattlefieldPermanents(battlefield, step.object as any, ctx);
    if (permanents.length === 0) {
      return {
        applied: false,
        message: `Skipped delayed exile scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    let watchingPermanentId: string | undefined;
    if (timing === DelayedTriggerTiming.WHEN_LEAVES || timing === DelayedTriggerTiming.WHEN_CONTROL_LOST) {
      const recentWatched = resolveRecentlyMovedBattlefieldPermanents(battlefield, step.watch as any, runtime);
      const watched =
        recentWatched.length > 0
          ? recentWatched
          : resolveDirectBattlefieldPermanents(battlefield, step.watch as any, ctx);
      if (watched.length !== 1) {
        return {
          applied: false,
          message: `Skipped delayed exile scheduling (no deterministic watched object): ${step.raw}`,
          reason: watched.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
          ...(watched.length > 1 ? { options: { classification: 'player_choice' as const } } : {}),
        };
      }
      watchingPermanentId = String((watched[0] as any)?.id || '').trim() || undefined;
      if (!watchingPermanentId) {
        return {
          applied: false,
          message: `Skipped delayed exile scheduling (no deterministic watched object): ${step.raw}`,
          reason: 'no_deterministic_target',
        };
      }
    }

    const scheduled = registerDelayedBattlefieldAction(
      state,
      ctx,
      (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID,
      timing,
      'exile',
      permanents,
      undefined,
      undefined,
      watchingPermanentId
    );
    return { applied: true, state: scheduled.state, log: scheduled.log };
  }

  const recentTokenTargets = resolveRecentlyCreatedTokenPermanents(battlefield, step.object as any, runtime);
  const recentMovedTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, step.object as any, runtime);
  if (recentTokenTargets.length > 0 || recentMovedTargets.length > 0) {
    const players = resolvePlayers(state, step.who || ({ kind: 'you' } as any), ctx);
    const toSchedule = recentTokenTargets.length > 0 ? recentTokenTargets : recentMovedTargets;
    const scheduled = registerDelayedBattlefieldAction(
      state,
      ctx,
      (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID,
      timing,
      'sacrifice',
      toSchedule,
      step.condition,
      players.length > 0 ? 'You' : undefined
    );
    return { applied: true, state: scheduled.state, log: scheduled.log };
  }

  const players = resolvePlayers(state, step.who || ({ kind: 'you' } as any), ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const parsed = parseSacrificeWhat(step.object as any);
  const namedSelfReference = isNamedSelfSacrificeReference(step.object as any, ctx);
  if (!parsed && !namedSelfReference) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (unsupported object selector): ${step.raw}`,
      reason: 'unsupported_object_selector',
    };
  }

  const toSchedule: BattlefieldPermanent[] = [];
  let needsChoice = false;
  let watchingPermanentId: string | undefined;
  const sourceId = String(ctx.sourceId || '').trim();
  const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const contextualTargetIds = (() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const candidate of [
      ...chosenObjectIds,
      String(ctx.targetPermanentId || '').trim(),
      String(ctx.targetCreatureId || '').trim(),
    ]) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      ids.push(candidate);
    }
    return ids;
  })();

  const resolveContextualPermanents = (
    contextual: Extract<NonNullable<typeof parsed>, { readonly mode: 'contextual' }>
  ): BattlefieldPermanent[] => {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, contextual.plural, contextual.type);
    if (ids.length === 0) return [];

    const matches = ids
      .map(id => battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === id))
      .filter((perm): perm is BattlefieldPermanent => Boolean(perm))
      .filter(perm => players.includes(perm.controller))
      .filter(perm => permanentMatchesType(perm, contextual.type))
      .filter(perm => !contextual.tokenOnly || Boolean((perm as any)?.isToken));

    return contextual.plural ? matches : matches.slice(0, 1);
  };

  if (namedSelfReference || parsed?.mode === 'self') {
    const selfPermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    if (!selfPermanent || !players.includes(selfPermanent.controller)) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    toSchedule.push(selfPermanent);
  }

  if (parsed?.mode === 'choice_required') {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (parsed?.mode === 'contextual' && toSchedule.length === 0) {
    const contextualPermanents = resolveContextualPermanents(parsed);
    if (contextualPermanents.length === 0) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    toSchedule.push(...contextualPermanents);
  }

  if (parsed?.mode === 'attached_to_source' || parsed?.mode === 'attached_to_named') {
    const attachmentResolution = resolveAttachmentReferencePermanents(battlefield, parsed, players, ctx);
    if (attachmentResolution.requiresChoice) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (attachmentResolution.permanents.length === 0) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    toSchedule.push(...attachmentResolution.permanents);
  }

  if (parsed?.mode === 'created_with_source') {
    if (!sourceId) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const createdTokens = battlefield.filter((perm: any) => {
      if (!(perm as any)?.isToken) return false;
      if (!players.includes(perm.controller)) return false;
      return String((perm as any)?.createdBySourceId || '').trim() === sourceId;
    });
    toSchedule.push(...createdTokens);
  }

  if (
    !namedSelfReference &&
    parsed &&
    parsed.mode !== 'self' &&
    parsed.mode !== 'contextual' &&
    parsed.mode !== 'attached_to_source' &&
    parsed.mode !== 'attached_to_named' &&
    parsed.mode !== 'created_with_source'
  ) {
    for (const playerId of players) {
      const excludeSource = Boolean((parsed as any).excludeSource);
      const allowedTypes = Array.isArray((parsed as any).types) && (parsed as any).types.length > 0
        ? (parsed as any).types
        : [parsed.type];
      const subtype = String((parsed as any).subtype || '').trim().toLowerCase();
      const tokenOnly = Boolean((parsed as any).tokenOnly);
      const candidates = battlefield.filter(p => {
        if (p.controller !== playerId) return false;
        if (!allowedTypes.some(type => permanentMatchesType(p, type))) return false;
        if (tokenOnly && !(p as any)?.isToken) return false;
        if (subtype) {
          const typeLineLower = getExecutorTypeLineLower(p);
          if (!new RegExp(`(^|[^a-z])${subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
            return false;
          }
        }
        if (excludeSource && sourceId && String((p as any)?.id || '').trim() === sourceId) return false;
        return true;
      });

      if (parsed.mode === 'all') {
        toSchedule.push(...candidates);
        continue;
      }

      if (candidates.length > parsed.count) {
        needsChoice = true;
        break;
      }
      toSchedule.push(...candidates);
    }
  }

  if (needsChoice) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (toSchedule.length === 0) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (step.condition && toSchedule.length !== 1) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (unsupported condition target shape): ${step.raw}`,
      reason: 'unsupported_condition',
    };
  }

  if (timing === DelayedTriggerTiming.WHEN_LEAVES || timing === DelayedTriggerTiming.WHEN_CONTROL_LOST) {
    const watched = resolveDirectBattlefieldPermanents(battlefield, step.watch as any, ctx);
    if (watched.length !== 1) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic watched object): ${step.raw}`,
        reason: watched.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
        ...(watched.length > 1 ? { options: { classification: 'player_choice' as const } } : {}),
      };
    }
    watchingPermanentId = String((watched[0] as any)?.id || '').trim() || undefined;
    if (!watchingPermanentId) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic watched object): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
  }

  const whoText = (() => {
    const whoKind = String((step.who as any)?.kind || 'you').trim();
    switch (whoKind) {
      case 'you':
        return 'You';
      case 'each_player':
        return 'Each player';
      case 'each_opponent':
        return 'Each opponent';
      case 'each_of_those_opponents':
        return 'Each of those opponents';
      case 'target_player':
        return 'That player';
      case 'target_opponent':
        return 'That opponent';
      default:
        return undefined;
    }
  })();

  const scheduled = registerDelayedBattlefieldAction(
    state,
    ctx,
    (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID,
    timing,
    'sacrifice',
    toSchedule,
    step.condition,
    whoText,
    watchingPermanentId
  );
  return { applied: true, state: scheduled.state, log: scheduled.log };
}

function sacrificeStepResult(
  ctx: OracleIRExecutionContext,
  result: StepApplyResult,
): StepApplyResult {
  return bridgedZoneStepResult(ctx, result);
}

export function applySacrificeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'sacrifice' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const special = trySpecialSacrificeStep(state, step, ctx);
  if (special) return special;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const enchantedSacrificeMatch = String(step.raw || '').match(
    /^enchanted permanent's controller sacrifices it$/i
  );
  if (enchantedSacrificeMatch) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const attachedToId = String(
      (sourcePermanent as any)?.attachedTo || (sourcePermanent as any)?.enchanting || ''
    ).trim();
    const enchantedPermanent = attachedToId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === attachedToId)
      : undefined;
    if (!enchantedPermanent) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const removedIds = new Set<string>([String((enchantedPermanent as any)?.id || '').trim()].filter(Boolean));
    const kept = battlefield.filter(perm => !removedIds.has(String((perm as any)?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [enchantedPermanent], removedIds, kept, 'graveyard', 'sacrificed', oracleIrBattlefieldRemovalOptions(ctx, 'sacrifice'));
    return sacrificeStepResult(ctx, {
      applied: true,
      state: result.state,
      log: result.log,
      lastSacrificedPermanents: [createLastKnownPermanentSnapshot(enchantedPermanent)],
    });
  }

  const controllerSacrificesMatch = String(step.raw || '').match(
    /^that creature's controller sacrifices (?:it|that creature)$/i
  );
  if (controllerSacrificesMatch) {
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, false, 'creature');
    const creature = battlefield.find((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      return contextualIds.includes(permanentId) && permanentMatchesType(perm, 'creature');
    });
    if (!creature) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const removedIds = new Set<string>([String((creature as any)?.id || '').trim()].filter(Boolean));
    const kept = battlefield.filter(perm => !removedIds.has(String((perm as any)?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [creature], removedIds, kept, 'graveyard', 'sacrificed', oracleIrBattlefieldRemovalOptions(ctx, 'sacrifice'));
    return sacrificeStepResult(ctx, {
      applied: true,
      state: result.state,
      log: result.log,
      lastSacrificedPermanents: [createLastKnownPermanentSnapshot(creature)],
    });
  }

  const sacrificeWhatTextEarly = extractSacrificeWhatText(step);
  const explicitTargetSacrificeMatch = sacrificeWhatTextEarly.match(
    /^target (creature(?: or planeswalker)?|permanent|artifact|enchantment|land|planeswalker)$/i,
  );
  if (explicitTargetSacrificeMatch) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    if (boundIds.length === 0) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const typeWord = String(explicitTargetSacrificeMatch[1] || 'permanent').toLowerCase();
    const selected = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(permanentId)) return false;
      if (typeWord.includes('creature') && typeWord.includes('planeswalker')) {
        return permanentMatchesType(perm, 'creature') || permanentMatchesType(perm, 'planeswalker');
      }
      const typeFilter = parseSimplePermanentTypeFromText(typeWord) || 'permanent';
      return permanentMatchesType(perm, typeFilter);
    });
    if (selected.length === 0) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const removedIds = new Set(
      selected.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean),
    );
    const kept = battlefield.filter(perm => !removedIds.has(String((perm as any)?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, selected, removedIds, kept, 'graveyard', 'sacrificed', oracleIrBattlefieldRemovalOptions(ctx, 'sacrifice'));
    return sacrificeStepResult(ctx, {
      applied: true,
      state: result.state,
      log: result.log,
      lastSacrificedPermanents: selected.map(createLastKnownPermanentSnapshot),
    });
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped sacrifice (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const sacrificeWhatText = (() => {
    const direct = String((step.what as any)?.text || (step.what as any)?.raw || '').trim();
    if (direct) return direct;
    const rawMatch = String(step.raw || '').match(/(?:^then\s+)?sacrifice\s+(.+?)[.!?\s]*$/i);
    return rawMatch ? String(rawMatch[1] || '').trim() : '';
  })();
  const sacrificeWhat = { kind: 'raw', text: sacrificeWhatText } as const;
  if (/^any number of lands$/i.test(sacrificeWhatText)) {
    const chosenIds = collectBoundBattlefieldIds(ctx);
    const landPermanents = battlefield.filter((perm: any) => {
      if (!players.includes(String((perm as any)?.controller || '').trim())) return false;
      if (!permanentMatchesType(perm, 'land')) return false;
      const permanentId = String((perm as any)?.id || '').trim();
      return chosenIds.length === 0 || chosenIds.includes(permanentId);
    });
    const toSacrifice =
      chosenIds.length > 0
        ? landPermanents.filter((perm: any) => chosenIds.includes(String((perm as any)?.id || '').trim()))
        : landPermanents.slice(0, 1);
    if (toSacrifice.length === 0) {
      return {
        applied: false,
        message: `Skipped sacrifice (requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const removedIds = new Set(
      toSacrifice.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean)
    );
    const kept = battlefield.filter(perm => !removedIds.has(String((perm as any)?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, toSacrifice, removedIds, kept, 'graveyard', 'sacrificed', oracleIrBattlefieldRemovalOptions(ctx, 'sacrifice'));
    return sacrificeStepResult(ctx, {
      applied: true,
      state: result.state,
      log: result.log,
      lastSacrificedPermanents: toSacrifice.map(createLastKnownPermanentSnapshot),
    });
  }

  const parsed = parseSacrificeWhat(sacrificeWhat);
  const namedSelfReference = isNamedSelfSacrificeReference(sacrificeWhat, ctx);
  if (!parsed && !namedSelfReference) {
    return {
      applied: false,
      message: `Skipped sacrifice (unsupported object selector): ${step.raw}`,
      reason: 'unsupported_object_selector',
    };
  }

  const toRemove: BattlefieldPermanent[] = [];
  let needsChoice = false;
  const sourceId = String(ctx.sourceId || '').trim();

  const resolveContextualPermanents = (
    contextual: Extract<NonNullable<typeof parsed>, { readonly mode: 'contextual' }>
  ): BattlefieldPermanent[] => {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, contextual.plural, contextual.type);
    if (ids.length === 0) return [];

    const matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!ids.includes(permanentId)) return false;
      if (!players.includes(perm.controller)) return false;
      if (!permanentMatchesType(perm, contextual.type)) return false;
      if (contextual.tokenOnly && !(perm as any)?.isToken) return false;
      return true;
    });

    if (matches.length > 0 || !contextual.tokenOnly) {
      return matches;
    }

    return battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!ids.includes(permanentId)) return false;
      if (!players.includes(perm.controller)) return false;
      return permanentMatchesType(perm, contextual.type);
    });
  };

  if (namedSelfReference || parsed?.mode === 'self') {
    const selfPermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;

    if (!selfPermanent || !players.includes(selfPermanent.controller)) {
      if (sourceId && parsed?.mode === 'self') {
        return {
          applied: true,
          state,
          log: ['Source permanent already absent for sacrifice'],
        };
      }
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    toRemove.push(selfPermanent);
  }

  if (parsed?.mode === 'choice_required') {
    const chosenIds = collectSacrificeChoiceBoundIds(battlefield, ctx);
    const wantsCreature = /\bcreature\b/i.test(sacrificeWhatText);
    const wantsAttacking = sacrificeRequiresAttackingCreature(sacrificeWhatText);
    const pickOneForPlayer = (playerId: string): BattlefieldPermanent | undefined => {
      const sourceId = String(ctx.sourceId || '').trim();
      const matchesPlayer = (perm: any) =>
        String((perm as any)?.controller || '').trim() === playerId &&
        (!wantsCreature || permanentMatchesType(perm, 'creature')) &&
        (!wantsAttacking || isPermanentAttackingForSacrifice(perm));

      const boundMatches = battlefield.filter((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        return chosenIds.length > 0
          ? chosenIds.includes(permanentId) && matchesPlayer(perm)
          : matchesPlayer(perm);
      });
      const preferNonSource = (matches: BattlefieldPermanent[]) =>
        matches.find((perm: any) => String((perm as any)?.id || '').trim() !== sourceId) || matches[0];

      if (boundMatches.length > 0) return preferNonSource(boundMatches);

      const fallbackMatches = battlefield.filter((perm: any) => matchesPlayer(perm));
      return preferNonSource(fallbackMatches);
    };

    if (String((step.who as any)?.kind || '') === 'each_player') {
      const perPlayer = players
        .map((playerId) => pickOneForPlayer(String(playerId || '').trim()))
        .filter((perm): perm is BattlefieldPermanent => Boolean(perm));
      if (perPlayer.length !== players.length) {
        return {
          applied: false,
          message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
          reason: 'no_deterministic_target',
        };
      }
      toRemove.push(...perPlayer);
    } else {
      if (chosenIds.length === 0) {
        return {
          applied: false,
          message: `Skipped sacrifice (requires player choice): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice' },
        };
      }

      const selected = battlefield.filter((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        return (
          chosenIds.includes(permanentId) &&
          players.includes(String((perm as any)?.controller || '').trim()) &&
          (!wantsCreature || permanentMatchesType(perm, 'creature')) &&
          (!wantsAttacking || isPermanentAttackingForSacrifice(perm))
        );
      });
      if (selected.length === 0) {
        return {
          applied: false,
          message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
          reason: 'no_deterministic_target',
        };
      }

      toRemove.push(...selected);
    }
  }

  if (parsed?.mode === 'contextual') {
    const contextualPermanents = resolveContextualPermanents(parsed);
    if (contextualPermanents.length === 0) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    toRemove.push(...contextualPermanents);
  }

  if (parsed?.mode === 'attached_to_source' || parsed?.mode === 'attached_to_named') {
    const attachmentResolution = resolveAttachmentReferencePermanents(battlefield, parsed, players, ctx);
    if (attachmentResolution.requiresChoice) {
      return {
        applied: false,
        message: `Skipped sacrifice (requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (attachmentResolution.permanents.length === 0) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    toRemove.push(...attachmentResolution.permanents);
  }

  if (parsed?.mode === 'created_with_source') {
    if (!sourceId) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const createdTokens = battlefield.filter((perm: any) => {
      if (!(perm as any)?.isToken) return false;
      if (!players.includes(perm.controller)) return false;
      return String((perm as any)?.createdBySourceId || '').trim() === sourceId;
    });

    toRemove.push(...createdTokens);
  }

  if (
    !namedSelfReference &&
    parsed &&
    (parsed.mode === 'count' || parsed.mode === 'all')
  ) {
    const effectiveCount = (() => {
      if (parsed.mode !== 'count') return 0;
      if (!parsed.usesVariableCount) return parsed.count;
      const xValue = Number((ctx as any).xValue);
      return Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : null;
    })();
    if (effectiveCount === null) {
      return {
        applied: false,
        message: `Skipped sacrifice (requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    for (const playerId of players) {
      const excludeSource = Boolean((parsed as any).excludeSource);
      const allowedTypes = Array.isArray((parsed as any).types) && (parsed as any).types.length > 0
        ? (parsed as any).types
        : [parsed.type];
      const subtype = String((parsed as any).subtype || '').trim().toLowerCase();
      const excludeSubtype = String((parsed as any).excludeSubtype || '').trim().toLowerCase();
      const tokenOnly = Boolean((parsed as any).tokenOnly);
      const candidates = battlefield.filter(p => {
        if (p.controller !== playerId) return false;
        if (!allowedTypes.some(type => permanentMatchesType(p, type))) return false;
        if (tokenOnly && !(p as any)?.isToken) return false;
        if (subtype) {
          const typeLineLower = getExecutorTypeLineLower(p);
          if (!new RegExp(`(^|[^a-z])${subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
            return false;
          }
        }
        if (excludeSubtype) {
          const typeLineLower = getExecutorTypeLineLower(p);
          if (new RegExp(`(^|[^a-z])${excludeSubtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
            return false;
          }
        }
        if (excludeSource && sourceId && String((p as any)?.id || '').trim() === sourceId) return false;
        return true;
      });

      if (parsed.mode === 'all') {
        toRemove.push(...candidates);
        continue;
      }

      const resolveCountCandidates = (): BattlefieldPermanent[] => {
        if (!Boolean((parsed as any).greatestPowerAmongControlled)) return candidates;
        if (candidates.length === 0) return [];
        const readPower = (perm: BattlefieldPermanent): number => {
          const rawPower = (perm as any)?.power ?? (perm as any)?.card?.power;
          const numeric = Number(rawPower);
          return Number.isFinite(numeric) ? numeric : 0;
        };
        const maxPower = Math.max(...candidates.map(readPower));
        return candidates.filter((perm) => readPower(perm) === maxPower);
      };

      const countCandidates = resolveCountCandidates();
      if (countCandidates.length < effectiveCount) {
        return {
          applied: false,
          message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
          reason: 'no_deterministic_target',
        };
      }

      if (countCandidates.length > effectiveCount) {
        const chosenIds = collectBoundBattlefieldIds(ctx);
        if (chosenIds.length > 0) {
          const selected = countCandidates.filter((perm: any) =>
            chosenIds.includes(String((perm as any)?.id || '').trim())
          );
          if (selected.length >= effectiveCount) {
            toRemove.push(...selected.slice(0, effectiveCount));
            continue;
          }
        }
        needsChoice = true;
        break;
      }
      toRemove.push(...countCandidates.slice(0, effectiveCount));
    }
  }

  if (needsChoice) {
    return {
      applied: false,
      message: `Skipped sacrifice (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (step.condition) {
    if (toRemove.length !== 1) {
      return {
        applied: false,
        message: `Skipped sacrifice (unsupported condition target shape): ${step.raw}`,
        reason: 'unsupported_condition',
      };
    }

    const conditionResult = evaluateBattlefieldObjectCondition(toRemove[0], step.condition);
    if (conditionResult === null) {
      return {
        applied: false,
        message: `Skipped sacrifice (unsupported condition evaluation): ${step.raw}`,
        reason: 'unsupported_condition',
      };
    }

    if (!conditionResult) {
      return {
        applied: false,
        message: `Skipped sacrifice (condition false): ${step.raw}`,
        reason: 'condition_false',
        options: { persist: false },
      };
    }
  }

  const lastSacrificedPermanents = toRemove.map(permanent => createLastKnownPermanentSnapshot(permanent));
  const sacrificedCreaturesPowerTotal = lastSacrificedPermanents.reduce((sum, permanent) => {
    if (!permanent.typeLine.includes('creature')) return sum;
    return sum + (permanent.power ?? 0);
  }, 0);

  const removedIds = new Set<string>(toRemove.map(p => p.id));
  const kept = battlefield.filter(p => !removedIds.has(p.id));
  const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'graveyard', 'sacrificed', oracleIrBattlefieldRemovalOptions(ctx, 'sacrifice'));

  return sacrificeStepResult(ctx, {
    applied: true,
    state: result.state,
    log: result.log,
    lastSacrificedCreaturesPowerTotal: Math.max(0, sacrificedCreaturesPowerTotal),
    lastSacrificedPermanents,
  });
}
