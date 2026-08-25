/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: shuffle-source / cycling-permanent / among-milled resolvers
 * from parseMoveZoneShuffleSourceAndTargetIntoLibraries through resolveCardIdsFromAnyGraveyard,
 * including GRAVEYARD_CARD_TYPE_WORDS and getGraveyardCardTypesFromTypeLine.
 * Public entry symbols: exileUpToOneEachCardTypeFromGraveyard, resolveAmongThemMatchingCardIds,
 * resolveCardIdsFromAnyGraveyard, getGraveyardCardTypesFromTypeLine.
 */
import type { GameState, PlayerID } from '../../shared/src';
import { getCardManaValue, getCurrentTurnNumber } from './oracleIRExecutorPlayerUtils';
import type { AmongThemMoveCriteria } from './oracleIRExecutorZoneOpsAmongThemParsers';
import {
  cardMatchesType,
  getCardPower,
  parseSimpleCardTypeFromText,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import { normalizeBoundPlayerZoneSelectorText } from './oracleIRExecutorZoneOpsGraveyardCountParsers';
import type { MoveZoneUpToTargetCountSpec } from './oracleIRExecutorZoneOpsHandSimpleWhatParsers';
import { parseMoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import { cardMatchesMoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetMatchers';

export function parseMoveZoneShuffleSourceAndTargetIntoLibraries(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^this creature and target (.+?) with a stun counter on it$/i);
  if (!match) return null;
  const typeText = String(match[1] || '').trim();
  const parsed = parseMoveZoneSingleTargetCriteria(typeText) || (
    parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null
  );
  if (!parsed) return null;
  return { ...parsed, requiredCounter: 'stun' };
}

export function parseMoveZoneUpToXFromAmongExiledWithThis(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'up to x cards from among cards exiled with this artifact';
}

export function parseMoveZoneAnyNumberSaddledCreaturesToHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'any number of creatures that saddled it this turn';
}

export function parseMoveZoneUpToXOtherCreaturesBfOrGy(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'up to x other target creatures from the battlefield and/or creature cards from graveyards' ||
    raw === 'up to three other target creatures from the battlefield and/or creature cards from graveyards'
  );
}

export function parseMoveZoneEachCreatureWithPowerOfChosenQuality(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'each creature with power of the chosen quality';
}

export type DestroyChosenQualityMetric = 'power' | 'mana_value';

export function parseDestroyChosenQualityTarget(target: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly metric: DestroyChosenQualityMetric; readonly excludeSource: boolean } | null {
  if (target.kind !== 'raw') return null;
  const raw = String((target as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'each creature with power of the chosen quality') {
    return { metric: 'power', excludeSource: false };
  }
  if (raw === 'each other creature with mana value of the chosen quality') {
    return { metric: 'mana_value', excludeSource: true };
  }
  if (raw === 'each creature with mana value of the chosen quality') {
    return { metric: 'mana_value', excludeSource: false };
  }
  return null;
}

export function parseMoveZoneEachOpponentCreatureToughnessXOrLess(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'each creature your opponents control with toughness x or less';
}

export function parseMoveZoneTopLibraryFaceDownPerOpponent(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a card from the top of your library face down for each opponent you have';
}

export function parseMoveZoneAllNamedThisPermanentFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'all cards named this permanent from your graveyard';
}

export function parseMoveZoneCreatureExiledWithThisVehicle(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a creature card exiled with this vehicle';
}

export function parseMoveZoneAnyNumberCyclingPermanentsFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'any number of target permanent cards with cycling abilities from your graveyard';
}

export function parseMoveZoneAnyNumberCreaturesTotalPowerFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly totalPowerLte: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^any number of target creature cards with total power (\d+) or less from your graveyard$/);
  if (match) {
    const total = Number.parseInt(String(match[1] || ''), 10);
    if (!Number.isFinite(total)) return null;
    return { totalPowerLte: total };
  }
  if (
    raw ===
    "any number of other creature cards with total power x or less from your graveyard, where x is this creature's power"
  ) {
    return { totalPowerLte: -1 };
  }
  if (raw === 'any number of other creature cards with total power x or less from your graveyard') {
    return { totalPowerLte: -1 };
  }
  return null;
}

