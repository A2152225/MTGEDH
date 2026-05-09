import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import { buildZoneObjectWithRetainedCounters } from '../../shared/src/zoneRetainedCounters';
import type { OracleBattlefieldObjectCondition, OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { parseSimpleBattlefieldSelector, parseSimplePermanentTypeFromText } from './oracleIRExecutorBattlefieldParser';
import { parseQuantity } from './oracleIRParserUtils';
import {
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
} from './oracleIRExecutorBattlefieldOps';
import {
  createRegenerationShield,
  getAvailableShields,
  processDestructionWithRegeneration,
} from './keywordAbilities/regeneration';
import {
  DelayedTriggerTiming,
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  registerDelayedTrigger,
} from './delayedTriggeredAbilities';
import { createLastKnownPermanentSnapshot, type LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import {
  resolveBolsterTargetCreatureIdFromBattlefield,
  getProcessedBattlefield,
  resolveMentorTargetCreatureIdFromBattlefield,
  resolveSingleCreatureTargetId,
} from './oracleIRExecutorCreatureStepUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { getCardManaValue, getCardTypeLineLower, quantityToNumber, resolvePlayers } from './oracleIRExecutorPlayerUtils';
import { canTargetPermanent } from './permanentTargeting';
import { EARTHBENDED_PROPERTIES } from './keywordActions/earthbend';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly count?: number;
  readonly lastSacrificedCreaturesPowerTotal?: number;
  readonly lastSacrificedPermanents?: readonly LastKnownPermanentSnapshot[];
  readonly lastMovedCards?: readonly any[];
  readonly lastTappedMatchingPermanentCount?: number;
  readonly lastTappedMatchingPermanentIds?: readonly string[];
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
    readonly classification?: 'player_choice';
    readonly persist?: boolean;
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
  };
};

export type BattlefieldStepHandlerResult = StepApplyResult | StepSkipResult;

