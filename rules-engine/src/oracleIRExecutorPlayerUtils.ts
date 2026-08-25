import {
  commitCardZoneChanges,
  type PlayerZoneChangeBridgeContext,
} from './oracleIRExecutorCardZoneTransitionCommit';
import { commitCardDraws } from './oracleIRExecutorDrawTransitionCommit';
import type { OracleQuantity } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { cardHasCreatureType } from '../../shared/src/creatureTypes';
import { clearPlayableFromExileForCards, stripPlayableFromExileTags } from './playableFromExile';
import { stripPlayableFromGraveyardTags } from './playableFromGraveyard';
import type { GameState, PlayerID } from '../../shared/src';

import {
  readPlayerZoneCards,
  writePlayerZoneCards,
  getCurrentTurnNumber,
  stampCardPutIntoGraveyardThisTurn,
  stampCardsPutIntoGraveyardThisTurn,
} from './oracleIRExecutorPlayerZoneAccess';

export {
  readPlayerZoneCards,
  writePlayerZoneCards,
  getCurrentTurnNumber,
  stampCardPutIntoGraveyardThisTurn,
  stampCardsPutIntoGraveyardThisTurn,
};


export function impulseExileTopRequiresChooseOne(step: { readonly raw?: string } | null | undefined): boolean {
  const raw = normalizeOracleText(String(step?.raw || ''));
  return /choose one of them/i.test(raw);
}

export function impulseExileTopIsDiscoverCastOrHand(step: {
  readonly kind?: string;
  readonly raw?: string;
  readonly duration?: string;
  readonly permission?: string;
  readonly amount?: { readonly kind?: string; readonly subject?: string; readonly raw?: string };
} | null | undefined): boolean {
  if (!step || step.kind !== 'impulse_exile_top') return false;
  if (String(step.duration || '') !== 'during_resolution') return false;
  if (String(step.permission || '') !== 'cast') return false;

  const raw = normalizeOracleText(String(step.raw || ''));
  if (/put it into your hand/i.test(raw)) return true;

  const amountKind = String(step.amount?.kind || '');
  if (amountKind === 'until_nonland_mana_value_lte') return true;
  if (amountKind === 'object_stat' && String(step.amount?.subject || '') === 'that_creature') return true;
  if (amountKind === 'reference_amount' && /that spell(?:'|’)s mana value/i.test(String(step.amount?.raw || raw))) {
    return true;
  }
  return false;
}

export function getPlayableUntilTurnForImpulseDuration(state: GameState, duration: any): number | null {
  const turnNumber = getCurrentTurnNumber(state);
  const d = String(duration || '').trim();
  if (!d) return null;

  if (d === 'this_turn' || d === 'during_resolution') return turnNumber;

  if (
    d === 'during_next_turn' ||
    d === 'until_end_of_next_turn' ||
    d === 'until_end_of_combat_on_next_turn' ||
    d === 'until_next_turn' ||
    d === 'until_next_upkeep' ||
    d === 'until_next_end_step'
  ) {
    return turnNumber + 1;
  }

  if (d === 'as_long_as_remains_exiled' || d === 'as_long_as_control_source' || d === 'until_exile_another') {
    return Number.MAX_SAFE_INTEGER;
  }

  return null;
}

export { applyImpulsePermissionMarkers } from './oracleIRExecutorPlayerImpulsePermissionMarkers';

export function stampExiledCardsForDeferredChoice(
  state: GameState,
  playerId: PlayerID,
  exiledCards: readonly any[],
  exiledBy: string,
): GameState {
  const exiledIds = new Set(
    exiledCards
      .map(card => String((card as any)?.id ?? (card as any)?.cardId ?? '').trim())
      .filter(Boolean),
  );
  if (exiledIds.size === 0) return state;

  const stampCard = (card: any): any => {
    const id = String(card?.id ?? card?.cardId ?? '').trim();
    if (!id || !exiledIds.has(id) || card?.canBePlayedBy) return card;
    return {
      ...card,
      zone: 'exile',
      exiledBy,
    };
  };

  const updatedPlayers = (state.players || []).map((player: any) => {
    if (String(player?.id || '') !== String(playerId)) return player;
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    const updatedExile = exile.map(stampCard);
    return { ...player, exile: updatedExile };
  });

  const stateAny: any = { ...(state as any), players: updatedPlayers };
  const zones = stateAny.zones && typeof stateAny.zones === 'object' ? { ...stateAny.zones } : null;
  if (zones && Array.isArray(zones[playerId]?.exile)) {
    zones[playerId] = {
      ...zones[playerId],
      exile: zones[playerId].exile.map(stampCard),
    };
    stateAny.zones = zones;
  }

  return stateAny as GameState;
}

export function applyGraveyardPermissionMarkers(
  state: GameState,
  playerId: PlayerID,
  graveyardCards: readonly any[],
  meta: {
    readonly permission: 'play' | 'cast';
    readonly playableUntilTurn: number | null;
    readonly castCost?: 'mana_cost';
  }
): { state: GameState; granted: number } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, granted: 0 };

  const graveyardArr: any[] = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  if (graveyardArr.length === 0 || graveyardCards.length === 0) return { state, granted: 0 };

  const stateAny: any = state as any;
  stateAny.playableFromGraveyard = stateAny.playableFromGraveyard || {};
  stateAny.playableFromGraveyard[playerId] = stateAny.playableFromGraveyard[playerId] || {};

  const playableUntilTurn = meta.playableUntilTurn;
  let granted = 0;

  const graveyardIds = new Set(graveyardCards.map(c => String((c as any)?.id ?? (c as any)?.cardId ?? '')));

  for (let i = 0; i < graveyardArr.length; i++) {
    const card = graveyardArr[i];
    const id = String(card?.id ?? card?.cardId ?? '');
    if (!id || !graveyardIds.has(id)) continue;

    const typeLineLower = String(card?.type_line || '').toLowerCase();
    const isLand = typeLineLower.includes('land');
    const grant = meta.permission === 'play' ? true : !isLand;

    const next = {
      ...card,
      zone: 'graveyard',
      ...(grant
        ? {
            canBePlayedBy: playerId,
            playableUntilTurn,
            ...(meta.castCost ? { graveyardCastCost: meta.castCost } : {}),
          }
        : {}),
    };
    graveyardArr[i] = next;

    if (grant) {
      stateAny.playableFromGraveyard[playerId][id] = playableUntilTurn ?? Number.MAX_SAFE_INTEGER;
      granted++;
    }
  }

  const updatedPlayers = state.players.map(p => (p.id === playerId ? ({ ...(p as any), graveyard: graveyardArr } as any) : p));
  return { state: { ...(stateAny as any), players: updatedPlayers as any }, granted };
}

