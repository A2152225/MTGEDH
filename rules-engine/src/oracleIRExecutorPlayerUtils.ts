import {
  commitCardZoneChanges,
  commitLookSelectRestZoneChanges,
  type PlayerZoneChangeBridgeContext,
} from './oracleIRExecutorCardZoneTransitionCommit';
import { commitCardDraws } from './oracleIRExecutorDrawTransitionCommit';
import type { OraclePlayerSelector, OracleQuantity } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { clearPlayableFromExileForCards, stripPlayableFromExileTags } from './playableFromExile';
import { stripPlayableFromGraveyardTags } from './playableFromGraveyard';
import { parseManaSymbols } from './types/numbers';
import { addMana, addRestrictedMana, createEmptyManaPool, ManaRestrictionType, ManaType } from './types/mana';

type PlayerZoneName = 'library' | 'hand' | 'graveyard' | 'exile';

function getAttachedServerLibraries(state: GameState): Map<PlayerID, any[]> | undefined {
  const libs = (state as any).__serverLibraries;
  return libs && typeof libs.get === 'function' ? libs : undefined;
}

export function readPlayerZoneCards(
  state: GameState,
  playerId: PlayerID,
  player: any,
  zone: PlayerZoneName,
): any[] {
  const fromPlayer = Array.isArray(player?.[zone]) ? [...player[zone]] : [];
  if (zone !== 'library' || fromPlayer.length > 0) return fromPlayer;
  const serverLibs = getAttachedServerLibraries(state);
  const external = serverLibs?.get(playerId);
  return Array.isArray(external) ? [...external] : fromPlayer;
}

export function writePlayerZoneCards(
  state: GameState,
  playerId: PlayerID,
  player: any,
  zone: PlayerZoneName,
  cards: any[],
): any[] {
  const next = [...cards];
  player[zone] = next;
  if (zone === 'library') {
    const serverLibs = getAttachedServerLibraries(state);
    if (serverLibs?.set) serverLibs.set(playerId, [...next]);
  }
  return next;
}

export function getCurrentTurnNumber(state: GameState): number {
  return Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
}

export function stampCardPutIntoGraveyardThisTurn(state: GameState, card: any): any {
  return {
    ...(card || {}),
    zone: 'graveyard',
    putIntoGraveyardTurn: getCurrentTurnNumber(state),
  };
}

export function stampCardsPutIntoGraveyardThisTurn(state: GameState, cards: readonly any[]): any[] {
  return (Array.isArray(cards) ? cards : []).map(card => stampCardPutIntoGraveyardThisTurn(state, card));
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

export function applyImpulsePermissionMarkers(
  state: GameState,
  playerId: PlayerID,
  exiledCards: readonly any[],
  meta: {
    readonly permission: 'play' | 'cast';
    readonly playableUntilTurn: number | null;
    readonly condition?: any;
    readonly exiledBy?: string;
  }
): { state: GameState; granted: number } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, granted: 0 };

  const exileArr: any[] = Array.isArray(player.exile) ? [...player.exile] : [];
  if (exileArr.length === 0 || exiledCards.length === 0) return { state, granted: 0 };

  const stateAny: any = state as any;
  stateAny.playableFromExile = stateAny.playableFromExile || {};
  stateAny.playableFromExile[playerId] = stateAny.playableFromExile[playerId] || {};

  const playableUntilTurn = meta.playableUntilTurn;
  const condition = meta.condition as any;

  let granted = 0;

  const exiledIds = new Set(exiledCards.map(c => String((c as any)?.id ?? (c as any)?.cardId ?? '')));

  const shouldGrant = (card: any): boolean => {
    const typeLineLower = String(card?.type_line || '').toLowerCase();
    const isLand = typeLineLower.includes('land');
    const colors = Array.isArray(card?.colors) ? card.colors.map((x: any) => String(x || '').toUpperCase()) : [];

    const passesPermissionGate = meta.permission === 'play' ? true : !isLand;
    let passesConditionGate = true;
    if (condition) {
      if (condition.kind === 'type') {
        passesConditionGate = condition.type === 'land' ? isLand : !isLand;
      } else if (condition.kind === 'color') {
        passesConditionGate = colors.includes(condition.color);
      }
    }
    return passesPermissionGate && passesConditionGate;
  };

  for (let i = 0; i < exileArr.length; i++) {
    const card = exileArr[i];
    const id = String(card?.id ?? card?.cardId ?? '');
    if (!id || !exiledIds.has(id)) continue;

    const grant = shouldGrant(card);
    const next = {
      ...card,
      zone: 'exile',
      ...(meta.exiledBy ? { exiledBy: meta.exiledBy } : {}),
      ...(grant ? { canBePlayedBy: playerId, playableUntilTurn } : {}),
    };
    exileArr[i] = next;

    if (grant) {
      stateAny.playableFromExile[playerId][id] = playableUntilTurn ?? Number.MAX_SAFE_INTEGER;
      granted++;
    }
  }

  const updatedPlayers = state.players.map(p => (p.id === playerId ? ({ ...(p as any), exile: exileArr } as any) : p));
  return { state: { ...(stateAny as any), players: updatedPlayers as any }, granted };
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
  return Math.max(0, Number(counts[normalizedChoice] ?? 0) || 0);
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
  return null;
}

export function normalizeOracleText(value: string): string {
  return String(value || '')
    .replace(/â€™|â€˜|[\u2018\u2019]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:,]+$/g, '')
    .trim();
}

export function getCardTypeLineLower(card: any): string {
  return String(card?.cardType || card?.type_line || card?.card?.type_line || '')
    .toLowerCase()
    .trim();
}

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

