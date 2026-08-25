/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: leftover what-parsers and helpers from parseMoveZoneCardFromOutsideGame
 * through shuffleContextualCardsIntoLibrary.
 * Public entry symbols: parseMoveZoneCardFromOutsideGame,
 * putOpponentOwnedMatchingFromExileOntoBattlefield, shuffleContextualCardsIntoLibrary.
 */
import type { GameState, PlayerID } from '../../shared/src';
import { getGraveyardCardTypesFromTypeLine } from './oracleIRExecutorZoneOpsAmongMilledResolvers';
import { cardMatchesType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import { moveTargetedCardFromExile } from './oracleIRExecutorZoneOpsHandExileTargetedMovers';

export function parseMoveZoneCardFromOutsideGame(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a card you own from outside the game';
}

export function parseMoveZoneOneOrMoreCreaturesFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'one or more creature cards from your graveyard';
}

export function parseMoveZoneOwnedNonlandPermanentYouOwn(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a nonland permanent you own';
}

export function parseMoveZoneShuffleAnyNumberTargetCardsFromTargetPlayerGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === "any number of target cards from target player's graveyard";
}

export function parseMoveZoneExileXTargetCardsFromTargetPlayerGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === "x target cards from target player's graveyard" ||
    raw === "any number of target cards from target player's graveyard"
  );
}

export function parseMoveZoneForEachOpponentUpToOneNonlandBounce(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}, stepRaw?: string): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any)?.text || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  const fullRaw = String(stepRaw || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  if (
    raw ===
      "for each opponent, return up to one target nonland permanent that player controls to its owner's hand" ||
    fullRaw ===
      "for each opponent, return up to one target nonland permanent that player controls to its owner's hand"
  ) {
    return true;
  }
  return raw === 'up' && /\bfor each opponent,\s+return up to one target nonland permanent\b/i.test(fullRaw);
}

export function parseMoveZoneAnyNumberOpponentOwnedLandsFromExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'any number of land cards that player owns from exile';
}

export function parseMoveZoneCreatureFromOwnersGraveyardUnderOwner(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === "a creature card from its owner's graveyard";
}

export function parseMoveZoneEnchantedCreatureAndAurasToHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): 'all_attached_auras' | 'this_aura' | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'enchanted creature and all auras attached to that creature') {
    return 'all_attached_auras';
  }
  if (raw === 'enchanted creature and this aura') {
    return 'this_aura';
  }
  return null;
}

export function parseMoveZoneBottomCardFromLibrary(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): 'your' | 'target_player' | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'the bottom card of your library') return 'your';
  if (
    raw === "the bottom card of target player's library" ||
    raw === "the bottom card of target opponent's library" ||
    raw === "the bottom card of that player's library" ||
    raw === "the bottom card of that opponent's library"
  ) {
    return 'target_player';
  }
  return null;
}

export function parseMoveZoneOneTwoOrThreeTargetCreatureCardsFromGraveyards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType; readonly maxCount: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'one, two, or three target creature cards from graveyards') {
    return { cardType: 'creature', maxCount: 3 };
  }
  return null;
}

export function parseMoveZoneExileXTargetCreatureCardsFromGraveyards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType; readonly useXValue: true } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'x target creature cards from graveyards') {
    return { cardType: 'creature', useXValue: true };
  }
  return null;
}

export function parseMoveZoneDelayedReturnThisCreatureUnderTargetPlayer(step: {
  readonly what?: { readonly kind?: string; readonly text?: string };
  readonly raw?: string;
  readonly to?: string;
  readonly toRaw?: string;
}): boolean {
  const whatText = String((step.what as any)?.text || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  if (whatText !== 'this creature') return false;
  const combined = `${String(step.raw || '')} ${String(step.toRaw || '')}`.toLowerCase();
  return (
    step.to === 'battlefield' &&
    /\bat the beginning of (?:their|that player'?s) next upkeep\b/.test(combined) &&
    /\bunder (?:that player'?s|their) control\b/.test(combined)
  );
}

export function parseMoveZoneSingleCardExiledWithIt(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a card exiled with it';
}

export function parseMoveZoneDiscardedCardFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'the discarded card from your graveyard';
}

export function parseMoveZoneReturnThisVehicleToOwnersHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}, stepRaw?: string): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const fullRaw = String(stepRaw || '').trim().toLowerCase();
  if (raw === "this vehicle to its owner's hand") return true;
  return raw === 'this vehicle' && /\breturn this vehicle\b/i.test(fullRaw);
}

export function parseMoveZoneAnyNumberGyWithCardTypesAmong(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly minDistinctTypes: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw !== 'any number of cards from your graveyard with four or more card types among them') return null;
  return { minDistinctTypes: 4 };
}

export function parseMoveZoneCloakCardFromHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}, stepRaw?: string): boolean {
  if (what.kind !== 'raw') return false;
  const text = String((what as any)?.text || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  const raw = String(stepRaw || (what as any)?.raw || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  return raw === 'cloak a card from your hand' || (/\bcloak\b/i.test(raw) && text === 'a card from your hand');
}

export function parseMoveZoneUpToOneNoncreatureNonlandFromTargetPlayerGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === "up to one noncreature, nonland card from that player's graveyard";
}

export function parseMoveZoneMechtitanReturnExiledExceptSelf(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (/^all cards exiled with this vehicle except this card(?:\s+to\b.*)?$/i.test(raw)) return true;
  return false;
}

export function parseMoveZoneOneOfThemFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'one of them from your graveyard';
}

export function parseMoveZoneExileItFromTheirGraveyardWithStash(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'it from their graveyard with a stash counter on it' ||
    raw === "it from target opponent's graveyard with a stash counter on it"
  );
}

export function parseMoveZoneOneOfThoseCardsWithThatNameToHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === "one of those cards with that name into its owner's hand" ||
    raw === 'one of those cards with that name'
  );
}

export function parseMoveZoneRandomFromEachOpponentGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === "a card at random from each opponent's graveyard";
}

export function parseMoveZonePutThatCardBfShuffleRestRevealed(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'put that card onto the battlefield and shuffle all other cards revealed this way into your library' ||
    raw === 'that card onto the battlefield and shuffle all other cards revealed this way into your library'
  );
}

export function parseMoveZoneThemToOwnersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
  stepRaw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'them';
}

export function putOpponentOwnedMatchingFromExileOntoBattlefield(
  state: GameState,
  controllerId: PlayerID,
  ownerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[]; movedPermanentIds?: readonly string[] } {
  let workingState = state;
  const combinedLog: string[] = [];
  const movedPermanentIds: string[] = [];

  for (const player of state.players || []) {
    const zonePlayerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!zonePlayerId) continue;
    const exile = Array.isArray((player as any)?.exile) ? (player as any).exile : [];
    for (const card of exile) {
      const cardOwner = String((card as any)?.owner || zonePlayerId).trim();
      if (cardOwner !== ownerId || !cardMatchesType(card, cardType)) continue;
      const cardId = String((card as any)?.id || '').trim();
      if (!cardId) continue;
      const result = moveTargetedCardFromExile(
        workingState,
        zonePlayerId,
        cardId,
        cardType,
        'battlefield',
        controllerId,
        entersTapped,
        entersFaceDown,
        withCounters
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedPermanentIds.push(...(result.movedPermanentIds || []));
    }
  }

  return {
    state: workingState,
    log: combinedLog.length > 0 ? combinedLog : [],
    movedPermanentIds,
  };
}

export function selectGraveyardCardsWithMinDistinctTypes(
  state: GameState,
  playerId: PlayerID,
  minDistinctTypes: number,
  preferredIds: readonly string[] = []
): readonly string[] {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return [];
  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const candidates = graveyard
    .map((card: any) => String(card?.id || '').trim())
    .filter(Boolean)
    .filter(cardId => preferred.size === 0 || preferred.has(cardId));
  if (candidates.length === 0) {
    return graveyard.map((card: any) => String(card?.id || '').trim()).filter(Boolean).slice(0, 4);
  }
  const selected: string[] = [];
  const types = new Set<string>();
  for (const cardId of candidates) {
    const card = graveyard.find((entry: any) => String(entry?.id || '').trim() === cardId);
    if (!card) continue;
    for (const typeWord of getGraveyardCardTypesFromTypeLine(card)) {
      types.add(typeWord);
    }
    selected.push(cardId);
    if (types.size >= minDistinctTypes) break;
  }
  return selected.length > 0 ? selected : candidates.slice(0, Math.min(candidates.length, 4));
}

export function shuffleContextualCardsIntoLibrary(
  state: GameState,
  playerId: PlayerID,
  cardIds: readonly string[]
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player || cardIds.length === 0) return { state, log: [] };

  const wanted = new Set(cardIds.map(id => String(id || '').trim()).filter(Boolean));
  const moved: any[] = [];
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const keptHand: any[] = [];
  const keptExile: any[] = [];
  const keptGraveyard: any[] = [];

  for (const card of hand) {
    const cardId = String((card as any)?.id || '').trim();
    if (wanted.has(cardId)) moved.push(card);
    else keptHand.push(card);
  }
  for (const card of exile) {
    const cardId = String((card as any)?.id || '').trim();
    if (wanted.has(cardId)) moved.push(card);
    else keptExile.push(card);
  }
  for (const card of graveyard) {
    const cardId = String((card as any)?.id || '').trim();
    if (wanted.has(cardId)) moved.push(card);
    else keptGraveyard.push(card);
  }

  if (moved.length === 0) return { state, log: [] };
  const library = Array.isArray(player.library) ? [...player.library, ...moved] : [...moved];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId
      ? ({ ...(p as any), library, hand: keptHand, exile: keptExile, graveyard: keptGraveyard } as any)
      : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as GameState,
    log: [`${playerId} shuffles ${moved.length} revealed card(s) into their library`],
  };
}