const stripImpulsePermissionMarkers = stripPlayableFromExileTags;
export const stripGraveyardPermissionMarkers = stripPlayableFromGraveyardTags;

function normalizeVoteChoice(choice: string | undefined): string {
  return normalizeOracleText(String(choice || ''));
}

export function getVoteChoiceCounts(
  ctx?: OracleIRExecutionContext
): Readonly<Record<string, number>> | undefined {
  if (!ctx?.voteChoiceCounts || typeof ctx.voteChoiceCounts !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [choice, count] of Object.entries(ctx.voteChoiceCounts)) {
    const normalizedChoice = normalizeVoteChoice(choice);
    const normalizedCount = Number(count);
    if (!normalizedChoice || !Number.isFinite(normalizedCount)) continue;
    out[normalizedChoice] = Math.max(0, Math.trunc(normalizedCount));
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function getVoteCountForChoice(ctx: OracleIRExecutionContext | undefined, choice: string | undefined): number | null {
  const normalizedChoice = normalizeVoteChoice(choice);
  if (!normalizedChoice) return null;
  const counts = getVoteChoiceCounts(ctx);
  if (!counts) return null;
  if (!Object.prototype.hasOwnProperty.call(counts, normalizedChoice)) return null;
  return Math.max(0, Number(counts[normalizedChoice]) || 0);
}

export function deriveWinningVoteChoice(
  ctx?: OracleIRExecutionContext
): string | null | undefined {
  const counts = getVoteChoiceCounts(ctx);
  if (counts) {
    const entries = Object.entries(counts);
    if (entries.length === 0) return undefined;
    let winner: string | null = null;
    let maxVotes = -1;
    let isTie = false;
    for (const [choice, count] of entries) {
      const normalizedCount = Number(count);
      if (!Number.isFinite(normalizedCount)) continue;
      if (normalizedCount > maxVotes) {
        maxVotes = normalizedCount;
        winner = choice;
        isTie = false;
      } else if (normalizedCount === maxVotes) {
        isTie = true;
      }
    }
    if (maxVotes < 0) return undefined;
    return isTie ? null : winner;
  }

  if (typeof ctx?.winningVoteChoice === 'undefined') return undefined;
  if (ctx.winningVoteChoice === null) return null;
  const normalizedWinner = String(ctx.winningVoteChoice || '').trim();
  return normalizedWinner || undefined;
}

export function quantityToNumber(qty: OracleQuantity, ctx?: OracleIRExecutionContext): number | null {
  if (qty.kind === 'number') return qty.value;
  if (qty.kind === 'reference_amount') {
    const referenceAmount = Number(ctx?.referenceAmount);
    return Number.isFinite(referenceAmount) ? Math.max(0, referenceAmount) : null;
  }
  if (qty.kind === 'votes_for_choice') {
    const voteCount = getVoteCountForChoice(ctx, qty.choice);
    if (voteCount === null) return null;
    const multiplier = Number.isFinite(Number(qty.multiplier)) ? Math.max(0, Math.trunc(Number(qty.multiplier))) : 1;
    return voteCount * multiplier;
  }
  if (qty.kind === 'votes_received') {
    // Resolved against state in battlefield/draw amount helpers; keep null here so
    // callers with state can use resolveVotesReceivedQuantity.
    return null;
  }
  return null;
}

export function resolveVotesReceivedQuantity(
  state: GameState,
  controllerId: string,
  qty: Extract<OracleQuantity, { kind: 'votes_received' }>
): number {
  const multiplier = Number.isFinite(Number(qty.multiplier)) ? Math.max(0, Math.trunc(Number(qty.multiplier))) : 1;
  const received =
    (state as any)?.votesReceivedByPlayer && typeof (state as any).votesReceivedByPlayer === 'object'
      ? ((state as any).votesReceivedByPlayer as Record<string, number>)
      : {};
  const controller = String(controllerId || '').trim().toLowerCase();
  const players = Array.isArray((state as any).players) ? ((state as any).players as any[]) : [];
  const opponentIds = new Set(
    players
      .map((p) => String(p?.id || '').trim().toLowerCase())
      .filter((id) => id && id !== controller)
  );

  let total = 0;
  if (qty.who === 'you') {
    total = Number(received[controller] ?? 0) || 0;
  } else if (qty.who === 'opponents') {
    for (const [playerId, count] of Object.entries(received)) {
      if (opponentIds.has(String(playerId || '').trim().toLowerCase())) {
        total += Number(count) || 0;
      }
    }
  } else {
    for (const count of Object.values(received)) {
      total += Number(count) || 0;
    }
  }
  return Math.max(0, Math.floor(total * multiplier));
}

import { getCardTypeLineLower, normalizeOracleText } from './oracleIRExecutorPlayerCardInspect';

export { getCardTypeLineLower, normalizeOracleText };


function matchesCardTypeQualifier(card: any, rawTypeQualifier?: string): boolean {
  const typeQualifier = normalizeOracleText(String(rawTypeQualifier || ''));
  if (!typeQualifier) return true;

  const typeLine = getCardTypeLineLower(card);
  if (!typeLine) return false;

  if (typeQualifier === 'permanent') {
    return !typeLine.includes('instant') && !typeLine.includes('sorcery');
  }

  if (typeQualifier === 'nonland permanent') {
    return !typeLine.includes('land') && !typeLine.includes('instant') && !typeLine.includes('sorcery');
  }

  return typeLine.includes(typeQualifier);
}

export function isCardExiledWithSource(card: any, sourceId: string): boolean {
  if (!sourceId) return false;

  const linkedIds = [
    card?.exiledBy,
    card?.exiledWith,
    card?.exiledWithSourceId,
    card?.card?.exiledBy,
    card?.card?.exiledWith,
    card?.card?.exiledWithSourceId,
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean);

  return linkedIds.includes(sourceId);
}

export function applyExilePermissionMarkers(
  state: GameState,
  playerId: PlayerID,
  exiledCards: readonly any[],
  meta: {
    readonly permission: 'play' | 'cast';
    readonly playableUntilTurn: number | null;
    readonly castedPermanentEntersWithCounters?: Record<string, number>;
  }
): { state: GameState; granted: number } {
  if (exiledCards.length === 0) return { state, granted: 0 };

  const exiledIds = new Set(
    exiledCards
      .map(card => String((card as any)?.id ?? (card as any)?.cardId ?? '').trim())
      .filter(Boolean)
  );
  if (exiledIds.size === 0) return { state, granted: 0 };

  const stateAny: any = state as any;
  stateAny.playableFromExile = stateAny.playableFromExile || {};
  stateAny.playableFromExile[playerId] = stateAny.playableFromExile[playerId] || {};

  let granted = 0;
  const updatedPlayers = (state.players || []).map((player: any) => {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    if (exile.length === 0) return player;

    let changed = false;
    const nextExile = exile.map((card: any) => {
      const id = String(card?.id ?? card?.cardId ?? '').trim();
      if (!id || !exiledIds.has(id)) return card;

      const typeLineLower = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
      const isLand = typeLineLower.includes('land');
      const grant = meta.permission === 'play' ? true : !isLand;
      if (!grant) return card;

      changed = true;
      granted += 1;
      stateAny.playableFromExile[playerId][id] = meta.playableUntilTurn ?? Number.MAX_SAFE_INTEGER;
      return {
        ...card,
        zone: 'exile',
        canBePlayedBy: playerId,
        playableUntilTurn: meta.playableUntilTurn,
        ...(meta.castedPermanentEntersWithCounters
          ? { entersBattlefieldWithCounters: { ...meta.castedPermanentEntersWithCounters } }
          : {}),
      };
    });

    return changed ? ({ ...player, exile: nextExile } as any) : player;
  });

  return {
    state: { ...(stateAny as any), players: updatedPlayers as any } as any,
    granted,
  };
}

export function countCardsExiledWithSource(
  state: GameState,
  sourceId: string,
  rawTypeQualifier?: string
): number {
  if (!sourceId) return 0;

  let count = 0;
  for (const player of state.players as any[]) {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    for (const card of exile) {
      if (!isCardExiledWithSource(card, sourceId)) continue;
      if (!matchesCardTypeQualifier(card, rawTypeQualifier)) continue;
      count++;
    }
  }

  return count;
}

import { getCardManaValue } from './oracleIRExecutorPlayerExileUntilAmount';

export {
  getCardTypesFromTypeLine,
  getCardManaValue,
  resolveUnknownExileUntilAmountForPlayer,
} from './oracleIRExecutorPlayerExileUntilAmount';

export function resolveUnknownMillUntilAmountForPlayer(
  state: GameState,
  playerId: PlayerID,
  qty: OracleQuantity
): number | null {
  if (qty.kind !== 'reveal_until_land' && qty.kind !== 'unknown') return null;

  const raw = normalizeOracleText(String((qty as any).raw || ''));
  if (qty.kind === 'unknown' && raw !== 'until they reveal a land card' && raw !== 'until you reveal a land card') {
    return null;
  }

  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return null;
  const library: any[] = Array.isArray(player.library) ? player.library : [];

  for (let i = 0; i < library.length; i++) {
    const typeLine = getCardTypeLineLower(library[i]);
    if (!typeLine) continue;
    if (typeLine.includes('land')) return i + 1;
  }

  return library.length;
}

function cardMatchesRevealUntilCriterion(card: any, criterion: string): boolean {
  const normalized = normalizeOracleText(criterion).replace(/^an?\s+/i, '').trim();
  const typeLine = getCardTypeLineLower(card);
  if (!typeLine) return false;
  if (normalized === 'nonland card') return !typeLine.includes('land');
  if (normalized === 'land card') return typeLine.includes('land');
  if (/^creature card\b/i.test(normalized)) return typeLine.includes('creature');
  if (/zombie creature card/i.test(normalized)) {
    return typeLine.includes('creature') && typeLine.includes('zombie');
  }
  if (normalized.endsWith(' card')) {
    const typeName = normalized.slice(0, -' card'.length).trim();
    return typeName ? typeLine.includes(typeName) : false;
  }
  return typeLine.includes(normalized);
}

function countControlledCreaturesOfChosenType(
  state: GameState,
  controllerId: PlayerID,
  chosenType: string,
): number {
  const normalizedType = String(chosenType || '').trim();
  if (!normalizedType) return 0;
  return ((state.battlefield || []) as any[]).filter((perm) => {
    if (String(perm?.controller || '').trim() !== controllerId) return false;
    const card = perm?.card || perm;
    const typeLine = getCardTypeLineLower(card);
    if (!typeLine.includes('creature')) return false;
    const oracleText = String(card?.oracle_text || '');
    return cardHasCreatureType(typeLine, oracleText, normalizedType);
  }).length;
}

function libraryCardMatchesChosenCreatureType(card: any, chosenType: string): boolean {
  const normalizedType = String(chosenType || '').trim();
  if (!normalizedType) return false;
  const typeLine = getCardTypeLineLower(card);
  if (!typeLine.includes('creature')) return false;
  const oracleText = String(card?.oracle_text || '');
  return cardHasCreatureType(typeLine, oracleText, normalizedType);
}

export function resolveRevealUntilReferenceAmountForPlayer(
  state: GameState,
  playerId: PlayerID,
  qty: OracleQuantity,
  ctx?: OracleIRExecutionContext,
): { readonly count: number; readonly cards: readonly any[] } | null {
  if (qty.kind !== 'reference_amount') return null;
  const raw = normalizeOracleText(String((qty as any).raw || ''));

  if (
    /^until you reveal x creature cards of the chosen type(?:,\s*where x is the number of creatures you control of that type)?$/i.test(
      raw,
    )
  ) {
    const chosenType = String(ctx?.selectorContext?.chosenCreatureType || '').trim();
    if (!chosenType) return null;
    const targetCount = countControlledCreaturesOfChosenType(state, ctx?.controllerId || playerId, chosenType);
    if (targetCount <= 0) return { count: 0, cards: [] };

    const player = state.players.find(p => p.id === playerId) as any;
    if (!player) return null;
    const library: any[] = Array.isArray(player.library) ? player.library : [];
    const revealedCards: any[] = [];
    let found = 0;

    for (let i = 0; i < library.length && found < targetCount; i += 1) {
      const card = library[i];
      revealedCards.push(card);
      if (libraryCardMatchesChosenCreatureType(card, chosenType)) {
        found += 1;
      }
    }

    return revealedCards.length > 0 ? { count: revealedCards.length, cards: revealedCards } : { count: 0, cards: [] };
  }

  const untilMatch = raw.match(/^until you reveal an? (.+)$/i);
  if (!untilMatch) return null;

  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return null;
  const library: any[] = Array.isArray(player.library) ? player.library : [];
  const criterion = String(untilMatch[1] || '').trim();
  const revealedCards: any[] = [];

  for (let i = 0; i < library.length; i += 1) {
    const card = library[i];
    revealedCards.push(card);
    if (cardMatchesRevealUntilCriterion(card, criterion)) {
      return { count: i + 1, cards: revealedCards };
    }
  }

  return revealedCards.length > 0 ? { count: revealedCards.length, cards: revealedCards } : null;
}

export {
  resolvePlayers,
  countControlledLands,
  listEligibleChooseOpponentIds,
  resolvePlayersFromDamageTarget,
  isThatOwnerOrControllerSelector,
  isThoseOpponentsSelector,
} from './oracleIRExecutorPlayerResolvePlayers';


export function drawCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  count: number,
  bridgeOptions?: PlayerZoneChangeBridgeContext,
): { state: GameState; log: string[]; halted?: boolean; ledgerRecordedViaBridge?: boolean } {
  if (bridgeOptions?.ctx?.serverBridge && Number.isFinite(bridgeOptions.stepIndex)) {
    const result = commitCardDraws({
      state,
      playerId,
      count,
      stepIndex: Number(bridgeOptions.stepIndex),
      stepKind: String(bridgeOptions.stepKind || 'draw'),
      cause: 'oracle_ir:draw',
      ctx: bridgeOptions.ctx,
    });
    return {
      state: result.state,
      log: result.log,
      halted: result.halted,
      ledgerRecordedViaBridge: result.ledgerRecordedViaBridge,
    };
  }

  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`] };

  const library = readPlayerZoneCards(state, playerId, player, 'library');
  const hand = readPlayerZoneCards(state, playerId, player, 'hand');

  let drawn = 0;
  for (let i = 0; i < Math.max(0, count | 0); i++) {
    if (library.length === 0) {
      log.push(`${playerId} cannot draw (empty library)`);
      break;
    }
    const [card] = library.splice(0, 1);
    hand.push(card);
    drawn++;
  }

  writePlayerZoneCards(state, playerId, player, 'library', library);
  writePlayerZoneCards(state, playerId, player, 'hand', hand);
  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...player } : p));
  return {
    state: { ...state, players: updatedPlayers as any },
    log: drawn > 0 ? [`${playerId} draws ${drawn} card(s)`] : log,
  };
}

export function exileTopCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  count: number,
  bridgeOptions?: PlayerZoneChangeBridgeContext,
): {
  state: GameState;
  log: string[];
  exiled: any[];
  ledgerRecordedViaBridge?: boolean;
  halted?: boolean;
} {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`], exiled: [] };

  const n = Math.max(0, count | 0);
  if (n === 0) return { state, log, exiled: [] };

  const library = readPlayerZoneCards(state, playerId, player, 'library');
  const actual = Math.min(n, library.length);
  const toExile = library.slice(0, actual).map((card: any) => ({
    ...card,
    ownerId: playerId,
    owner: playerId,
  }));

  const stepIndex = bridgeOptions?.stepIndex;
  if (bridgeOptions?.ctx?.serverBridge && Number.isFinite(stepIndex)) {
    const commitResult = commitCardZoneChanges({
      state,
      playerId,
      cards: toExile,
      sourceZone: 'library',
      intendedDestination: 'exile',
      stepIndex: Number(stepIndex),
      stepKind: String(bridgeOptions.stepKind || 'exile_top'),
      cause: 'oracle_ir:exile_top',
      ctx: bridgeOptions.ctx,
    });
    if (commitResult.halted) {
      return { state, log: [], exiled: [], halted: true };
    }
    if (commitResult.movedCards.length > 0) {
      log.push(`${playerId} exiles ${commitResult.movedCards.length} card(s) from the top of their library`);
    }
    return {
      state: commitResult.state,
      log,
      exiled: commitResult.movedCards,
      ledgerRecordedViaBridge: commitResult.ledgerRecordedViaBridge,
    };
  }

  const exile = readPlayerZoneCards(state, playerId, player, 'exile');
  const exiled: any[] = [];
  let nextLibrary = [...library];
  for (let i = 0; i < actual; i += 1) {
    if (nextLibrary.length === 0) {
      log.push(`${playerId} cannot exile from library (empty library)`);
      break;
    }
    const [card] = nextLibrary.splice(0, 1);
    exile.push(card);
    exiled.push(card);
  }

  writePlayerZoneCards(state, playerId, player, 'library', nextLibrary);
  writePlayerZoneCards(state, playerId, player, 'exile', exile);
  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...player } : p));
  return {
    state: { ...state, players: updatedPlayers as any },
    log: exiled.length > 0 ? [`${playerId} exiles ${exiled.length} card(s) from the top of their library`] : log,
    exiled,
  };
}