export function getCardTypesFromTypeLine(card: any): readonly string[] | null {
  const tl = getCardTypeLineLower(card);
  if (!tl) return null;
  const known = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery'];
  const out = known.filter(type => tl.includes(type));
  if (tl.includes('tribal') && !out.includes('kindred')) out.push('kindred');
  return out.length > 0 ? out : null;
}

export function getCardManaValue(card: any): number | null {
  const raw =
    card?.manaValue ??
    card?.mana_value ??
    card?.cmc ??
    card?.spell?.manaValue ??
    card?.spell?.mana_value ??
    card?.spell?.cmc ??
    card?.card?.manaValue ??
    card?.card?.mana_value ??
    card?.card?.cmc;

  const value = Number(raw);
  if (Number.isFinite(value)) return value;

  const manaCost = String(
    card?.mana_cost ??
      card?.manaCost ??
      card?.spell?.mana_cost ??
      card?.spell?.manaCost ??
      card?.card?.mana_cost ??
      card?.card?.manaCost ??
      ''
  ).trim();
  if (!manaCost) {
    const typeLine = getCardTypeLineLower(card);
    if (typeLine.includes('land')) return 0;
    return null;
  }

  const symbols = parseManaSymbols(manaCost);
  if (symbols.length === 0) return null;

  let total = 0;
  for (const symbol of symbols) {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (!normalized) return null;
    if (/^\{\d+\}$/.test(normalized)) {
      total += Number.parseInt(normalized.slice(1, -1), 10);
      continue;
    }
    if (/^\{X\}$/.test(normalized)) continue;
    total += 1;
  }

  return total;
}

export function resolveUnknownExileUntilAmountForPlayer(
  state: GameState,
  playerId: PlayerID,
  qty: OracleQuantity,
  ctx?: OracleIRExecutionContext
): number | null {
  if (qty.kind !== 'unknown' && qty.kind !== 'reference_amount') return null;

  const raw = normalizeOracleText(String((qty as any).raw || ''));
  if (!raw.startsWith('until ')) return null;

  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return null;
  const library: any[] = Array.isArray(player.library) ? player.library : [];

  if (raw === 'until they exile a nonland card' || raw === 'until you exile a nonland card') {
    for (let i = 0; i < library.length; i++) {
      const typeLine = getCardTypeLineLower(library[i]);
      if (!typeLine) return null;
      if (!typeLine.includes('land')) return i + 1;
    }
    return library.length;
  }

  if (
    raw === 'until they exile an instant or sorcery card' ||
    raw === 'until you exile an instant or sorcery card'
  ) {
    for (let i = 0; i < library.length; i++) {
      const typeLine = getCardTypeLineLower(library[i]);
      if (!typeLine) return null;
      if (typeLine.includes('instant') || typeLine.includes('sorcery')) return i + 1;
    }
    return library.length;
  }

  if (raw === 'until you exile a legendary card' || raw === 'until they exile a legendary card') {
    for (let i = 0; i < library.length; i++) {
      const typeLine = getCardTypeLineLower(library[i]);
      if (!typeLine) return null;
      if (typeLine.includes('legendary')) return i + 1;
    }
    return library.length;
  }

  {
    const discoverMatch = raw.match(/^until (?:they|you) exile a nonland card with mana value (\d+|x) or less$/i);
    if (discoverMatch) {
      const thresholdRaw = String(discoverMatch[1] || '').trim().toLowerCase();
      if (thresholdRaw === 'x') return null;
      const threshold = Number(thresholdRaw);
      if (!Number.isFinite(threshold) || threshold < 0) return null;

      for (let i = 0; i < library.length; i++) {
        const typeLine = getCardTypeLineLower(library[i]);
        if (!typeLine) return null;
        if (typeLine.includes('land')) continue;

        const manaValue = getCardManaValue(library[i]);
        if (manaValue === null) return null;
        if (manaValue <= threshold) return i + 1;
      }
      return library.length;
    }
  }

  const totalMvMatch = raw.match(
    /^until (?:they|you) have exiled cards with total mana value (\d+) or greater(?: this way)?$/
  );
  if (totalMvMatch) {
    const threshold = Number(totalMvMatch[1]);
    if (!Number.isFinite(threshold) || threshold <= 0) return null;

    let total = 0;
    for (let i = 0; i < library.length; i++) {
      const manaValue = getCardManaValue(library[i]);
      if (manaValue === null) return null;
      total += manaValue;
      if (total >= threshold) return i + 1;
    }
    return library.length;
  }

  if (
    raw === 'until they exile a card that shares a card type with it' ||
    raw === 'until you exile a card that shares a card type with it'
  ) {
    const refTypes = Array.isArray(ctx?.referenceSpellTypes)
      ? new Set(ctx.referenceSpellTypes.map(t => String(t || '').toLowerCase()).filter(Boolean))
      : null;
    if (!refTypes || refTypes.size === 0) return null;

    for (let i = 0; i < library.length; i++) {
      const cardTypes = getCardTypesFromTypeLine(library[i]);
      if (!cardTypes) return null;
      if (cardTypes.some(type => refTypes.has(type))) return i + 1;
    }
    return library.length;
  }

  if (
    raw === "until you exile a nonland card whose mana value is less than this spell's mana value" ||
    raw === "until they exile a nonland card whose mana value is less than this spell's mana value"
  ) {
    const referenceManaValue = Number(ctx?.referenceSpellManaValue);
    if (!Number.isFinite(referenceManaValue)) return null;

    for (let i = 0; i < library.length; i++) {
      const typeLine = getCardTypeLineLower(library[i]);
      if (!typeLine) return null;
      if (typeLine.includes('land')) continue;

      const manaValue = getCardManaValue(library[i]);
      if (manaValue === null) return null;
      if (manaValue < referenceManaValue) return i + 1;
    }
    return library.length;
  }

  return null;
}

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
  if (normalized.endsWith(' card')) {
    const typeName = normalized.slice(0, -' card'.length).trim();
    return typeName ? typeLine.includes(typeName) : false;
  }
  return typeLine.includes(normalized);
}