export function parseMoveZoneUpToThatManyFromTheirGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneUpToTargetCountSpec | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim())
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  if (
    raw !== 'up to that many target cards from their graveyard' &&
    raw !== "up to that many target cards from target opponent's graveyard"
  ) {
    return null;
  }
  return { maxCount: 0, criteria: { cardType: 'any' }, useReferenceAmount: true };
}

const GRAVEYARD_CARD_TYPE_WORDS = [
  'artifact',
  'battle',
  'creature',
  'enchantment',
  'instant',
  'kindred',
  'land',
  'planeswalker',
  'sorcery',
] as const;

export function getGraveyardCardTypesFromTypeLine(card: any): readonly string[] {
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  if (!typeLine) return [];
  const found: string[] = [];
  for (const typeWord of GRAVEYARD_CARD_TYPE_WORDS) {
    if (typeLine.includes(typeWord) && !found.includes(typeWord)) {
      found.push(typeWord);
    }
  }
  return found;
}

export function exileUpToOneEachCardTypeFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  preferredIds: readonly string[] = []
): { state: GameState; log: string[]; movedCards: any[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [], movedCards: [] };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const preferred = preferredIds.map(id => String(id || '').trim()).filter(Boolean);
  const pickedTypes = new Set<string>();
  const picked: any[] = [];
  const kept: any[] = [];

  const pickCard = (card: any): void => {
    const types = getGraveyardCardTypesFromTypeLine(card);
    if (types.length === 0) {
      kept.push(card);
      return;
    }
    const unpickedType = types.find(type => !pickedTypes.has(type));
    if (!unpickedType) {
      kept.push(card);
      return;
    }
    pickedTypes.add(unpickedType);
    picked.push(card);
  };

  for (const wantedId of preferred) {
    const card = graveyard.find((entry: any) => String(entry?.id || '').trim() === wantedId);
    if (!card) continue;
    pickCard(card);
  }
  for (const card of graveyard) {
    const cardId = String((card as any)?.id || '').trim();
    if (preferred.includes(cardId)) continue;
    pickCard(card);
  }

  if (picked.length === 0) return { state, log: [], movedCards: [] };

  const pickedIds = new Set(picked.map(card => String((card as any)?.id || '').trim()).filter(Boolean));
  const nextGraveyard = graveyard.filter(card => !pickedIds.has(String((card as any)?.id || '').trim()));

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: nextGraveyard, exile: [...exile, ...picked] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles up to one card of each card type from graveyard`],
    movedCards: picked,
  };
}

export function parseMoveZoneUpToOneEachCardTypeFromBoundGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim())
    .replace(/[.\s]+$/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return (
    raw === "up to one card of each card type from target opponent's graveyard" ||
    raw === "up to one card of each card type from target player's graveyard"
  );
}

export function parseMoveZoneCreatureFromAmongCardsMilledThisWay(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^(?:a|an)\s+(.+?)\s+card from among the cards milled this way$/i);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneCreatureHandOrCommandZoneLesserMv(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^(?:a|an)\s+(.+?)\s+card you own with lesser mana value from your hand or from the command zone$/i
  );
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneOneOfThemBfTappedOtherHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'one of them onto the battlefield tapped and the other';
}


export function selectGraveyardCardsWithTotalManaValueLte(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  totalManaValueLte: number,
  preferredIds: readonly string[] = []
): string[] {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return [];
  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const candidates = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || !cardMatchesType(card, cardType)) return false;
    if (preferred.size > 0 && !preferred.has(cardId)) return false;
    return true;
  });
  const pool = candidates.length > 0 ? candidates : graveyard.filter((card: any) => cardMatchesType(card, cardType));
  const selected: string[] = [];
  let total = 0;
  for (const card of pool) {
    const mv = getCardManaValue(card);
    if (mv === null) continue;
    if (total + mv > totalManaValueLte) continue;
    const cardId = String(card?.id || '').trim();
    if (!cardId) continue;
    selected.push(cardId);
    total += mv;
  }
  return selected;
}

export function selectGraveyardCreatureCardsWithTotalPowerLte(
  state: GameState,
  playerId: PlayerID,
  totalPowerLte: number,
  preferredIds: readonly string[] = []
): string[] {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return [];
  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const candidates = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || !cardMatchesType(card, 'creature')) return false;
    if (preferred.size > 0 && !preferred.has(cardId)) return false;
    return true;
  });
  const pool = candidates.length > 0 ? candidates : graveyard.filter((card: any) => cardMatchesType(card, 'creature'));
  const selected: string[] = [];
  let total = 0;
  for (const card of pool) {
    const power = getCardPower(card);
    if (power === null) continue;
    if (total + power > totalPowerLte) continue;
    const cardId = String(card?.id || '').trim();
    if (!cardId) continue;
    selected.push(cardId);
    total += power;
  }
  return selected;
}

export function exileCountFromTopOfLibrary(
  state: GameState,
  playerId: PlayerID,
  count: number,
  faceDown = false
): { readonly state: GameState; readonly log: readonly string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player || count <= 0) return { state, log: [] };
  const library = Array.isArray(player.library) ? [...player.library] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const moved = library.splice(0, Math.min(count, library.length)).map((card: any) =>
    faceDown ? { ...card, faceDown: true } : card
  );
  if (moved.length === 0) return { state, log: [] };
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), library, exile: [...exile, ...moved] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${moved.length} card(s) from the top of their library`],
  };
}