export function collectTopLibraryObservationForPlayers(
  state: GameState,
  playerIds: readonly PlayerID[],
  amount: number,
): { cards: any[]; lookedCount: number } {
  const cards: any[] = [];
  let lookedCount = 0;
  const perAmount = Math.max(0, amount | 0);
  for (const playerId of playerIds) {
    const player = state.players.find((entry) => entry.id === playerId) as any;
    const library = Array.isArray(player?.library) ? player.library : [];
    const looked = Math.max(0, Math.min(library.length, perAmount));
    if (looked > 0) {
      cards.push(...library.slice(0, looked));
      lookedCount += looked;
    }
  }
  return { cards, lookedCount };
}

export { lookSelectTopCardsForPlayer } from './oracleIRExecutorPlayerLookSelectTop';

export function shouldReturnUncastExiledToBottom(step: any): boolean {
  const t = normalizeOracleText(String(step?.raw || ''));
  if (
    (/\bput\s+the\s+exiled\s+cards\b/.test(t) && /\bon\s+the\s+bottom\s+of\s+that\s+library\b/.test(t)) ||
    (/\bput\s+all\s+cards\s+exiled\b/.test(t) && /\bon\s+the\s+bottom\s+of\s+their\s+library\b/.test(t))
  ) {
    return true;
  }

  const amountRaw = normalizeOracleText(String(step?.amount?.raw || ''));
  const who = String(step?.who?.kind || '');
  return (
    step?.kind === 'impulse_exile_top' &&
    step?.duration === 'during_resolution' &&
    step?.permission === 'cast' &&
    (step?.amount?.kind === 'unknown' || step?.amount?.kind === 'reference_amount') &&
    (
      ((who === 'target_opponent' || who === 'target_player') &&
        (amountRaw === 'until they exile an instant or sorcery card' ||
          amountRaw === 'until you exile an instant or sorcery card' ||
          amountRaw === 'until they exile a card that shares a card type with it' ||
          amountRaw === 'until you exile a card that shares a card type with it' ||
          amountRaw === "until they exile a nonland card whose mana value is less than this spell's mana value" ||
          amountRaw === "until you exile a nonland card whose mana value is less than this spell's mana value")) ||
      (who === 'you' &&
        (amountRaw === "until they exile a nonland card whose mana value is less than this spell's mana value" ||
          amountRaw === "until you exile a nonland card whose mana value is less than this spell's mana value"))
    )
  );
}

