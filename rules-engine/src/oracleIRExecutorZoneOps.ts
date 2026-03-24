import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import { mergeRetainedCountersForBattlefieldEntry } from '../../shared/src/zoneRetainedCounters';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { clearPlayableFromExileForCards, stripPlayableFromExileTags } from './playableFromExile';

export type SimpleCardType =
  | 'any'
  | 'creature'
  | 'artifact'
  | 'enchantment'
  | 'land'
  | 'instant'
  | 'sorcery'
  | 'planeswalker'
  | 'saga'
  | 'aura'
  | 'nonland'
  | 'instant_or_sorcery'
  | 'artifact_or_creature'
  | 'artifact_or_enchantment'
  | 'creature_or_land'
  | 'creature_or_planeswalker'
  | 'artifact_instant_or_sorcery'
  | 'creature_instant_or_sorcery'
  | 'non_dragon_creature'
  | 'legendary_creature';

export type MoveZoneSingleTargetCriteria = {
  readonly cardType: SimpleCardType;
  readonly manaValueLte?: number;
};

const stripImpulsePermissionMarkers = stripPlayableFromExileTags;

function parseSmallNumberWord(text: string): number | null {
  const lower = String(text || '').trim().toLowerCase();
  if (!lower) return null;
  if (/^\d+$/.test(lower)) return parseInt(lower, 10);
  const lookup: Record<string, number> = {
    a: 1,
    an: 1,
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
    eleven: 11,
    twelve: 12,
  };
  return Number.isFinite(lookup[lower]) ? lookup[lower] : null;
}

export function parseSimpleCardTypeFromText(text: string): SimpleCardType | null {
  const lower = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim();

  if (!lower) return null;
  if (lower === 'artifact or creature') return 'artifact_or_creature';
  if (lower === 'artifact or enchantment') return 'artifact_or_enchantment';
  if (lower === 'creature or land') return 'creature_or_land';
  if (lower === 'creature or planeswalker') return 'creature_or_planeswalker';
  if (lower === 'instant or sorcery') return 'instant_or_sorcery';
  if (lower === 'artifact, instant, or sorcery' || lower === 'artifact, instant or sorcery') {
    return 'artifact_instant_or_sorcery';
  }
  if (
    lower === 'instant, sorcery, or creature' ||
    lower === 'instant, sorcery or creature' ||
    lower === 'creature, instant, or sorcery' ||
    lower === 'creature, instant or sorcery'
  ) {
    return 'creature_instant_or_sorcery';
  }
  if (lower === 'saga') return 'saga';
  if (lower === 'nonland') return 'nonland';
  if (lower === 'aura') return 'aura';
  if (lower === 'non-dragon creature') return 'non_dragon_creature';
  if (lower === 'legendary creature') return 'legendary_creature';
  if (/\bcreature(s)?\b/i.test(lower)) return 'creature';
  if (/\bartifact(s)?\b/i.test(lower)) return 'artifact';
  if (/\benchantment(s)?\b/i.test(lower)) return 'enchantment';
  if (/\bland(s)?\b/i.test(lower)) return 'land';
  if (/\binstant(s)?\b/i.test(lower)) return 'instant';
  if (/\bsorcery|sorceries\b/i.test(lower)) return 'sorcery';
  if (/\bplaneswalker(s)?\b/i.test(lower)) return 'planeswalker';
  if (/\bsaga(s)?\b/i.test(lower)) return 'saga';
  return null;
}

