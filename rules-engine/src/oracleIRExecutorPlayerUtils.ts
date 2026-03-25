import type { GameState, PlayerID } from '../../shared/src';
import type { OraclePlayerSelector, OracleQuantity } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { clearPlayableFromExileForCards, stripPlayableFromExileTags } from './playableFromExile';
import { stripPlayableFromGraveyardTags } from './playableFromGraveyard';
import { parseManaSymbols } from './types/numbers';
import { addMana, createEmptyManaPool, ManaType } from './types/mana';

export function getPlayableUntilTurnForImpulseDuration(state: GameState, duration: any): number | null {
  const turnNumber = Number((state as any).turnNumber ?? 0) || 0;
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

export function quantityToNumber(qty: OracleQuantity): number | null {
  if (qty.kind === 'number') return qty.value;
  return null;
}

export function normalizeOracleText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
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
    card?.card?.manaValue ??
    card?.card?.mana_value ??
    card?.card?.cmc;

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function resolveUnknownExileUntilAmountForPlayer(
  state: GameState,
  playerId: PlayerID,
  qty: OracleQuantity,
  ctx?: OracleIRExecutionContext
): number | null {
  if (qty.kind !== 'unknown') return null;

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

  return null;
}

export function resolveUnknownMillUntilAmountForPlayer(
  state: GameState,
  playerId: PlayerID,
  qty: OracleQuantity
): number | null {
  if (qty.kind !== 'unknown') return null;

  const raw = normalizeOracleText(String((qty as any).raw || ''));
  if (raw !== 'until they reveal a land card' && raw !== 'until you reveal a land card') {
    return null;
  }

  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return null;
  const library: any[] = Array.isArray(player.library) ? player.library : [];

  for (let i = 0; i < library.length; i++) {
    const typeLine = getCardTypeLineLower(library[i]);
    if (!typeLine) return null;
    if (typeLine.includes('land')) return i + 1;
  }

  return library.length;
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
    case 'each_player':
      return state.players.map(p => p.id);
    case 'each_opponent':
      return opponents;
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
      return opponents.length === 1 ? [opponents[0]] : [];
    }
    case 'target_player': {
      const bound = normalizeId(ctx.selectorContext?.targetPlayerId);
      if (bound && allPlayerIds.has(bound)) return [bound];
      return [];
    }
    case 'unknown':
    default:
      return [];
  }
}

export function resolvePlayersFromDamageTarget(
  state: GameState,
  target: { readonly kind: 'raw'; readonly text: string } | { readonly kind: 'unknown'; readonly raw: string },
  ctx: OracleIRExecutionContext
): readonly PlayerID[] {
  if (target.kind !== 'raw') return [];

  const t = String(target.text || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\.!]$/, '');
  if (!t) return [];

  if (t === 'you') return resolvePlayers(state, { kind: 'you' }, ctx);
  if (
    t === 'that player' ||
    t === 'he or she' ||
    t === 'him or her' ||
    t === 'they' ||
    t === 'its controller' ||
    t === 'its owner' ||
    isThatOwnerOrControllerSelector(t)
  ) return resolvePlayers(state, { kind: 'target_player' }, ctx);
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
  return /^that [a-z0-9][a-z0-9 -]*'s (?:controller|owner)$/i.test(s);
}

export function isThoseOpponentsSelector(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[â€™]/g, "'")
    .trim()
    .toLowerCase();
  return s === 'each of those opponents' || s === 'those opponents' || s === 'all of those opponents' || s === 'all those opponents';
}

export function drawCardsForPlayer(state: GameState, playerId: PlayerID, count: number): { state: GameState; log: string[] } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`] };

  const library = [...((player as any).library || [])];
  const hand = [...((player as any).hand || [])];

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

  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...p, library, hand } : p));
  return {
    state: { ...state, players: updatedPlayers as any },
    log: drawn > 0 ? [`${playerId} draws ${drawn} card(s)`] : log,
  };
}

export function exileTopCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  count: number
): { state: GameState; log: string[]; exiled: any[] } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`], exiled: [] };

  const library = [...((player as any).library || [])];
  const exile = [...((player as any).exile || [])];

  const exiled: any[] = [];
  for (let i = 0; i < Math.max(0, count | 0); i++) {
    if (library.length === 0) {
      log.push(`${playerId} cannot exile from library (empty library)`);
      break;
    }
    const [card] = library.splice(0, 1);
    exile.push(card);
    exiled.push(card);
  }

  const updatedPlayers = state.players.map(p => (p.id === playerId ? ({ ...p, library, exile } as any) : p));
  return {
    state: { ...state, players: updatedPlayers as any },
    log: exiled.length > 0 ? [`${playerId} exiles ${exiled.length} card(s) from the top of their library`] : log,
    exiled,
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
    step?.amount?.kind === 'unknown' &&
    (who === 'target_opponent' || who === 'target_player') &&
    (amountRaw === 'until they exile an instant or sorcery card' ||
      amountRaw === 'until you exile an instant or sorcery card' ||
      amountRaw === 'until they exile a card that shares a card type with it' ||
      amountRaw === 'until you exile a card that shares a card type with it')
  );
}

