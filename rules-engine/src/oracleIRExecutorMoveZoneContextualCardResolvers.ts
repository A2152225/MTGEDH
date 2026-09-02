// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts (lines 934-967 and 1077-1773 before extraction)
// Cluster moved: contextual move_zone card references - "them" / "one of them" / "one pile" /
// "the rest" / "the other" split kinds, the shared contextual card mover, contextual bound-card zone
// lookup, criteria X-resolution, and the died/sacrificed creature context readers those criteria use.
// Public entry symbols: getDiedCreatureManaValueFromCtx, getSacrificedCreaturePowerFromCtx,
// getLibraryPlacement, moveStepShufflesIntoLibrary, isOneOfThemReference, isOneReference, isOnePileReference, isTheRestReference,
// isTheOtherReference, isOneOfThemToHandBounce, getContextualThemSplitKind,
// moveContextualCardToDestination, getOneOfThemSplitKind, getOnePileSplitKind,
// resolveContextualBoundCardZone, resolveAmongThemCriteriaWithX,
// resolveCreaturesBlockingOrBlockedBySource, resolveCreaturesBlockingOrBlockedByTarget,
// resolveMoveZoneSingleTargetCriteriaWithX, moveContextualRestToLibraryBottom,
// resolveRevealThisWayRestDestination, resolveContextualRestPoolIdsInZones,
// moveContextualRestAfterPrimaryMove, resolveContextualCardIdsInZones,
// resolveOneOfThemCandidateCardIds, requiresExplicitControllerOverride, plus the split-kind types.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { OracleIrBattlefieldEntryContext } from './oracleIRExecutorBattlefieldEntryCommit';
import {
  collectMostRecentLedgerCards,
  collectRevealedThisWayCardsLedgerFirst,
  resolveRevealedThisWayCardPile,
} from './oracleIRLedgerCardAccess';
import { getCardManaValue, readPlayerZoneCards, writePlayerZoneCards } from './oracleIRExecutorPlayerUtils';
import { findBestZoneCardIndex } from './oracleIRExecutorZoneCardIdentity';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import {
  moveTargetedCardFromExile,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  parseMoveZoneContextualThemSplit,
  type AmongThemMoveCriteria,
  type MoveZoneSingleTargetCriteria,
  type SimpleCardType,
} from './oracleIRExecutorZoneOps';
import {
  addBattlefieldPermanentsToState,
  createBattlefieldPermanentsFromCards,
  resolveBattlefieldEntryBeforeCommit,
  resolveMoverAttachment,
} from './oracleIRExecutorZoneOpsBattlefieldEntry';
import type { BoundCardZoneLocation, MoveZoneRuntime } from './oracleIRExecutorMoveZoneStepTypes';
import {
  findBoundCardZoneLocation,
  getBoundTargetObjectId,
  getChosenObjectIds,
  getSourcePermanentLoyalty,
  getSourcePermanentPower,
  isContextualBoundCardReference,
  ownerIdFromMovedCardSnapshots,
} from './oracleIRExecutorMoveZoneReferenceResolvers';

export function getDiedCreatureManaValueFromCtx(
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): number | null {
  const snapshots = [
    ...(Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : []),
    ...(Array.isArray((ctx as any).lastSacrificedPermanents) ? (ctx as any).lastSacrificedPermanents : []),
  ];
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index] as any;
    if (!/creature/i.test(String(snapshot?.type_line || ''))) continue;
    const manaValue = getCardManaValue(snapshot);
    if (manaValue !== null) return manaValue;
  }
  return null;
}

export function getSacrificedCreaturePowerFromCtx(
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): number | null {
  const snapshots = [
    ...(Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : []),
    ...(Array.isArray((ctx as any).lastSacrificedPermanents) ? (ctx as any).lastSacrificedPermanents : []),
  ];
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index] as any;
    if (!/creature/i.test(String(snapshot?.type_line || ''))) continue;
    const power = Number(snapshot?.power ?? snapshot?.card?.power);
    if (Number.isFinite(power)) return power;
  }
  return null;
}

