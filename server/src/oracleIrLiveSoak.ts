/*
  Localhost-only live Oracle IR soak driver.

  Creates a real in-memory game on this process, seats a human soak driver plus
  AI opponents, imports a constructed soak deck, fast-starts to a playable
  phase, then either free-casts listed cards through requestCastSpellForSocket
  or injects named permanents (real local oracle) and fires mill / combat /
  library-search so gap telemetry on GET /api/oracle-ir/telemetry actually moves.

  This is not a full EDH playthrough (no mulligan / mana / AI turns). Board
  setup is injected so each card can be cast or a replacement table can fire.
*/

import type { Application, Request, Response } from 'express';
import type { Server } from 'socket.io';

import type { PlayerID } from '../../shared/src/index.js';
import { GamePhase } from '../../shared/src/index.js';
import GameManager from './GameManager.js';
import { deleteGame as dbDeleteGame } from './db/index.js';
import { lookupLocalCardByNameSync, type LocalCardLookupRecord } from './services/localCardLookup.js';
import { registerAIPlayer, unregisterAIPlayer } from './socket/ai.js';
import { registerGameActions, requestCastSpellForSocket } from './socket/game-actions.js';
import { registerResolutionHandlers } from './socket/resolution.js';
import { provisionSpellCastBoardContext } from './socket/spellCastBoardContext.js';
import { games } from './socket/socket.js';
import { ensureGame } from './socket/util.js';
import { clearOracleIrPendingCompoundResumeOnState } from './state/modules/oracleIrTransitionPipeline.js';
import {
  applyMillReplacements,
  resolveCombatDamageToOpponent,
} from './state/modules/game-state-effects.js';
import {
  getOracleIrGapTelemetrySnapshot,
  type OracleIrGapTelemetryEvent,
} from './state/modules/oracleIrGapTelemetry.js';
import { evaluateLibrarySearchReplacementEvent } from './state/modules/replacement-effects.js';
import { millCardsFromLibrary } from './state/modules/triggerLibraryMillUtils.js';
import { ResolutionQueueManager } from './state/resolution/index.js';
import { debug, debugError, debugWarn } from './utils/debug.js';

export type LiveSoakSetup = 'main' | 'combat' | 'vote_board';
export type LiveSoakController = 'human' | 'ai';
export type LiveSoakAction = 'cast' | 'mill' | 'combat' | 'search';

export type LiveSoakInject = {
  name?: string;
  soakCreature?: boolean;
  controller?: LiveSoakController;
  attacking?: boolean;
};

export type LiveSoakBoardSnapshot = {
  millApplied?: number;
  millOpponent?: number;
  millOther?: number;
  lifeUnchanged?: boolean;
  attackerPlusOne?: number;
  search?: {
    canSearch?: boolean;
    limitToTop?: number;
    paymentAmount?: string;
    controlledBySeat?: LiveSoakController;
    triggerCount?: number;
  };
};

export type LiveSoakSession = {
  gameId: string;
  humanPlayerId: string;
  aiPlayerIds: string[];
  playerCount: number;
  soakId?: string;
};

export type LiveSoakQueuedStep = {
  type: string;
  playerId?: string;
  cardName?: string;
  pBudget?: number;
  canRepeatModes?: boolean;
  status?: string;
};

export type LiveSoakCastResult = {
  gameId: string;
  cardName: string;
  cardId?: string;
  found: boolean;
  errors: Array<{ code?: string; message?: string }>;
  queuedSteps: LiveSoakQueuedStep[];
  seenQueueTypes: string[];
  stack: Array<{ name?: string; id?: string }>;
  handNames: string[];
  phase?: string;
  combatCleared?: boolean;
  telemetryEvents: Array<{ kind: string; label: string }>;
  action?: LiveSoakAction;
  injected?: string[];
  board?: LiveSoakBoardSnapshot;
};

const SOAK_COMMANDER = 'Kenrith, the Returned King';
const SOAK_BASIC = 'Island';

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'card';
}

function noopIo(): Server {
  return {
    to: () => ({ emit: () => {} }),
    emit: () => {},
    sockets: { sockets: new Map() },
  } as any;
}

function getIo(): Server {
  return (GameManager.getIOServer?.() as Server | undefined) || noopIo();
}

