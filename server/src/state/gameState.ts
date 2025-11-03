import { GameFormat, GamePhase } from '../../../shared/src';
import type {
  GameID,
  PlayerID,
  PlayerRef,
  GameState,
  ClientGameView,
  CommanderInfo,
  PlayerZones,
  CardRef,
  KnownCardRef,
  HiddenCardRef,
  SpectatorRef
} from '../../../shared/src';

function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export type GameEvent =
  | { type: 'join'; playerId: PlayerID; name: string; seat?: number; seatToken?: string }
  | { type: 'leave'; playerId: PlayerID }
  | { type: 'passPriority'; by: PlayerID }
  | { type: 'restart'; preservePlayers?: boolean }
  | { type: 'removePlayer'; playerId: PlayerID }
  | { type: 'skipPlayer'; playerId: PlayerID }
  | { type: 'unskipPlayer'; playerId: PlayerID }
  | { type: 'spectatorGrant'; owner: PlayerID; spectator: PlayerID }
  | { type: 'spectatorRevoke'; owner: PlayerID; spectator: PlayerID }
  // Deck ops (include richer fields for search)
  | { type: 'deckImportResolved'; playerId: PlayerID; cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text'>> }
  | { type: 'shuffleLibrary'; playerId: PlayerID }
  | { type: 'drawCards'; playerId: PlayerID; count: number }
  | { type: 'selectFromLibrary'; playerId: PlayerID; cardIds: string[]; moveTo: 'hand' | 'graveyard' | 'exile' | 'battlefield'; reveal?: boolean }
  // NEW: persist moving hand back into library (shuffle is a separate event)
  | { type: 'handIntoLibrary'; playerId: PlayerID };

export interface Participant {
  readonly socketId: string;
  readonly playerId: PlayerID;
  readonly spectator: boolean;
}

export interface InMemoryGame {
  readonly state: GameState;
  seq: number;
  join: (
    socketId: string,
    playerName: string,
    spectator: boolean,
    fixedPlayerId?: PlayerID,
    seatTokenFromClient?: string
  ) => { playerId: PlayerID; added: boolean; seatToken?: string; seat?: number };
  leave: (playerId?: PlayerID) => boolean;
  disconnect: (socketId: string) => void;
  participants: () => Participant[];
  passPriority: (playerId: PlayerID) => boolean;

  // Deck/state ops
  importDeckResolved: (playerId: PlayerID, cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text'>>) => void;
  shuffleLibrary: (playerId: PlayerID) => void;
  drawCards: (playerId: PlayerID, count: number) => string[];
  selectFromLibrary: (playerId: PlayerID, cardIds: string[], moveTo: 'hand' | 'graveyard' | 'exile' | 'battlefield') => string[];
  // NEW
  moveHandToLibrary: (playerId: PlayerID) => number;

  // Search (owner only)
  searchLibrary: (playerId: PlayerID, query: string, limit: number) => Array<Pick<KnownCardRef, 'id' | 'name'>>;

  // Visibility and views
  grantSpectatorAccess: (owner: PlayerID, spectator: PlayerID) => void;
  revokeSpectatorAccess: (owner: PlayerID, spectator: PlayerID) => void;
  viewFor: (viewer: PlayerID, spectator: boolean) => ClientGameView;

  // Replay
  applyEvent: (e: GameEvent) => void;
  replay: (events: GameEvent[]) => void;

  // Admin
  reset: (preservePlayers: boolean) => void;
  skip: (playerId: PlayerID) => void;
  unskip: (playerId: PlayerID) => void;
  remove: (playerId: PlayerID) => void;
}

export function createInitialGameState(gameId: GameID): InMemoryGame {
  const players: PlayerRef[] = [];
  const commandZone: Record<PlayerID, CommanderInfo> = {} as Record<PlayerID, CommanderInfo>;
  const zones: Record<PlayerID, PlayerZones> = {};
  const life: Record<PlayerID, number> = {};

  const state: GameState = {
    id: gameId,
    format: GameFormat.COMMANDER,
    players: players as any,
    startingLife: 40,
    life,
    turnPlayer: '' as PlayerID,
    priority: '' as PlayerID,
    stack: [],
    battlefield: [],
    commandZone,
    phase: GamePhase.BEGINNING,
    active: true,
    zones,
    status: undefined,
    turnOrder: [],
    startedAt: undefined,
    turn: undefined,
    activePlayerIndex: undefined
  };

  const joinedBySocket = new Map<string, Participant>();
  const participantsList: Participant[] = [];
  const tokenToPlayer = new Map<string, PlayerID>();
  const playerToToken = new Map<PlayerID, string>();
  const grants = new Map<PlayerID, Set<PlayerID>>();
  const inactive = new Set<PlayerID>();
  const spectatorNames = new Map<PlayerID, string>();

  const libraries = new Map<PlayerID, KnownCardRef[]>(); // keep rich refs to enable searching text/type

  let seq = 0;

  function participants(): Participant[] {
    return participantsList.slice();
  }

  function addPlayerIfMissing(id: PlayerID, name: string, desiredSeat?: number): number {
    const existing = players.find(p => p.id === id);
    if (existing) return existing.seat;
    const seat = (typeof desiredSeat === 'number' ? desiredSeat : players.length) as PlayerRef['seat'];
    const ref: PlayerRef = { id, name, seat };
    (players as PlayerRef[]).push(ref);
    life[id] = state.startingLife;
    zones[id] = zones[id] ?? { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
    commandZone[id] = { commanderIds: [], tax: 0 };
    if (!state.turnPlayer) state.turnPlayer = id;
    if (!state.priority) state.priority = id;
    seq++;
    return seat;
  }

  function join(
    socketId: string,
    playerName: string,
    spectator: boolean,
    fixedPlayerId?: PlayerID,
    seatTokenFromClient?: string
  ) {
    const existing = joinedBySocket.get(socketId);
    if (existing) {
      return { playerId: existing.playerId, added: false, seatToken: playerToToken.get(existing.playerId) };
    }
    const normalizedName = playerName.trim();
    let playerId = fixedPlayerId ?? ('' as PlayerID);
    let added = false;
    let seat: number | undefined;
    let seatToken = seatTokenFromClient;

    if (!spectator) {
      if (seatToken && tokenToPlayer.has(seatToken)) {
        const claimedId = tokenToPlayer.get(seatToken)!;
        const p = players.find(x => x.id === claimedId);
        if (p && p.name.trim().toLowerCase() === normalizedName.toLowerCase()) {
          playerId = claimedId;
          seat = addPlayerIfMissing(playerId, normalizedName);
          if (!playerToToken.get(playerId)) playerToToken.set(playerId, seatToken);
        } else {
          seatToken = undefined;
        }
      }
      if (!playerId) {
        const byName = players.find(p => p.name.trim().toLowerCase() === normalizedName.toLowerCase());
        if (byName) playerId = byName.id as PlayerID;
      }
      if (playerId) {
        const existingToken = playerToToken.get(playerId);
        if (existingToken) seatToken = existingToken;
        else {
          seatToken = seatToken || uid('t');
          tokenToPlayer.set(seatToken, playerId);
          playerToToken.set(playerId, seatToken);
        }
        zones[playerId] = zones[playerId] ?? { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
      }
      if (!playerId) {
        playerId = uid('p') as PlayerID;
        seat = addPlayerIfMissing(playerId, normalizedName);
        added = true;
        seatToken = uid('t');
        tokenToPlayer.set(seatToken, playerId);
        playerToToken.set(playerId, seatToken);
      }
    } else {
      if (!playerId) playerId = uid('s') as PlayerID;
      spectatorNames.set(playerId, normalizedName || 'Spectator');
    }

    const participant: Participant = { socketId, playerId, spectator };
    joinedBySocket.set(socketId, participant);
    participantsList.push(participant);

    return { playerId, added, seatToken, seat };
  }

  function leave(playerId?: PlayerID): boolean {
    if (!playerId) return false;
    const idx = players.findIndex(p => p.id === playerId);
    if (idx >= 0) {
      (players as PlayerRef[]).splice(idx, 1);
      delete life[playerId];
      delete (commandZone as Record<string, unknown>)[playerId];
      delete zones[playerId];
      libraries.delete(playerId);
      inactive.delete(playerId);
      if (state.turnPlayer === playerId) state.turnPlayer = (players[0]?.id ?? '') as PlayerID;
      if (state.priority === playerId) state.priority = (players[0]?.id ?? '') as PlayerID;
      const token = playerToToken.get(playerId);
      if (token) {
        playerToToken.delete(playerId);
        tokenToPlayer.delete(token);
      }
      grants.delete(playerId);
      seq++;
      return true;
    }
    for (let i = participantsList.length - 1; i >= 0; i--) {
      if (participantsList[i].playerId === playerId) participantsList.splice(i, 1);
    }
    spectatorNames.delete(playerId);
    return false;
  }

  function disconnect(socketId: string) {
    const p = joinedBySocket.get(socketId);
    if (!p) return;
    joinedBySocket.delete(socketId);
    for (let i = participantsList.length - 1; i >= 0; i--) {
      if (participantsList[i].socketId === socketId) participantsList.splice(i, 1);
    }
  }

  function passPriority(playerId: PlayerID): boolean {
    if (state.priority !== playerId) return false;
    const order = players.map(p => p.id).filter(id => !inactive.has(id));
    if (order.length === 0) return false;
    const idx = order.indexOf(playerId);
    const next = order[(idx + 1) % order.length];
    state.priority = next;
    seq++;
    return true;
  }

  // Deck/state ops
  function importDeckResolved(playerId: PlayerID, cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text'>>) {
    libraries.set(
      playerId,
      cards.map(c => ({ id: c.id, name: c.name, type_line: c.type_line, oracle_text: c.oracle_text, zone: 'library' as const }))
    );
    const libLen = libraries.get(playerId)?.length ?? 0;
    zones[playerId] = { hand: [], handCount: 0, libraryCount: libLen, graveyard: [], graveyardCount: 0 };
    seq++;
  }

  function shuffleLibrary(playerId: PlayerID) {
    const lib = libraries.get(playerId);
    if (!lib) return;
    for (let i = lib.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lib[i], lib[j]] = [lib[j], lib[i]];
    }
    zones[playerId]!.libraryCount = lib.length;
    seq++;
  }

  function drawCards(playerId: PlayerID, count: number) {
    const lib = libraries.get(playerId) || [];
    const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 });
    const drawnIds: string[] = [];
    for (let i = 0; i < count && lib.length > 0; i++) {
      const card = lib.shift()!;
      z.hand.push({ ...card, zone: 'hand' });
      drawnIds.push(card.id);
    }
    z.handCount = z.hand.length;
    z.libraryCount = lib.length;
    seq++;
    return drawnIds;
  }

  function selectFromLibrary(playerId: PlayerID, cardIds: string[], moveTo: 'hand' | 'graveyard' | 'exile' | 'battlefield') {
    const lib = libraries.get(playerId) || [];
    const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 });
    const movedNames: string[] = [];
    for (const id of cardIds) {
      const idx = lib.findIndex(c => c.id === id);
      if (idx >= 0) {
        const [card] = lib.splice(idx, 1);
        movedNames.push(card.name);
        if (moveTo === 'hand') {
          z.hand.push({ ...card, zone: 'hand' });
          z.handCount = z.hand.length;
        } else if (moveTo === 'graveyard') {
          z.graveyard.push({ ...card, zone: 'graveyard', faceDown: false });
          z.graveyardCount = z.graveyard.length;
        }
      }
    }
    z.libraryCount = lib.length;
    seq++;
    return movedNames;
  }

  // NEW: move entire hand back into library, update counts; return number moved
  function moveHandToLibrary(playerId: PlayerID) {
    const lib = libraries.get(playerId) || [];
    const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: lib.length, graveyard: [], graveyardCount: 0 });
    const moved = z.hand.length;
    if (moved === 0) return 0;
    for (const c of z.hand as Array<Partial<KnownCardRef> & { id: string }>) {
      lib.push({
        id: c.id,
        name: (c as any).name ?? 'Card',
        type_line: (c as any).type_line,
        oracle_text: (c as any).oracle_text,
        zone: 'library'
      } as KnownCardRef);
    }
    z.hand = [];
    z.handCount = 0;
    z.libraryCount = lib.length;
    libraries.set(playerId, lib);
    seq++;
    return moved;
  }

  // Search (owner only)
  function searchLibrary(playerId: PlayerID, query: string, limit: number) {
    const lib = libraries.get(playerId) || [];
    const q = query.trim().toLowerCase();
    if (!q) return lib.slice(0, limit).map(c => ({ id: c.id, name: c.name }));
    const matches = lib.filter(c => {
      const t = (c.type_line || '').toLowerCase();
      const o = (c.oracle_text || '').toLowerCase();
      return c.name.toLowerCase().includes(q) || t.includes(q) || o.includes(q);
    });
    return matches.slice(0, limit).map(c => ({ id: c.id, name: c.name }));
  }

  function grantSpectatorAccess(owner: PlayerID, spectator: PlayerID) {
    let set = grants.get(owner);
    if (!set) {
      set = new Set<PlayerID>();
      grants.set(owner, set);
    }
    set.add(spectator);
    seq++;
  }

  function revokeSpectatorAccess(owner: PlayerID, spectator: PlayerID) {
    const set = grants.get(owner);
    if (set) {
      set.delete(spectator);
      seq++;
    }
  }

  function canSeeOwnersHidden(viewer: PlayerID, owner: PlayerID): boolean {
    if (viewer === owner) return true;
    const set = grants.get(owner);
    return !!set && set.has(viewer);
  }

  function maskCardForViewer(card: CardRef, viewer: PlayerID, owner: PlayerID): CardRef {
    const isFaceDown = (card as HiddenCardRef).faceDown === true || (card as KnownCardRef).faceDown === true;
    if (isFaceDown && !canSeeOwnersHidden(viewer, owner)) {
      return { id: card.id, faceDown: true, zone: card.zone, visibility: 'owner' } as HiddenCardRef;
    }
    return card;
  }

  function viewFor(viewer: PlayerID, _spectator: boolean): ClientGameView {
    const filteredBattlefield = state.battlefield.map(perm => ({
      ...perm,
      card: maskCardForViewer(perm.card, viewer, perm.owner)
    }));

    const filteredZones: Record<PlayerID, PlayerZones> = {};
    for (const p of state.players) {
      const z =
        state.zones?.[p.id] ??
        { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
      const libCount = libraries.get(p.id)?.length ?? z.libraryCount ?? 0;
      const isSelf = viewer === p.id;
      const canSee = isSelf || canSeeOwnersHidden(viewer, p.id);
      filteredZones[p.id] = {
        hand: isSelf ? z.hand : (canSee ? z.hand : []),
        handCount: z.handCount ?? z.hand.length ?? 0,
        libraryCount: libCount,
        graveyard: z.graveyard,
        graveyardCount: z.graveyardCount ?? z.graveyard.length ?? 0,
        exile: z.exile
      };
    }

    const projectedPlayers: PlayerRef[] = state.players.map(p => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      inactive: inactive.has(p.id)
    }));

    const myGrants = grants.get(viewer) ?? new Set<PlayerID>();
    const spectatorList: SpectatorRef[] = participantsList
      .filter(p => p.spectator)
      .map(p => ({ id: p.playerId, name: spectatorNames.get(p.playerId) || 'Spectator', hasAccessToYou: myGrants.has(p.playerId) }));

    return {
      ...state,
      battlefield: filteredBattlefield,
      stack: state.stack.slice(),
      players: projectedPlayers,
      zones: filteredZones,
      spectators: spectatorList
    };
  }

  function reset(preservePlayers: boolean) {
    state.stack = [];
    state.battlefield = [];
    state.commandZone = {};
    state.phase = GamePhase.BEGINNING;
    inactive.clear();
    if (preservePlayers) {
      for (const p of players) {
        const libLen = libraries.get(p.id)?.length ?? 0;
        state.life[p.id] = state.startingLife;
        state.zones![p.id] = { hand: [], handCount: 0, libraryCount: libLen, graveyard: [], graveyardCount: 0 };
      }
      state.turnPlayer = players[0]?.id ?? ('' as PlayerID);
      state.priority = players[0]?.id ?? ('' as PlayerID);
    } else {
      (players as PlayerRef[]).splice(0, players.length);
      state.life = {};
      state.zones = {};
      libraries.clear();
      state.turnPlayer = '' as PlayerID;
      state.priority = '' as PlayerID;
      tokenToPlayer.clear();
      playerToToken.clear();
      grants.clear();
      spectatorNames.clear();
    }
    seq++;
  }

  function skip(playerId: PlayerID) {
    if (!players.find(p => p.id === playerId)) return;
    inactive.add(playerId);
    seq++;
  }

  function unskip(playerId: PlayerID) {
    if (!players.find(p => p.id === playerId)) return;
    inactive.delete(playerId);
    seq++;
  }

  function applyEvent(e: GameEvent) {
    switch (e.type) {
      case 'join': addPlayerIfMissing(e.playerId, e.name, e.seat); break;
      case 'leave': leave(e.playerId); break;
      case 'passPriority': passPriority(e.by); break;
      case 'restart': reset(Boolean(e.preservePlayers)); break;
      case 'removePlayer': leave(e.playerId); break;
      case 'skipPlayer': skip(e.playerId); break;
      case 'unskipPlayer': unskip(e.playerId); break;
      case 'spectatorGrant': grantSpectatorAccess(e.owner, e.spectator); break;
      case 'spectatorRevoke': revokeSpectatorAccess(e.owner, e.spectator); break;
      case 'deckImportResolved': importDeckResolved(e.playerId, e.cards); break;
      case 'shuffleLibrary': shuffleLibrary(e.playerId); break;
      case 'drawCards': drawCards(e.playerId, e.count); break;
      case 'selectFromLibrary': selectFromLibrary(e.playerId, e.cardIds, e.moveTo); break;
      // NEW
      case 'handIntoLibrary': moveHandToLibrary(e.playerId); break;
    }
  }

  function replay(events: GameEvent[]) {
    for (const e of events) applyEvent(e);
  }

  return {
    state,
    seq,
    join,
    leave,
    disconnect,
    participants,
    passPriority,
    importDeckResolved,
    shuffleLibrary,
    drawCards,
    selectFromLibrary,
    moveHandToLibrary,
    searchLibrary,
    grantSpectatorAccess,
    revokeSpectatorAccess,
    viewFor,
    applyEvent,
    replay,
    reset,
    skip,
    unskip,
    remove: leave
  };
}