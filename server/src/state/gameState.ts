import { GameFormat, GamePhase, GameStep } from '../../../shared/src';
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
  SpectatorRef,
  TargetRef,
} from '../../../shared/src';
import { mulberry32, hashStringToSeed } from '../utils/rng';
import { applyStateBasedActions, evaluateAction, type EngineEffect as DmgEffect } from '../rules-engine';
import { categorizeSpell, resolveSpell, type SpellSpec, type EngineEffect as TargetEffect } from '../rules-engine/targeting';

function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export type GameEvent =
  | { type: 'rngSeed'; seed: number }
  | { type: 'setTurnDirection'; direction: 1 | -1 }
  | { type: 'join'; playerId: PlayerID; name: string; seat?: number; seatToken?: string }
  | { type: 'leave'; playerId: PlayerID }
  | { type: 'passPriority'; by: PlayerID }
  | { type: 'restart'; preservePlayers?: boolean }
  | { type: 'removePlayer'; playerId: PlayerID }
  | { type: 'skipPlayer'; playerId: PlayerID }
  | { type: 'unskipPlayer'; playerId: PlayerID }
  | { type: 'spectatorGrant'; owner: PlayerID; spectator: PlayerID }
  | { type: 'spectatorRevoke'; owner: PlayerID; spectator: PlayerID }
  // Deck ops
  | {
      type: 'deckImportResolved';
      playerId: PlayerID;
      cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>>
    }
  | { type: 'shuffleLibrary'; playerId: PlayerID }
  | { type: 'drawCards'; playerId: PlayerID; count: number }
  | {
      type: 'selectFromLibrary';
      playerId: PlayerID;
      cardIds: string[];
      moveTo: 'hand' | 'graveyard' | 'exile' | 'battlefield';
      reveal?: boolean;
    }
  | { type: 'handIntoLibrary'; playerId: PlayerID }
  // Commander core
  | { type: 'setCommander'; playerId: PlayerID; commanderNames: string[]; commanderIds: string[] }
  | { type: 'castCommander'; playerId: PlayerID; commanderId: string }
  | { type: 'moveCommanderToCZ'; playerId: PlayerID; commanderId: string }
  // Counters/tokens
  | { type: 'updateCounters'; permanentId: string; deltas: Record<string, number> }
  | { type: 'updateCountersBulk'; updates: { permanentId: string; deltas: Record<string, number> }[] }
  | { type: 'createToken'; controller: PlayerID; name: string; count?: number; basePower?: number; baseToughness?: number }
  | { type: 'removePermanent'; permanentId: string }
  // Damage (instant ability/effect)
  | { type: 'dealDamage'; targetPermanentId: string; amount: number; wither?: boolean; infect?: boolean }
  // Targeting resolution (optional direct path)
  | { type: 'resolveSpell'; caster: PlayerID; cardId: string; spec: SpellSpec; chosen: TargetRef[] }
  // Stack + lands + turn
  | {
      type: 'pushStack';
      item: {
        id: string;
        controller: PlayerID;
        card: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>;
        targets?: string[];
      };
    }
  | { type: 'resolveTopOfStack' }
  | { type: 'playLand'; playerId: PlayerID; card: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'> }
  | { type: 'nextTurn' }
  | { type: 'nextStep' };

export interface Participant {
  readonly socketId: string;
  readonly playerId: PlayerID;
  readonly spectator: boolean;
}

export interface InMemoryGame {
  readonly state: GameState;
  seq: number;
  // Session
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

  // Turn / priority
  passPriority: (playerId: PlayerID) => { changed: boolean; resolvedNow: boolean };
  setTurnDirection: (dir: 1 | -1) => void;
  nextTurn: () => void;
  nextStep: () => void;

  // Deck/state ops
  importDeckResolved: (
    playerId: PlayerID,
    cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>>
  ) => void;
  shuffleLibrary: (playerId: PlayerID) => void;
  drawCards: (playerId: PlayerID, count: number) => string[];
  selectFromLibrary: (
    playerId: PlayerID,
    cardIds: string[],
    moveTo: 'hand' | 'graveyard' | 'exile' | 'battlefield'
  ) => string[];
  moveHandToLibrary: (playerId: PlayerID) => number;

  // Search (owner only)
  searchLibrary: (playerId: PlayerID, query: string, limit: number) => Array<Pick<KnownCardRef, 'id' | 'name'>>;

  // Visibility and views
  grantSpectatorAccess: (owner: PlayerID, spectator: PlayerID) => void;
  revokeSpectatorAccess: (owner: PlayerID, spectator: PlayerID) => void;
  viewFor: (viewer: PlayerID, spectator: boolean) => ClientGameView;

  // RNG control
  seedRng: (seed: number) => void;
  hasRngSeed: () => boolean;

  // Commander core
  setCommander: (playerId: PlayerID, commanderNames: string[], commanderIds: string[]) => void;
  castCommander: (playerId: PlayerID, commanderId: string) => void;
  moveCommanderToCZ: (playerId: PlayerID, commanderId: string) => void;

  // Counters/tokens
  updateCounters: (permanentId: string, deltas: Record<string, number>) => void;
  createToken: (controller: PlayerID, name: string, count?: number, basePower?: number, baseToughness?: number) => void;
  removePermanent: (permanentId: string) => void;
  movePermanentToExile: (permanentId: string) => void;

  // Engine integration
  applyEngineEffects: (effects: readonly DmgEffect[]) => void;

  // Stack / lands
  pushStack: (item: {
    id: string;
    controller: PlayerID;
    card: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>;
    targets?: string[];
  }) => void;
  resolveTopOfStack: () => void;
  playLand: (playerId: PlayerID, card: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>) => void;

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
    turnDirection: 1,
    stack: [],
    battlefield: [],
    commandZone,
    phase: GamePhase.BEGINNING,
    step: undefined,
    active: true,
    zones,
    status: undefined,
    turnOrder: [],
    startedAt: undefined,
    turn: 1,
    activePlayerIndex: undefined,
    landsPlayedThisTurn: {}
  };

  const joinedBySocket = new Map<string, Participant>();
  const participantsList: Participant[] = [];
  const tokenToPlayer = new Map<string, PlayerID>();
  const playerToToken = new Map<PlayerID, string>();
  const grants = new Map<PlayerID, Set<PlayerID>>();
  const inactive = new Set<PlayerID>();
  const spectatorNames = new Map<PlayerID, string>();

  const libraries = new Map<PlayerID, KnownCardRef[]>();

  // Seeded RNG
  let rngSeed: number | null = null;
  let rng = mulberry32(hashStringToSeed(gameId));

  let seq = 0;
  let passesInRow = 0; // consecutive passes since last stack change

  function participants(): Participant[] {
    return participantsList.slice();
  }

  function seedRng(seed: number) {
    rngSeed = seed >>> 0;
    rng = mulberry32(rngSeed);
  }
  function hasRngSeed() {
    return rngSeed !== null;
  }

  function addPlayerIfMissing(id: PlayerID, name: string, desiredSeat?: number): number {
    const existing = (state.players as any as PlayerRef[]).find((p) => p.id === id);
    if (existing) return existing.seat;
    const seat = (typeof desiredSeat === 'number' ? desiredSeat : (state.players as any as PlayerRef[]).length) as PlayerRef['seat'];
    const ref: PlayerRef = { id, name, seat };
    (state.players as any as PlayerRef[]).push(ref);
    life[id] = state.startingLife;
    zones[id] = zones[id] ?? { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
    commandZone[id] = commandZone[id] ?? { commanderIds: [], tax: 0, taxById: {} };
    state.landsPlayedThisTurn![id] = state.landsPlayedThisTurn![id] ?? 0;
    if (!state.turnPlayer) state.turnPlayer = id;
    if (!state.priority) state.priority = id;
    seq++;
    return seat;
  }

  // Engine SBA runner
  function runSBA() {
    const res = applyStateBasedActions(state);
    let changed = false;
    for (const upd of res.counterUpdates) {
      const perm = state.battlefield.find((b) => b.id === upd.permanentId);
      if (!perm) continue;
      const before = perm.counters ?? {};
      const after = upd.counters;
      const same =
        Object.keys(before).length === Object.keys(after).length &&
        Object.keys(after).every((k) => (before as any)[k] === (after as any)[k]);
      if (!same) {
        perm.counters = Object.keys(after).length ? { ...after } : undefined;
        changed = true;
      }
    }
    if (res.destroys.length) {
      for (const id of res.destroys) {
        const idx = state.battlefield.findIndex((b) => b.id === id);
        if (idx >= 0) {
          state.battlefield.splice(idx, 1);
          changed = true;
        }
      }
    }
    if (changed) seq++;
  }

  function applyEngineEffects(effects: readonly DmgEffect[]) {
    if (!effects.length) return;
    for (const eff of effects) {
      switch (eff.kind) {
        case 'AddCounters':
          updateCounters(eff.permanentId, { [eff.counter]: eff.amount });
          break;
        case 'DestroyPermanent':
          removePermanent(eff.permanentId);
          break;
      }
    }
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
        const p = (state.players as any as PlayerRef[]).find((x) => x.id === claimedId);
        if (p && p.name.trim().toLowerCase() === normalizedName.toLowerCase()) {
          playerId = claimedId;
          seat = addPlayerIfMissing(playerId, normalizedName);
          if (!playerToToken.get(playerId)) playerToToken.set(playerId, seatToken);
        } else {
          seatToken = undefined;
        }
      }
      if (!playerId) {
        const byName = (state.players as any as PlayerRef[]).find((p) => p.name.trim().toLowerCase() === normalizedName.toLowerCase());
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
        commandZone[playerId] = commandZone[playerId] ?? { commanderIds: [], tax: 0, taxById: {} };
        state.landsPlayedThisTurn![playerId] = state.landsPlayedThisTurn![playerId] ?? 0;
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
    const idx = (state.players as any as PlayerRef[]).findIndex((p) => p.id === playerId);
    if (idx >= 0) {
      (state.players as any as PlayerRef[]).splice(idx, 1);
      delete life[playerId];
      delete (commandZone as Record<string, unknown>)[playerId];
      delete zones[playerId];
      delete state.landsPlayedThisTurn![playerId];
      libraries.delete(playerId);
      inactive.delete(playerId);
      if (state.turnPlayer === playerId) state.turnPlayer = ((state.players as any as PlayerRef[])[0]?.id ?? '') as PlayerID;
      if (state.priority === playerId) state.priority = ((state.players as any as PlayerRef[])[0]?.id ?? '') as PlayerID;
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

  function setTurnDirection(dir: 1 | -1) {
    state.turnDirection = dir;
    seq++;
  }

  function advancePriorityClockwise(from: PlayerID): PlayerID {
    const active = (state.players as any as PlayerRef[]).filter((p) => !inactive.has(p.id)).sort((a, b) => a.seat - b.seat);
    const n = active.length;
    if (n === 0) return from;
    const idx = active.findIndex((p) => p.id === from);
    const step = state.turnDirection === -1 ? -1 : 1;
    const nextIdx = ((idx >= 0 ? idx : 0) + step + n) % n;
    return active[nextIdx].id as PlayerID;
  }

  function passPriority(playerId: PlayerID): { changed: boolean; resolvedNow: boolean } {
    if (state.priority !== playerId) return { changed: false, resolvedNow: false };
    const active = (state.players as any as PlayerRef[]).filter((p) => !inactive.has(p.id)).sort((a, b) => a.seat - b.seat);
    const n = active.length;
    if (n === 0) return { changed: false, resolvedNow: false };
    state.priority = advancePriorityClockwise(playerId);
    seq++;

    let resolvedNow = false;
    if (state.stack.length > 0) {
      passesInRow++;
      if (passesInRow >= n) {
        resolvedNow = true;
        passesInRow = 0;
      }
    } else {
      passesInRow = 0;
    }

    return { changed: true, resolvedNow };
  }

  // Deck/state ops
  function importDeckResolved(
    playerId: PlayerID,
    cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>>
  ) {
    libraries.set(
      playerId,
      cards.map((c) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        image_uris: c.image_uris,
        zone: 'library' as const,
      }))
    );
    const libLen = libraries.get(playerId)?.length ?? 0;
    zones[playerId] = { hand: [], handCount: 0, libraryCount: libLen, graveyard: [], graveyardCount: 0 };
    seq++;
  }

  function shuffleLibrary(playerId: PlayerID) {
    const lib = libraries.get(playerId);
    if (!lib || lib.length <= 1) {
      zones[playerId] && (zones[playerId]!.libraryCount = lib?.length ?? 0);
      return;
    }
    for (let i = lib.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [lib[i], lib[j]] = [lib[j], lib[i]];
    }
    zones[playerId]!.libraryCount = lib.length;
    seq++;
  }

  function drawCards(playerId: PlayerID, count: number) {
    const lib = libraries.get(playerId) || [];
    const z =
      zones[playerId] ||
      (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 });
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

  function selectFromLibrary(
    playerId: PlayerID,
    cardIds: string[],
    moveTo: 'hand' | 'graveyard' | 'exile' | 'battlefield'
  ) {
    const lib = libraries.get(playerId) || [];
    const z =
      zones[playerId] ||
      (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 });
    const movedNames: string[] = [];
    for (const id of cardIds) {
      const idx = lib.findIndex((c) => c.id === id);
      if (idx >= 0) {
        const [card] = lib.splice(idx, 1);
        movedNames.push(card.name);
        if (moveTo === 'hand') {
          z.hand.push({ ...card, zone: 'hand' });
          z.handCount = z.hand.length;
        } else if (moveTo === 'graveyard') {
          z.graveyard.push({ ...card, zone: 'graveyard', faceDown: false });
          z.graveyardCount = z.graveyard.length;
        } else if (moveTo === 'exile') {
          z.exile = z.exile || [];
          z.exile.push({ ...card, zone: 'exile' });
        }
      }
    }
    z.libraryCount = lib.length;
    seq++;
    return movedNames;
  }

  function moveHandToLibrary(playerId: PlayerID) {
    const lib = libraries.get(playerId) || [];
    const z =
      zones[playerId] ||
      (zones[playerId] = { hand: [], handCount: 0, libraryCount: lib.length, graveyard: [], graveyardCount: 0 });
    const moved = z.hand.length;
    if (moved === 0) return 0;
    for (const c of z.hand as Array<Partial<KnownCardRef> & { id: string }>) {
      lib.push({
        id: c.id,
        name: (c as any).name ?? 'Card',
        type_line: (c as any).type_line,
        oracle_text: (c as any).oracle_text,
        zone: 'library',
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
    if (!q) return lib.slice(0, limit).map((c) => ({ id: c.id, name: c.name }));
    const matches = lib.filter((c) => {
      const t = (c.type_line || '').toLowerCase();
      const o = (c.oracle_text || '').toLowerCase();
      return c.name.toLowerCase().includes(q) || t.includes(q) || o.includes(q);
    });
    return matches.slice(0, limit).map((c) => ({ id: c.id, name: c.name }));
  }

  // Commander core
  function setCommander(playerId: PlayerID, commanderNames: string[], commanderIds: string[]) {
    const info = commandZone[playerId] ?? { commanderIds: [], tax: 0, taxById: {} };
    info.commanderIds = commanderIds.slice();
    info.commanderNames = commanderNames.slice();
    const prev = info.taxById ?? {};
    const next: Record<string, number> = {};
    for (const id of commanderIds) next[id] = (prev as any)[id] ?? 0;
    info.taxById = next;
    info.tax = Object.values(info.taxById).reduce((a, b) => a + b, 0);
    commandZone[playerId] = info;
    seq++;
  }

  function castCommander(playerId: PlayerID, commanderId: string) {
    const info = commandZone[playerId] ?? { commanderIds: [], tax: 0, taxById: {} };
    if (!info.taxById) info.taxById = {};
    info.taxById[commanderId] = (info.taxById[commanderId] ?? 0) + 2;
    info.tax = Object.values(info.taxById).reduce((a, b) => a + b, 0);
    commandZone[playerId] = info;
    seq++;
  }

  function moveCommanderToCZ(_playerId: PlayerID, _commanderId: string) {
    seq++;
  }

  // Counters/tokens
  function updateCounters(permanentId: string, deltas: Record<string, number>) {
    const p = state.battlefield.find((b) => b.id === permanentId);
    if (!p) return;

    const current: Record<string, number> = { ...(p.counters ?? {}) };
    for (const [k, vRaw] of Object.entries(deltas)) {
      const v = Math.floor(Number(vRaw) || 0);
      if (v === 0) continue;
      current[k] = (current[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(current)) {
      if ((v as number) <= 0) delete current[k];
    }

    p.counters = Object.keys(current).length ? current : undefined;
    seq++;
    runSBA();
  }

  function applyUpdateCountersBulk(updates: { permanentId: string; deltas: Record<string, number> }[]) {
    for (const u of updates) updateCounters(u.permanentId, u.deltas);
  }

  function createToken(controller: PlayerID, name: string, count = 1, basePower?: number, baseToughness?: number) {
    for (let i = 0; i < Math.max(1, count | 0); i++) {
      state.battlefield.push({
        id: uid('tok'),
        controller,
        owner: controller,
        tapped: false,
        counters: {},
        basePower,
        baseToughness,
        card: { id: uid('card'), name, type_line: 'Token', zone: 'battlefield' },
      });
    }
    seq++;
    runSBA();
  }

  function removePermanent(permanentId: string) {
    const i = state.battlefield.findIndex((b) => b.id === permanentId);
    if (i >= 0) {
      state.battlefield.splice(i, 1);
      seq++;
      runSBA();
    }
  }

  function movePermanentToExile(permanentId: string) {
    const idx = state.battlefield.findIndex((b) => b.id === permanentId);
    if (idx < 0) return;
    const perm = state.battlefield.splice(idx, 1)[0];
    const owner = perm.owner;
    const z =
      state.zones![owner] ||
      (state.zones![owner] = {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
      });
    const card = perm.card as any;
    const kc = {
      id: card.id,
      name: card.name,
      type_line: card.type_line,
      oracle_text: card.oracle_text,
      image_uris: card.image_uris,
      zone: 'exile' as const,
    };
    z.exile = z.exile || [];
    z.exile!.push(kc);
    seq++;
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
    const filteredBattlefield = state.battlefield.map((perm) => ({
      ...perm,
      card: maskCardForViewer(perm.card, viewer, perm.owner),
    }));

    const filteredZones: Record<PlayerID, PlayerZones> = {};
    for (const p of (state.players as any as PlayerRef)) {
      const z =
        state.zones?.[p.id] ?? { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
      const libCount = libraries.get(p.id)?.length ?? z.libraryCount ?? 0;
      const isSelf = viewer === p.id;
      const canSee = isSelf || canSeeOwnersHidden(viewer, p.id);
      filteredZones[p.id] = {
        hand: isSelf ? z.hand : canSee ? z.hand : [],
        handCount: z.handCount ?? (z.hand as any[])?.length ?? 0,
        libraryCount: libCount,
        graveyard: z.graveyard,
        graveyardCount: z.graveyardCount ?? (z.graveyard as any[])?.length ?? 0,
        exile: z.exile,
      };
    }

    const projectedPlayers: PlayerRef[] = (state.players as any as PlayerRef[]).map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      inactive: inactive.has(p.id),
    }));

    const myGrants = grants.get(viewer) ?? new Set<PlayerID>();
    const spectatorList: SpectatorRef[] = participantsList
      .filter((p) => p.spectator)
      .map((p) => ({
        id: p.playerId,
        name: spectatorNames.get(p.playerId) || 'Spectator',
        hasAccessToYou: myGrants.has(p.playerId),
      }));

    return {
      ...state,
      battlefield: filteredBattlefield,
      stack: state.stack.slice(),
      players: projectedPlayers,
      zones: filteredZones,
      spectators: spectatorList,
    };
  }

  function clearRecord(obj: Record<string, unknown>) {
    for (const k of Object.keys(obj)) delete (obj as any)[k];
  }

  function reset(preservePlayers: boolean) {
    state.stack = [];
    state.battlefield = [];
    state.phase = GamePhase.BEGINNING;
    state.step = undefined;
    inactive.clear();
    clearRecord(commandZone);
    if (preservePlayers) {
      for (const p of (state.players as any as PlayerRef[])) {
        life[p.id] = state.startingLife;
        zones[p.id] = {
          hand: [],
          handCount: 0,
          libraryCount: libraries.get(p.id)?.length ?? 0,
          graveyard: [],
          graveyardCount: 0,
        };
        commandZone[p.id] = { commanderIds: [], tax: 0, taxById: {} };
      }
      for (const pid of Object.keys(zones)) {
        if (!(state.players as any as PlayerRef[]).find((p) => p.id === pid)) delete zones[pid as PlayerID];
      }
      for (const pid of Object.keys(life)) {
        if (!(state.players as any as PlayerRef[]).find((p) => p.id === pid)) delete life[pid as PlayerID];
      }
      state.turnPlayer = (state.players as any as PlayerRef[])[0]?.id ?? ('' as PlayerID);
      state.priority = (state.players as any as PlayerRef[])[0]?.id ?? ('' as PlayerID);
    } else {
      (state.players as any as PlayerRef[]).splice(0, (state.players as any as PlayerRef[]).length);
      clearRecord(life);
      clearRecord(zones);
      libraries.clear();
      spectatorNames.clear();
      tokenToPlayer.clear();
      playerToToken.clear();
      state.turnPlayer = '' as PlayerID;
      state.priority = '' as PlayerID;
    }
    state.landsPlayedThisTurn = {};
    passesInRow = 0;
    seq++;
  }

  function skip(playerId: PlayerID) {
    if (!(state.players as any as PlayerRef[]).find((p) => p.id === playerId)) return;
    inactive.add(playerId);
    seq++;
  }

  function unskip(playerId: PlayerID) {
    if (!(state.players as any as PlayerRef[]).find((p) => p.id === playerId)) return;
    inactive.delete(playerId);
    seq++;
  }

  // Apply effects from targeting (destroy/exile/damage/counter)
  function applyTargetEffects(effects: readonly TargetEffect[]) {
    let changed = false;
    for (const eff of effects) {
      switch (eff.kind) {
        case 'DestroyPermanent': {
          const i = state.battlefield.findIndex((b) => b.id === eff.id);
          if (i >= 0) {
            state.battlefield.splice(i, 1);
            changed = true;
          }
          break;
        }
        case 'MoveToExile': {
          movePermanentToExile(eff.id);
          changed = true;
          break;
        }
        case 'DamagePlayer': {
          const pid = eff.playerId as PlayerID;
          const cur = state.life[pid] ?? state.startingLife;
          state.life[pid] = Math.max(0, cur - Math.max(0, eff.amount | 0));
          changed = true;
          break;
        }
        case 'DamagePermanent': {
          const p = state.battlefield.find((b) => b.id === eff.id);
          if (!p) break;
          const baseT = typeof p.baseToughness === 'number' ? p.baseToughness : undefined;
          if (typeof baseT !== 'number') break;
          const plus = p.counters?.['+1/+1'] ?? 0;
          const minus = p.counters?.['-1/-1'] ?? 0;
          const curT = baseT + (plus - minus);
          const amt = Math.max(0, eff.amount | 0);
          if (amt >= curT) {
            const i = state.battlefield.findIndex((b) => b.id === eff.id);
            if (i >= 0) {
              state.battlefield.splice(i, 1);
              changed = true;
            }
          }
          break;
        }
        case 'CounterStackItem': {
          const idx = state.stack.findIndex((s) => s.id === eff.id);
          if (idx >= 0) {
            const item = state.stack.splice(idx, 1)[0];
            // Move countered spell to its controller's graveyard
            const ctrl = item.controller;
            const z =
              state.zones?.[ctrl] ||
              (state.zones![ctrl] = {
                hand: [],
                handCount: 0,
                libraryCount: 0,
                graveyard: [],
                graveyardCount: 0,
              });
            z.graveyard.push({
              id: (item.card as any).id,
              name: (item.card as any).name,
              type_line: (item.card as any).type_line,
              oracle_text: (item.card as any).oracle_text,
              zone: 'graveyard',
            });
            z.graveyardCount = z.graveyard.length;
            changed = true;
          }
          break;
        }
        case 'Broadcast':
          break;
      }
    }
    if (changed) runSBA();
  }

  function pushStack(item: {
    id: string;
    controller: PlayerID;
    card: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>;
    targets?: string[];
  }) {
    state.stack.push({
      id: item.id,
      type: 'spell',
      controller: item.controller,
      card: { ...item.card, zone: 'stack' },
      targets: item.targets ? [...item.targets] : undefined,
    });
    passesInRow = 0;
    seq++;
  }

  function resolveTopOfStack() {
    const top = state.stack[state.stack.length - 1];
    if (!top) return;
    const item = state.stack.pop()!;
    const tline = ((item.card as any)?.type_line || '').toLowerCase();
    const isInstantOrSorcery = /\binstant\b/.test(tline) || /\bsorcery\b/.test(tline);

    if (isInstantOrSorcery) {
      const spec = categorizeSpell((item.card as any).name || '', (item.card as any).oracle_text || '');
      const chosen: TargetRef[] = (item.targets || []).map((s) => {
        const [kind, id] = String(s).split(':');
        return { kind: kind as TargetRef['kind'], id } as TargetRef;
      });
      if (spec) {
        const effects = resolveSpell(spec, chosen, state);
        applyTargetEffects(effects);
      }
      // Move spell to graveyard
      const ctrl = item.controller;
      const z =
        state.zones?.[ctrl] ||
        (state.zones![ctrl] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 });
      z.graveyard.push({
        id: (item.card as any).id,
        name: (item.card as any).name,
        type_line: (item.card as any).type_line,
        oracle_text: (item.card as any).oracle_text,
        zone: 'graveyard',
      });
      z.graveyardCount = z.graveyard.length;
    } else {
      // Permanent spell: put onto battlefield
      state.battlefield.push({
        id: uid('perm'),
        controller: item.controller,
        owner: item.controller,
        tapped: false,
        counters: {},
        card: { ...(item.card as any), zone: 'battlefield' },
      });
      runSBA();
    }
    passesInRow = 0;
    seq++;
  }

  function playLand(
    playerId: PlayerID,
    card: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>
  ) {
    state.battlefield.push({
      id: uid('perm'),
      controller: playerId,
      owner: playerId,
      tapped: false,
      counters: {},
      card: { ...card, zone: 'battlefield' },
    });
    state.landsPlayedThisTurn![playerId] = (state.landsPlayedThisTurn![playerId] ?? 0) + 1;
    seq++;
    runSBA();
  }

  // Phase/step engine
  const stepOrder: ReadonlyArray<{ phase: GamePhase; step: GameStep }> = [
    { phase: GamePhase.BEGINNING, step: GameStep.UNTAP },
    { phase: GamePhase.BEGINNING, step: GameStep.UPKEEP },
    { phase: GamePhase.BEGINNING, step: GameStep.DRAW },
    { phase: GamePhase.PRECOMBAT_MAIN, step: GameStep.MAIN1 },
    { phase: GamePhase.COMBAT, step: GameStep.BEGIN_COMBAT },
    { phase: GamePhase.COMBAT, step: GameStep.DECLARE_ATTACKERS },
    { phase: GamePhase.COMBAT, step: GameStep.DECLARE_BLOCKERS },
    { phase: GamePhase.COMBAT, step: GameStep.DAMAGE },
    { phase: GamePhase.COMBAT, step: GameStep.END_COMBAT },
    { phase: GamePhase.POSTCOMBAT_MAIN, step: GameStep.MAIN2 },
    { phase: GamePhase.END, step: GameStep.END },
    { phase: GamePhase.END, step: GameStep.CLEANUP },
  ];

  function indexOfCurrentStep(): number {
    const idx = stepOrder.findIndex((s) => s.phase === state.phase && s.step === state.step);
    return idx >= 0 ? idx : 0;
  }

  function beginTurnFor(player: PlayerID) {
    state.turnPlayer = player;
    state.priority = player;
    state.phase = GamePhase.BEGINNING;
    state.step = GameStep.UNTAP;
    // Reset land plays for all (some effects grant extra plays; baseline resets)
    state.landsPlayedThisTurn = {};
    for (const p of (state.players as any as PlayerRef[])) state.landsPlayedThisTurn[p.id] = 0;
    passesInRow = 0;
    seq++;
  }

  function applyStartOfStepActions() {
    // Simple automation for UNTAP and DRAW
    if (state.step === GameStep.UNTAP) {
      for (const perm of state.battlefield) {
        if (perm.controller === state.turnPlayer) perm.tapped = false;
      }
      seq++;
    } else if (state.step === GameStep.DRAW) {
      drawCards(state.turnPlayer, 1);
    }
  }

  function nextTurn() {
    const current = state.turnPlayer;
    const next = current ? advancePriorityClockwise(current) : ((state.players as any as PlayerRef[])[0]?.id as PlayerID);
    beginTurnFor(next);
  }

  function nextStep() {
    if (!state.step) {
      state.phase = GamePhase.BEGINNING;
      state.step = GameStep.UNTAP;
      applyStartOfStepActions();
      return;
    }
    const idx = indexOfCurrentStep();
    if (idx < stepOrder.length - 1) {
      const next = stepOrder[idx + 1];
      state.phase = next.phase;
      state.step = next.step;
      state.priority = state.turnPlayer; // AP gets priority at new step start
      passesInRow = 0;
      seq++;
      applyStartOfStepActions();
    } else {
      // End of turn -> next turn
      nextTurn();
    }
  }

  function applyEvent(e: GameEvent) {
    switch (e.type) {
      case 'rngSeed':
        seedRng(e.seed);
        break;
      case 'setTurnDirection':
        setTurnDirection(e.direction);
        break;
      case 'join':
        addPlayerIfMissing(e.playerId, e.name, e.seat);
        break;
      case 'leave':
        leave(e.playerId);
        break;
      case 'passPriority':
        // No-op here; sequencing done via socket
        break;
      case 'restart':
        reset(Boolean(e.preservePlayers));
        break;
      case 'removePlayer':
        leave(e.playerId);
        break;
      case 'skipPlayer':
        skip(e.playerId);
        break;
      case 'unskipPlayer':
        unskip(e.playerId);
        break;
      case 'spectatorGrant': {
        const set = grants.get(e.owner) ?? new Set<PlayerID>();
        set.add(e.spectator);
        grants.set(e.owner, set);
        seq++;
        break;
      }
      case 'spectatorRevoke': {
        const set = grants.get(e.owner) ?? new Set<PlayerID>();
        set.delete(e.spectator);
        grants.set(e.owner, set);
        seq++;
        break;
      }
      case 'deckImportResolved':
        importDeckResolved(e.playerId, e.cards);
        break;
      case 'shuffleLibrary':
        shuffleLibrary(e.playerId);
        break;
      case 'drawCards':
        drawCards(e.playerId, e.count);
        break;
      case 'selectFromLibrary':
        selectFromLibrary(e.playerId, e.cardIds, e.moveTo);
        break;
      case 'handIntoLibrary':
        moveHandToLibrary(e.playerId);
        break;
      case 'setCommander':
        setCommander(e.playerId, e.commanderNames, e.commanderIds);
        break;
      case 'castCommander':
        castCommander(e.playerId, e.commanderId);
        break;
      case 'moveCommanderToCZ':
        moveCommanderToCZ(e.playerId, e.commanderId);
        break;
      case 'updateCounters':
        updateCounters(e.permanentId, e.deltas);
        break;
      case 'updateCountersBulk':
        applyUpdateCountersBulk(e.updates);
        break;
      case 'createToken':
        createToken(e.controller, e.name, e.count, e.basePower, e.baseToughness);
        break;
      case 'removePermanent':
        removePermanent(e.permanentId);
        break;
      case 'dealDamage': {
        const effects = evaluateAction(state, {
          type: 'DEAL_DAMAGE',
          targetPermanentId: e.targetPermanentId,
          amount: e.amount,
          wither: e.wither,
          infect: e.infect,
        });
        applyEngineEffects(effects);
        runSBA();
        break;
      }
      case 'resolveSpell': {
        const effects = resolveSpell(e.spec, e.chosen, state);
        applyTargetEffects(effects);
        break;
      }
      case 'pushStack':
        pushStack(e.item);
        break;
      case 'resolveTopOfStack':
        resolveTopOfStack();
        break;
      case 'playLand':
        playLand(e.playerId, e.card);
        break;
      case 'nextTurn':
        nextTurn();
        break;
      case 'nextStep':
        nextStep();
        break;
    }
  }

  function replay(events: GameEvent[]) {
    for (const e of events) {
      if (e.type === 'passPriority') {
        passPriority((e as any).by);
      } else {
        applyEvent(e);
      }
    }
  }

  return {
    state,
    seq,
    // session
    join,
    leave,
    disconnect,
    participants,
    // turn/priority
    passPriority,
    setTurnDirection,
    nextTurn,
    nextStep,
    // deck/state
    importDeckResolved,
    shuffleLibrary,
    drawCards,
    selectFromLibrary,
    moveHandToLibrary,
    // search
    searchLibrary,
    // visibility
    grantSpectatorAccess: (owner: PlayerID, spectator: PlayerID) => {
      const set = grants.get(owner) ?? new Set<PlayerID>();
      set.add(spectator);
      grants.set(owner, set);
      seq++;
    },
    revokeSpectatorAccess: (owner: PlayerID, spectator: PlayerID) => {
      const set = grants.get(owner) ?? new Set<PlayerID>();
      set.delete(spectator);
      grants.set(owner, set);
      seq++;
    },
    viewFor,
    // rng
    seedRng,
    hasRngSeed,
    // commander
    setCommander,
    castCommander,
    moveCommanderToCZ,
    // counters/tokens
    updateCounters,
    createToken,
    removePermanent,
    movePermanentToExile,
    // engine
    applyEngineEffects,
    // stack/lands
    pushStack,
    resolveTopOfStack,
    playLand,
    // replay
    applyEvent,
    replay,
    // admin
    reset,
    skip,
    unskip,
    remove: leave,
  };
}