function createDriverSocket(gameId: string, playerId: string, errors: LiveSoakCastResult['errors']) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const socket: any = {
    data: { gameId, playerId, spectator: false },
    rooms: new Set([gameId]),
    emit: (event: string, payload: any) => {
      if (event === 'error' && payload) {
        errors.push({
          code: typeof payload.code === 'string' ? payload.code : undefined,
          message: typeof payload.message === 'string' ? payload.message : String(payload?.message || event),
        });
      }
    },
    on: (event: string, handler: (...args: any[]) => any) => {
      handlers.set(event, handler);
      return socket;
    },
  };
  return { socket, handlers };
}

function toImportedCard(record: LocalCardLookupRecord, id: string, zone?: string) {
  return {
    id,
    name: record.name,
    type_line: record.type_line,
    oracle_text: record.oracle_text,
    mana_cost: record.mana_cost,
    power: record.power,
    toughness: record.toughness,
    card_faces: record.card_faces,
    layout: record.layout,
    loyalty: record.loyalty,
    color_identity: record.color_identity,
    colors: record.colors,
    keywords: record.keywords,
    image_uris: record.image_uris,
    cmc: (record as any).cmc,
    zone,
  };
}

function lookupCard(name: string): LocalCardLookupRecord | undefined {
  const direct = lookupLocalCardByNameSync(name);
  if (direct) return direct;
  const folded = name.normalize('NFD').replace(/\p{M}/gu, '');
  if (folded !== name) return lookupLocalCardByNameSync(folded);
  return undefined;
}

function buildDeckCards(cardNames: readonly string[], ownerTag: string): any[] {
  const cards: any[] = [];
  let n = 0;
  const push = (name: string, copies = 1) => {
    const record = lookupCard(name);
    if (!record) return;
    for (let i = 0; i < copies; i += 1) {
      n += 1;
      cards.push(toImportedCard(record, `${ownerTag}-${slug(name)}-${n}`));
    }
  };
  push(SOAK_COMMANDER);
  for (const name of cardNames) push(name);
  push(SOAK_BASIC, Math.max(8, 12 - cardNames.length));
  if (cards.length === 0) {
    push(SOAK_BASIC, 8);
  }
  return cards;
}

function makeSoakCreature(controller: string, id: string, name = 'Grizzly Bears') {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: {
      id: `${id}-card`,
      name,
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
      zone: 'battlefield',
    },
  };
}

function putCreatureOnBattlefield(game: any, controller: string, id: string, name = 'Grizzly Bears') {
  const battlefield = Array.isArray(game.state.battlefield) ? game.state.battlefield : (game.state.battlefield = []);
  battlefield.push(makeSoakCreature(controller, id, name));
}

function applySetup(game: any, humanId: string, aiIds: readonly string[], setup: LiveSoakSetup) {
  const state = game.state as any;
  if (setup === 'combat') {
    state.phase = GamePhase.COMBAT;
    state.step = 'DECLARE_BLOCKERS';
    state.combat = { attackers: [`${humanId}-atk`] };
    state.combatNumber = 1;
    putCreatureOnBattlefield(game, humanId, `${humanId}-atk`, 'Grizzly Bears');
    const attacker = (state.battlefield || []).find((permanent: any) => permanent.id === `${humanId}-atk`);
    if (attacker && aiIds[0]) attacker.attacking = aiIds[0];
    if (aiIds[0]) putCreatureOnBattlefield(game, aiIds[0], `${aiIds[0]}-blk`, 'Wall of Omens');
  } else {
    state.phase = GamePhase.PRECOMBAT_MAIN;
    state.step = 'MAIN1';
    state.combat = undefined;
  }
  if (setup === 'vote_board' || setup === 'combat') {
    for (const aiId of aiIds) {
      if (!(state.battlefield || []).some((permanent: any) => permanent.controller === aiId && permanent.id?.includes('-board'))) {
        putCreatureOnBattlefield(game, aiId, `${aiId}-board`, 'Grizzly Bears');
      }
    }
  }
  state.activePlayer = humanId;
  state.turnPlayer = humanId;
  state.priority = humanId;
  state.turnNumber = Math.max(1, Number(state.turnNumber) || 1);
}

function snapshotQueue(gameId: string): LiveSoakQueuedStep[] {
  return (ResolutionQueueManager.getQueue(gameId).steps || []).map((step: any) => ({
    type: String(step.type || ''),
    playerId: step.playerId ? String(step.playerId) : undefined,
    cardName: step.cardName ? String(step.cardName) : undefined,
    pBudget: step.pBudget != null ? Number(step.pBudget) : undefined,
    canRepeatModes: step.canRepeatModes != null ? Boolean(step.canRepeatModes) : undefined,
    status: step.status ? String(step.status) : undefined,
  }));
}