export function cardMatchesType(card: any, type: SimpleCardType): boolean {
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (type === 'any') return true;
  if (type === 'nonland') return !typeLine.includes('land');
  if (type === 'aura') return typeLine.includes('aura');
  if (type === 'instant_or_sorcery') return typeLine.includes('instant') || typeLine.includes('sorcery');
  if (type === 'artifact_or_creature') return typeLine.includes('artifact') || typeLine.includes('creature');
  if (type === 'artifact_or_enchantment') return typeLine.includes('artifact') || typeLine.includes('enchantment');
  if (type === 'creature_or_land') return typeLine.includes('creature') || typeLine.includes('land');
  if (type === 'creature_or_planeswalker') return typeLine.includes('creature') || typeLine.includes('planeswalker');
  if (type === 'artifact_instant_or_sorcery') {
    return typeLine.includes('artifact') || typeLine.includes('instant') || typeLine.includes('sorcery');
  }
  if (type === 'creature_instant_or_sorcery') {
    return typeLine.includes('creature') || typeLine.includes('instant') || typeLine.includes('sorcery');
  }
  if (type === 'non_dragon_creature') return typeLine.includes('creature') && !typeLine.includes('dragon');
  if (type === 'legendary_creature') return typeLine.includes('legendary') && typeLine.includes('creature');
  return typeLine.includes(type);
}

function parseStaticManaValueLteConstraint(typeText: string): MoveZoneSingleTargetCriteria | null {
  const normalized = String(typeText || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const numericConstraintMatch =
    normalized.match(/^(.+?)(?:\s+cards?)?\s+with\s+mana\s+value\s+(\d+)\s+or\s+less$/i) ||
    normalized.match(/^(.+?)\s+with\s+mana\s+value\s+(\d+)\s+or\s+less$/i);
  if (!numericConstraintMatch) return null;

  const parsedCardType = parseSimpleCardTypeFromText(String(numericConstraintMatch[1] || '').trim());
  const manaValueLte = Number.parseInt(String(numericConstraintMatch[2] || ''), 10);
  if (!parsedCardType || !Number.isFinite(manaValueLte)) return null;

  return { cardType: parsedCardType, manaValueLte };
}

function parseMoveZoneSingleTargetCriteria(typeText: string): MoveZoneSingleTargetCriteria | null {
  const normalized = String(typeText || '').trim();
  if (!normalized) return null;

  const constrained = parseStaticManaValueLteConstraint(normalized);
  if (constrained) return constrained;

  const normalizedTypeText = normalized.replace(/\s+cards?$/i, '').trim();
  if (/^cards?$/i.test(normalizedTypeText)) return { cardType: 'any' };

  const parsedCardType = parseSimpleCardTypeFromText(normalizedTypeText);
  if (!parsedCardType) return null;
  return { cardType: parsedCardType };
}

export function cardMatchesMoveZoneSingleTargetCriteria(card: any, criteria: MoveZoneSingleTargetCriteria): boolean {
  if (!cardMatchesType(card, criteria.cardType)) return false;

  if (criteria.manaValueLte !== undefined) {
    const manaValue = getCardManaValue(card);
    if (manaValue === null || manaValue > criteria.manaValueLte) return false;
  }

  return true;
}

export function parseMoveZoneAllFromYourGraveyard(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (!/\bfrom your graveyard\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+your\s+graveyard$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+your\s+graveyard$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;

  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s graveyard\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;

  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneCountFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly count: number; readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (lower.startsWith('all ')) return null;
  if (!/\bfrom your graveyard\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  let m = cleaned.match(/^([a-z0-9]+)\s+cards?\s+from\s+your\s+graveyard$/i);
  if (m) {
    const count = parseSmallNumberWord(String(m[1] || ''));
    if (count === null || count <= 0) return null;
    return { count, cardType: 'any' };
  }

  m = cleaned.match(/^([a-z0-9]+)\s+(.+?)\s+cards?\s+from\s+your\s+graveyard$/i);
  if (!m) return null;

  const count = parseSmallNumberWord(String(m[1] || ''));
  if (count === null || count <= 0) return null;

  const typeText = String(m[2] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { count, cardType: parsed };
}

export function parseMoveZoneCountFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly count: number; readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (lower.startsWith('all ')) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s graveyard\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  let m = cleaned.match(/^([a-z0-9]+)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (m) {
    const count = parseSmallNumberWord(String(m[1] || ''));
    if (count === null || count <= 0) return null;
    return { count, cardType: 'any' };
  }

  m = cleaned.match(/^([a-z0-9]+)\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (!m) return null;

  const count = parseSmallNumberWord(String(m[1] || ''));
  if (count === null || count <= 0) return null;

  const typeText = String(m[2] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { count, cardType: parsed };
}

export function parseMoveZoneSingleTargetFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!/^(?:up to one\s+)?(?:other\s+)?target\s+/i.test(lower)) return null;
  if (!/\bfrom your graveyard\b/i.test(lower)) return null;

  if (/^(?:up to one\s+)?(?:other\s+)?target\s+cards?\s+from\s+your\s+graveyard$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^(?:up to one\s+)?(?:other\s+)?target\s+(.+?)\s+from\s+your\s+graveyard$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseMoveZoneSingleTargetCriteria(typeText);
  if (!parsed) return null;
  return parsed;
}

export function parseMoveZoneSingleTargetFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!/^(?:up to one\s+)?(?:other\s+)?target\s+/i.test(lower)) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s graveyard\b/i.test(lower)) return null;

  if (/^(?:up to one\s+)?(?:other\s+)?target\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^(?:up to one\s+)?(?:other\s+)?target\s+(.+?)\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseMoveZoneSingleTargetCriteria(typeText);
  if (!parsed) return null;
  return parsed;
}

export function parseMoveZoneSingleTargetFromAGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!/^(?:up to one\s+)?(?:other\s+)?target\s+/i.test(lower)) return null;
  if (!/\bfrom a graveyard\b/i.test(lower)) return null;

  if (/^(?:up to one\s+)?(?:other\s+)?target\s+cards?\s+from\s+a\s+graveyard$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^(?:up to one\s+)?(?:other\s+)?target\s+(.+?)\s+from\s+a\s+graveyard$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseMoveZoneSingleTargetCriteria(typeText);
  if (!parsed) return null;
  return parsed;
}

type ExactGraveyardSelection =
  | { readonly kind: 'missing_player' }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number }
  | {
      readonly kind: 'deterministic';
      readonly kept: readonly any[];
      readonly moved: readonly any[];
    };

function selectExactMatchingFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  count: number,
  cardType: SimpleCardType
): ExactGraveyardSelection {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'missing_player' };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length < count) return { kind: 'impossible', available: moved.length };
  if (moved.length > count) return { kind: 'player_choice_required', available: moved.length };
  return { kind: 'deterministic', kept, moved };
}