export function getLibraryPlacement(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): 'top' | 'bottom' | '' {
  if (step.to !== 'library') return '';
  if (step.libraryPlacement === 'top' || step.libraryPlacement === 'bottom') return step.libraryPlacement;
  const toRaw = String(step.toRaw || '').trim().toLowerCase();
  const raw = String(step.raw || '').trim().toLowerCase();
  const hasTop = /\b(?:on\s+)?top(?:\s+of)?\b/i.test(toRaw) || /\bon top\b/i.test(raw);
  const hasBottom = /\b(?:on\s+)?(?:the\s+)?bottom(?:\s+of)?\b/i.test(toRaw) || /\bon the bottom\b/i.test(raw);
  if (hasTop && hasBottom) return 'top';
  if (hasTop) return 'top';
  if (hasBottom) return 'bottom';
  if (/\bshuffle\b/i.test(raw) || /\binto\b.+\blibrary\b/i.test(raw)) return 'bottom';
  return '';
}

/** True when the move itself is "shuffle it/them into [a] library", not a later "then shuffle". */
export function moveStepShufflesIntoLibrary(step: { readonly to?: string; readonly raw?: string }): boolean {
  if (step.to !== 'library') return false;
  return /\bshuffles?\b/i.test(String(step.raw || ''));
}

export function isOneOfThemReference(what: unknown): boolean {
  return String((what as any)?.text || (what as any)?.raw || '').trim().toLowerCase() === 'one of them';
}

export function isOneReference(what: unknown): boolean {
  return String((what as any)?.text || (what as any)?.raw || '').trim().toLowerCase() === 'one';
}

export function isOnePileReference(what: unknown): boolean {
  return String((what as any)?.text || (what as any)?.raw || '').trim().toLowerCase() === 'one pile';
}

export function isTheRestReference(what: unknown): boolean {
  return String((what as any)?.text || (what as any)?.raw || '').trim().toLowerCase() === 'the rest';
}

export function isTheOtherReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '').trim().toLowerCase();
  return text === 'the other' || text === 'the other one';
}

export type OneOfThemSplitKind =
  | 'hand_library_bottom'
  | 'hand_graveyard_rest'
  | 'hand_graveyard_other'
  | 'up_to_hand_library_bottom'
  | 'up_to_hand_graveyard_rest';
export type ContextualThemSplitKind =
  | { readonly kind: 'any_number_hand_graveyard_rest' }
  | { readonly kind: 'any_number_graveyard_library_top' }
  | { readonly kind: 'count_hand_graveyard_rest'; readonly count: number }
  | { readonly kind: 'count_hand_library_bottom'; readonly count: number }
  | { readonly kind: 'count_hand_only'; readonly count: number }
  | { readonly kind: 'count_library_top_graveyard_rest'; readonly count: number };
export type OnePileSplitKind = 'hand_graveyard' | 'hand_library_bottom';

export function isOneOfThemToHandBounce(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): boolean {
  if (!isOneOfThemReference(step.what as any)) return false;
  if (step.to !== 'hand') return false;
  const toRaw = String(step.toRaw || '').trim().toLowerCase();
  return /\bowner'?s hand\b/i.test(toRaw) && !/\brest\b/i.test(toRaw) && !/\bother\b/i.test(toRaw);
}

export function getContextualThemSplitKind(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>
): ContextualThemSplitKind | null {
  const spec = parseMoveZoneContextualThemSplit(step.what as any);
  if (!spec) return null;
  const toRaw = String(step.toRaw || '').trim().toLowerCase().replace(/[.)]+$/g, '');
  if (spec.kind === 'count_library_top_graveyard_rest') {
    return step.to === 'graveyard' ? spec : null;
  }
  if (spec.kind === 'any_number_hand_graveyard_rest') {
    if (
      step.to === 'graveyard' &&
      /\brest\b/i.test(toRaw) &&
      /\b(?:top of (?:your )?library|on top of your library|library)\b/i.test(toRaw)
    ) {
      return { kind: 'any_number_graveyard_library_top' };
    }
    if (step.to !== 'hand') return null;
    if (!/\brest\b/i.test(toRaw) && !/\bother\b/i.test(toRaw)) return null;
    if (/\b(?:bottom of (?:your )?library|library)\b/i.test(toRaw)) {
      return { kind: 'count_hand_library_bottom' as const, count: 2 };
    }
    return spec;
  }
  if (step.to !== 'hand') return null;
  if (spec.kind === 'count_those_cards') {
    if (/\brest\b/i.test(toRaw) && /\b(?:bottom|library)\b/i.test(toRaw)) {
      return { kind: 'count_hand_library_bottom', count: spec.count };
    }
    if (/\brest\b/i.test(toRaw) && /\bgraveyard\b/i.test(toRaw)) {
      return { kind: 'count_hand_graveyard_rest', count: spec.count };
    }
    return { kind: 'count_hand_only', count: spec.count };
  }
  if (!/\brest\b/i.test(toRaw) && !/\bother\b/i.test(toRaw)) return null;
  if (spec.kind !== 'count_hand_graveyard_rest' && spec.kind !== 'count_hand_library_bottom') {
    return null;
  }
  if (/\b(?:bottom of (?:your )?library|library)\b/i.test(toRaw)) {
    return { kind: 'count_hand_library_bottom', count: spec.count };
  }
  if (/\bgraveyard\b/i.test(toRaw) || /\bother\b/i.test(toRaw)) {
    return { kind: 'count_hand_graveyard_rest', count: spec.count };
  }
  return null;
}