export function resolveRevealUntilReferenceAmountForPlayer(
  state: GameState,
  playerId: PlayerID,
  qty: OracleQuantity
): { readonly count: number; readonly cards: readonly any[] } | null {
  if (qty.kind !== 'reference_amount') return null;
  const raw = normalizeOracleText(String((qty as any).raw || ''));
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

function resolvePlayerByLifeTotal(state: GameState, mode: 'most' | 'least'): readonly PlayerID[] {
  const entries = (state.players || [])
    .map((player: any) => ({
      id: String(player?.id || '').trim(),
      life: Number(player?.life ?? 0),
    }))
    .filter(entry => Boolean(entry.id));
  if (entries.length === 0) return [];

  const targetLife =
    mode === 'most'
      ? Math.max(...entries.map(entry => entry.life))
      : Math.min(...entries.map(entry => entry.life));
  const matches = entries.filter(entry => entry.life === targetLife).map(entry => entry.id as PlayerID);
  return matches.length === 1 ? matches : matches.slice(0, 1);
}

function resolvePlayersFromRawSelectorText(
  state: GameState,
  rawText: string,
  ctx: OracleIRExecutionContext
): readonly PlayerID[] {
  const normalized = String(rawText || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!normalized) return [];

  if (normalized === 'the player with the most life') return resolvePlayerByLifeTotal(state, 'most');
  if (normalized === 'the player with the lowest life total') return resolvePlayerByLifeTotal(state, 'least');
  if (normalized === "the exiled card's owner" || normalized === 'the exiled cards owner') {
    return resolvePlayers(state, { kind: 'owner_of_source' }, ctx);
  }

  return resolvePlayersFromDamageTarget(state, { kind: 'raw', text: rawText }, ctx);
}

export function resolvePlayers(
  state: GameState,
  selector: OraclePlayerSelector,
  ctx: OracleIRExecutionContext
): readonly PlayerID[] {
  const normalizeId = (value: unknown): PlayerID | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized ? (normalized as PlayerID) : undefined;
  };

  const controllerId = normalizeId(ctx.controllerId) ?? ctx.controllerId;
  const hasValidController = (state.players || []).some((player: any) => normalizeId(player?.id) === controllerId);
  const opponents = hasValidController
    ? (state.players || [])
        .map((player: any) => normalizeId(player?.id))
        .filter((id: PlayerID | undefined): id is PlayerID => Boolean(id) && id !== controllerId)
    : [];
  const opponentIdSet = new Set(opponents);
  const allPlayerIds = new Set(
    (state.players || [])
      .map((player: any) => normalizeId(player?.id))
      .filter((id: PlayerID | undefined): id is PlayerID => Boolean(id))
  );

  const dedupe = (ids: readonly PlayerID[]): readonly PlayerID[] => {
    const out: PlayerID[] = [];
    const seen = new Set<PlayerID>();
    for (const id of ids) {
      const normalized = normalizeId(id);
      if (!normalized || !allPlayerIds.has(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  };

  const dedupeOpponents = (ids: readonly PlayerID[]): readonly PlayerID[] =>
    dedupe(ids).filter(id => opponentIdSet.has(id));

  switch (selector.kind) {
    case 'you':
      return hasValidController ? [controllerId] : [];
    case 'any_player':
      return state.players.map(p => p.id);
    case 'each_player':
      return state.players.map(p => p.id);
    case 'each_opponent':
      return opponents;
    case 'any_number_of_target_opponents': {
      const chosenTargets = Array.isArray(ctx.selectorContext?.chosenObjectIds)
        ? dedupeOpponents(ctx.selectorContext.chosenObjectIds as PlayerID[])
        : [];
      if (chosenTargets.length > 0) return chosenTargets;
      const bound = normalizeId(ctx.selectorContext?.targetOpponentId);
      if (bound && opponentIdSet.has(bound)) return [bound];
      return opponents;
    }
    case 'any_number_of_target_players': {
      const chosenTargets = Array.isArray(ctx.selectorContext?.chosenObjectIds)
        ? dedupe(ctx.selectorContext.chosenObjectIds as PlayerID[])
        : [];
      if (chosenTargets.length > 0) return chosenTargets;
      const bound = normalizeId(ctx.selectorContext?.targetPlayerId) ?? normalizeId(ctx.selectorContext?.targetOpponentId);
      if (bound && allPlayerIds.has(bound)) return [bound];
      return [];
    }
    case 'you_and_target_opponent': {
      const target = normalizeId(ctx.selectorContext?.targetOpponentId) ?? normalizeId(ctx.selectorContext?.targetPlayerId);
      const opponent = target && opponentIdSet.has(target) ? target : opponents.length === 1 ? opponents[0] : undefined;
      return opponent ? dedupe([controllerId, opponent]) : (hasValidController ? [controllerId] : []);
    }
    case 'you_and_target_player': {
      const target = normalizeId(ctx.selectorContext?.targetPlayerId) ?? normalizeId(ctx.selectorContext?.targetOpponentId);
      const player = target && allPlayerIds.has(target) ? target : opponents.length === 1 ? opponents[0] : undefined;
      return player ? dedupe([controllerId, player]) : (hasValidController ? [controllerId] : []);
    }
    case 'each_of_those_opponents': {
      const contextual = ctx.selectorContext?.eachOfThoseOpponents;
      if (Array.isArray(contextual) && contextual.length > 0) {
        return dedupeOpponents(contextual as PlayerID[]);
      }
      return opponents.length === 1 ? [opponents[0]] : [];
    }
    case 'target_opponent': {
      const bound = normalizeId(ctx.selectorContext?.targetOpponentId);
      if (bound && opponentIdSet.has(bound)) return [bound];
      const boundPlayer = normalizeId(ctx.selectorContext?.targetPlayerId);
      if (boundPlayer && opponentIdSet.has(boundPlayer)) return [boundPlayer];
      return opponents.length === 1 ? [opponents[0]] : [];
    }
    case 'enchanted_player': {
      const bound = normalizeId(ctx.selectorContext?.targetPlayerId);
      if (bound && allPlayerIds.has(bound)) return [bound];

      const sourceId = String(ctx.sourceId || '').trim();
      if (sourceId) {
        const sourcePermanent = (state.battlefield || []).find(
          (permanent: any) => String(permanent?.id || '').trim() === sourceId
        ) as any;
        const attachedTo = String(
          sourcePermanent?.attachedTo ||
            sourcePermanent?.enchanting ||
            sourcePermanent?.enchantedPlayerId ||
            ''
        ).trim();
        if (attachedTo && allPlayerIds.has(attachedTo as PlayerID)) {
          return [attachedTo as PlayerID];
        }
      }
      return [];
    }
    case 'target_player': {
      const bound =
        normalizeId(ctx.targetPlayerId) ??
        normalizeId(ctx.selectorContext?.targetPlayerId);
      if (bound && allPlayerIds.has(bound)) return [bound];
      const boundOpponent =
        normalizeId(ctx.selectorContext?.targetOpponentId) ??
        normalizeId(ctx.targetOpponentId);
      if (boundOpponent && allPlayerIds.has(boundOpponent)) return [boundOpponent];
      const boundSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
      if (boundSpellId) {
        const stackItem = (state.stack || []).find((item: any) => String(item?.id || '').trim() === boundSpellId) as any;
        const spellControllerId = normalizeId(stackItem?.controller || stackItem?.owner);
        if (spellControllerId && allPlayerIds.has(spellControllerId)) {
          return [spellControllerId];
        }
      }
      return opponents.length === 1 ? [opponents[0]] : [];
    }
    case 'owner_of_moved_cards': {
      const movedCards = Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : [];
      const seen = new Set<string>();
      const owners: PlayerID[] = [];
      for (const card of movedCards) {
        const ownerId = normalizeId((card as any)?.owner ?? (card as any)?.ownerId);
        if (!ownerId || !allPlayerIds.has(ownerId) || seen.has(ownerId)) continue;
        seen.add(ownerId);
        owners.push(ownerId);
      }
      if (owners.length > 0) return owners;
      return opponents.length === 1 ? [opponents[0]] : [];
    }
    case 'owner_of_source': {
      const movedCards = Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : [];
      const sacrificed = Array.isArray(ctx.lastSacrificedPermanents) ? ctx.lastSacrificedPermanents : [];
      for (const entry of [...sacrificed, ...movedCards].reverse()) {
        const ownerId = normalizeId((entry as any)?.owner || (entry as any)?.controller);
        if (ownerId && allPlayerIds.has(ownerId)) return [ownerId];
      }
      const sourceId = String(ctx.sourceId || '').trim();
      if (sourceId) {
        for (const player of state.players || []) {
          const playerId = normalizeId((player as any)?.id);
          if (!playerId) continue;
          for (const zone of ['battlefield', 'graveyard', 'hand', 'exile', 'library'] as const) {
            if (zone === 'battlefield') {
              const permanent = (state.battlefield || []).find(
                (entry: any) => String(entry?.id || '').trim() === sourceId
              ) as any;
              if (permanent) {
                const ownerId = normalizeId(permanent?.owner || permanent?.controller);
                if (ownerId && allPlayerIds.has(ownerId)) return [ownerId];
              }
              continue;
            }
            const cards = zone === 'library'
              ? (Array.isArray((player as any)?.library) ? (player as any).library : [])
              : Array.isArray((player as any)?.[zone])
                ? (player as any)[zone]
                : [];
            if (cards.some((card: any) => String(card?.id || '').trim() === sourceId)) {
              return [playerId];
            }
          }
        }
      }
      return hasValidController ? [controllerId] : [];
    }
    case 'high_bidder': {
      const bound = normalizeId((ctx as any).highBidderPlayerId ?? ctx.selectorContext?.highBidderPlayerId);
      if (bound && allPlayerIds.has(bound)) return [bound];
      return hasValidController ? [controllerId] : [];
    }
    case 'source_controller': {
      const sourceId = String(ctx.sourceId || '').trim();
      if (sourceId) {
        const permanent = (state.battlefield || []).find(
          (entry: any) => String(entry?.id || '').trim() === sourceId
        ) as any;
        const sourceController = normalizeId(permanent?.controller || permanent?.controllerId);
        if (sourceController && allPlayerIds.has(sourceController)) return [sourceController];
      }
      const bound = normalizeId(ctx.selectorContext?.targetPlayerId);
      if (bound && allPlayerIds.has(bound)) return [bound];
      return hasValidController ? [controllerId] : [];
    }
    case 'each_player_who_controls_the_most': {
      const filter = String((selector as any).filter || 'creatures')
        .replace(/[.]+$/g, '')
        .trim()
        .toLowerCase();
      const counts = new Map<PlayerID, number>();
      for (const permanent of (state.battlefield || []) as any[]) {
        const typeLine = String(permanent?.type_line || permanent?.typeLine || '').toLowerCase();
        if (filter.includes('creature') && !typeLine.includes('creature')) continue;
        const owner = normalizeId(permanent?.controller || permanent?.controllerId);
        if (!owner || !allPlayerIds.has(owner)) continue;
        counts.set(owner, (counts.get(owner) || 0) + 1);
      }
      if (counts.size === 0) return hasValidController ? [controllerId] : [];
      const max = Math.max(...counts.values());
      return [...counts.entries()].filter(([, count]) => count === max).map(([id]) => id);
    }
    case 'each_controller_of_those':
      return [];
    case 'unknown':
    default: {
      const rawText =
        (selector as any).kind === 'raw'
          ? String((selector as any).text || '')
          : String((selector as any).raw || '');
      if (!rawText) return [];
      return resolvePlayersFromRawSelectorText(state, rawText, ctx);
    }
  }
}

export function resolvePlayersFromDamageTarget(
  state: GameState,
  target: { readonly kind: 'raw'; readonly text: string } | { readonly kind: 'unknown'; readonly raw: string },
  ctx: OracleIRExecutionContext
): readonly PlayerID[] {
  if (target.kind !== 'raw') return [];

  const normalizeId = (value: unknown): PlayerID | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized ? (normalized as PlayerID) : undefined;
  };
  const allPlayerIds = new Set(
    (state.players || [])
      .map((player: any) => normalizeId(player?.id))
      .filter((id: PlayerID | undefined): id is PlayerID => Boolean(id))
  );

  const t = String(target.text || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\.!]$/, '');
  if (!t) return [];

  if (t === 'you') return resolvePlayers(state, { kind: 'you' }, ctx);
  if (t === 'any target') {
    const targetPlayerId = normalizeId(ctx.selectorContext?.targetPlayerId);
    if (targetPlayerId && allPlayerIds.has(targetPlayerId)) return [targetPlayerId];

    const targetOpponentId = normalizeId(ctx.selectorContext?.targetOpponentId);
    if (targetOpponentId && allPlayerIds.has(targetOpponentId)) return [targetOpponentId];
  }
  if (t === 'target player') return resolvePlayers(state, { kind: 'target_player' }, ctx);
  if (t === 'target opponent') return resolvePlayers(state, { kind: 'target_opponent' }, ctx);
  if (
    t === 'that player' ||
    t === 'he or she' ||
    t === 'him or her' ||
    t === 'they' ||
    t === 'its controller' ||
    t === 'its owner' ||
    isThatOwnerOrControllerSelector(t)
  ) {
    if (t === 'its owner') return resolvePlayers(state, { kind: 'owner_of_source' }, ctx);
    return resolvePlayers(state, { kind: 'target_player' }, ctx);
  }
  if (t === 'defending player' || t === 'the defending player') {
    return resolvePlayers(state, { kind: 'target_opponent' }, ctx);
  }
  if (t === 'that opponent') return resolvePlayers(state, { kind: 'target_opponent' }, ctx);
  if (isThoseOpponentsSelector(t)) return resolvePlayers(state, { kind: 'each_of_those_opponents' }, ctx);
  if (t === 'each player') return resolvePlayers(state, { kind: 'each_player' }, ctx);
  if (t === 'each of your opponents' || t === 'each of the opponents') return resolvePlayers(state, { kind: 'each_opponent' }, ctx);
  if (t === 'each opponent') return resolvePlayers(state, { kind: 'each_opponent' }, ctx);
  if (t === 'your opponents') return resolvePlayers(state, { kind: 'each_opponent' }, ctx);
  if (t === 'all opponents' || t === 'all of your opponents' || t === 'all of the opponents') {
    return resolvePlayers(state, { kind: 'each_opponent' }, ctx);
  }
  if (t === 'all your opponents') return resolvePlayers(state, { kind: 'each_opponent' }, ctx);

  return [];
}

export function isThatOwnerOrControllerSelector(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[â€™]/g, "'")
    .trim()
    .toLowerCase();
  return /^(?:that|the) [a-z0-9][a-z0-9 -]*'s (?:controller|owner)$/i.test(s);
}