export function exileExactMatchingFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  count: number,
  cardType: SimpleCardType
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectExactMatchingFromGraveyard(state, playerId, count, cardType);
  if (selection.kind === 'missing_player') return { kind: 'applied', state, log: [] };
  if (selection.kind === 'impossible' || selection.kind === 'player_choice_required') return selection;

  const player = state.players.find(p => p.id === playerId) as any;
  const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: [...selection.kept], exile: [...exile, ...selection.moved] } as any) : p
  );
  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${selection.moved.length} card(s) from graveyard`],
  };
}

export function returnExactMatchingFromGraveyardToHand(
  state: GameState,
  playerId: PlayerID,
  count: number,
  cardType: SimpleCardType
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectExactMatchingFromGraveyard(state, playerId, count, cardType);
  if (selection.kind === 'missing_player') return { kind: 'applied', state, log: [] };
  if (selection.kind === 'impossible' || selection.kind === 'player_choice_required') return selection;

  const player = state.players.find(p => p.id === playerId) as any;
  const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: [...selection.kept], hand: [...hand, ...selection.moved] } as any) : p
  );
  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} returns ${selection.moved.length} card(s) from graveyard to hand`],
  };
}

export function putExactMatchingFromGraveyardOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  count: number,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  withCounters?: Record<string, number>
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectExactMatchingFromGraveyard(state, sourcePlayerId, count, cardType);
  if (selection.kind === 'missing_player') return { kind: 'applied', state, log: [] };
  if (selection.kind === 'impossible' || selection.kind === 'player_choice_required') return selection;

  const newPermanents = createBattlefieldPermanentsFromCards(
    [...selection.moved],
    sourcePlayerId,
    controllerId,
    entersTapped,
    withCounters,
    'gy'
  );
  const updatedPlayers = state.players.map(p =>
    p.id === sourcePlayerId ? ({ ...(p as any), graveyard: [...selection.kept] } as any) : p
  );
  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any, battlefield: [...(state.battlefield || []), ...newPermanents] } as any,
    log: [`${controllerId} puts ${selection.moved.length} card(s) from ${sourcePlayerId}'s graveyard onto the battlefield`],
  };
}

