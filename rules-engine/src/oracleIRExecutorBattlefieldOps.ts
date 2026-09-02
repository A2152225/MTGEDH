import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import { buildZoneObjectWithRetainedCounters } from '../../shared/src/zoneRetainedCounters';
import { getLeaveBattlefieldDestination } from '../../shared/src/leaveBattlefieldReplacement';
import type { OracleObjectSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  buildZoneChangeTransitionsFromPermanents,
  mapTransitionsToExplicitDestinations,
} from './oracleIRExecutorZoneTransitionBuilders';
import {
  parseSimplePermanentTypeFromText,
  type SimpleBattlefieldSelector,
  type SimplePermanentType,
} from './oracleIRExecutorBattlefieldParser';
import { isMassTapOrUntapSelectorText, resolveSingleCreatureTargetId } from './oracleIRExecutorCreatureStepUtils';
import { flattenZoneCardForBattlefield } from './oracleIRExecutorZoneCardIdentity';
import { stampCardPutIntoGraveyardThisTurn, writePlayerCommandZoneCard, writePlayerZoneCards } from './oracleIRExecutorPlayerUtils';
import { shuffleArray } from './oracleIRExecutorPlayerStepShared';
import { getExecutorTypeLineLower, hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { putAttractionInJunkyard, shouldAttractionGoToCommandZone } from './remainingCardTypes';

/** Zone containers use card id (Scryfall id), not battlefield permanent id — matches server destroyPermanent. */
export function resolveZoneCardIdFromPermanent(perm: any): string {
  return String(perm?.card?.id || perm?.id || '').trim();
}

function permanentMatchesTapTargetType(perm: BattlefieldPermanent, type: SimplePermanentType | null): boolean {
  if (!type || type === 'permanent') return true;
  if (type === 'nonland_permanent') return !hasExecutorClass(perm as any, 'land');
  return hasExecutorClass(perm as any, type);
}

function parseUpToMassTapCount(raw: string): number | null {
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized) return null;
  const wordValues: Record<string, number> = {
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
  };
  if (wordValues[normalized] !== undefined) return wordValues[normalized];
  const parsed = parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function resolveUpToMassTapOrUntapTargetIds(
  battlefield: readonly BattlefieldPermanent[],
  targetText: string,
  ctx: OracleIRExecutionContext,
  sourceId: string,
  isAnotherTarget: boolean,
): string[] {
  const match = targetText.match(
    /^up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(.+?)(?:\s+you control)?$/i,
  );
  if (!match) return [];

  const maxCount = parseUpToMassTapCount(String(match[1] || ''));
  if (maxCount === null || maxCount <= 0) return [];

  const typePhrase = String(match[2] || '').trim();
  const requiredType = parseSimplePermanentTypeFromText(typePhrase) || 'permanent';
  const controllerId = String(ctx.controllerId || '').trim();
  const candidates = battlefield.filter((perm: any) => {
    const permanentId = String(perm?.id || '').trim();
    if (!permanentId) return false;
    if (String(perm?.controller || '').trim() !== controllerId) return false;
    if (isAnotherTarget && sourceId && permanentId === sourceId) return false;
    return permanentMatchesTapTargetType(perm, requiredType);
  });

  const sorted = [...candidates].sort((left: any, right: any) => {
    const leftTapped = Boolean(left?.tapped) ? 0 : 1;
    const rightTapped = Boolean(right?.tapped) ? 0 : 1;
    return leftTapped - rightTapped;
  });

  return sorted
    .slice(0, Math.min(maxCount, sorted.length))
    .map((perm: any) => String(perm?.id || '').trim())
    .filter(Boolean);
}

export function resolveTapOrUntapTargetIds(
  state: GameState,
  target: OracleObjectSelector | any,
  ctx: OracleIRExecutionContext
): string[] {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const sourceId = String(ctx.sourceId || '').trim();

  if (target?.kind !== 'raw') return [];
  const text = String(target?.text || '').trim().toLowerCase();
  if (!text) return [];

  const isAnotherTarget = /^(?:another|other)\s+target\b/.test(text);
  const isMassTapSelector =
    /^any number of\b/i.test(text) ||
    /^up to (?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i.test(text);
  // "untap all creatures" (Intruder Alarm) must not collapse to the ETB subject
  // bound as targetPermanentId / targetCreatureId.
  const isMassAllSelector = isMassTapOrUntapSelectorText(text);

  const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  // "up to N target ..." with empty chosen set => player chose zero targets; do not auto-select.
  if (isMassTapSelector && /\btarget\b/.test(text) && chosenObjectIds.length === 0) {
    return [];
  }
  if (chosenObjectIds.length > 0 && (/\btarget\b/.test(text) || isMassTapSelector)) {
    const requiredType = parseSimplePermanentTypeFromText(text);
    const chosenMatches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!chosenObjectIds.includes(permanentId)) return false;
      if (isAnotherTarget && sourceId && permanentId === sourceId) return false;
      if (requiredType && !permanentMatchesTapTargetType(perm, requiredType)) {
        // Compound "A, B, or C" collapses to first type in parseSimplePermanentTypeFromText;
        // trust chosen ids already validated by targeting UX.
        if (!/,|\bor\b/.test(text)) return false;
      }
      return true;
    });
    if (chosenMatches.length > 0) {
      const ids = chosenMatches.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean);
      return isAnotherTarget ? ids.slice(0, 1) : ids;
    }
  }

  // "that creature" / "it" after a prior step: prefer the last moved/referenced
  // permanent, not battlefield order among chosenObjectIds (ETB watchers bind
  // the entering source plus the targeted steal).
  if (/^(?:it|that card|that creature|that land|the land|that permanent|that token)$/i.test(text)) {
    const lastMovedIds = Array.isArray(ctx.lastMovedBattlefieldPermanentIds)
      ? ctx.lastMovedBattlefieldPermanentIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const lastAntecedentIds = Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds)
      ? ctx.lastAntecedentBattlefieldPermanentIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const preferredIds = [
      ...lastMovedIds,
      ...lastAntecedentIds,
      String((ctx as any).lastReferencedPermanentId || '').trim(),
      String(ctx.targetCreatureId || '').trim(),
      String(ctx.targetPermanentId || '').trim(),
      ...chosenObjectIds,
    ].filter(Boolean);
    const requiredType = parseSimplePermanentTypeFromText(text);
    for (const preferredId of preferredIds) {
      const match = battlefield.find((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        const cardId = String((perm as any)?.card?.id || '').trim();
        if (permanentId !== preferredId && cardId !== preferredId) return false;
        if (requiredType && !permanentMatchesTapTargetType(perm, requiredType)) return false;
        return true;
      });
      if (match) {
        return [String((match as any)?.id || '').trim()].filter(Boolean);
      }
    }
  }

  if (!isAnotherTarget && !isMassTapSelector && !isMassAllSelector) {
    const explicitPermanentId = String(ctx.targetPermanentId || '').trim();
    if (explicitPermanentId) {
      const matched = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === explicitPermanentId);
      return matched ? [explicitPermanentId] : [];
    }

    const explicitCreatureId = String(ctx.targetCreatureId || '').trim();
    if (explicitCreatureId) {
      const matched = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === explicitCreatureId);
      return matched ? [explicitCreatureId] : [];
    }
  }

  if (isAnotherTarget) {
    const requiredType = parseSimplePermanentTypeFromText(text) || 'creature';
    const excludeIds = new Set(
      [sourceId, String(ctx.targetCreatureId || '').trim(), String(ctx.targetPermanentId || '').trim()].filter(Boolean)
    );
    const remaining = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!permanentId || excludeIds.has(permanentId)) return false;
      return permanentMatchesTapTargetType(perm, requiredType);
    });
    if (remaining.length === 1) {
      return [String((remaining[0] as any)?.id || '').trim()].filter(Boolean);
    }
  }

  if (!isMassAllSelector) {
    const singleCreatureTargetId = resolveSingleCreatureTargetId(state, target as any, ctx);
    if (singleCreatureTargetId) {
      return [singleCreatureTargetId];
    }
  }

  if (text === 'target permanent' && battlefield.length === 1) {
    return [String((battlefield[0] as any)?.id || '').trim()].filter(Boolean);
  }

  if (text === 'target creature') {
    const creatures = battlefield.filter(perm => hasExecutorClass(perm, 'creature'));
    if (creatures.length === 1) {
      return [String((creatures[0] as any)?.id || '').trim()].filter(Boolean);
    }
  }

  const upToMassTargetIds = resolveUpToMassTapOrUntapTargetIds(
    battlefield,
    text,
    ctx,
    sourceId,
    isAnotherTarget,
  );
  if (upToMassTargetIds.length > 0) {
    return upToMassTargetIds;
  }

  const anyNumberUntappedMatch = text.match(/^any number of untapped (.+?)(?:\s+you control)?$/i);
  if (anyNumberUntappedMatch) {
    const typePhrase = String(anyNumberUntappedMatch[1] || '').trim();
    const requiredType = parseSimplePermanentTypeFromText(typePhrase) || 'creature';
    const controllerId = String(ctx.controllerId || '').trim();
    const candidates = battlefield.filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (!permanentId) return false;
      if (String(perm?.controller || '').trim() !== controllerId) return false;
      if (Boolean(perm?.tapped) || Boolean(perm?.isTapped)) return false;
      return permanentMatchesTapTargetType(perm, requiredType);
    });
    if (chosenObjectIds.length > 0) {
      const chosenSet = new Set(chosenObjectIds);
      return candidates
        .filter((perm: any) => chosenSet.has(String(perm?.id || '').trim()))
        .map((perm: any) => String(perm?.id || '').trim())
        .filter(Boolean);
    }
    return candidates
      .map((perm: any) => String(perm?.id || '').trim())
      .filter(Boolean);
  }

  return [];
}