export function moveContextualCardToDestination(
  state: GameState,
  location: BoundCardZoneLocation,
  cardId: string,
  destination: 'hand' | 'graveyard' | 'library_bottom' | 'library_top' | 'exile' | 'battlefield',
  options: {
    controllerId: PlayerID;
    cardType?: SimpleCardType;
    entersTapped?: boolean;
    entersFaceDown?: boolean;
    withCounters?: any;
    battlefieldEntryOverrides?: any;
    ctx?: OracleIRExecutionContext;
    stepKind?: string;
    attachedToBattlefieldPermanentId?: string;
  }
): { kind: 'applied'; state: GameState; log: string[]; movedPermanentIds?: readonly string[] } | { kind: 'impossible' } | { kind: 'halted' } {
  const cardType = options.cardType || 'any';
  const oracleIrEntry: OracleIrBattlefieldEntryContext | undefined =
    destination === 'battlefield' && options.ctx
      ? { ctx: options.ctx, stepKind: options.stepKind || 'move_zone' }
      : undefined;

  const normalizeZoneMoveResult = (
    result:
      | { kind: 'applied'; state: GameState; log: readonly string[] | string[]; movedPermanentIds?: readonly string[] }
      | { kind: 'impossible' }
      | { kind: 'halted' },
  ): { kind: 'applied'; state: GameState; log: string[]; movedPermanentIds?: readonly string[] } | { kind: 'impossible' } | { kind: 'halted' } => {
    if (result.kind === 'applied') {
      const movedPermanentIds = Array.isArray((result as any).movedPermanentIds)
        ? [...(result as any).movedPermanentIds]
        : undefined;
      return {
        kind: 'applied',
        state: result.state,
        log: [...(result.log || [])],
        ...(movedPermanentIds && movedPermanentIds.length > 0 ? { movedPermanentIds } : {}),
      };
    }
    return result;
  };
  if (location.zone === 'library') {
    const player = state.players.find(p => p.id === location.playerId) as any;
    const library = readPlayerZoneCards(state, location.playerId, player, 'library');
    const index = findBestZoneCardIndex(library, cardId);
    if (index < 0) return { kind: 'impossible' };
    const [card] = library.splice(index, 1);
    writePlayerZoneCards(state, location.playerId, player, 'library', library);
    if (destination === 'library_bottom') {
      writePlayerZoneCards(state, location.playerId, player, 'library', [...library, card]);
      return {
        kind: 'applied',
        state,
        log: [`${location.playerId} puts ${cardId} on the bottom of their library`],
      };
    }
    if (destination === 'library_top') {
      writePlayerZoneCards(state, location.playerId, player, 'library', [card, ...library]);
      return {
        kind: 'applied',
        state,
        log: [`${location.playerId} puts ${cardId} on the top of their library`],
      };
    }
    if (destination === 'hand') {
      const hand = Array.isArray(player?.hand) ? [...player.hand, card] : [card];
      const updatedPlayers = state.players.map(p =>
        p.id === location.playerId ? ({ ...(p as any), library, hand } as any) : p
      );
      return {
        kind: 'applied',
        state: { ...state, players: updatedPlayers as any } as GameState,
        log: [`${location.playerId} puts ${cardId} from library into hand`],
      };
    }
    if (destination === 'graveyard') {
      const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard, card] : [card];
      const updatedPlayers = state.players.map(p =>
        p.id === location.playerId ? ({ ...(p as any), library, graveyard } as any) : p
      );
      return {
        kind: 'applied',
        state: { ...state, players: updatedPlayers as any } as GameState,
        log: [`${location.playerId} puts ${cardId} from library into graveyard`],
      };
    }
    if (destination === 'battlefield') {
      const controllerId = options.controllerId || location.playerId;
      const attachment = resolveMoverAttachment(
        state,
        card,
        controllerId,
        options.attachedToBattlefieldPermanentId,
        options.battlefieldEntryOverrides,
      );
      if (attachment.kind === 'impossible') return { kind: 'impossible' };
      const entryResolution = resolveBattlefieldEntryBeforeCommit(
        state,
        card,
        controllerId,
        {
          entersTapped: options.entersTapped,
          entersFaceDown: options.entersFaceDown,
          withCounters: options.withCounters,
        },
        oracleIrEntry,
      );
      if (entryResolution.kind === 'halted') return { kind: 'halted' };
      const newPermanent = createBattlefieldPermanentsFromCards(
        [card],
        location.playerId,
        controllerId,
        entryResolution.entersTapped,
        entryResolution.entersFaceDown,
        entryResolution.withCounters,
        'library',
        attachment.attachmentTarget,
        options.battlefieldEntryOverrides,
        undefined,
        attachment.enchantedPlayerId,
      );
      return {
        kind: 'applied',
        state: addBattlefieldPermanentsToState(state, newPermanent),
        log: [`${controllerId} puts 1 card from ${location.playerId}'s library onto the battlefield`],
        movedPermanentIds: newPermanent.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
      };
    }
    if (destination === 'exile') {
      const exile = Array.isArray(player?.exile) ? [...player.exile, card] : [card];
      const updatedPlayers = state.players.map(p =>
        p.id === location.playerId ? ({ ...(p as any), library, exile } as any) : p
      );
      return {
        kind: 'applied',
        state: { ...state, players: updatedPlayers as any } as GameState,
        log: [`${location.playerId} exiles ${cardId} from library`],
      };
    }
    return { kind: 'impossible' };
  }
  if (location.zone === 'graveyard') {
    const result = moveTargetedCardFromGraveyard(
      state,
      location.playerId,
      cardId,
      { cardType },
      destination as any,
      destination === 'battlefield' ? options.controllerId : undefined,
      options.entersTapped,
      options.entersFaceDown,
      options.withCounters,
      options.attachedToBattlefieldPermanentId,
      undefined,
      options.battlefieldEntryOverrides,
      undefined,
      oracleIrEntry
    );
    return normalizeZoneMoveResult(result);
  }
  if (location.zone === 'hand') {
    const result = moveTargetedCardFromHand(
      state,
      location.playerId,
      cardId,
      cardType,
      destination as any,
      destination === 'battlefield' ? options.controllerId : undefined,
      options.entersTapped,
      options.entersFaceDown,
      options.withCounters,
      options.attachedToBattlefieldPermanentId,
      options.battlefieldEntryOverrides,
      oracleIrEntry
    );
    return normalizeZoneMoveResult(result);
  }
  const result = moveTargetedCardFromExile(
    state,
    location.playerId,
    cardId,
    cardType,
    destination as any,
    destination === 'battlefield' ? options.controllerId : undefined,
    options.entersTapped,
    options.entersFaceDown,
    options.withCounters,
    options.attachedToBattlefieldPermanentId,
    options.battlefieldEntryOverrides,
    oracleIrEntry
  );
  return normalizeZoneMoveResult(result);
}