export function moveTargetedCardFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  targetCardId: string,
  criteria: MoveZoneSingleTargetCriteria,
  destination: 'hand' | 'exile' | 'battlefield' | 'library_top' | 'library_bottom',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  withCounters?: Record<string, number>
): { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] } | { readonly kind: 'impossible' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return { kind: 'impossible' };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const index = graveyard.findIndex(card => String((card as any)?.id || '').trim() === wantedId);
  if (index < 0) return { kind: 'impossible' };

  const card = graveyard[index];
  if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria)) return { kind: 'impossible' };

  const kept = graveyard.filter((_: any, i: number) => i !== index);
  if (destination === 'hand') {
    const hand = Array.isArray(player.hand) ? [...player.hand] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), graveyard: kept, hand: [...hand, card] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} returns 1 card from graveyard to hand`],
    };
  }

  if (destination === 'exile') {
    const exile = Array.isArray(player.exile) ? [...player.exile] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), graveyard: kept, exile: [...exile, card] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} exiles 1 card from graveyard`],
    };
  }

  if (destination === 'library_top' || destination === 'library_bottom') {
    const library = Array.isArray(player.library) ? [...player.library] : [];
    const nextLibrary = destination === 'library_top' ? [card, ...library] : [...library, card];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), graveyard: kept, library: nextLibrary } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} puts 1 card from graveyard on the ${destination === 'library_top' ? 'top' : 'bottom'} of their library`],
    };
  }

  const controllerId = battlefieldControllerId || playerId;
  const newPermanent = createBattlefieldPermanentsFromCards([card], playerId, controllerId, entersTapped, withCounters, 'gy');
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: kept } as any) : p
  );
  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any, battlefield: [...(state.battlefield || []), ...newPermanent] } as any,
    log: [`${controllerId} puts 1 card from ${playerId}'s graveyard onto the battlefield`],
  };
}

export function moveTargetedCardFromAnyGraveyard(
  state: GameState,
  targetCardId: string,
  criteria: MoveZoneSingleTargetCriteria,
  destination: 'hand' | 'exile' | 'battlefield' | 'library_top' | 'library_bottom',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  withCounters?: Record<string, number>
): { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] } | { readonly kind: 'impossible' } {
  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return { kind: 'impossible' };

  for (const player of (state.players || []) as any[]) {
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    if (graveyard.some((card: any) => String(card?.id || '').trim() === wantedId)) {
      return moveTargetedCardFromGraveyard(
        state,
        player.id as PlayerID,
        wantedId,
        criteria,
        destination,
        battlefieldControllerId,
        entersTapped,
        withCounters
      );
    }
  }

  return { kind: 'impossible' };
}

export function parseMoveZoneSingleTargetFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('target ')) return null;
  if (!/\bfrom your hand\b/i.test(lower)) return null;

  if (/^target\s+cards?\s+from\s+your\s+hand$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^target\s+(.+?)\s+cards?\s+from\s+your\s+hand$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneSingleTargetFromTargetPlayersHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('target ')) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s hand\b/i.test(lower)) return null;

  if (/^target\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+hand$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^target\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+hand$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneSingleTargetFromYourExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('target ')) return null;
  if (!/\bfrom your exile\b/i.test(lower)) return null;

  if (/^target\s+cards?\s+from\s+your\s+exile$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^target\s+(.+?)\s+cards?\s+from\s+your\s+exile$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneSingleTargetFromTargetPlayersExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('target ')) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s exile\b/i.test(lower)) return null;

  if (/^target\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+exile$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^target\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+exile$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function moveTargetedCardFromHand(
  state: GameState,
  playerId: PlayerID,
  targetCardId: string,
  cardType: SimpleCardType,
  destination: 'graveyard' | 'exile' | 'battlefield',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  withCounters?: Record<string, number>
): { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] } | { readonly kind: 'impossible' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return { kind: 'impossible' };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const index = hand.findIndex(card => String((card as any)?.id || '').trim() === wantedId);
  if (index < 0) return { kind: 'impossible' };

  const card = hand[index];
  if (!cardMatchesType(card, cardType)) return { kind: 'impossible' };

  const kept = hand.filter((_: any, i: number) => i !== index);
  if (destination === 'graveyard') {
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), hand: kept, graveyard: [...graveyard, card] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} puts 1 card from hand to graveyard`],
    };
  }

  if (destination === 'exile') {
    const exile = Array.isArray(player.exile) ? [...player.exile] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), hand: kept, exile: [...exile, card] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} exiles 1 card from hand`],
    };
  }

  const controllerId = battlefieldControllerId || playerId;
  const newPermanent = createBattlefieldPermanentsFromCards([card], playerId, controllerId, entersTapped, withCounters, 'hand');
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), hand: kept } as any) : p
  );
  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any, battlefield: [...(state.battlefield || []), ...newPermanent] } as any,
    log: [`${controllerId} puts 1 card from ${playerId}'s hand onto the battlefield`],
  };
}

export function moveTargetedCardFromExile(
  state: GameState,
  playerId: PlayerID,
  targetCardId: string,
  cardType: SimpleCardType,
  destination: 'hand' | 'graveyard' | 'battlefield',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  withCounters?: Record<string, number>
): { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] } | { readonly kind: 'impossible' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return { kind: 'impossible' };

  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const index = exile.findIndex(card => String((card as any)?.id || '').trim() === wantedId);
  if (index < 0) return { kind: 'impossible' };

  const card = exile[index];
  if (!cardMatchesType(card, cardType)) return { kind: 'impossible' };

  const kept = exile.filter((_: any, i: number) => i !== index);
  if (destination === 'hand') {
    const hand = Array.isArray(player.hand) ? [...player.hand] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), exile: kept, hand: [...hand, card] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} returns 1 card from exile to hand`],
    };
  }

  if (destination === 'graveyard') {
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), exile: kept, graveyard: [...graveyard, card] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} puts 1 card from exile to graveyard`],
    };
  }

  const controllerId = battlefieldControllerId || playerId;
  const newPermanent = createBattlefieldPermanentsFromCards([card], playerId, controllerId, entersTapped, withCounters, 'exile');
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), exile: kept } as any) : p
  );
  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any, battlefield: [...(state.battlefield || []), ...newPermanent] } as any,
    log: [`${controllerId} puts 1 card from ${playerId}'s exile onto the battlefield`],
  };
}