export function exileCountFromBottomOfLibrary(
  state: GameState,
  playerId: PlayerID,
  count: number
): { readonly state: GameState; readonly log: readonly string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player || count <= 0) return { state, log: [] };

  const library = Array.isArray(player.library) ? [...player.library] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const moved = library.splice(Math.max(0, library.length - count), count);
  if (moved.length === 0) return { state, log: [] };

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), library, exile: [...exile, ...moved] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${moved.length} card(s) from the bottom of their library`],
  };
}

export function exileAllMatchingCriteriaFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  criteria: MoveZoneSingleTargetCriteria,
  referencePower?: number
): { state: GameState; log: string[]; movedCards: any[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [], movedCards: [] };

  const currentTurn = getCurrentTurnNumber(state);
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn, referencePower)) {
      moved.push(card);
    } else {
      kept.push(card);
    }
  }

  if (moved.length === 0) return { state, log: [], movedCards: [] };

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: kept, exile: [...exile, ...moved] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${moved.length} card(s) from graveyard`],
    movedCards: moved,
  };
}

export function returnAllMatchingCriteriaFromGraveyardToHand(
  state: GameState,
  playerId: PlayerID,
  criteria: MoveZoneSingleTargetCriteria,
  referencePower?: number
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const currentTurn = getCurrentTurnNumber(state);
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn, referencePower)) {
      moved.push(card);
    } else {
      kept.push(card);
    }
  }

  if (moved.length === 0) return { state, log: [] };

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: kept, hand: [...hand, ...moved] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} returns ${moved.length} card(s) from graveyard to hand`],
  };
}

export function parseMoveZoneNamedCardReference(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): string | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (!raw || /\s/.test(raw)) return null;
  if (
    /^(?:that|this|it|target|all|any|each|up|the|a|an|another|other)\b/.test(raw) ||
    /\b(card|cards|permanent|creature|land|spell)\b/.test(raw)
  ) {
    return null;
  }
  return raw;
}

export function resolveAmongMilledMatchingCardIds(
  state: GameState,
  playerId: PlayerID,
  criteria: AmongThemMoveCriteria,
  preferredIds: readonly string[] = []
): string[] {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return [];
  const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const matches = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId) return false;
    if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria)) return false;
    if (preferred.size > 0 && !preferred.has(cardId)) return false;
    return true;
  });
  const ids = matches.map((card: any) => String(card?.id || '').trim()).filter(Boolean);
  if (ids.length === 0 && preferred.size > 0) {
    return graveyard
      .filter((card: any) => {
        const cardId = String(card?.id || '').trim();
        return cardId && preferred.has(cardId) && cardMatchesMoveZoneSingleTargetCriteria(card, criteria);
      })
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
  }
  if (criteria.maxCount && ids.length > criteria.maxCount) return ids.slice(0, criteria.maxCount);
  return ids;
}

export function resolveAmongThemMatchingCardIds(
  state: GameState,
  playerId: PlayerID,
  criteria: AmongThemMoveCriteria,
  preferredIds: readonly string[] = []
): string[] {
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return [];

  const matches: string[] = [];
  for (const zone of ['library', 'hand', 'exile', 'graveyard'] as const) {
    const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
    for (const card of cards) {
      const cardId = String((card as any)?.id || '').trim();
      if (!cardId) continue;
      if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria)) continue;
      if (preferred.size > 0 && !preferred.has(cardId)) continue;
      matches.push(cardId);
    }
  }

  if (matches.length === 0 && preferred.size > 0) {
    for (const zone of ['library', 'hand', 'exile', 'graveyard'] as const) {
      const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
      for (const card of cards) {
        const cardId = String((card as any)?.id || '').trim();
        if (!cardId || !preferred.has(cardId)) continue;
        if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria)) continue;
        matches.push(cardId);
      }
    }
  }

  if (criteria.differentPowers) {
    const seenPowers = new Set<number>();
    const uniquePowerMatches: string[] = [];
    for (const cardId of matches) {
      let card: any = null;
      for (const zone of ['library', 'hand', 'exile', 'graveyard'] as const) {
        const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
        card = cards.find((entry: any) => String(entry?.id || '').trim() === cardId);
        if (card) break;
      }
      const power = getCardPower(card);
      if (power === null || seenPowers.has(power)) continue;
      seenPowers.add(power);
      uniquePowerMatches.push(cardId);
    }
    return uniquePowerMatches;
  }

  return matches;
}

export function resolveTypedCardIdFromPlayerZone(
  state: GameState,
  playerId: PlayerID,
  zone: 'hand' | 'graveyard' | 'exile',
  cardType: SimpleCardType,
  preferredIds: readonly string[] = []
): string {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return '';

  const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));

  const matches = cards.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId) return false;
    if (!cardMatchesType(card, cardType)) return false;
    if (preferred.size > 0 && !preferred.has(cardId)) return false;
    return true;
  });

  if (matches.length === 0 && preferred.size > 0) {
    const relaxed = cards.filter(
      (card: any) => cardMatchesType(card, cardType) && String(card?.id || '').trim()
    );
    if (relaxed.length === 1) return String((relaxed[0] as any)?.id || '').trim();
    return '';
  }

  if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
  if (matches.length > 1) {
    for (const wantedId of preferredIds) {
      if (matches.some((card: any) => String(card?.id || '').trim() === wantedId)) return wantedId;
    }
  }
  return '';
}

export function resolveCardIdsFromAnyGraveyard(
  state: GameState,
  cardType: SimpleCardType,
  preferredIds: readonly string[] = [],
  maxCount = 1
): Array<{ readonly playerId: PlayerID; readonly cardId: string }> {
  const requested = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  // Selections made earlier in the same effect (a created token, a tapped permanent) also live in
  // chosenObjectIds. Only ids that name a card in some graveyard narrow this search; the rest belong
  // to another zone and would otherwise filter every candidate away.
  const preferred = new Set<string>();
  if (requested.size > 0) {
    for (const player of state.players || []) {
      const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
      for (const card of graveyard) {
        const cardId = String((card as any)?.id || '').trim();
        if (cardId && requested.has(cardId)) preferred.add(cardId);
      }
    }
  }
  const matches: Array<{ readonly playerId: PlayerID; readonly cardId: string }> = [];

  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;
    const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
    for (const card of graveyard) {
      const cardId = String((card as any)?.id || '').trim();
      if (!cardId || !cardMatchesType(card, cardType)) continue;
      if (preferred.size > 0 && !preferred.has(cardId)) continue;
      matches.push({ playerId, cardId });
    }
  }

  if (matches.length === 0 && preferred.size > 0) {
    for (const player of state.players || []) {
      const playerId = String((player as any)?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
      for (const card of graveyard) {
        const cardId = String((card as any)?.id || '').trim();
        if (!cardId || !preferred.has(cardId) || !cardMatchesType(card, cardType)) continue;
        matches.push({ playerId, cardId });
      }
    }
  }

  if (matches.length <= maxCount) return matches;

  const prioritized: Array<{ readonly playerId: PlayerID; readonly cardId: string }> = [];
  for (const wantedId of preferredIds) {
    const found = matches.find(match => match.cardId === wantedId);
    if (found) prioritized.push(found);
    if (prioritized.length >= maxCount) break;
  }
  return prioritized.length > 0 ? prioritized.slice(0, maxCount) : matches.slice(0, maxCount);
}