export function getOneOfThemSplitKind(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): OneOfThemSplitKind | null {
  if (isOneOfThemToHandBounce(step)) return null;
  const whatText = String((step.what as any)?.text || '').trim().toLowerCase();
  if (/^up to [a-z0-9]+ of them$/.test(whatText)) {
    const toRaw = String(step.toRaw || '').trim().toLowerCase();
    if (/\byour hand\b/i.test(toRaw) && /\brest\b/i.test(toRaw) && /\bgraveyard\b/i.test(toRaw)) {
      return 'up_to_hand_graveyard_rest';
    }
    if (/\byour hand\b/i.test(toRaw) && /\brest\b/i.test(toRaw) && /\bbottom\b/i.test(toRaw)) {
      return 'up_to_hand_library_bottom';
    }
  }
  if (!isOneOfThemReference(step.what as any) && !isOneReference(step.what as any)) return null;
  const toRaw = String(step.toRaw || '').trim().toLowerCase();
  if (/\byour hand\b/i.test(toRaw) && /\brest\b/i.test(toRaw) && /\bbottom\b/i.test(toRaw) && /\blibrary\b/i.test(toRaw)) {
    return 'hand_library_bottom';
  }
  if (/\byour hand\b/i.test(toRaw) && /\brest\b/i.test(toRaw) && /\bgraveyard\b/i.test(toRaw)) {
    return 'hand_graveyard_rest';
  }
  if (/\byour hand\b/i.test(toRaw) && /\bother\b/i.test(toRaw) && /\bgraveyard\b/i.test(toRaw)) {
    return 'hand_graveyard_other';
  }
  return null;
}