function telemetryDelta(beforeCount: number): OracleIrGapTelemetryEvent[] {
  const snap = getOracleIrGapTelemetrySnapshot();
  const added = Math.max(0, snap.totalEvents - beforeCount);
  if (added === 0) return [];
  return snap.recentEvents.slice(-added) as OracleIrGapTelemetryEvent[];
}

function pendingQueueCount(gameId: string): number {
  return (ResolutionQueueManager.getQueue(gameId).steps || []).filter((step: any) => {
    const status = String(step.status || '').toLowerCase();
    return status !== 'completed' && status !== 'cancelled';
  }).length;
}

function resolveInjectController(
  token: LiveSoakController | undefined,
  humanId: string,
  aiIds: readonly string[],
): string {
  if (token === 'ai') return aiIds[0] || humanId;
  return humanId;
}

function putNamedPermanentOnBattlefield(
  game: any,
  controller: string,
  name: string,
  opts?: { attacking?: boolean; defendingPlayerId?: string; soakCreature?: boolean },
): { permanent: any; recordName: string } | undefined {
  if (opts?.soakCreature) {
    const id = `soak-inject-bear-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    putCreatureOnBattlefield(game, controller, id, 'Grizzly Bears');
    const permanent = (game.state.battlefield || []).find((entry: any) => entry.id === id);
    if (!permanent) return undefined;
    if (opts.attacking && opts.defendingPlayerId) {
      permanent.attacking = opts.defendingPlayerId;
      permanent.blockedBy = [];
    }
    return { permanent, recordName: 'Grizzly Bears' };
  }
  const record = lookupCard(name);
  if (!record) return undefined;
  const id = `soak-inject-${slug(name)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const card = toImportedCard(record, `${id}-card`, 'battlefield');
  const permanent: any = {
    id,
    controller,
    owner: controller,
    tapped: false,
    card,
    name: record.name,
    oracle_text: record.oracle_text,
    counters: {},
  };
  if (opts?.attacking && opts.defendingPlayerId) {
    permanent.attacking = opts.defendingPlayerId;
    permanent.blockedBy = [];
  }
  const battlefield = Array.isArray(game.state.battlefield) ? game.state.battlefield : (game.state.battlefield = []);
  battlefield.push(permanent);
  return { permanent, recordName: record.name };
}

function ensureLibraries(game: any, minCount: number) {
  if (!game.libraries || typeof game.libraries.get !== 'function') {
    game.libraries = new Map<string, any[]>();
  }
  const state = game.state as any;
  state.zones = state.zones || {};
  for (const player of state.players || []) {
    const id = String(player.id || '');
    if (!id) continue;
    const zones = state.zones[id] = state.zones[id] || {
      hand: [],
      library: [],
      graveyard: [],
      handCount: 0,
      libraryCount: 0,
      graveyardCount: 0,
    };
    let lib = game.libraries.get(id);
    if (!Array.isArray(lib) || lib.length === 0) {
      lib = Array.isArray(zones.library) ? zones.library : [];
    }
    while (lib.length < minCount) {
      lib.push({
        id: `soak-lib-${id}-${lib.length}`,
        name: 'Island',
        type_line: 'Basic Land — Island',
        oracle_text: '',
        zone: 'library',
      });
    }
    game.libraries.set(id, lib);
    zones.library = lib;
    zones.libraryCount = lib.length;
    zones.graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
    zones.graveyardCount = zones.graveyard.length;
  }
}

function graveyardCount(game: any, playerId: string): number {
  const zones = game?.state?.zones?.[playerId];
  if (!zones) return 0;
  if (Array.isArray(zones.graveyard)) return zones.graveyard.length;
  return Number(zones.graveyardCount || 0);
}

function snapshotLife(game: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const player of game?.state?.players || []) {
    if (player?.id) out[String(player.id)] = Number(player.life || 0);
  }
  return out;
}

function plusOneCount(permanent: any): number {
  const counters = permanent?.counters || {};
  return Number(counters['+1/+1'] || 0);
}

function fillManaPool(game: any, playerId: string) {
  const state = game.state as any;
  const amount = 20;
  const pool = {
    W: amount,
    U: amount,
    B: amount,
    R: amount,
    G: amount,
    C: amount,
    white: amount,
    blue: amount,
    black: amount,
    red: amount,
    green: amount,
    colorless: amount,
  };
  state.manaPool = state.manaPool || {};
  state.manaPool[playerId] = { ...(state.manaPool[playerId] || {}), ...pool };
}

async function autoCompleteTargetSelection(
  io: Server,
  gameId: string,
  playerId: string,
  errors: LiveSoakCastResult['errors'],
) {
  const pending = (ResolutionQueueManager.getQueue(gameId).steps || []).filter((step: any) => {
    const status = String(step.status || '').toLowerCase();
    return String(step.type) === 'target_selection'
      && status !== 'completed'
      && status !== 'cancelled';
  });
  if (pending.length === 0) return false;
  const { socket, handlers } = createDriverSocket(gameId, playerId, errors);
  registerResolutionHandlers(io, socket);
  const submit = handlers.get('submitResolutionResponse');
  if (typeof submit !== 'function') return false;
  for (const step of pending) {
    const valid = Array.isArray(step.validTargets) ? step.validTargets : [];
    const minTargets = Math.max(1, Number(step.minTargets || 1));
    if (valid.length < minTargets) continue;
    const preferred = [...valid].sort((left: any, right: any) => Number(Boolean(right.isOpponent)) - Number(Boolean(left.isOpponent)));
    const ids = preferred.slice(0, minTargets).map((target: any) => String(target.id));
    await submit({
      gameId,
      stepId: String(step.id),
      selections: ids,
      cancelled: false,
    });
  }
  return true;
}

async function autoCompleteManaPayment(
  io: Server,
  gameId: string,
  playerId: string,
  errors: LiveSoakCastResult['errors'],
) {
  const pending = (ResolutionQueueManager.getQueue(gameId).steps || []).filter((step: any) => {
    const status = String(step.status || '').toLowerCase();
    return String(step.type) === 'mana_payment_choice'
      && status !== 'completed'
      && status !== 'cancelled';
  });
  if (pending.length === 0) return false;
  const { socket, handlers } = createDriverSocket(gameId, playerId, errors);
  registerResolutionHandlers(io, socket);
  const submit = handlers.get('submitResolutionResponse');
  if (typeof submit !== 'function') return false;
  for (const step of pending) {
    await submit({
      gameId,
      stepId: String(step.id),
      selections: { payment: [] },
      cancelled: false,
    });
  }
  return true;
}

async function passPriorityOnce(io: Server, gameId: string, playerId: string, errors: LiveSoakCastResult['errors']) {
  const { socket, handlers } = createDriverSocket(gameId, playerId, errors);
  registerGameActions(io, socket);
  const pass = handlers.get('passPriority');
  if (typeof pass === 'function') {
    await pass({ gameId, isAutoPass: true });
    return;
  }
  const game = ensureGame(gameId);
  if (game && typeof (game as any).passPriority === 'function') {
    (game as any).passPriority(playerId, true);
  }
}

async function drainUntilChoiceOrEmpty(
  io: Server,
  gameId: string,
  playerIds: readonly string[],
  errors: LiveSoakCastResult['errors'],
) {
  const game = ensureGame(gameId);
  if (!game) return;
  for (let i = 0; i < 16; i += 1) {
    if (pendingQueueCount(gameId) > 0) return;
    const stack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
    if (stack.length === 0) return;
    for (const playerId of playerIds) {
      await passPriorityOnce(io, gameId, playerId, errors);
      if (pendingQueueCount(gameId) > 0) return;
    }
  }
}

function putCardInHand(game: any, playerId: string, card: any) {
  const state = game.state as any;
  state.zones = state.zones || {};
  state.zones[playerId] = state.zones[playerId] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 };
  const hand = Array.isArray(state.zones[playerId].hand) ? state.zones[playerId].hand : (state.zones[playerId].hand = []);
  hand.push(card);
  state.zones[playerId].handCount = hand.length;
  const player = (state.players || []).find((entry: any) => entry.id === playerId);
  if (player) {
    player.hand = Array.isArray(player.hand) ? player.hand : [];
    player.hand.push(card);
  }
}