export function shouldShuffleRestIntoLibrary(step: any): boolean {
  const t = normalizeOracleText(String(step?.raw || ''));
  if (/\bthen\s+shuffles\s+the\s+rest\s+into\s+(?:their|his\s+or\s+her|your)\s+library\b/.test(t)) {
    return true;
  }

  const amountRaw = normalizeOracleText(String(step?.amount?.raw || ''));
  const who = String(step?.who?.kind || '');
  return (
    step?.kind === 'impulse_exile_top' &&
    step?.duration === 'during_resolution' &&
    step?.permission === 'cast' &&
    step?.amount?.kind === 'unknown' &&
    who === 'each_opponent' &&
    (amountRaw === 'until they exile an instant or sorcery card' ||
      amountRaw === 'until you exile an instant or sorcery card')
  );
}

export function splitExiledForShuffleRest(step: any, exiled: readonly any[]): { keepExiled: readonly any[]; returnToLibrary: readonly any[] } {
  const all = Array.isArray(exiled) ? exiled : [];
  if (all.length === 0) return { keepExiled: [], returnToLibrary: [] };

  const amountRaw = normalizeOracleText(String(step?.amount?.raw || ''));

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

export function discardCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  count: number
): { state: GameState; log: string[]; applied: boolean; needsChoice: boolean; discardedCount: number } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`], applied: false, needsChoice: false, discardedCount: 0 };

  const hand = [...((player as any).hand || [])];
  const graveyard = [...((player as any).graveyard || [])];

  const n = Math.max(0, count | 0);
  if (n === 0) return { state, log, applied: true, needsChoice: false, discardedCount: 0 };

  if (hand.length > n) {
    return { state, log, applied: false, needsChoice: true, discardedCount: 0 };
  }

  const discarded = hand.splice(0, hand.length);
  graveyard.push(...discarded);

  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...p, hand, graveyard } : p));
  log.push(`${playerId} discards ${discarded.length} card(s)`);
  return { state: { ...state, players: updatedPlayers as any }, log, applied: true, needsChoice: false, discardedCount: discarded.length };
}

export function millCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  count: number
): { state: GameState; log: string[] } {
  const log: string[] = [];
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { state, log: [`Player not found: ${playerId}`] };

  const library = [...((player as any).library || [])];
  const graveyard = [...((player as any).graveyard || [])];

  const n = Math.max(0, count | 0);
  if (n === 0) return { state, log };

  const actual = Math.min(n, library.length);
  const milled = library.splice(0, actual);
  graveyard.push(...milled);

  const updatedPlayers = state.players.map(p => (p.id === playerId ? { ...p, library, graveyard } : p));
  log.push(`${playerId} mills ${actual} card(s)`);
  return { state: { ...state, players: updatedPlayers as any }, log };
}

export function addManaToPoolForPlayer(
  state: GameState,
  playerId: PlayerID,
  mana: string
): { state: GameState; log: string[]; applied: boolean } {
  const log: string[] = [];

  const playerExists = state.players.some(p => p.id === playerId);
  if (!playerExists) return { state, log: [`Player not found: ${playerId}`], applied: false };

  const symbols = parseManaSymbols(mana);
  if (symbols.length === 0) return { state, log: [`Skipped add mana (no symbols): ${mana}`], applied: false };

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
  }

  manaPoolRecord[playerId] = pool;
  log.push(`${playerId} adds ${mana.replace(/\s+/g, '')} to their mana pool`);
  return { state: { ...(state as any), manaPool: manaPoolRecord } as any, log, applied: true };
}