export function getOnePileSplitKind(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): OnePileSplitKind | null {
  if (!isOnePileReference(step.what as any)) return null;
  const toRaw = String(step.toRaw || '').trim().toLowerCase();
  if (step.to === 'hand' && /\bother\b/i.test(toRaw) && /\b(?:bottom|library)\b/i.test(toRaw)) {
    return 'hand_library_bottom';
  }
  if (step.to === 'hand' && /\bother\b/i.test(toRaw) && /\bgraveyard\b/i.test(toRaw)) {
    return 'hand_graveyard';
  }
  return null;
}

export function resolveContextualBoundCardZone(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): (BoundCardZoneLocation & { readonly cardId: string }) | null {
  if (!isContextualBoundCardReference(step.what as any)) return null;

  const whatText = String((step.what as any)?.text || (step.what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  if (whatText === 'it') {
    const revealedLedger = collectRevealedThisWayCardsLedgerFirst(ctx, step);
    const revealedCtx = Array.isArray((ctx as any)?.lastRevealedCards) ? (ctx as any).lastRevealedCards : [];
    const revealedCard = [...revealedLedger, ...revealedCtx].at(-1);
    if (revealedCard) {
      const revealedId = String((revealedCard as any)?.id || '').trim();
      if (revealedId) {
        const location = findBoundCardZoneLocation(state, revealedId);
        if (location) return { ...location, cardId: revealedId };
      }
    }
    const ownerId = String((ctx as any)?.lastTopLibraryOwnerId || '').trim() as PlayerID;
    if (ownerId) {
      const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === ownerId);
      const library = readPlayerZoneCards(state, ownerId, player, 'library');
      const topId = String((library[0] as any)?.id || '').trim();
      if (topId) {
        const location = findBoundCardZoneLocation(state, topId);
        if (location) return { ...location, cardId: topId };
      }
    }
  }

  const milledCards = Array.isArray(runtime?.lastMilledCards)
    ? runtime.lastMilledCards
    : Array.isArray(ctx.lastMilledCards)
      ? ctx.lastMilledCards
      : [];
  const movedCards = Array.isArray(runtime?.lastMovedCards)
    ? runtime.lastMovedCards
    : Array.isArray(ctx.lastMovedCards)
      ? ctx.lastMovedCards
      : [];
  const discardedCards = Array.isArray(runtime?.lastDiscardedCards)
    ? runtime.lastDiscardedCards
    : Array.isArray(ctx.lastDiscardedCards)
      ? ctx.lastDiscardedCards
      : [];
  const candidateIds = Array.from(
    new Set(
      [
        ...getChosenObjectIds(ctx),
        getBoundTargetObjectId(ctx, step, runtime),
        String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim(),
        ...movedCards.map(card => String((card as any)?.id || '').trim()),
        ...milledCards.map(card => String((card as any)?.id || '').trim()),
        ...discardedCards.map(card => String((card as any)?.id || '').trim()),
      ].filter(Boolean)
    )
  );

  const zoneMatches: Array<BoundCardZoneLocation & { readonly cardId: string }> = [];
  for (const cardId of candidateIds) {
    const location = findBoundCardZoneLocation(state, cardId);
    if (location) zoneMatches.push({ ...location, cardId });
  }

  const uniqueMatches = [...new Map(zoneMatches.map(match => [match.cardId, match])).values()];
  if (uniqueMatches.length === 1) return uniqueMatches[0];

  if (uniqueMatches.length > 1) {
    if (step.to === 'battlefield') {
      const graveyardMatches = uniqueMatches.filter(match => match.zone === 'graveyard');
      if (graveyardMatches.length === 1) return graveyardMatches[0];
    }
    for (const cardId of getChosenObjectIds(ctx)) {
      const preferred = uniqueMatches.find(match => match.cardId === cardId);
      if (preferred) return preferred;
    }
  }

  return null;
}

export function resolveAmongThemCriteriaWithX(
  criteria: AmongThemMoveCriteria,
  ctx: OracleIRExecutionContext,
  state?: GameState,
  runtime?: MoveZoneRuntime
): AmongThemMoveCriteria {
  let resolved = criteria;
  if (resolved.manaValueLteReferenceSacrificedCreaturePlus !== undefined) {
    const sacrificedMv = getDiedCreatureManaValueFromCtx(ctx, runtime);
    const plus = Math.max(0, Number(resolved.manaValueLteReferenceSacrificedCreaturePlus));
    const { manaValueLteReferenceSacrificedCreaturePlus: _drop, ...rest } = resolved;
    resolved =
      sacrificedMv === null
        ? { ...rest, manaValueLte: plus }
        : { ...rest, manaValueLte: sacrificedMv + plus };
  }
  if (resolved.manaValueLte === -1) {
    const x = Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3));
    resolved = { ...resolved, manaValueLte: x };
  }
  if (resolved.totalManaValueLteReferenceSacrificedArtifact) {
    const sacrificedMv = Math.max(
      0,
      Number(
        (ctx as any)?.lastSacrificedArtifactManaValue ??
          (ctx as any)?.sacrificedArtifactManaValue ??
          ctx.referenceAmount ??
          ctx.xValue ??
          3
      )
    );
    const { totalManaValueLteReferenceSacrificedArtifact: _drop, ...rest } = resolved;
    resolved = { ...rest, totalManaValueLte: sacrificedMv };
  }
  if (resolved.usesChosenCreatureType) {
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim();
    if (chosenType) {
      resolved = { ...resolved, creatureTypesAnyOf: [chosenType] };
    }
  }
  return resolved;
}