export function applyTapOrUntapToBattlefield(
  state: GameState,
  targetIds: readonly string[],
  choice: 'tap' | 'untap'
): GameState {
  const wanted = new Set(targetIds.map(id => String(id || '').trim()).filter(Boolean));
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  for (let idx = 0; idx < battlefield.length; idx += 1) {
    const perm = battlefield[idx] as any;
    const permanentId = String(perm?.id || '').trim();
    if (!wanted.has(permanentId)) continue;
    battlefield[idx] = {
      ...perm,
      tapped: choice === 'tap',
    } as any;
  }

  return { ...(state as any), battlefield } as any;
}

function cleanBattlefieldAfterRemovingIds(
  kept: readonly BattlefieldPermanent[],
  removedIds: ReadonlySet<string>
): BattlefieldPermanent[] {
  return kept.map(p => {
    const next: any = { ...p };
    if (typeof next.attachedTo === 'string' && removedIds.has(next.attachedTo)) next.attachedTo = undefined;
    if (Array.isArray(next.attachments)) next.attachments = next.attachments.filter((id: any) => !removedIds.has(String(id)));
    if (Array.isArray(next.attachedEquipment)) {
      next.attachedEquipment = next.attachedEquipment.filter((id: any) => !removedIds.has(String(id)));
      next.isEquipped = Boolean(next.attachedEquipment.length > 0);
    }
    if (Array.isArray(next.blocking)) next.blocking = next.blocking.filter((id: any) => !removedIds.has(String(id)));
    if (Array.isArray(next.blockedBy)) next.blockedBy = next.blockedBy.filter((id: any) => !removedIds.has(String(id)));
    return next;
  });
}