export function shouldShuffleRestIntoLibrary(step: any): boolean {
  const t = normalizeOracleText(String(step?.raw || ''));
  if (/\bthen\s+shuffles\s+the\s+rest\s+into\s+(?:their|his\s+or\s+her|your)\s+library\b/.test(t)) {
    return true;
  }

  const amountRaw = normalizeOracleText(String(step?.amount?.raw || ''));
  const who = String(step?.who?.kind || '');
  if (
    step?.kind === 'impulse_exile_top' &&
    step?.duration === 'during_resolution' &&
    step?.permission === 'cast' &&
    step?.amount?.kind === 'until_nonland_mana_value_lte'
  ) {
    return true;
  }

  return (
    step?.kind === 'impulse_exile_top' &&
    step?.duration === 'during_resolution' &&
    step?.permission === 'cast' &&
    (step?.amount?.kind === 'unknown' || step?.amount?.kind === 'reference_amount') &&
    (
      (who === 'each_opponent' &&
        (amountRaw === 'until they exile an instant or sorcery card' ||
          amountRaw === 'until you exile an instant or sorcery card')) ||
      /until (?:they|you) exile a nonland card with mana value \d+ or less/i.test(amountRaw)
    )
  );
}

export function splitExiledForShuffleRest(step: any, exiled: readonly any[]): { keepExiled: readonly any[]; returnToLibrary: readonly any[] } {
  const all = Array.isArray(exiled) ? exiled : [];
  if (all.length === 0) return { keepExiled: [], returnToLibrary: [] };

  const amountRaw = normalizeOracleText(String(step?.amount?.raw || ''));

  if (step?.amount?.kind === 'until_nonland_mana_value_lte') {
    const threshold = Math.max(0, Number(step.amount.value) || 0);
    const hitIndex = all.findIndex((card: any) => {
      const typeLine = getCardTypeLineLower(card);
      const manaValue = getCardManaValue(card);
      return Boolean(typeLine) && !typeLine.includes('land') && manaValue !== null && manaValue <= threshold;
    });
    if (hitIndex < 0) return { keepExiled: [], returnToLibrary: all };
    return {
      keepExiled: [all[hitIndex]],
      returnToLibrary: all.filter((_, index) => index !== hitIndex),
    };
  }

  if (
    amountRaw === 'until they exile an instant or sorcery card' ||
    amountRaw === 'until you exile an instant or sorcery card'
  ) {
    const last = all[all.length - 1];
    const typeLine = getCardTypeLineLower(last);
    const hit = typeLine.includes('instant') || typeLine.includes('sorcery');
    if (!hit) return { keepExiled: [], returnToLibrary: all };
    return { keepExiled: [last], returnToLibrary: all.slice(0, -1) };
  }

  if (
    amountRaw === "until they exile a nonland card whose mana value is less than this spell's mana value" ||
    amountRaw === "until you exile a nonland card whose mana value is less than this spell's mana value"
  ) {
    const hitIndex = all.findIndex((card: any) => {
      const typeLine = getCardTypeLineLower(card);
      const manaValue = getCardManaValue(card);
      return Boolean(typeLine) && !typeLine.includes('land') && manaValue !== null;
    });
    if (hitIndex < 0) return { keepExiled: [], returnToLibrary: all };
    return {
      keepExiled: [all[hitIndex]],
      returnToLibrary: all.filter((_, index) => index !== hitIndex),
    };
  }

  {
    const discoverMatch = amountRaw.match(/^until (?:they|you) exile a nonland card with mana value (\d+) or less$/i);
    if (discoverMatch) {
      const threshold = Number(discoverMatch[1]);
      if (!Number.isFinite(threshold)) return { keepExiled: all, returnToLibrary: [] };

      const hitIndex = all.findIndex((card: any) => {
        const typeLine = getCardTypeLineLower(card);
        const manaValue = getCardManaValue(card);
        return Boolean(typeLine) && !typeLine.includes('land') && manaValue !== null && manaValue <= threshold;
      });
      if (hitIndex < 0) return { keepExiled: [], returnToLibrary: all };
      return {
        keepExiled: [all[hitIndex]],
        returnToLibrary: all.filter((_, index) => index !== hitIndex),
      };
    }
  }

  return { keepExiled: all, returnToLibrary: [] };
}