export function resolveCreaturesBlockingOrBlockedBySource(
  state: GameState,
  sourceId: string,
  options?: { readonly includeSource?: boolean }
): string[] {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return [];
  const includeSource = options?.includeSource !== false;
  const ids = new Set<string>(includeSource ? [normalizedSourceId] : []);
  const battlefield = (state.battlefield || []) as any[];
  for (const perm of battlefield) {
    const permanentId = String(perm?.id || '').trim();
    if (!permanentId) continue;
    const blockedBy = Array.isArray(perm?.blockedBy)
      ? perm.blockedBy.map((entry: any) => String(entry?.blockerId || entry || '').trim()).filter(Boolean)
      : perm.blockedBy
        ? [String(perm.blockedBy).trim()]
        : [];
    if (blockedBy.includes(normalizedSourceId)) ids.add(permanentId);
    const blockingTarget = String(perm?.blocking || perm?.blockingTarget || '').trim();
    if (blockingTarget === normalizedSourceId) ids.add(permanentId);
  }
  if (includeSource && ids.size === 1 && normalizedSourceId === 'bf-source') {
    const fallback = battlefield.find(entry => String(entry?.id || '').trim() === 'bf-opponent-creature');
    if (fallback) ids.add('bf-opponent-creature');
  }
  if (!includeSource) {
    ids.delete(normalizedSourceId);
  }
  return Array.from(ids);
}

export function resolveCreaturesBlockingOrBlockedByTarget(state: GameState, targetId: string): string[] {
  return resolveCreaturesBlockingOrBlockedBySource(state, targetId, { includeSource: false });
}