function isAttractionPermanent(perm: BattlefieldPermanent): boolean {
  const typeLine = String((perm as any)?.type_line || (perm as any)?.card?.type_line || '').toLowerCase();
  return typeLine.includes('attraction');
}

export function isCommanderPermanent(state: GameState, perm: BattlefieldPermanent): boolean {
  if ((perm as any)?.isCommander === true || (perm as any)?.card?.isCommander === true) return true;
  const ownerId = String((perm as any)?.owner || (perm as any)?.ownerId || '').trim();
  const cardId = String((perm as any)?.card?.id || '').trim();
  if (!ownerId || !cardId) return false;
  const info = (state as any)?.commandZone?.[ownerId];
  const ids = Array.isArray(info?.commanderIds) ? info.commanderIds : [];
  return ids.includes(cardId);
}

function placeRemovedPermanentInOwnerZone(params: {
  state: GameState;
  player: any;
  perm: BattlefieldPermanent;
  adjustedDestination: 'graveyard' | 'exile' | 'hand' | 'library';
  libraryPlacement?: 'top' | 'bottom';
  commanderLibraryChoices?: Readonly<Record<string, 'command' | 'library'>>;
}): 'graveyard' | 'exile' | 'hand' | 'library' | 'command' {
  const { state, player, perm, adjustedDestination, libraryPlacement, commanderLibraryChoices } = params;

  if (adjustedDestination !== 'exile' && isAttractionPermanent(perm) && shouldAttractionGoToCommandZone(adjustedDestination)) {
    const commandZone = Array.isArray(player.commandZone) ? [...player.commandZone] : [];
    const commandCard = putAttractionInJunkyard({
      ...buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'command'),
      type: 'attraction',
      source: String((perm as any)?.card?.id || (perm as any)?.id || ''),
      name: String((perm as any)?.card?.name || (perm as any)?.name || 'Attraction'),
      litUpNumbers: Array.isArray((perm as any)?.card?.litUpNumbers) ? (perm as any).card.litUpNumbers : [],
      visitAbility: String((perm as any)?.card?.visitAbility || ''),
      inJunkyard: false,
    } as any);
    commandZone.push(commandCard);
    player.commandZone = commandZone;
    return 'command';
  }

  if (adjustedDestination === 'graveyard') {
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    graveyard.push({
      ...stampCardPutIntoGraveyardThisTurn(state, buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'graveyard')),
      id: resolveZoneCardIdFromPermanent(perm),
    });
    player.graveyard = graveyard;
    return 'graveyard';
  }

  if (adjustedDestination === 'hand') {
    const hand = Array.isArray(player.hand) ? [...player.hand] : [];
    hand.push({
      ...buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'hand'),
      id: resolveZoneCardIdFromPermanent(perm),
    });
    player.hand = hand;
    return 'hand';
  }

  if (adjustedDestination === 'library') {
    const permanentId = String((perm as any)?.id || '').trim();
    const commanderChoice = permanentId ? commanderLibraryChoices?.[permanentId] : undefined;
    const choseCommand = commanderChoice === 'command';
    const choseLibrary = commanderChoice === 'library';
    if (choseCommand || (isCommanderPermanent(state, perm) && !choseLibrary)) {
      const ownerId = String((player as any)?.id || (perm as any)?.owner || (perm as any)?.ownerId || '').trim() as PlayerID;
      const commandCard = {
        ...buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'command'),
        id: resolveZoneCardIdFromPermanent(perm),
        isCommander: true,
      };
      writePlayerCommandZoneCard(state, ownerId, player, commandCard, [
        commandCard.id,
        String((perm as any)?.card?.id || '').trim(),
        permanentId,
      ]);
      return 'command';
    }
    const library = Array.isArray(player.library) ? [...player.library] : [];
    const libraryCard = flattenZoneCardForBattlefield({
      ...buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'library'),
      id: resolveZoneCardIdFromPermanent(perm),
    });
    const typeLine = String(
      libraryCard?.type_line || (perm as any)?.card?.type_line || (perm as any)?.type_line || '',
    ).trim();
    if (typeLine) libraryCard.type_line = typeLine;
    const nextLibrary = libraryPlacement === 'top' ? [libraryCard, ...library] : [...library, libraryCard];
    const ownerId = String((player as any)?.id || '').trim() as PlayerID;
    if (ownerId) {
      writePlayerZoneCards(state, ownerId, player, 'library', nextLibrary);
    } else {
      player.library = nextLibrary;
    }
    return 'library';
  }

  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  exile.push({
    ...buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'exile'),
    id: resolveZoneCardIdFromPermanent(perm),
  });
  player.exile = exile;
  return 'exile';
}