export function isOracleIrLiveSoakGame(game: any): boolean {
  return Boolean(game?.state && (game.state as any).oracleIrLiveSoak === true);
}

export async function createLiveSoakSession(options: {
  playerCount?: number;
  soakId?: string;
  cardNames?: readonly string[];
  keepGame?: boolean;
}): Promise<LiveSoakSession> {
  const playerCount = Math.min(4, Math.max(2, Number(options.playerCount) || 2));
  const soakId = options.soakId ? slug(options.soakId) : 'ad-hoc';
  const gameId = `live-soak-${soakId}-${Date.now().toString(36)}`;

  if (GameManager.getGame(gameId)) {
    throw new Error(`Game ${gameId} already exists`);
  }

  const game = GameManager.createGame({ id: gameId });
  games.set(gameId as any, game as any);
  (game as any).gameId = gameId;
  const state = game.state as any;
  state.format = 'commander';
  state.startingLife = 40;
  state.oracleIrLiveSoak = true;
  state.oracleIrLiveSoakKeep = options.keepGame === true;
  state.players = state.players || [];
  state.zones = state.zones || {};
  state.battlefield = [];
  state.stack = [];

  const joinIds: string[] = [];
  for (let i = 1; i <= playerCount; i += 1) {
    const playerId = (i === 1 ? 'soak_human' : `soak_ai_${i - 1}`) as PlayerID;
    if (typeof (game as any).applyEvent === 'function') {
      (game as any).applyEvent({ type: 'join', playerId, name: i === 1 ? 'Soak Driver' : `Soak AI ${i - 1}` });
    } else if (typeof (game as any).join === 'function') {
      (game as any).join(`soak_socket_${playerId}_${gameId}`, i === 1 ? 'Soak Driver' : `Soak AI ${i - 1}`, false);
    }
    joinIds.push(playerId);
  }

  const humanPlayerId = joinIds[0];
  const aiPlayerIds = joinIds.slice(1);
  const cardNames = options.cardNames && options.cardNames.length > 0 ? options.cardNames : [SOAK_BASIC];

  for (const playerId of joinIds) {
    const player = (state.players || []).find((entry: any) => entry.id === playerId);
    if (player) {
      player.life = 40;
      if (playerId !== humanPlayerId) {
        player.isAI = true;
        player.difficulty = 0.5;
      }
    }
    const deck = buildDeckCards(cardNames, playerId);
    if (typeof (game as any).importDeckResolved === 'function' && deck.length > 0) {
      (game as any).importDeckResolved(playerId, deck);
    }
  }

  for (const aiId of aiPlayerIds) {
    registerAIPlayer(gameId, aiId as PlayerID, `Soak AI ${aiId}`, 0.5);
  }

  state.oracleIrLiveSoak = true;
  applySetup(game, humanPlayerId, aiPlayerIds, 'main');
  ensureGame(gameId);

  debug(1, '[live-soak] session created', { gameId, playerCount, soakId, cards: cardNames.length });
  return { gameId, humanPlayerId, aiPlayerIds, playerCount, soakId: options.soakId };
}