export function putSpecificExiledCardsOnLibraryBottom(
  state: GameState,
  playerId: PlayerID,
  cards: readonly any[]
): { state: GameState; moved: number; log: string[] } {
  if (!Array.isArray(cards) || cards.length === 0) return { state, moved: 0, log: [] };
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, moved: 0, log: [] };

  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const library = Array.isArray(player.library) ? [...player.library] : [];

  const wantedIds = new Set(
    cards
      .map(c => String((c as any)?.id ?? (c as any)?.cardId ?? '').trim())
      .filter(Boolean)
  );
  if (wantedIds.size === 0) return { state, moved: 0, log: [] };

  const kept: any[] = [];
  const moved: any[] = [];
  for (const card of exile) {
    const id = String((card as any)?.id ?? (card as any)?.cardId ?? '').trim();
    if (id && wantedIds.has(id)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, moved: 0, log: [] };

  const nextState = clearPlayableFromExileForCards(state, playerId, moved);
  const movedClean = moved.map(stripImpulsePermissionMarkers);
  const nextPlayer: any = { ...(player as any), exile: kept, library: [...library, ...movedClean] };
  const updatedPlayers = nextState.players.map(p => (p.id === playerId ? nextPlayer : p));
  return {
    state: { ...nextState, players: updatedPlayers as any } as any,
    moved: moved.length,
    log: [`${playerId} puts ${moved.length} exiled card(s) on the bottom of their library`],
  };
}