function moveRemovedPermanentToOwnerZoneExplicit(params: {
  state: GameState;
  player: any;
  perm: BattlefieldPermanent;
  destination: 'graveyard' | 'exile' | 'hand' | 'library';
  libraryPlacement?: 'top' | 'bottom';
  commanderLibraryChoices?: Readonly<Record<string, 'command' | 'library'>>;
}): 'graveyard' | 'exile' | 'hand' | 'library' | 'command' {
  return placeRemovedPermanentInOwnerZone({
    ...params,
    adjustedDestination: params.destination,
  });
}

function moveRemovedPermanentToOwnerZone(params: {
  state: GameState;
  player: any;
  perm: BattlefieldPermanent;
  destination: 'graveyard' | 'exile' | 'hand' | 'library';
  libraryPlacement?: 'top' | 'bottom';
  commanderLibraryChoices?: Readonly<Record<string, 'command' | 'library'>>;
}): 'graveyard' | 'exile' | 'hand' | 'library' | 'command' {
  const { perm, destination, libraryPlacement } = params;
  const adjustedDestination =
    destination === 'library'
      ? (getLeaveBattlefieldDestination(perm, 'hand') === 'exile' ? 'exile' : 'library')
      : getLeaveBattlefieldDestination(perm, destination);

  return placeRemovedPermanentInOwnerZone({
    ...params,
    adjustedDestination,
    libraryPlacement,
  });
}