export function isThoseOpponentsSelector(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[â€™]/g, "'")
    .trim()
    .toLowerCase();
  return s === 'each of those opponents' || s === 'those opponents' || s === 'all of those opponents' || s === 'all those opponents';
}

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
  writePlayerZoneCards(state, playerId, player, 'exile', [...exile, ...exiled]);
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

export function lookSelectTopCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  lookCount: number,
  chooseCount: number,
  destination: 'hand' | 'graveyard' | 'library_top',
  restDestination: 'graveyard' | 'library',
  restToTop = false,
  restRandomOrder = false,
  bridgeOptions?: PlayerZoneChangeBridgeContext,
  chosenObjectIds?: readonly string[],
): {
  state: GameState;
  log: string[];
  chosen: any[];
  rest: any[];
  lookedAtCount: number;
  ledgerRecordedViaBridge?: boolean;
  halted?: boolean;
} {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) {
    return {
      state,
      log: [`Player not found: ${playerId}`],
      chosen: [],
      rest: [],
      lookedAtCount: 0,
    };
  }

  const library = readPlayerZoneCards(state, playerId, player, 'library');
  const actualLookCount = Math.max(0, Math.min(library.length, lookCount | 0));
  const chooseActual = Math.max(0, Math.min(actualLookCount, chooseCount | 0));
  const looked = library.slice(0, actualLookCount);
  let chosen: any[];
  let rest: any[];
  const normalizedChosenIds = (Array.isArray(chosenObjectIds) ? chosenObjectIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (normalizedChosenIds.length > 0) {
    const chosenIdSet = new Set(normalizedChosenIds);
    chosen = looked
      .filter((card) => chosenIdSet.has(String((card as { id?: string })?.id || '').trim()))
      .slice(0, chooseActual);
    const chosenIds = new Set(
      chosen.map((card) => String((card as { id?: string })?.id || '').trim()).filter(Boolean),
    );
    rest = looked.filter((card) => !chosenIds.has(String((card as { id?: string })?.id || '').trim()));
  } else {
    chosen = looked.slice(0, chooseActual);
    rest = looked.slice(chooseActual);
  }

  const stepIndex = bridgeOptions?.stepIndex;
  const canBridge = bridgeOptions?.ctx?.serverBridge && Number.isFinite(stepIndex);
  const canBridgeChosen = canBridge
    && (destination === 'hand' || destination === 'graveyard' || destination === 'library_top')
    && chosen.length > 0;

  if (canBridgeChosen) {
    const intendedDestination = destination === 'hand'
      ? 'hand'
      : destination === 'graveyard'
        ? 'graveyard'
        : 'library';
    const libraryPlacement = destination === 'library_top' ? 'top' as const : undefined;
    const cardsToCommit = (destination === 'graveyard'
      ? stampCardsPutIntoGraveyardThisTurn(state, chosen)
      : destination === 'library_top'
        ? [...chosen].reverse()
        : chosen
    ).map((card: any) => ({ ...card, ownerId: playerId, owner: playerId }));

    const commitResult = commitCardZoneChanges({
      state,
      playerId,
      cards: cardsToCommit,
      sourceZone: 'library',
      intendedDestination,
      stepIndex: Number(stepIndex),
      stepKind: String(bridgeOptions?.stepKind || 'look_select_top'),
      cause: 'oracle_ir:look_select_top',
      ctx: bridgeOptions?.ctx,
      libraryPlacement,
    });
    if (commitResult.halted) {
      return {
        state,
        log: [],
        chosen: [],
        rest: [],
        lookedAtCount: 0,
        halted: true,
      };
    }

    let ledgerRecordedViaBridge = Boolean(commitResult.ledgerRecordedViaBridge);
    if (rest.length > 0) {
      const restCommit = commitLookSelectRestZoneChanges({
        state,
        playerId,
        rest,
        destination,
        restDestination,
        restToTop,
        restRandomOrder,
        stepIndex: Number(stepIndex),
        stepKind: String(bridgeOptions?.stepKind || 'look_select_top'),
        ctx: bridgeOptions?.ctx,
      });
      if (restCommit.halted) {
        return {
          state,
          log: [],
          chosen: [],
          rest: [],
          lookedAtCount: 0,
          halted: true,
        };
      }
      if (restCommit.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
    }

    const destinationLabel = destination === 'hand'
      ? 'their hand'
      : destination === 'graveyard'
        ? 'their graveyard'
        : 'the top of their library';
    const restLabel = restDestination === 'graveyard'
      ? 'their graveyard'
      : restRandomOrder
        ? 'the bottom of their library in a random order'
        : restToTop
          ? 'the top of their library'
          : 'the bottom of their library';

    return {
      state,
      log: [
        `${playerId} looks at ${actualLookCount} card(s), puts ${commitResult.movedCards.length} into ${destinationLabel}, and moves ${rest.length} to ${restLabel}`,
      ],
      chosen: commitResult.movedCards,
      rest,
      lookedAtCount: actualLookCount,
      ledgerRecordedViaBridge,
    };
  }

  if (canBridge && chosen.length === 0 && rest.length > 0) {
    const restCommit = commitLookSelectRestZoneChanges({
      state,
      playerId,
      rest,
      destination,
      restDestination,
      restToTop,
      restRandomOrder,
      stepIndex: Number(stepIndex),
      stepKind: String(bridgeOptions?.stepKind || 'look_select_top'),
      ctx: bridgeOptions?.ctx,
    });
    if (restCommit.halted) {
      return {
        state,
        log: [],
        chosen: [],
        rest: [],
        lookedAtCount: 0,
        halted: true,
      };
    }

    const destinationLabel = destination === 'hand'
      ? 'their hand'
      : destination === 'graveyard'
        ? 'their graveyard'
        : 'the top of their library';
    const restLabel = restDestination === 'graveyard'
      ? 'their graveyard'
      : restRandomOrder
        ? 'the bottom of their library in a random order'
        : restToTop
          ? 'the top of their library'
          : 'the bottom of their library';

    return {
      state: restCommit.state,
      log: [
        `${playerId} looks at ${actualLookCount} card(s), puts 0 into ${destinationLabel}, and moves ${rest.length} to ${restLabel}`,
      ],
      chosen: [],
      rest,
      lookedAtCount: actualLookCount,
      ledgerRecordedViaBridge: restCommit.ledgerRecordedViaBridge,
    };
  }

  const hand = readPlayerZoneCards(state, playerId, player, 'hand');
  const graveyard = readPlayerZoneCards(state, playerId, player, 'graveyard');
  let nextLibrary = [...library];
  let nextHand = [...hand];
  let nextGraveyard = [...graveyard];
  nextLibrary.splice(0, actualLookCount);

  if (destination === 'hand') {
    nextHand.push(...chosen);
  } else if (destination === 'graveyard') {
    nextGraveyard.push(...stampCardsPutIntoGraveyardThisTurn(state, chosen));
  } else if (destination === 'library_top' && chosen.length > 0) {
    for (let index = chosen.length - 1; index >= 0; index -= 1) {
      nextLibrary.unshift(chosen[index]);
    }
  }

  if (restDestination === 'graveyard') {
    nextGraveyard.push(...stampCardsPutIntoGraveyardThisTurn(state, rest));
  } else if (rest.length > 0) {
    if (destination === 'library_top') {
      const bottomRest = restRandomOrder
        ? [...rest].sort(() => Math.random() - 0.5)
        : rest;
      nextLibrary.push(...bottomRest);
    } else {
      const reorderedRest = restToTop ? rest : [...rest].reverse();
      nextLibrary.unshift(...reorderedRest);
    }
  }

  writePlayerZoneCards(state, playerId, player, 'library', nextLibrary);
  writePlayerZoneCards(state, playerId, player, 'hand', nextHand);
  writePlayerZoneCards(state, playerId, player, 'graveyard', nextGraveyard);

  const destinationLabel = destination === 'hand'
    ? 'their hand'
    : destination === 'graveyard'
      ? 'their graveyard'
      : 'the top of their library';
  const restLabel = restDestination === 'graveyard'
    ? 'their graveyard'
    : restRandomOrder
      ? 'the bottom of their library in a random order'
      : restToTop
        ? 'the top of their library'
        : 'the bottom of their library';

  return {
    state,
    log: [
      `${playerId} looks at ${actualLookCount} card(s), puts ${chosen.length} into ${destinationLabel}, and moves ${rest.length} to ${restLabel}`,
    ],
    chosen,
    rest,
    lookedAtCount: actualLookCount,
  };
}

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

  const verb = delta >= 0 ? 'gains' : 'loses';
  log.push(`${playerId} ${verb} ${Math.abs(delta)} life`);

  return { state: { ...state, players: updatedPlayers as any }, log };
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
          ? player?.energyCounters ?? player?.energy ?? nextCounters.energy
          : normalizedCounter === 'experience'
            ? player?.experienceCounters ?? player?.experience ?? (state as any)?.experienceCounters?.[playerId] ?? nextCounters.experience
            : normalizedCounter === 'rad'
              ? player?.radCounters ?? nextCounters.rad
              : normalizedCounter === 'ticket'
                ? player?.ticketCounters ?? nextCounters.ticket
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
  }

  nextState.players = state.players.map(p => (p.id === playerId ? nextPlayer : p));
  const verb = delta >= 0 ? 'gets' : 'loses';
  log.push(`${playerId} ${verb} ${Math.abs(delta)} ${normalizedCounter} counter${Math.abs(delta) === 1 ? '' : 's'}`);

  return { state: nextState as GameState, log, applied: true };
}