export async function castLiveSoakCard(options: {
  gameId: string;
  cardName: string;
  setup?: LiveSoakSetup;
  inject?: readonly LiveSoakInject[];
  action?: LiveSoakAction;
  millCount?: number;
}): Promise<LiveSoakCastResult> {
  const gameId = options.gameId;
  const cardName = options.cardName;
  const setup = options.setup || 'main';
  const action: LiveSoakAction = options.action || 'cast';
  const errors: LiveSoakCastResult['errors'] = [];
  const before = getOracleIrGapTelemetrySnapshot().totalEvents;
  const game = ensureGame(gameId);
  if (!game) {
    return {
      gameId,
      cardName,
      found: false,
      errors: [{ code: 'GAME_NOT_FOUND', message: 'Live soak game not found' }],
      queuedSteps: [],
      seenQueueTypes: [],
      stack: [],
      handNames: [],
      telemetryEvents: [],
      action,
    };
  }

  const state = game.state as any;
  const humanPlayerId = String((state.players || []).find((player: any) => !player.isAI)?.id || 'soak_human');
  const aiPlayerIds = (state.players || [])
    .filter((player: any) => player.isAI)
    .map((player: any) => String(player.id));

  ResolutionQueueManager.removeQueue(gameId);
  state.stack = [];
  state.battlefield = [];
  delete state.lastVoteResults;
  delete state.voteResults;
  delete state.votesReceivedByPlayer;
  delete state.votesReceivedByPermanent;
  delete state.lastVoteMeta;
  delete state.oracleIrAppliedStepKinds;
  delete state.oracleIrStepLedger;
  clearOracleIrPendingCompoundResumeOnState(state);
  applySetup(game, humanPlayerId, aiPlayerIds, setup);

  const record = lookupCard(cardName);
  if (!record) {
    return {
      gameId,
      cardName,
      found: false,
      errors: [{ code: 'CARD_NOT_FOUND', message: `Local oracle lookup missed "${cardName}"` }],
      queuedSteps: snapshotQueue(gameId),
      seenQueueTypes: [],
      stack: [],
      handNames: [],
      telemetryEvents: telemetryDelta(before).map((event) => ({ kind: event.kind, label: event.label })),
      action,
    };
  }

  let injectList = [...(options.inject || [])];
  if (injectList.length === 0 && action !== 'cast') {
    injectList = [{
      name: cardName,
      controller: action === 'search' ? 'ai' : 'human',
      attacking: action === 'combat',
    }];
  }

  const injectedNames: string[] = [];
  const injectedPermanents: any[] = [];
  for (const entry of injectList) {
    const controller = resolveInjectController(entry.controller, humanPlayerId, aiPlayerIds);
    const placed = putNamedPermanentOnBattlefield(game, controller, entry.name || 'Grizzly Bears', {
      attacking: entry.attacking === true,
      defendingPlayerId: aiPlayerIds[0],
      soakCreature: entry.soakCreature === true,
    });
    if (!placed) {
      errors.push({ code: 'INJECT_NOT_FOUND', message: `Local oracle lookup missed inject "${entry.name || 'soak creature'}"` });
      return {
        gameId,
        cardName,
        found: false,
        errors,
        queuedSteps: snapshotQueue(gameId),
        seenQueueTypes: [],
        stack: [],
        handNames: [],
        telemetryEvents: telemetryDelta(before).map((event) => ({ kind: event.kind, label: event.label })),
        action,
        injected: injectedNames,
      };
    }
    injectedNames.push(placed.recordName);
    injectedPermanents.push(placed.permanent);
  }

  if (action !== 'cast') {
    ensureLibraries(game, Math.max(16, (Number(options.millCount) || 3) * 4));
  }
  fillManaPool(game, humanPlayerId);
  state.priority = humanPlayerId;
  state.activePlayer = humanPlayerId;
  state.turnPlayer = humanPlayerId;

  const gyBefore = Object.fromEntries(
    [humanPlayerId, ...aiPlayerIds].map((id) => [id, graveyardCount(game, id)]),
  );
  const lifeBefore = snapshotLife(game);

  let board: LiveSoakBoardSnapshot | undefined;
  let cardId: string | undefined;

  if (action === 'mill') {
    const millCount = Math.max(1, Number(options.millCount) || 3);
    const targetId = aiPlayerIds[0];
    const { finalCount } = applyMillReplacements(game as any, millCount, humanPlayerId, targetId);
    millCardsFromLibrary(state, targetId, finalCount, game as any);
    const millOpponent = graveyardCount(game, targetId) - Number(gyBefore[targetId] || 0);
    const millOther = aiPlayerIds.slice(1).reduce(
      (sum, id) => sum + (graveyardCount(game, id) - Number(gyBefore[id] || 0)),
      0,
    );
    board = { millApplied: finalCount, millOpponent, millOther };
  } else if (action === 'combat') {
    const attacker = injectedPermanents.find((permanent) => permanent.attacking)
      || injectedPermanents.find((permanent) => String(permanent.controller) === humanPlayerId)
      || injectedPermanents[0];
    const defendingPlayerId = String(attacker?.attacking || aiPlayerIds[0] || '');
    const damageAmount = Number.parseInt(String(attacker?.card?.power ?? '0'), 10) || 0;
    if (attacker && defendingPlayerId) {
      resolveCombatDamageToOpponent(game as any, {
        attackerCard: attacker.card,
        attackerPermanent: attacker,
        attackerController: String(attacker.controller || humanPlayerId),
        damageAmount,
        defendingPlayerId,
        executeMills: true,
      });
    }
    const millOpponent = aiPlayerIds[0]
      ? graveyardCount(game, aiPlayerIds[0]) - Number(gyBefore[aiPlayerIds[0]] || 0)
      : 0;
    const millOther = aiPlayerIds.slice(1).reduce(
      (sum, id) => sum + (graveyardCount(game, id) - Number(gyBefore[id] || 0)),
      0,
    );
    const lifeAfter = snapshotLife(game);
    const lifeUnchanged = Object.keys(lifeBefore).every((id) => lifeBefore[id] === lifeAfter[id]);
    board = {
      millOpponent,
      millOther,
      lifeUnchanged,
      attackerPlusOne: plusOneCount(attacker),
    };
  } else if (action === 'search') {
    const result = evaluateLibrarySearchReplacementEvent({
      game,
      state,
      searchingPlayerId: humanPlayerId,
    });
    const meta = (result?.metadata || {}) as {
      canSearch?: boolean;
      limitToTop?: number;
      paymentRequired?: { amount?: string };
      controlledBy?: string;
      triggerEffects?: unknown[];
    };
    const controlledBy = String(meta.controlledBy || '');
    board = {
      search: {
        canSearch: meta.canSearch !== false,
        ...(typeof meta.limitToTop === 'number' ? { limitToTop: meta.limitToTop } : {}),
        ...(meta.paymentRequired?.amount ? { paymentAmount: String(meta.paymentRequired.amount) } : {}),
        ...(controlledBy
          ? { controlledBySeat: controlledBy === humanPlayerId ? 'human' : 'ai' }
          : {}),
        triggerCount: Array.isArray(meta.triggerEffects) ? meta.triggerEffects.length : 0,
      },
    };
  } else {
    cardId = `soak-cast-${slug(cardName)}-${Date.now().toString(36)}`;
    const card = toImportedCard(record, cardId, 'hand');
    putCardInHand(game, humanPlayerId, card);
    provisionSpellCastBoardContext(game, humanPlayerId, record, {
      opponentIds: aiPlayerIds,
      excludeCardId: cardId,
    });

    const io = getIo();
    const { socket } = createDriverSocket(gameId, humanPlayerId, errors);
    try {
      await requestCastSpellForSocket(
        io,
        socket,
        { gameId, cardId, fromZone: 'hand' },
        { skipPriorityCheck: true, castWithoutPayingManaCost: true, ignoreTimingRestrictions: true },
      );
    } catch (error) {
      errors.push({
        code: 'CAST_THREW',
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const seenQueueTypes = new Set<string>();
    const noteQueue = () => {
      for (const step of snapshotQueue(gameId)) {
        if (step.type) seenQueueTypes.add(step.type);
      }
    };

    noteQueue();
    for (let i = 0; i < 8; i += 1) {
      const paid = await autoCompleteManaPayment(io, gameId, humanPlayerId, errors);
      noteQueue();
      const targeted = await autoCompleteTargetSelection(io, gameId, humanPlayerId, errors);
      noteQueue();
      await drainUntilChoiceOrEmpty(io, gameId, [humanPlayerId, ...aiPlayerIds], errors);
      noteQueue();
      const types = snapshotQueue(gameId).map((step) => step.type);
      const waitingOnChoice = types.some((type) =>
        type !== 'mana_payment_choice' && type !== 'target_selection',
      );
      if (!paid && !targeted && (waitingOnChoice || types.length === 0 || !types.includes('mana_payment_choice'))) break;
    }

    const hand = Array.isArray(state.zones?.[humanPlayerId]?.hand) ? state.zones[humanPlayerId].hand : [];
    const stack = Array.isArray(state.stack) ? state.stack : [];
    const telemetryEvents = telemetryDelta(before);

    return {
      gameId,
      cardName,
      cardId,
      found: true,
      errors,
      queuedSteps: snapshotQueue(gameId),
      seenQueueTypes: [...seenQueueTypes],
      stack: stack.map((item: any) => ({
        name: item?.card?.name || item?.name,
        id: item?.card?.id || item?.id,
      })),
      handNames: hand.map((entry: any) => String(entry?.name || '')),
      phase: String(state.phase || ''),
      combatCleared: state.combat === undefined,
      telemetryEvents: telemetryEvents.map((event) => ({ kind: event.kind, label: event.label })),
      action,
      injected: injectedNames,
    };
  }

  const hand = Array.isArray(state.zones?.[humanPlayerId]?.hand) ? state.zones[humanPlayerId].hand : [];
  const stack = Array.isArray(state.stack) ? state.stack : [];
  const telemetryEvents = telemetryDelta(before);

  return {
    gameId,
    cardName,
    cardId,
    found: true,
    errors,
    queuedSteps: snapshotQueue(gameId),
    seenQueueTypes: [],
    stack: stack.map((item: any) => ({
      name: item?.card?.name || item?.name,
      id: item?.card?.id || item?.id,
    })),
    handNames: hand.map((entry: any) => String(entry?.name || '')),
    phase: String(state.phase || ''),
    combatCleared: state.combat === undefined,
    telemetryEvents: telemetryEvents.map((event) => ({ kind: event.kind, label: event.label })),
    action,
    injected: injectedNames,
    board,
  };
}

export async function endLiveSoakSession(gameId: string): Promise<{ ok: boolean; gameId: string }> {
  const game = GameManager.getGame(gameId) || games.get(gameId as any);
  const players = ((game as any)?.state?.players || []) as any[];
  for (const player of players) {
    if (player?.isAI && player.id) {
      try {
        unregisterAIPlayer(gameId, player.id);
      } catch (error) {
        debugWarn(1, '[live-soak] unregisterAIPlayer failed', { gameId, playerId: player.id, error });
      }
    }
  }
  try {
    ResolutionQueueManager.removeQueue(gameId);
  } catch {
    // ignore
  }
  try {
    GameManager.deleteGame(gameId);
  } catch (error) {
    debugWarn(1, '[live-soak] GameManager.deleteGame failed', { gameId, error });
  }
  try {
    games.delete(gameId as any);
  } catch {
    // ignore
  }
  try {
    dbDeleteGame(gameId);
  } catch (error) {
    debugWarn(1, '[live-soak] dbDeleteGame failed', { gameId, error });
  }
  debug(1, '[live-soak] session ended', { gameId });
  return { ok: true, gameId };
}

function isLocalhostRequest(req: Request): boolean {
  const remote = String(req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return remote === '127.0.0.1' || remote === '::1' || remote === 'localhost' || remote.startsWith('127.0.0.1:');
}

function rejectUnlessLocalhost(req: Request, res: Response): boolean {
  if (isLocalhostRequest(req)) return false;
  res.status(403).json({ error: 'Forbidden' });
  return true;
}

export function registerOracleIrLiveSoakRoutes(app: Application): void {
  app.post('/api/oracle-ir/live-soak/session', async (req, res) => {
    if (rejectUnlessLocalhost(req, res)) return;
    try {
      const body = req.body || {};
      const session = await createLiveSoakSession({
        playerCount: body.playerCount,
        soakId: typeof body.soakId === 'string' ? body.soakId : undefined,
        cardNames: Array.isArray(body.cardNames) ? body.cardNames.map(String) : undefined,
        keepGame: body.keepGame === true,
      });
      res.json(session);
    } catch (error) {
      debugError(1, 'POST /api/oracle-ir/live-soak/session failed:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create live soak session' });
    }
  });

  app.post('/api/oracle-ir/live-soak/cast', async (req, res) => {
    if (rejectUnlessLocalhost(req, res)) return;
    try {
      const body = req.body || {};
      const gameId = String(body.gameId || '');
      const cardName = String(body.cardName || '');
      if (!gameId || !cardName) {
        res.status(400).json({ error: 'gameId and cardName are required' });
        return;
      }
      const inject = Array.isArray(body.inject)
        ? body.inject
          .filter((entry: unknown) => {
            if (!entry || typeof entry !== 'object') return false;
            const rec = entry as { name?: unknown; soakCreature?: unknown };
            return typeof rec.name === 'string' || rec.soakCreature === true;
          })
          .map((entry: { name?: string; controller?: string; attacking?: boolean; soakCreature?: boolean }) => ({
            ...(typeof entry.name === 'string' ? { name: String(entry.name) } : {}),
            ...(entry.soakCreature === true ? { soakCreature: true } : {}),
            ...(entry.controller === 'ai' || entry.controller === 'human' ? { controller: entry.controller } : {}),
            ...(entry.attacking === true ? { attacking: true } : {}),
          }))
        : undefined;
      const action = body.action === 'mill' || body.action === 'combat' || body.action === 'search' || body.action === 'cast'
        ? body.action
        : undefined;
      const result = await castLiveSoakCard({
        gameId,
        cardName,
        setup: body.setup === 'combat' || body.setup === 'vote_board' ? body.setup : 'main',
        inject,
        action,
        millCount: body.millCount != null ? Number(body.millCount) : undefined,
      });
      res.json(result);
    } catch (error) {
      debugError(1, 'POST /api/oracle-ir/live-soak/cast failed:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to cast live soak card' });
    }
  });

  app.post('/api/oracle-ir/live-soak/end', async (req, res) => {
    if (rejectUnlessLocalhost(req, res)) return;
    try {
      const gameId = String(req.body?.gameId || '');
      if (!gameId) {
        res.status(400).json({ error: 'gameId is required' });
        return;
      }
      const result = await endLiveSoakSession(gameId);
      res.json(result);
    } catch (error) {
      debugError(1, 'POST /api/oracle-ir/live-soak/end failed:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to end live soak session' });
    }
  });
}