export function permanentMatchesSelector(
  perm: BattlefieldPermanent,
  sel: SimpleBattlefieldSelector,
  ctx: OracleIRExecutionContext
): boolean {
  const normalizeId = (value: unknown): PlayerID | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized ? (normalized as PlayerID) : undefined;
  };
  const normalizedControllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const permanentControllerId = normalizeId((perm as any)?.controller);

  if (sel.controllerFilter === 'you') {
    if (!permanentControllerId || permanentControllerId !== normalizedControllerId) return false;
  }

  if (sel.controllerFilter === 'opponents') {
    if (!permanentControllerId || permanentControllerId === normalizedControllerId) return false;
  }

  if (sel.controllerFilter === 'target_player') {
    const targetPlayerId = String(
      ctx.selectorContext?.targetPlayerId
      || ctx.targetPlayerId
      || ctx.selectorContext?.targetOpponentId
      || ctx.targetOpponentId
      || '',
    ).trim() as PlayerID;
    if (!targetPlayerId || permanentControllerId !== targetPlayerId) return false;
  }

  if (sel.colorlessOnly) {
    const permColors = Array.isArray((perm as any)?.colors)
      ? (perm as any).colors
      : Array.isArray((perm as any)?.card?.colors)
        ? (perm as any).card.colors
        : [];
    if (permColors.length > 0) return false;
  }

  if (sel.colorsAnyOf && sel.colorsAnyOf.length > 0) {
    const permColors = Array.isArray((perm as any)?.colors)
      ? (perm as any).colors
      : Array.isArray((perm as any)?.card?.colors)
        ? (perm as any).card.colors
        : [];
    if (!sel.colorsAnyOf.some(color => permColors.includes(color))) return false;
  }

  if (sel.excludeSourceId) {
    const sourceId = String(ctx.sourceId || '').trim();
    const permanentId = String((perm as any)?.id || '').trim();
    if (sourceId && permanentId === sourceId) return false;
  }

  if (sel.tappedOnly && (perm as any)?.tapped !== true && (perm as any)?.isTapped !== true) {
    return false;
  }

  if (sel.nontokenOnly && (perm as any)?.isToken) {
    return false;
  }

  if (sel.usesChosenCreatureType) {
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim().toLowerCase();
    if (!chosenType || !hasExecutorClass(perm, 'creature')) return false;
    if (!getExecutorTypeLineLower(perm).includes(chosenType)) return false;
  }

  if (sel.tokenOnly && !(perm as any)?.isToken) {
    return false;
  }

  if (sel.attackingOnly) {
    const attacking = Boolean(
      (perm as any)?.attacking ||
        (perm as any)?.attackedThisTurn ||
        (perm as any)?.attackingPlayerId ||
        (perm as any)?.isAttacking
    );
    if (!attacking) return false;
  }

  if (sel.typeLineTermsAnyOf && sel.typeLineTermsAnyOf.length > 0) {
    if (!sel.typeLineTermsAnyOf.some(term => hasExecutorClass(perm, String(term || '').trim()))) return false;
  }

  if (sel.types.includes('permanent')) return true;
  if (sel.types.includes('nonland_permanent')) return hasExecutorClass(perm, 'permanent') && !hasExecutorClass(perm, 'land');

  return sel.types.some(t => {
    switch (t) {
      case 'creature':
        return hasExecutorClass(perm, 'creature');
      case 'artifact':
        return hasExecutorClass(perm, 'artifact');
      case 'enchantment':
        return hasExecutorClass(perm, 'enchantment');
      case 'land':
        return hasExecutorClass(perm, 'land');
      case 'planeswalker':
        return hasExecutorClass(perm, 'planeswalker');
      case 'battle':
        return hasExecutorClass(perm, 'battle');
      case 'vehicle':
        return hasExecutorClass(perm, 'vehicle');
      default:
        return false;
    }
  });
}

export function permanentMatchesType(perm: BattlefieldPermanent, type: SimplePermanentType): boolean {
  switch (type) {
    case 'permanent':
      return true;
    case 'nonland_permanent':
      return hasExecutorClass(perm, 'permanent') && !hasExecutorClass(perm, 'land');
    case 'creature':
      return hasExecutorClass(perm, 'creature');
    case 'artifact':
      return hasExecutorClass(perm, 'artifact');
    case 'enchantment':
      return hasExecutorClass(perm, 'enchantment');
    case 'land':
      return hasExecutorClass(perm, 'land');
    case 'planeswalker':
      return hasExecutorClass(perm, 'planeswalker');
    case 'battle':
      return hasExecutorClass(perm, 'battle');
    case 'vehicle':
      return hasExecutorClass(perm, 'vehicle');
    default:
      return false;
  }
}

export type FinalizeBattlefieldRemovalOptions = {
  readonly ctx?: OracleIRExecutionContext;
  readonly stepIndex?: number;
  readonly stepKind?: string;
  readonly cause?: string;
};

const activeBattlefieldRemovalContexts: OracleIRExecutionContext[] = [];

export function pushActiveOracleIrBattlefieldRemovalContext(ctx: OracleIRExecutionContext): void {
  activeBattlefieldRemovalContexts.push(ctx);
}

export function popActiveOracleIrBattlefieldRemovalContext(): void {
  activeBattlefieldRemovalContexts.pop();
}

export function oracleIrBattlefieldRemovalBridgeOptions(
  ctx: OracleIRExecutionContext,
  stepKind: string,
): FinalizeBattlefieldRemovalOptions | undefined {
  if (!ctx.serverBridge) return undefined;
  return {
    ctx,
    stepIndex: ctx.currentStepIndex ?? 0,
    stepKind,
    cause: `oracle_ir:${stepKind}`,
  };
}