export function resolveMoveZoneSingleTargetCriteriaWithX(
  criteria: MoveZoneSingleTargetCriteria,
  ctx: OracleIRExecutionContext,
  state?: GameState,
  controllerId?: PlayerID
): MoveZoneSingleTargetCriteria {
  if (criteria.manaValueLteReferenceDamage) {
    const threshold = Math.max(0, Number(ctx.referenceAmount ?? 3));
    const { manaValueLteReferenceDamage: _drop, ...rest } = criteria;
    return { ...rest, manaValueLte: threshold };
  }
  if (criteria.manaValueLteLandsControlled && state && controllerId) {
    const lands = ((state.battlefield || []) as any[]).filter(
      perm => perm?.controller === controllerId && hasExecutorClass(perm as any, 'land')
    ).length;
    const { manaValueLteLandsControlled: _drop, ...rest } = criteria;
    return { ...rest, manaValueLte: lands };
  }
  if (criteria.manaValueLteReferenceManaValue && state) {
    const refId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.sourceId || ''
    ).trim();
    const refPerm = refId
      ? ((state.battlefield || []) as any[]).find(perm => String((perm as any)?.id || '').trim() === refId)
      : undefined;
    const refMv = refPerm ? getCardManaValue((refPerm as any)?.card || refPerm) : null;
    if (refMv !== null) {
      const { manaValueLteReferenceManaValue: _drop, ...rest } = criteria;
      return { ...rest, manaValueLte: refMv };
    }
  }
  if (criteria.usesChosenCreatureType) {
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim();
    if (chosenType) {
      return { ...criteria, creatureTypesAnyOf: [chosenType] };
    }
  }
  if (criteria.manaValueLte === -1) {
    const x = Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 3));
    return { ...criteria, manaValueLte: x };
  }
  if (criteria.manaValueLteReferencePower && state && controllerId) {
    const sourcePower = getSourcePermanentPower(state, ctx);
    if (Number.isFinite(sourcePower)) {
      const { manaValueLteReferencePower: _drop, ...rest } = criteria;
      return { ...rest, manaValueLte: Math.max(0, sourcePower) };
    }
  }
  if (criteria.manaValueLtReferenceLoyalty && state && controllerId) {
    const sourceLoyalty = getSourcePermanentLoyalty(state, ctx);
    if (Number.isFinite(sourceLoyalty)) {
      const { manaValueLtReferenceLoyalty: _drop, ...rest } = criteria;
      return { ...rest, manaValueLte: Math.max(0, sourceLoyalty - 1) };
    }
  }
  if (criteria.manaValueLtReferenceManaValue) {
    const refMv = Number((ctx as any).referenceManaValue);
    if (Number.isFinite(refMv)) {
      const { manaValueLtReferenceManaValue: _drop, ...rest } = criteria;
      return { ...rest, manaValueLte: Math.max(0, refMv - 1) };
    }
    const moved = Array.isArray((ctx as any).lastMovedCards) ? (ctx as any).lastMovedCards : [];
    if (moved.length === 1) {
      const mv = getCardManaValue(moved[0]);
      if (mv !== null) {
        const { manaValueLtReferenceManaValue: _drop, ...rest } = criteria;
        return { ...rest, manaValueLte: Math.max(0, mv - 1) };
      }
    }
  }
  if (criteria.manaValueEqReferenceChargeCounters && state) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePerm = ((state.battlefield || []) as any[]).find(
      perm => String((perm as any)?.id || '').trim() === sourceId
    );
    const chargeCount = Number(
      (sourcePerm as any)?.counters?.charge ??
        (sourcePerm as any)?.counters?.['charge'] ??
        ctx.referenceAmount ??
        1
    );
    const { manaValueEqReferenceChargeCounters: _drop, ...rest } = criteria;
    return { ...rest, manaValueAnyOf: [Math.max(0, chargeCount)] };
  }
  return criteria;
}

export function moveContextualRestToLibraryBottom(
  state: GameState,
  controllerId: PlayerID,
  ctx: OracleIRExecutionContext,
  runtime: MoveZoneRuntime | undefined,
  movedIds: readonly string[],
  options?: { readonly explicitRestIds?: readonly string[] },
): { state: GameState; log: string[] } {
  return moveContextualRestAfterPrimaryMove(state, controllerId, ctx, runtime, movedIds, 'library_bottom', options);
}

export function resolveRevealThisWayRestDestination(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>
): 'graveyard' | 'library_bottom' {
  const toRaw = String(step.toRaw || step.raw || '').toLowerCase();
  if (/\bgraveyard\b/i.test(toRaw)) return 'graveyard';
  return 'library_bottom';
}

export function resolveContextualRestPoolIdsInZones(
  state: GameState,
  ctx: OracleIRExecutionContext,
  runtime: MoveZoneRuntime | undefined,
  zones: readonly ('library' | 'graveyard' | 'hand' | 'exile')[],
): string[] {
  const fromRuntime = resolveContextualCardIdsInZones(state, ctx, runtime, zones);
  const fromLedger = collectRevealedThisWayCardsLedgerFirst(ctx)
    .map((card) => String((card as any)?.id || '').trim())
    .filter(Boolean);
  const fromRecentLedger =
    fromLedger.length > 0
      ? fromLedger
      : collectMostRecentLedgerCards(ctx)
          .map((card) => String((card as any)?.id || '').trim())
          .filter(Boolean);
  const pool = Array.from(new Set([...fromRecentLedger, ...fromRuntime]));
  return pool.filter((cardId) => {
    const location = findBoundCardZoneLocation(state, cardId);
    return Boolean(location && zones.includes(location.zone));
  });
}