type RecentBattlefieldRuntime = {
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
  readonly lastCreatedTokenIds?: readonly string[];
  readonly lastMovedCards?: readonly any[];
  readonly lastDiscardedCards?: readonly any[];
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

function normalizeWhereQualifiedTarget(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined
): { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined {
  if (!target || target.kind !== 'raw') return target;
  const rawText = String((target as any).text || '').trim();
  if (!rawText) return target;
  const normalizedText = rawText.replace(/\s*,\s*where\s+x\s+is\s+.+$/i, '').trim();
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

function exileContextualSourceCardFromZone(
  state: GameState,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult | null {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return null;

  const location = findCardZoneLocation(state, sourceId);
  if (!location) return null;

  const result =
    location.zone === 'graveyard'
      ? moveTargetedCardFromGraveyard(state, location.playerId, sourceId, { cardType: 'any' }, 'exile')
      : location.zone === 'hand'
        ? moveTargetedCardFromHand(state, location.playerId, sourceId, 'any', 'exile')
        : null;

  if (!result || result.kind === 'impossible') return null;
  return { applied: true, state: result.state, log: result.log };
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

function parseSacrificeWhat(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
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
      readonly tokenOnly?: boolean;
      readonly excludeSource?: boolean;
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

  if (/^(?:that creature|the creature)$/i.test(normalized)) {
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

  const parsedCount = parseQuantity(countRaw);
  if (parsedCount.kind === 'x') return { mode: 'choice_required' };
  if (parsedCount.kind !== 'number') return null;
  const count = parsedCount.value;
  if (!Number.isFinite(count) || count <= 0) return null;

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
    return { mode: 'count', count: Math.max(1, count | 0), type: 'permanent', subtype: normalizeSubtypeWord(rest) };
  }

  return null;
}

function normalizeSelfReferenceText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

function parseContextualBattlefieldReference(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string }
): ContextualBattlefieldReference | null {
  if (target.kind !== 'raw') return null;
  const raw = String((target as any).text || '').trim();
  if (!raw) return null;

  const normalized = raw.replace(/[.\s]+$/g, '').replace(/\u2019/g, "'").trim();

  if (
    /^(?:it|this creature|this artifact|this enchantment|this aura|this land|this planeswalker|this battle|this vehicle|this permanent|this token)$/i.test(
      normalized
    )
  ) {
    return { mode: 'self' };
  }

  if (/^(?:that creature|the creature)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'creature' };
  }

  if (/^(?:that vehicle|the vehicle)$/i.test(normalized)) {
    return { mode: 'contextual', type: 'vehicle' };
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
    return {
      mode: 'contextual',
      type: 'permanent',
      tokenOnly: /^those tokens$/i.test(normalized),
      plural: true,
    };
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
    const rawText = String((target as any).text || '').replace(/\u2019/g, "'").trim();
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
    if (!sourceId) return [];
    const selfPermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId);
    return selfPermanent ? [selfPermanent] : [];
  }

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
    return parsed.plural ? ids : ids.slice(0, 1);
  })();

  if (contextualTargetIds.length === 0) return [];

  const matches = battlefield.filter((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!contextualTargetIds.includes(permanentId)) return false;
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
    if (!contextualTargetIds.includes(permanentId)) return false;
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
  const armyMatches = resolveDeterministicArmyCreatureSelection(battlefield, target, ctx);
  if (armyMatches) return armyMatches;
  const selector = parseSimpleBattlefieldSelector(target as any);
  if (selector) {
    return battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx));
  }
  return resolveContextualBattlefieldPermanents(battlefield, target, ctx);
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

    return {
      ...perm,
      ...(existingEffects.length > 0 ? { temporaryEffects: existingEffects } : {}),
      ...(existingGrantedAbilities.length > 0 ? { grantedAbilities: existingGrantedAbilities } : {}),
    } as any;
  });

  return { ...(state as any), battlefield: nextBattlefield } as GameState;
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

  const sourceSelfMatch = normalized.match(/^this\s+(creature|land|saga|permanent)$/i);
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

    return {
      ...perm,
      ...(existingGranted.length > 0 ? { grantedAbilities: existingGranted } : {}),
      ...(existingModifiers.length > 0 ? { modifiers: existingModifiers } : {}),
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

  const singular = /^(?:it|that card|that creature|that permanent)$/i.test(normalized);
  const plural = /^(?:them|those creatures|those permanents)$/i.test(normalized);
  if (!singular && !plural) return [];

  const requiredType =
    normalized.includes('creature') ? 'creature' :
    normalized.includes('permanent') || normalized === 'it' || normalized === 'that card' || normalized === 'them'
      ? 'permanent'
      : undefined;

  const matches = battlefield.filter((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!recentIds.includes(permanentId)) return false;
    if (requiredType && !permanentMatchesType(perm, requiredType as any)) return false;
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

function resolveAddCounterAmount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  ctx?: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): number | null {
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
    return Math.max(
      0,
      discardedCards.filter((card: any) => !getCardTypeLineLower(card).includes('land')).length
    );
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
  const targetIds = resolveTapOrUntapTargetIds(state, step.target as any, ctx);
  if (targetIds.length === 0) {
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
  const targetText = String((step.target as any)?.text || '').trim().toLowerCase();
  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, step.target as any, runtime);
  const contextualTargetIds = (() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const candidate of [
      ...(Array.isArray(ctx.selectorContext?.chosenObjectIds)
        ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
        : []),
      String(ctx.targetPermanentId || '').trim(),
      String(ctx.targetCreatureId || '').trim(),
    ]) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      ids.push(candidate);
    }
    return ids;
  })();
  const contextualTargets = recentTargets.length > 0 || contextualTargetIds.length === 0
    ? []
    : battlefield.filter((perm: any) => {
        const permanentId = String((perm?.id || '')).trim();
        if (!contextualTargetIds.includes(permanentId)) return false;
        if (/creature/.test(targetText) && !permanentMatchesType(perm, 'creature')) return false;
        if (/token/.test(targetText) && !(perm as any)?.isToken) return false;
        return true;
      });
  const directTargets = recentTargets.length > 0
    ? []
    : /^(?:it|them|that creature|those creatures|that permanent|those permanents|that token|those tokens)$/i.test(targetText)
      ? contextualTargets
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
  const selfReference =
    /^(?:this\s+(?:creature|artifact|land|permanent|vehicle)|it)$/i.test(targetText) ||
    (normalizedTarget.length > 0 && sourceNames.has(normalizedTarget));

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
    const requested = parseQuantity(step.amount.kind === 'unknown' ? step.amount.raw || '' : String((step.amount as any).value || ''));
    const exactCount = requested.kind === 'number' ? Math.max(0, requested.value | 0) : null;
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
  const targetText = String((step.target as any)?.text || '').trim().toLowerCase();
  const explicitTargetId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
  const targets =
    explicitTargetId && /^target\b/.test(targetText)
      ? battlefield.filter((perm: any) => String(perm?.id || '').trim() === explicitTargetId)
      : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped temporary dies trigger grant (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targets.length > 1) {
    return {
      applied: false,
      message: `Skipped temporary dies trigger grant (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const watchedPermanentId = String((targets[0] as any)?.id || '').trim();
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
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

  const registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
  const nextRegistry = registerDelayedTrigger(registry, delayedTrigger);
  return {
    applied: true,
    state: {
      ...(state as any),
      delayedTriggerRegistry: nextRegistry,
    } as GameState,
    log: [
      `Granted delayed dies trigger to ${watchedPermanentId}${
        step.duration === 'until_end_of_turn' ? ' until end of turn' : ''
      }`,
    ],
  };
}

export function applyGrantTemporaryAbilityStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_temporary_ability' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const targetText = String((step.target as any)?.text || '').trim().toLowerCase();
  const explicitTargetId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
  const recentTokenTargets = resolveRecentlyCreatedTokenPermanents(battlefield, step.target as any, runtime);
  const recentMovedTargets = recentTokenTargets.length > 0
    ? []
    : resolveRecentlyMovedBattlefieldPermanents(battlefield, step.target as any, runtime);
  const directTargets =
    explicitTargetId && /^target\b/.test(targetText)
      ? battlefield.filter((perm: any) => String((perm?.id || '')).trim() === explicitTargetId)
      : recentTokenTargets.length > 0 || recentMovedTargets.length > 0
        ? []
        : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  const targets = recentTokenTargets.length > 0
    ? recentTokenTargets
    : recentMovedTargets.length > 0
      ? recentMovedTargets
      : directTargets;

  if (targets.length === 0) {
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
  if (step.duration !== 'end_of_turn') {
    return {
      applied: false,
      message: `Skipped cant_block static restriction (continuous text handled elsewhere): ${step.raw}`,
      reason: 'unsupported_condition',
    };
  }

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const targets = resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
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

  const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
    descriptions: ["can't block"],
    expiresAt: 'end_of_turn',
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
  if (step.duration !== 'end_of_turn') {
    return {
      applied: false,
      message: `Skipped cant_attack static restriction (continuous text handled elsewhere): ${step.raw}`,
      reason: 'unsupported_condition',
    };
  }

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const targets = resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
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

  const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
    descriptions: ["can't attack"],
    expiresAt: 'end_of_turn',
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
  if (step.duration !== 'end_of_turn') {
    return {
      applied: false,
      message: `Skipped cant_activate_abilities static restriction (continuous text handled elsewhere): ${step.raw}`,
      reason: 'unsupported_condition',
    };
  }

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const targets = resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
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
    expiresAt: 'end_of_turn',
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

export function applyEarthbendStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'earthbend' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const amountValue = quantityToNumber(step.amount, ctx);
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
  const controllerId = (String(ctx.controllerId || '').trim() || String((targets[0] as any)?.controller || '').trim()) as PlayerID;

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
  const targetText = String((step.target as any)?.text || '').trim().toLowerCase();
  const explicitTargetId = String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
  const targets =
    explicitTargetId && (/^(?:target|that|the)\b/.test(targetText) || targetText === 'it')
      ? battlefield.filter((perm: any) => String((perm as any)?.id || '').trim() === explicitTargetId)
      : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
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
  const amountValue = step.amount.kind === 'number' ? step.amount.value : null;
  if (amountValue === null || amountValue <= 0) {
    return {
      applied: false,
      message: `Skipped monstrosity (unsupported amount): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

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
        '+1/+1': Math.max(0, Number(((perm as any)?.counters || {})['+1/+1'] || 0)) + amountValue,
      },
      isMonstrous: true,
      monstrosityX: amountValue,
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

export function applyTurnFaceUpStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'turn_face_up' }>,
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
  const cardReferenceIds = Array.from(
    new Set(
      [
        String(ctx.targetPermanentId || '').trim(),
        String(ctx.targetCreatureId || '').trim(),
        ...(Array.isArray(ctx.selectorContext?.chosenObjectIds)
          ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
          : []),
      ].filter(Boolean)
    )
  );
  const fallbackTargetIds =
    targetIds.length > 0
      ? []
      : battlefield
          .filter((perm: any) =>
            cardReferenceIds.includes(String((perm as any)?.card?.id || '').trim()) ||
            cardReferenceIds.includes(String((perm as any)?.faceUpCard?.id || '').trim())
          )
          .map((perm: any) => String((perm as any)?.id || '').trim())
          .filter(Boolean);
  const effectiveTargetIds = targetIds.length > 0 ? targetIds : fallbackTargetIds;

  if (effectiveTargetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped turn face up (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  let turnedCount = 0;
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

  if (turnedCount === 0) {
    return {
      applied: false,
      message: `Skipped turn face up (target is not face down): ${step.raw}`,
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
    log: [`Turned ${turnedCount} permanent(s) face up`],
  };
}

export function applyTurnFaceDownStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'turn_face_down' }>,
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
  const targets = resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
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

  let targetPermanentId = String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
  if (!targetPermanentId && step.what.kind === 'raw') {
    const targetText = String(step.what.text || '').trim().toLowerCase();
    if (targetText.includes('target creature')) {
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
  const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const firstPermanentId = chosenIds[0] || String(ctx.targetPermanentId || '').trim();
  const secondPermanentId = chosenIds[1] || '';

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
  runtime?: RecentBattlefieldRuntime
): any | null {
  if (step.source.kind !== 'raw') return null;
  const reference = String(step.source.text || '').trim().toLowerCase();
  const movedCards = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];

  if (reference === 'that card' || reference === 'it' || reference === 'the exiled card') {
    return movedCards.length === 1 ? movedCards[0] : null;
  }

  return null;
}

export function applyCopyPermanentStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const directTargets = resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
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

  const sourceObject = resolveCopyPermanentSourceObject(step, runtime);
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
  const retainedAbilityText = String(step.retainAbilityText || '').trim();
  const copiedOracleText = [sourceOracleText, retainedAbilityText].filter(Boolean).join('\n').trim();
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

    const grantedAbilities = Array.isArray((perm as any)?.grantedAbilities)
      ? (perm as any).grantedAbilities
          .map((entry: unknown) => String(entry || '').trim())
          .filter(Boolean)
      : [];
    if (retainedAbilityText && !grantedAbilities.includes(retainedAbilityText)) {
      grantedAbilities.push(retainedAbilityText);
    }

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
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  const timing =
    step.timing === 'your_next_end_step'
      ? DelayedTriggerTiming.YOUR_NEXT_END_STEP
      : step.timing === 'next_upkeep'
        ? DelayedTriggerTiming.NEXT_UPKEEP
        : step.timing === 'your_next_upkeep'
          ? DelayedTriggerTiming.YOUR_NEXT_UPKEEP
          : DelayedTriggerTiming.NEXT_END_STEP;

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
    return {
      ...perm,
      leaveBattlefieldReplacement: step.destination,
    } as BattlefieldPermanent;
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

export function applyRemoveCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'remove_counter' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const removeAllCounters = step.amount.kind === 'all';
  const amountValue = step.amount.kind === 'number' ? step.amount.value : null;
  if (!removeAllCounters && (amountValue === null || amountValue <= 0)) {
    return {
      applied: false,
      message: `Skipped remove counter (unsupported amount): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const targets = resolveDirectBattlefieldPermanents((state.battlefield || []) as BattlefieldPermanent[], step.target as any, ctx);
  const normalizedTargetText = step.target.kind === 'raw'
    ? normalizeSelfReferenceText(String(step.target.text || '').trim()).toLowerCase()
    : '';
  const allowMultipleDeterministicTargets = removeAllCounters && /^(?:all|each)\b/.test(normalizedTargetText);
  if (targets.length > 1 && !allowMultipleDeterministicTargets) {
    return {
      applied: false,
      message: `Skipped remove counter (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }
  const counterName = String(step.counter || '').trim();
  if (!counterName) {
    return {
      applied: false,
      message: `Skipped remove counter (unsupported counter): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const battlefieldTarget = targets[0] as any;
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
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const targets = resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
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
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
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
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const blockers = resolveDirectBattlefieldPermanents(battlefield, step.blocker as any, ctx);
  const attackers = resolveDirectBattlefieldPermanents(battlefield, step.attacker as any, ctx);
  if (blockers.length !== 1 || attackers.length !== 1) {
    return {
      applied: false,
      message: `Skipped force block (needs deterministic blocker and attacker): ${step.raw}`,
      reason: blockers.length > 1 || attackers.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
      options: blockers.length > 1 || attackers.length > 1 ? { classification: 'player_choice' } : undefined,
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

  const normalizedTarget = normalizeWhereQualifiedTarget(step.target as any);
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
  const directTargets = recentTokenTargets.length > 0 || recentMovedTargets.length > 0
    ? []
    : shouldPreferMovedCards
      ? []
    : resolveDirectBattlefieldPermanents((state.battlefield || []) as BattlefieldPermanent[], normalizedTarget as any, ctx);
  const targets = recentTokenTargets.length > 0
    ? recentTokenTargets
    : recentMovedTargets.length > 0
      ? recentMovedTargets
      : directTargets;
  const fallbackSingleCreatureId = targets.length === 0 && !shouldPreferMovedCards
    ? resolveSingleCreatureTargetId(state, normalizedTarget as any, ctx)
    : undefined;
  const fallbackCreatureTargets = fallbackSingleCreatureId
    ? ((state.battlefield || []) as BattlefieldPermanent[]).filter(
        permanent => String((permanent as any)?.id || '').trim() === fallbackSingleCreatureId
      )
    : [];
  const resolvedTargets = targets.length > 0 ? targets : fallbackCreatureTargets;

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

  const targetIds = new Set(resolvedTargets.map((target: any) => String(target?.id || '').trim()).filter(Boolean));

  const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
    if (!targetIds.has(String(perm?.id || '').trim())) return perm;
    const counters = { ...((perm?.counters || {}) as Record<string, number>) };
    const currentCount = Number(counters[counterName] ?? 0);
    counters[counterName] = (Number.isFinite(currentCount) ? currentCount : 0) + amountValue;
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
    log: [`Added ${amountValue} ${counterName} counter(s) to ${resolvedTargets.length} permanent(s)`],
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

export function applyDestroyStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'destroy' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const selector = parseSimpleBattlefieldSelector(step.target as any);
  const toRemove = selector
    ? battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx))
    : resolveContextualBattlefieldPermanents(battlefield, step.target as any, ctx);
  if (toRemove.length === 0) {
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

  const result = finalizeBattlefieldRemoval(stateWithShields, removed, removedIds, kept, 'graveyard', 'destroyed');
  return { applied: true, state: result.state, log: [...log, ...result.log] };
}

export function applyRegenerateStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'regenerate' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const selector = parseSimpleBattlefieldSelector(step.target as any);
  const targets = selector
    ? battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx))
    : resolveContextualBattlefieldPermanents(battlefield, step.target as any, ctx);
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

export function applyExileStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const selector = parseSimpleBattlefieldSelector(step.target as any);
  if (selector) {
    const result = moveMatchingBattlefieldPermanents(state, selector, ctx, 'exile');
    return { applied: true, state: result.state, log: result.log };
  }

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const toRemove = resolveContextualBattlefieldPermanents(battlefield, step.target as any, ctx);
  if (toRemove.length === 0) {
    const contextualTarget = parseContextualBattlefieldReference(step.target as any);
    if (contextualTarget?.mode === 'self' || isNamedSelfSacrificeReference(step.target as any, ctx)) {
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
  const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled');
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

export function applyScheduleDelayedBattlefieldActionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'schedule_delayed_battlefield_action' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
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
    const ids = contextual.plural ? contextualTargetIds : contextualTargetIds.slice(0, 1);
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

  if (parsed?.mode === 'contextual') {
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

export function applySacrificeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'sacrifice' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped sacrifice (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const parsed = parseSacrificeWhat(step.what as any);
  const namedSelfReference = isNamedSelfSacrificeReference(step.what as any, ctx);
  if (!parsed && !namedSelfReference) {
    return {
      applied: false,
      message: `Skipped sacrifice (unsupported object selector): ${step.raw}`,
      reason: 'unsupported_object_selector',
    };
  }

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const toRemove: BattlefieldPermanent[] = [];
  let needsChoice = false;
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
    const ids = contextual.plural ? contextualTargetIds : contextualTargetIds.slice(0, 1);
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
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    toRemove.push(selfPermanent);
  }

  if (parsed?.mode === 'choice_required') {
    return {
      applied: false,
      message: `Skipped sacrifice (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
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
        toRemove.push(...candidates);
        continue;
      }

      if (candidates.length > parsed.count) {
        needsChoice = true;
        break;
      }
      toRemove.push(...candidates);
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
  const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'graveyard', 'sacrificed');

  return {
    applied: true,
    state: result.state,
    log: result.log,
    lastSacrificedCreaturesPowerTotal: Math.max(0, sacrificedCreaturesPowerTotal),
    lastSacrificedPermanents,
  };
}