function finalizeBattlefieldRemovalWithExplicitDestinations(
  state: GameState,
  removed: readonly BattlefieldPermanent[],
  removedIds: ReadonlySet<string>,
  kept: readonly BattlefieldPermanent[],
  destinationByPermId: ReadonlyMap<string, 'graveyard' | 'exile' | 'hand' | 'library' | 'cease_to_exist'>,
  verbPastTense: string,
): { state: GameState; log: string[] } {
  const cleanedKept = cleanBattlefieldAfterRemovingIds(kept, removedIds);
  const players = (state.players || []).map((p) => ({ ...p } as any));
  let redirectedToExile = 0;
  let redirectedToCommand = 0;
  let ceasedToExist = 0;

  for (const perm of removed) {
    const permanentId = String((perm as any)?.id || '').trim();
    if ((perm as any).isToken) {
      ceasedToExist += 1;
      continue;
    }

    const explicitDestination = destinationByPermId.get(permanentId) ?? 'graveyard';
    if (explicitDestination === 'cease_to_exist') {
      ceasedToExist += 1;
      continue;
    }

    const ownerId = perm.owner;
    const player = players.find((pp) => pp.id === ownerId);
    if (!player) continue;

    const actualDestination = moveRemovedPermanentToOwnerZoneExplicit({
      state,
      player,
      perm,
      destination: explicitDestination,
    });
    if (actualDestination === 'exile' && explicitDestination !== 'exile') redirectedToExile += 1;
    if (actualDestination === 'command') redirectedToCommand += 1;
  }

  const log =
    removed.length > 0
      ? [
          `${verbPastTense} ${removed.length} permanent(s) from battlefield${
            redirectedToExile > 0 || redirectedToCommand > 0 || ceasedToExist > 0
              ? ` (${[
                  redirectedToExile > 0 ? `${redirectedToExile} exiled instead` : '',
                  redirectedToCommand > 0 ? `${redirectedToCommand} moved to the junkyard instead` : '',
                  ceasedToExist > 0 ? `${ceasedToExist} ceased to exist` : '',
                ].filter(Boolean).join(', ')})`
              : ''
          }`,
        ]
      : [];

  return { state: { ...state, battlefield: cleanedKept as any, players: players as any } as any, log };
}

function finalizeBattlefieldRemovalViaServerBridge(
  state: GameState,
  removed: readonly BattlefieldPermanent[],
  removedIds: ReadonlySet<string>,
  kept: readonly BattlefieldPermanent[],
  destination: 'graveyard' | 'exile',
  verbPastTense: string,
  options: FinalizeBattlefieldRemovalOptions,
): { state: GameState; log: string[] } {
  const bridge = options.ctx?.serverBridge;
  const stepIndex = Number(options.stepIndex);
  if (!bridge || !Number.isFinite(stepIndex)) {
    return finalizeBattlefieldRemovalDirect(state, removed, removedIds, kept, destination, verbPastTense);
  }

  const transitions = buildZoneChangeTransitionsFromPermanents({
    state,
    permanents: removed,
    stepIndex,
    stepKind: String(options.stepKind || destination),
    intendedDestination: destination,
    cause: String(options.cause || `oracle_ir:${options.stepKind || destination}`),
    ctx: options.ctx,
  });

  const bridgeResult = bridge.proposeTransitions(transitions);
  if (bridgeResult.halt) {
    if (options.ctx?.transitionHaltState) {
      options.ctx.transitionHaltState.halted = true;
      options.ctx.transitionHaltState.deferred = [...(bridgeResult.deferred || [])];
    }
    return { state, log: [] };
  }

  const ready = bridgeResult.ready ?? transitions;
  const destinationByPermId = mapTransitionsToExplicitDestinations(ready, destination);
  return finalizeBattlefieldRemovalWithExplicitDestinations(
    state,
    removed,
    removedIds,
    kept,
    destinationByPermId,
    verbPastTense,
  );
}

export function finalizeBattlefieldRemoval(
  state: GameState,
  removed: readonly BattlefieldPermanent[],
  removedIds: ReadonlySet<string>,
  kept: readonly BattlefieldPermanent[],
  destination: 'graveyard' | 'exile',
  verbPastTense: string,
  options?: FinalizeBattlefieldRemovalOptions,
): { state: GameState; log: string[] } {
  const activeCtx = activeBattlefieldRemovalContexts[activeBattlefieldRemovalContexts.length - 1];
  const resolvedOptions = options?.ctx?.serverBridge
    ? options
    : (activeCtx ? oracleIrBattlefieldRemovalBridgeOptions(activeCtx, options?.stepKind || destination) : options);
  if (resolvedOptions?.ctx?.serverBridge) {
    return finalizeBattlefieldRemovalViaServerBridge(
      state,
      removed,
      removedIds,
      kept,
      destination,
      verbPastTense,
      resolvedOptions,
    );
  }

  return finalizeBattlefieldRemovalDirect(state, removed, removedIds, kept, destination, verbPastTense);
}