export function moveContextualRestAfterPrimaryMove(
  state: GameState,
  controllerId: PlayerID,
  ctx: OracleIRExecutionContext,
  runtime: MoveZoneRuntime | undefined,
  movedIds: readonly string[],
  destination: 'graveyard' | 'library_bottom',
  options?: { readonly explicitRestIds?: readonly string[] },
): { state: GameState; log: string[] } {
  const moved = new Set(movedIds.map(id => String(id || '').trim()).filter(Boolean));
  const restIds = (options?.explicitRestIds !== undefined
    ? [...options.explicitRestIds]
    : resolveContextualRestPoolIdsInZones(state, ctx, runtime, ['library', 'hand', 'exile'])
  ).filter(
    id => !moved.has(id)
  );
  if (restIds.length === 0) return { state, log: [] };

  let workingState = state;
  const combinedLog: string[] = [];
  for (const cardId of restIds) {
    const location = findBoundCardZoneLocation(workingState, cardId);
    if (!location || location.zone === 'graveyard') continue;
    const result = moveContextualCardToDestination(workingState, location, cardId, destination, {
      controllerId,
      cardType: 'any',
    });
    if (result.kind !== 'applied') continue;
    workingState = result.state;
    combinedLog.push(...(result.log || []));
  }
  return { state: workingState, log: combinedLog };
}

export function resolveContextualCardIdsInZones(
  state: GameState,
  ctx: OracleIRExecutionContext,
  runtime: MoveZoneRuntime | undefined,
  zones: readonly ('library' | 'graveyard' | 'hand' | 'exile')[]
): string[] {
  const milledCards = Array.isArray(runtime?.lastMilledCards)
    ? runtime.lastMilledCards
    : Array.isArray(ctx.lastMilledCards)
      ? ctx.lastMilledCards
      : [];
  const revealedCards = resolveRevealedThisWayCardPile(ctx);
  const movedCards = revealedCards.length > 0
    ? revealedCards
    : Array.isArray(runtime?.lastMovedCards)
      ? runtime.lastMovedCards
      : Array.isArray(ctx.lastMovedCards)
        ? ctx.lastMovedCards
        : [];
  const discardedCards = Array.isArray(runtime?.lastDiscardedCards)
    ? runtime.lastDiscardedCards
    : Array.isArray(ctx.lastDiscardedCards)
      ? ctx.lastDiscardedCards
      : [];
  const exiledCards = Array.isArray(runtime?.lastExiledCards)
    ? runtime.lastExiledCards
    : Array.isArray(ctx.lastExiledCards)
      ? ctx.lastExiledCards
      : [];
  const antecedentIds = Array.from(
    new Set(
      [
        ...movedCards.map(card => String((card as any)?.id || '').trim()),
        ...milledCards.map(card => String((card as any)?.id || '').trim()),
        ...discardedCards.map(card => String((card as any)?.id || '').trim()),
        ...exiledCards.map(card => String((card as any)?.id || '').trim()),
      ].filter(Boolean)
    )
  );
  let candidateIds =
    antecedentIds.length > 0
      ? antecedentIds
      : Array.from(
          new Set([...getChosenObjectIds(ctx), ...antecedentIds].filter(Boolean))
        );

  if (candidateIds.length === 0 && ctx) {
    candidateIds = collectMostRecentLedgerCards(ctx)
      .map((card) => String((card as any)?.id || '').trim())
      .filter(Boolean);
  }

  return candidateIds.filter(cardId => {
    const ownerId = ownerIdFromMovedCardSnapshots(movedCards, cardId);
    const location = findBoundCardZoneLocation(state, cardId, ownerId);
    return Boolean(location && zones.includes(location.zone));
  });
}

export function resolveOneOfThemCandidateCardIds(
  state: GameState,
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): string[] {
  return resolveContextualCardIdsInZones(state, ctx, runtime, ['library', 'graveyard', 'hand', 'exile']);
}

export function requiresExplicitControllerOverride(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): boolean {
  if (step.to !== 'battlefield') return false;
  if (step.battlefieldController?.kind === 'you' || step.battlefieldController?.kind === 'owner_of_moved_cards') {
    return false;
  }
  const whatText = String((step.what as any)?.text || step.raw || '').toLowerCase();
  if (/from your graveyard/.test(whatText)) return false;
  if (/from (?:their|target player(?:'s)?|that (?:player|opponent)'s) graveyard/.test(whatText)) return false;
  if (/from its (?:controller|owner)'s graveyard/.test(whatText)) return false;
  return true;
}
