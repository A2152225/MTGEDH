import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import { clearPlayableFromExileForCards, stripPlayableFromExileTags } from './playableFromExile';

export type SimpleCardType = 'any' | 'creature' | 'artifact' | 'enchantment' | 'land' | 'instant' | 'sorcery' | 'planeswalker';

const stripImpulsePermissionMarkers = stripPlayableFromExileTags;

export function parseSimpleCardTypeFromText(text: string): SimpleCardType | null {
  const lower = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim();

  if (!lower) return null;
  if (/\bcreature(s)?\b/i.test(lower)) return 'creature';
  if (/\bartifact(s)?\b/i.test(lower)) return 'artifact';
  if (/\benchantment(s)?\b/i.test(lower)) return 'enchantment';
  if (/\bland(s)?\b/i.test(lower)) return 'land';
  if (/\binstant(s)?\b/i.test(lower)) return 'instant';
  if (/\bsorcery|sorceries\b/i.test(lower)) return 'sorcery';
  if (/\bplaneswalker(s)?\b/i.test(lower)) return 'planeswalker';
  return null;
}

export function cardMatchesType(card: any, type: SimpleCardType): boolean {
  if (type === 'any') return true;
  const typeLine = String(card?.type_line || '').toLowerCase();
  return typeLine.includes(type);
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
  sourcePrefix: string
): BattlefieldPermanent[] {
  return moved.map((card: any, idx: number) => {
    const cardIdHint = String(card?.id || '').trim();
    const base = cardIdHint ? cardIdHint : `${sourcePrefix}-${idx}`;
    return {
      id: `perm-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      controller: controllerId,
      owner: sourcePlayerId,
      tapped: Boolean(entersTapped),
      summoningSickness: true,
      counters: {},
      attachments: [],
      modifiers: [],
      card,
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
  entersTapped?: boolean
): { state: GameState; log: string[] } {
  return putAllMatchingFromExileOntoBattlefieldWithController(state, playerId, playerId, cardType, entersTapped);
}

export function putAllMatchingFromExileOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean
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
  const newPermanents = createBattlefieldPermanentsFromCards(movedClean, sourcePlayerId, controllerId, entersTapped, 'ex');

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
  entersTapped?: boolean
): { state: GameState; log: string[] } {
  return putAllMatchingFromGraveyardOntoBattlefieldWithController(state, playerId, playerId, cardType, entersTapped);
}

export function putAllMatchingFromGraveyardOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean
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

  const newPermanents = createBattlefieldPermanentsFromCards(moved, sourcePlayerId, controllerId, entersTapped, 'gy');
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
  entersTapped?: boolean
): { state: GameState; log: string[] } {
  return putAllMatchingFromHandOntoBattlefieldWithController(state, playerId, playerId, cardType, entersTapped);
}

export function putAllMatchingFromHandOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean
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

  const newPermanents = createBattlefieldPermanentsFromCards(moved, sourcePlayerId, controllerId, entersTapped, 'hand');
  const updatedPlayers = state.players.map(p => (p.id === sourcePlayerId ? ({ ...(p as any), hand: kept } as any) : p));
  return {
    state: { ...state, players: updatedPlayers as any, battlefield: [...(state.battlefield || []), ...newPermanents] } as any,
    log: [`${controllerId} puts ${moved.length} card(s) from ${sourcePlayerId}'s hand onto the battlefield`],
  };
}