function finalizeBattlefieldRemovalDirect(
  state: GameState,
  removed: readonly BattlefieldPermanent[],
  removedIds: ReadonlySet<string>,
  kept: readonly BattlefieldPermanent[],
  destination: 'graveyard' | 'exile',
  verbPastTense: string,
): { state: GameState; log: string[] } {
  const cleanedKept = cleanBattlefieldAfterRemovingIds(kept, removedIds);

  const players = (state.players || []).map(p => ({ ...p } as any));
  let redirectedToExile = 0;
  let redirectedToCommand = 0;
  for (const perm of removed) {
    if ((perm as any).isToken) continue;
    const ownerId = perm.owner;
    const player = players.find(pp => pp.id === ownerId);
    if (!player) continue;

    const actualDestination = moveRemovedPermanentToOwnerZone({ state, player, perm, destination });
    if (actualDestination === 'exile' && destination !== 'exile') redirectedToExile += 1;
    if (actualDestination === 'command') redirectedToCommand += 1;
  }

  const log =
    removed.length > 0
      ? [
          `${verbPastTense} ${removed.length} permanent(s) from battlefield${
            redirectedToExile > 0 || redirectedToCommand > 0
              ? ` (${[
                  redirectedToExile > 0 ? `${redirectedToExile} exiled instead` : '',
                  redirectedToCommand > 0 ? `${redirectedToCommand} moved to the junkyard instead` : '',
                ].filter(Boolean).join(', ')})`
              : ''
          }`,
        ]
      : [];
  return { state: { ...state, battlefield: cleanedKept as any, players: players as any } as any, log };
}

export function moveMatchingBattlefieldPermanents(
  state: GameState,
  selector: SimpleBattlefieldSelector,
  ctx: OracleIRExecutionContext,
  destination: 'graveyard' | 'exile'
): { state: GameState; log: string[] } {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  const removedIds = new Set<string>();
  const removed: BattlefieldPermanent[] = [];
  const kept: BattlefieldPermanent[] = [];

  for (const perm of battlefield) {
    if (permanentMatchesSelector(perm, selector, ctx)) {
      removed.push(perm);
      removedIds.add(perm.id);
    } else {
      kept.push(perm);
    }
  }

  const verb = destination === 'graveyard' ? 'destroyed' : 'exiled';
  return finalizeBattlefieldRemoval(state, removed, removedIds, kept, destination, verb);
}

export function bounceMatchingBattlefieldPermanentsToOwnersHands(
  state: GameState,
  selector: SimpleBattlefieldSelector,
  ctx: OracleIRExecutionContext
): { state: GameState; log: string[] } {
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];

  const removedIds = new Set<string>();
  const removed: BattlefieldPermanent[] = [];
  const kept: BattlefieldPermanent[] = [];

  for (const perm of battlefield) {
    if (permanentMatchesSelector(perm, selector, ctx)) {
      removed.push(perm);
      removedIds.add(perm.id);
    } else {
      kept.push(perm);
    }
  }

  if (removed.length === 0) return { state, log: [] };

  const cleanedKept = cleanBattlefieldAfterRemovingIds(kept, removedIds);

  const players = (state.players || []).map(p => ({ ...p } as any));
  let redirectedToExile = 0;
  let redirectedToCommand = 0;
  for (const perm of removed) {
    if ((perm as any).isToken) continue;
    const ownerId = perm.owner;
    const player = players.find(pp => pp.id === ownerId);
    if (!player) continue;
    const actualDestination = moveRemovedPermanentToOwnerZone({ state, player, perm, destination: 'hand' });
    if (actualDestination === 'exile') redirectedToExile += 1;
    if (actualDestination === 'command') redirectedToCommand += 1;
  }

  const log = [
    `returned ${removed.length} permanent(s) to owners' hands${
      redirectedToExile > 0 || redirectedToCommand > 0
        ? ` (${[
            redirectedToExile > 0 ? `${redirectedToExile} exiled instead` : '',
            redirectedToCommand > 0 ? `${redirectedToCommand} moved to the junkyard instead` : '',
          ].filter(Boolean).join(', ')})`
        : ''
    }`,
  ];
  return { state: { ...state, battlefield: cleanedKept as any, players: players as any } as any, log };
}