export function adjustLife(state: GameState, playerId: PlayerID, delta: number): { state: GameState; log: string[] } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`] };

  const currentLife = typeof (player as any).life === 'number' ? (player as any).life : 0;
  const nextLife = currentLife + delta;
  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...p, life: nextLife } : p));
  const nextLifeByPlayer = {
    ...(((state as any).life && typeof (state as any).life === 'object') ? (state as any).life : {}),
    [playerId]: nextLife,
  };

  const verb = delta >= 0 ? 'gains' : 'loses';
  log.push(`${playerId} ${verb} ${Math.abs(delta)} life`);

  return { state: { ...state, players: updatedPlayers as any, life: nextLifeByPlayer } as GameState, log };
}

function normalizePlayerCounterName(counter: string): string {
  return String(counter || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\bcounters?\b/gi, '')
    .trim();
}

export function adjustPlayerCounter(
  state: GameState,
  playerId: PlayerID,
  counter: string,
  delta: number
): { state: GameState; log: string[]; applied: boolean } {
  const normalizedCounter = normalizePlayerCounterName(counter);
  const log: string[] = [];
  if (!normalizedCounter) return { state, log: ['Counter name missing'], applied: false };

  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [`Player not found: ${playerId}`], applied: false };

  const nextCounters = { ...((player?.counters || {}) as Record<string, number>) };
  const currentValue = Math.max(
    0,
    Number(
      normalizedCounter === 'poison'
        ? player?.poisonCounters ?? (state as any)?.poisonCounters?.[playerId] ?? nextCounters.poison
        : normalizedCounter === 'energy'
          ? (state as any)?.energy?.[playerId]
            ?? player?.energyCounters
            ?? player?.energy
            ?? nextCounters.energy
          : normalizedCounter === 'experience'
            ? player?.experienceCounters ?? player?.experience ?? (state as any)?.experienceCounters?.[playerId] ?? nextCounters.experience
            : normalizedCounter === 'rad'
              ? player?.radCounters ?? nextCounters.rad
              : normalizedCounter === 'ticket'
                ? player?.ticketCounters ?? nextCounters.ticket
                : normalizedCounter === 'token'
                  ? (state as any)?.tokenCounters?.[playerId]
                    ?? (state as any)?.tokenCounterCount?.[playerId]
                    ?? player?.tokenCounters
                    ?? nextCounters.token
                  : nextCounters[normalizedCounter]
    ) || 0
  );
  const nextValue = Math.max(0, currentValue + delta);

  nextCounters[normalizedCounter] = nextValue;
  const nextPlayer: any = {
    ...player,
    counters: nextCounters,
  };
  const nextState: any = { ...(state as any) };

  if (normalizedCounter === 'poison') {
    nextPlayer.poisonCounters = nextValue;
    nextState.poisonCounters = {
      ...((nextState.poisonCounters || {}) as Record<string, number>),
      [playerId]: nextValue,
    };
  } else if (normalizedCounter === 'energy') {
    nextPlayer.energyCounters = nextValue;
    nextPlayer.energy = nextValue;
    nextState.energy = {
      ...((nextState.energy || {}) as Record<string, number>),
      [playerId]: nextValue,
    };
    nextState.energyCount = {
      ...((nextState.energyCount || {}) as Record<string, number>),
      [playerId]: nextValue,
    };
  } else if (normalizedCounter === 'experience') {
    nextPlayer.experienceCounters = nextValue;
    nextPlayer.experience = nextValue;
    nextState.experienceCounters = {
      ...((nextState.experienceCounters || {}) as Record<string, number>),
      [playerId]: nextValue,
    };
  } else if (normalizedCounter === 'rad') {
    nextPlayer.radCounters = nextValue;
  } else if (normalizedCounter === 'ticket') {
    nextPlayer.ticketCounters = nextValue;
  } else if (normalizedCounter === 'token') {
    nextPlayer.tokenCounters = nextValue;
    nextState.tokenCounters = {
      ...((nextState.tokenCounters || {}) as Record<string, number>),
      [playerId]: nextValue,
    };
    nextState.tokenCounterCount = {
      ...((nextState.tokenCounterCount || {}) as Record<string, number>),
      [playerId]: nextValue,
    };
  }

  nextState.players = state.players.map(p => (p.id === playerId ? nextPlayer : p));
  const verb = delta >= 0 ? 'gets' : 'loses';
  log.push(`${playerId} ${verb} ${Math.abs(delta)} ${normalizedCounter} counter${Math.abs(delta) === 1 ? '' : 's'}`);

  return { state: nextState as GameState, log, applied: true };
}

export {
  discardCardsForPlayer,
  discardSpecificCardsForPlayer,
} from './oracleIRExecutorPlayerDiscardCards';

export function millCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  count: number,
  bridgeOptions?: PlayerZoneChangeBridgeContext,
): { state: GameState; log: string[]; milledCards: any[]; ledgerRecordedViaBridge?: boolean; halted?: boolean } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`], milledCards: [] };

  const library = readPlayerZoneCards(state, playerId, player, 'library');
  const graveyard = readPlayerZoneCards(state, playerId, player, 'graveyard');

  const n = Math.max(0, count | 0);
  if (n === 0) return { state, log, milledCards: [] };

  const actual = Math.min(n, library.length);
  const milled = library.splice(0, actual);
  const stampedMilled = stampCardsPutIntoGraveyardThisTurn(state, milled).map((card: any) => ({
    ...card,
    ownerId: playerId,
    owner: playerId,
  }));

  const stepIndex = bridgeOptions?.stepIndex;
  if (bridgeOptions?.ctx?.serverBridge && Number.isFinite(stepIndex)) {
    const commitResult = commitCardZoneChanges({
      state,
      playerId,
      cards: stampedMilled,
      sourceZone: 'library',
      intendedDestination: 'graveyard',
      stepIndex: Number(stepIndex),
      stepKind: String(bridgeOptions.stepKind || 'mill'),
      cause: 'oracle_ir:mill',
      ctx: bridgeOptions.ctx,
    });
    if (commitResult.halted) {
      return { state, log: [], milledCards: [], halted: true };
    }
    log.push(`${playerId} mills ${commitResult.movedCards.length} card(s)`);
    return {
      state: commitResult.state,
      log,
      milledCards: commitResult.movedCards,
      ledgerRecordedViaBridge: commitResult.ledgerRecordedViaBridge,
    };
  }

  graveyard.push(...stampedMilled);

  writePlayerZoneCards(state, playerId, player, 'library', library);
  writePlayerZoneCards(state, playerId, player, 'graveyard', graveyard);
  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...player } : p));
  log.push(`${playerId} mills ${actual} card(s)`);
  return { state: { ...state, players: updatedPlayers as any }, log, milledCards: stampedMilled };
}

export { addManaToPoolForPlayer } from './oracleIRExecutorPlayerAddManaToPool';