export function discardCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  count: number,
  bridgeOptions?: PlayerZoneChangeBridgeContext,
): { state: GameState; log: string[]; applied: boolean; needsChoice: boolean; discardedCount: number; discardedCards: any[]; ledgerRecordedViaBridge?: boolean; halted?: boolean } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`], applied: false, needsChoice: false, discardedCount: 0, discardedCards: [] };

  const hand = [...((player as any).hand || [])];
  const graveyard = [...((player as any).graveyard || [])];

  const n = Math.max(0, count | 0);
  if (n === 0) return { state, log, applied: true, needsChoice: false, discardedCount: 0, discardedCards: [] };

  if (hand.length > n) {
    return { state, log, applied: false, needsChoice: true, discardedCount: 0, discardedCards: [] };
  }

  const discarded = hand.splice(0, hand.length);
  const stampedDiscarded = stampCardsPutIntoGraveyardThisTurn(state, discarded).map((card: any) => ({
    ...card,
    ownerId: playerId,
    owner: playerId,
  }));

  const stepIndex = bridgeOptions?.stepIndex;
  if (bridgeOptions?.ctx?.serverBridge && Number.isFinite(stepIndex)) {
    const commitResult = commitCardZoneChanges({
      state,
      playerId,
      cards: stampedDiscarded,
      sourceZone: 'hand',
      intendedDestination: 'graveyard',
      stepIndex: Number(stepIndex),
      stepKind: String(bridgeOptions.stepKind || 'discard'),
      cause: 'oracle_ir:discard',
      ctx: bridgeOptions.ctx,
    });
    if (commitResult.halted) {
      return {
        state,
        log: [],
        applied: true,
        needsChoice: false,
        discardedCount: 0,
        discardedCards: [],
        halted: true,
      };
    }
    const actualCount = commitResult.movedCards.length;
    log.push(`${playerId} discards ${actualCount} card(s)`);
    return {
      state: commitResult.state,
      log,
      applied: true,
      needsChoice: false,
      discardedCount: actualCount,
      discardedCards: commitResult.movedCards,
      ledgerRecordedViaBridge: commitResult.ledgerRecordedViaBridge,
    };
  }

  graveyard.push(...stampedDiscarded);

  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...p, hand, graveyard } : p));
  log.push(`${playerId} discards ${discarded.length} card(s)`);
  return {
    state: { ...state, players: updatedPlayers as any },
    log,
    applied: true,
    needsChoice: false,
    discardedCount: discarded.length,
    discardedCards: stampedDiscarded,
  };
}

export function discardSpecificCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  cardIds: readonly string[],
  bridgeOptions?: PlayerZoneChangeBridgeContext,
): {
  state: GameState;
  log: string[];
  applied: boolean;
  discardedCount: number;
  discardedCards: any[];
  missingCardIds: readonly string[];
  ledgerRecordedViaBridge?: boolean;
  halted?: boolean;
} {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) {
    return { state, log: [`Player not found: ${playerId}`], applied: false, discardedCount: 0, discardedCards: [], missingCardIds: [] };
  }

  const wantedIds = Array.from(new Set((Array.isArray(cardIds) ? cardIds : []).map(id => String(id || '').trim()).filter(Boolean)));
  if (wantedIds.length === 0) {
    return { state, log, applied: false, discardedCount: 0, discardedCards: [], missingCardIds: [] };
  }

  const wantedIdSet = new Set(wantedIds);
  const hand = [...((player as any).hand || [])];
  const graveyard = [...((player as any).graveyard || [])];
  const discarded = hand.filter((card: any) => wantedIdSet.has(String(card?.id || '').trim()));
  const missingCardIds = wantedIds.filter(id => !discarded.some((card: any) => String(card?.id || '').trim() === id));
  if (missingCardIds.length > 0) {
    return { state, log, applied: false, discardedCount: 0, discardedCards: [], missingCardIds };
  }

  const remainingHand = hand.filter((card: any) => !wantedIdSet.has(String(card?.id || '').trim()));
  const stampedDiscarded = stampCardsPutIntoGraveyardThisTurn(state, discarded).map((card: any) => ({
    ...card,
    ownerId: playerId,
    owner: playerId,
  }));

  const stepIndex = bridgeOptions?.stepIndex;
  if (bridgeOptions?.ctx?.serverBridge && Number.isFinite(stepIndex)) {
    const commitResult = commitCardZoneChanges({
      state,
      playerId,
      cards: stampedDiscarded,
      sourceZone: 'hand',
      intendedDestination: 'graveyard',
      stepIndex: Number(stepIndex),
      stepKind: String(bridgeOptions.stepKind || 'discard'),
      cause: 'oracle_ir:discard',
      ctx: bridgeOptions.ctx,
    });
    if (commitResult.halted) {
      return {
        state,
        log: [],
        applied: true,
        discardedCount: 0,
        discardedCards: [],
        missingCardIds: [],
        halted: true,
      };
    }
    log.push(`${playerId} discards ${commitResult.movedCards.length} chosen card(s)`);
    return {
      state: commitResult.state,
      log,
      applied: true,
      discardedCount: commitResult.movedCards.length,
      discardedCards: commitResult.movedCards,
      missingCardIds: [],
      ledgerRecordedViaBridge: commitResult.ledgerRecordedViaBridge,
    };
  }

  graveyard.push(...stampedDiscarded);
  const updatedPlayers = state.players.map((p) => (
    p.id === playerId ? { ...p, hand: remainingHand, graveyard } : p
  ));
  log.push(`${playerId} discards ${discarded.length} chosen card(s)`);
  return {
    state: { ...state, players: updatedPlayers as any },
    log,
    applied: true,
    discardedCount: stampedDiscarded.length,
    discardedCards: stampedDiscarded,
    missingCardIds: [],
  };
}

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

export function addManaToPoolForPlayer(
  state: GameState,
  playerId: PlayerID,
  mana: string,
  spendRestriction?: 'creature_spell' | 'instant_or_sorcery_spell' | 'artifact_spell_or_ability' | 'activated_ability',
  sourceId?: string,
  sourceName?: string
): { state: GameState; log: string[]; applied: boolean } {
  const log: string[] = [];

  const playerExists = state.players.some(p => p.id === playerId);
  if (!playerExists) return { state, log: [`Player not found: ${playerId}`], applied: false };

  const symbols = parseManaSymbols(mana);
  if (symbols.length === 0) return { state, log: [`Skipped add mana (no symbols): ${mana}`], applied: false };

  const restriction: ManaRestrictionType | undefined = spendRestriction === 'creature_spell'
    ? 'creatures'
    : spendRestriction === 'instant_or_sorcery_spell'
      ? 'instant_sorcery'
      : spendRestriction === 'artifact_spell_or_ability'
        ? 'artifacts'
        : spendRestriction === 'activated_ability'
          ? 'activated_abilities'
        : undefined;

  const symbolToManaType = (symbol: string): ManaType => {
    switch (String(symbol).toUpperCase()) {
      case '{W}': return ManaType.WHITE;
      case '{U}': return ManaType.BLUE;
      case '{B}': return ManaType.BLACK;
      case '{R}': return ManaType.RED;
      case '{G}': return ManaType.GREEN;
      case '{C}': return ManaType.COLORLESS;
      default: return ManaType.COLORLESS;
    }
  };

  for (const sym of symbols) {
    const upper = String(sym).toUpperCase();
    const isBasic = ['{W}', '{U}', '{B}', '{R}', '{G}', '{C}'].includes(upper);
    const isNumeric = /^\{\d+\}$/.test(upper);
    if (!isBasic && !isNumeric) {
      return { state, log: [`Skipped add mana (unsupported symbol ${sym}): ${mana}`], applied: false };
    }
  }

  const manaPoolRecord: Record<PlayerID, any> = { ...(((state as any).manaPool || {}) as any) };
  let pool = manaPoolRecord[playerId] || createEmptyManaPool();

  for (const sym of symbols) {
    const upper = String(sym).toUpperCase();
    switch (upper) {
      case '{W}':
        pool = addMana(pool, ManaType.WHITE, 1);
        break;
      case '{U}':
        pool = addMana(pool, ManaType.BLUE, 1);
        break;
      case '{B}':
        pool = addMana(pool, ManaType.BLACK, 1);
        break;
      case '{R}':
        pool = addMana(pool, ManaType.RED, 1);
        break;
      case '{G}':
        pool = addMana(pool, ManaType.GREEN, 1);
        break;
      case '{C}':
        pool = addMana(pool, ManaType.COLORLESS, 1);
        break;
      default: {
        const m = upper.match(/^\{(\d+)\}$/);
        const n = m ? parseInt(m[1], 10) : 0;
        if (n > 0) pool = addMana(pool, ManaType.COLORLESS, n);
        break;
      }
    }

    if (restriction) {
      const amount = /^\{\d+\}$/.test(upper) ? parseInt(upper.slice(1, -1), 10) : 1;
      if (amount > 0) {
        pool = addRestrictedMana(pool, symbolToManaType(upper), amount, restriction, sourceId, sourceName);
      }
    }
  }

  manaPoolRecord[playerId] = pool;
  log.push(`${playerId} adds ${mana.replace(/\s+/g, '')} to their mana pool${restriction ? ' with a spending restriction' : ''}`);
  return { state: { ...(state as any), manaPool: manaPoolRecord } as any, log, applied: true };
}