export function parseMoveZoneAllFromYourHand(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (!/\bfrom your hand\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+your\s+hand$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+your\s+hand$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;

  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromYourExile(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (!/\bfrom your exile\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+your\s+exile$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+your\s+exile$/i);
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromTargetPlayersHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s hand\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+hand$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+hand$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromTargetPlayersExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s exile\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+exile$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+exile$/i);
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachPlayersGraveyard(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachPlayersGy =
    /\bfrom each player's graveyard\b/i.test(lower) || /\bfrom each players' graveyard\b/i.test(lower);
  const fromAllGys = /\bfrom all graveyards\b/i.test(lower);
  if (!fromEachPlayersGy && !fromAllGys) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+player's\s+graveyard|each\s+players'\s+graveyard|all\s+graveyards)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(
    /^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+player's\s+graveyard|each\s+players'\s+graveyard|all\s+graveyards)$/i
  );
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachPlayersHand(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  if (!/\bfrom each player's hand\b/i.test(lower) && !/\bfrom each players' hand\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+player's\s+hand|each\s+players'\s+hand)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+player's\s+hand|each\s+players'\s+hand)$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachPlayersExile(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachPlayersExile = /\bfrom each player's exile\b/i.test(lower) || /\bfrom each players' exile\b/i.test(lower);
  const fromAllExiles = /\bfrom all exiles\b/i.test(lower);
  if (!fromEachPlayersExile && !fromAllExiles) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+player's\s+exile|each\s+players'\s+exile|all\s+exiles)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(
    /^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+player's\s+exile|each\s+players'\s+exile|all\s+exiles)$/i
  );
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachOpponentsGraveyard(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachOppGy =
    /\bfrom each opponent's graveyard\b/i.test(lower) || /\bfrom each opponents' graveyard\b/i.test(lower);
  if (!fromEachOppGy) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+opponent's\s+graveyard|each\s+opponents'\s+graveyard)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+opponent's\s+graveyard|each\s+opponents'\s+graveyard)$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachOpponentsHand(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachOppHand = /\bfrom each opponent's hand\b/i.test(lower) || /\bfrom each opponents' hand\b/i.test(lower);
  if (!fromEachOppHand) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+opponent's\s+hand|each\s+opponents'\s+hand)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+opponent's\s+hand|each\s+opponents'\s+hand)$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachOpponentsExile(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachOppExile = /\bfrom each opponent's exile\b/i.test(lower) || /\bfrom each opponents' exile\b/i.test(lower);
  if (!fromEachOppExile) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+opponent's\s+exile|each\s+opponents'\s+exile)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+opponent's\s+exile|each\s+opponents'\s+exile)$/i);
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