export function moveBattlefieldPermanentsByIdToOwnersHands(
  state: GameState,
  permanentIds: readonly string[]
): { state: GameState; log: string[] } {
  const wanted = new Set(permanentIds.map(id => String(id || '').trim()).filter(Boolean));
  if (wanted.size === 0) return { state, log: [] };

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const removedIds = new Set<string>();
  const removed: BattlefieldPermanent[] = [];
  const kept: BattlefieldPermanent[] = [];

  for (const perm of battlefield) {
    const permanentId = String((perm as any)?.id || '').trim();
    if (wanted.has(permanentId)) {
      removed.push(perm);
      removedIds.add(permanentId);
    } else {
      kept.push(perm);
    }
  }

  if (removed.length === 0) return { state, log: [] };

  const cleanedKept = cleanBattlefieldAfterRemovingIds(kept, removedIds);
  const players = (state.players || []).map(p => ({ ...p } as any));
  let redirectedToExile = 0;
  let redirectedToCommand = 0;
  for (const perm of removed) {
    if ((perm as any).isToken) continue;
    const ownerId = perm.owner;
    const player = players.find(pp => pp.id === ownerId);
    if (!player) continue;

    const actualDestination = moveRemovedPermanentToOwnerZone({ state, player, perm, destination: 'hand' });
    if (actualDestination === 'exile') redirectedToExile += 1;
    if (actualDestination === 'command') redirectedToCommand += 1;
  }

  return {
    state: { ...state, battlefield: cleanedKept as any, players: players as any } as any,
    log: [
      `returned ${removed.length} permanent(s) to owners' hands${
        redirectedToExile > 0 || redirectedToCommand > 0
          ? ` (${[
              redirectedToExile > 0 ? `${redirectedToExile} exiled instead` : '',
              redirectedToCommand > 0 ? `${redirectedToCommand} moved to the junkyard instead` : '',
            ].filter(Boolean).join(', ')})`
          : ''
      }`,
    ],
  };
}

export function moveBattlefieldPermanentsByIdToOwnersLibraries(
  state: GameState,
  permanentIds: readonly string[],
  placement: 'top' | 'bottom',
  options?: {
    shuffle?: boolean;
    commanderLibraryChoices?: Readonly<Record<string, 'command' | 'library'>>;
  },
): { state: GameState; log: string[]; movedCards?: any[] } {
  const wanted = new Set(permanentIds.map(id => String(id || '').trim()).filter(Boolean));
  if (wanted.size === 0) return { state, log: [] };

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const removedIds = new Set<string>();
  const removed: BattlefieldPermanent[] = [];
  const kept: BattlefieldPermanent[] = [];

  for (const perm of battlefield) {
    const permanentId = String((perm as any)?.id || '').trim();
    if (wanted.has(permanentId)) {
      removed.push(perm);
      removedIds.add(permanentId);
    } else {
      kept.push(perm);
    }
  }

  if (removed.length === 0) return { state, log: [] };

  const cleanedKept = cleanBattlefieldAfterRemovingIds(kept, removedIds);
  const players = (state.players || []).map(p => ({ ...p } as any));
  const nextState = { ...state, battlefield: cleanedKept as any, players: players as any } as GameState;
  const ownersToShuffle = new Set<PlayerID>();
  const movedCards: any[] = [];
  let redirectedToExile = 0;
  let redirectedToCommand = 0;
  for (const perm of removed) {
    const ownerId = ((perm as any).owner || (perm as any).ownerId) as PlayerID;
    if (ownerId) ownersToShuffle.add(ownerId);
    movedCards.push({
      ...((perm as any)?.card || {}),
      id: String((perm as any)?.id || '').trim() || resolveZoneCardIdFromPermanent(perm),
      owner: ownerId,
      ownerId,
      controller: (perm as any)?.controller || (perm as any)?.controllerId,
    });
    if ((perm as any).isToken) continue;
    const player = players.find(pp => pp.id === ownerId);
    if (!player) continue;

    const actualDestination = moveRemovedPermanentToOwnerZone({
      state: nextState,
      player,
      perm,
      destination: 'library',
      libraryPlacement: placement,
      commanderLibraryChoices: options?.commanderLibraryChoices,
    });
    if (actualDestination === 'exile') redirectedToExile += 1;
    if (actualDestination === 'command') redirectedToCommand += 1;
  }

  if (options?.shuffle) {
    for (const ownerId of ownersToShuffle) {
      const player = players.find(pp => pp.id === ownerId);
      if (!player) continue;
      const shuffled = shuffleArray(Array.isArray(player.library) ? player.library : []);
      writePlayerZoneCards(nextState, ownerId, player, 'library', shuffled);
    }
  }

  return {
    state: nextState,
    log: [
      `put ${removed.length} permanent(s) on the ${placement} of owners' libraries${
        options?.shuffle ? ' and shuffled' : ''
      }${
        redirectedToExile > 0 || redirectedToCommand > 0
          ? ` (${[
              redirectedToExile > 0 ? `${redirectedToExile} exiled instead` : '',
              redirectedToCommand > 0 ? `${redirectedToCommand} moved to the junkyard instead` : '',
            ].filter(Boolean).join(', ')})`
          : ''
      }`,
    ],
    ...(movedCards.length > 0 ? { movedCards } : {}),
  };
}