function createBattlefieldPermanentsFromCards(
  moved: readonly any[],
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  entersTapped: boolean | undefined,
  withCounters: Record<string, number> | undefined,
  sourcePrefix: string
): BattlefieldPermanent[] {
  return moved.map((card: any, idx: number) => {
    const cardIdHint = String(card?.id || '').trim();
    const base = cardIdHint ? cardIdHint : `${sourcePrefix}-${idx}`;
    const sourceZone =
      sourcePrefix === 'gy' ? 'graveyard' : sourcePrefix === 'ex' ? 'exile' : sourcePrefix === 'hand' ? 'hand' : sourcePrefix;
    const counters = mergeRetainedCountersForBattlefieldEntry(card, sourceZone, withCounters);
    const battlefieldCard = { ...(card || {}), zone: 'battlefield' } as any;
    if ('counters' in battlefieldCard) delete battlefieldCard.counters;
    return {
      id: `perm-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      controller: controllerId,
      owner: sourcePlayerId,
      tapped: Boolean(entersTapped),
      summoningSickness: true,
      counters: counters || {},
      attachments: [],
      modifiers: [],
      card: battlefieldCard,
    } as any;
  });
}

export function moveAllMatchingFromExile(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  destination: 'hand' | 'graveyard'
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];

  const kept: any[] = [];
  const moved: any[] = [];
  for (const card of exile) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }
  if (moved.length === 0) return { state, log: [] };

  const nextState = clearPlayableFromExileForCards(state, playerId, moved);
  const movedClean = moved.map(stripImpulsePermissionMarkers);

  const nextPlayer: any = { ...(player as any), exile: kept };
  if (destination === 'hand') nextPlayer.hand = [...hand, ...movedClean];
  else nextPlayer.graveyard = [...graveyard, ...movedClean];

  const updatedPlayers = nextState.players.map(p => (p.id === playerId ? nextPlayer : p));
  return {
    state: { ...nextState, players: updatedPlayers as any } as any,
    log: [`${playerId} moves ${moved.length} card(s) from exile to ${destination}`],
  };
}

export function putAllMatchingFromExileOntoBattlefield(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[] } {
  return putAllMatchingFromExileOntoBattlefieldWithController(state, playerId, playerId, cardType, entersTapped, withCounters);
}

export function putAllMatchingFromExileOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === sourcePlayerId) as any;
  if (!player) return { state, log: [] };

  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of exile) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const nextState = clearPlayableFromExileForCards(state, sourcePlayerId, moved);
  const movedClean = moved.map(stripImpulsePermissionMarkers);
  const newPermanents = createBattlefieldPermanentsFromCards(movedClean, sourcePlayerId, controllerId, entersTapped, withCounters, 'ex');

  const updatedPlayers = nextState.players.map(p => (p.id === sourcePlayerId ? ({ ...(p as any), exile: kept } as any) : p));
  return {
    state: { ...nextState, players: updatedPlayers as any, battlefield: [...(nextState.battlefield || []), ...newPermanents] } as any,
    log: [`${controllerId} puts ${moved.length} card(s) from ${sourcePlayerId}'s exile onto the battlefield`],
  };
}

export function returnAllMatchingFromGraveyardToHand(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
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

export function exileAllMatchingFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: kept, exile: [...exile, ...moved] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${moved.length} card(s) from graveyard`],
  };
}

export function putAllMatchingFromGraveyardOntoBattlefield(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[] } {
  return putAllMatchingFromGraveyardOntoBattlefieldWithController(state, playerId, playerId, cardType, entersTapped, withCounters);
}

export function putAllMatchingFromGraveyardOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === sourcePlayerId) as any;
  if (!player) return { state, log: [] };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const newPermanents = createBattlefieldPermanentsFromCards(moved, sourcePlayerId, controllerId, entersTapped, withCounters, 'gy');
  const updatedPlayers = state.players.map(p => (p.id === sourcePlayerId ? ({ ...(p as any), graveyard: kept } as any) : p));
  return {
    state: { ...state, players: updatedPlayers as any, battlefield: [...(state.battlefield || []), ...newPermanents] } as any,
    log: [`${controllerId} puts ${moved.length} card(s) from ${sourcePlayerId}'s graveyard onto the battlefield`],
  };
}

export function moveAllMatchingFromHand(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  destination: 'graveyard' | 'exile'
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of hand) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const nextPlayer: any = { ...(player as any), hand: kept };
  if (destination === 'graveyard') nextPlayer.graveyard = [...graveyard, ...moved];
  else nextPlayer.exile = [...exile, ...moved];

  const updatedPlayers = state.players.map(p => (p.id === playerId ? nextPlayer : p));
  const verb = destination === 'graveyard' ? 'puts' : 'exiles';
  const where = destination === 'graveyard' ? 'graveyard' : 'exile';
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} ${verb} ${moved.length} card(s) from hand to ${where}`],
  };
}

export function putAllMatchingFromHandOntoBattlefield(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[] } {
  return putAllMatchingFromHandOntoBattlefieldWithController(state, playerId, playerId, cardType, entersTapped, withCounters);
}

export function putAllMatchingFromHandOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === sourcePlayerId) as any;
  if (!player) return { state, log: [] };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of hand) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const newPermanents = createBattlefieldPermanentsFromCards(moved, sourcePlayerId, controllerId, entersTapped, withCounters, 'hand');
  const updatedPlayers = state.players.map(p => (p.id === sourcePlayerId ? ({ ...(p as any), hand: kept } as any) : p));
  return {
    state: { ...state, players: updatedPlayers as any, battlefield: [...(state.battlefield || []), ...newPermanents] } as any,
    log: [`${controllerId} puts ${moved.length} card(s) from ${sourcePlayerId}'s hand onto the battlefield`],
  };
}
