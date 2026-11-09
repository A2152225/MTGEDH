/**
 * Headless live-game helpers for AI self-play and precon e2e.
 *
 * Origin: AI_Upgrade Phase 0-1 (P0-3), extracted from precon-live-e2e.integration.test.ts.
 * Public entry symbols: createNoopIo, deriveLivePreconSeed, resolveDeckCards,
 * instantiateDeckCards, selectCommanders, stateSnapshot, prepareLiveGame,
 * advanceLiveGame, cleanupLiveGame, LiveSeatSettings, PreparedLiveGame,
 * LoadedCard, DeckSeatSpec.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, vi } from 'vitest';
import { createGameIfNotExists, deleteGame } from '../../src/db/index.js';
import { ensureGame, broadcastGame } from '../../src/socket/util.js';
import { registerAIPlayer, scheduleAIGameFlow, unregisterAIPlayer } from '../../src/socket/ai.js';
import { games, priorityTimers } from '../../src/socket/socket.js';
import { ResolutionQueueManager } from '../../src/state/resolution/index.js';
import { readOracleCardsSync } from '../../src/services/oracleCardsIndex.js';
import { seedAIRandom } from '../../../rules-engine/src/aiRandom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const LIVE_PRECON_ENV_SEED = Number(process.env.LIVE_PRECON_SEED);
const LIVE_PRECON_DEFAULT_SEED = 8;
const LIVE_PRECON_BASE_SEED = Number.isFinite(LIVE_PRECON_ENV_SEED) ? LIVE_PRECON_ENV_SEED : LIVE_PRECON_DEFAULT_SEED;
const LIVE_PRECON_PROGRESS_LOG = process.env.LIVE_PRECON_PROGRESS_LOG === '1';

export type LoadedCard = {
  id?: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: Record<string, string>;
  mana_cost?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  card_faces?: any[];
  layout?: string;
  color_identity?: string[];
  colors?: string[];
};

export type LiveSeatSettings = {
  aiStrategy?: string;
  difficulty?: number;
  /** Brain name for Phase 1+ (v0 / shadow / v1 / v2). */
  brain?: string;
  playerName?: string;
};

export type DeckSeatSpec = {
  deckId: string;
  cardNames: string[];
  settings?: LiveSeatSettings;
};

export type JoinedDeckFixture = {
  deckId: string;
  playerId: string;
  playerName: string;
  cards: LoadedCard[];
  commanders: LoadedCard[];
  actualPlayerId: string;
  settings: LiveSeatSettings;
};

export type PreparedLiveGame = {
  io: any;
  game: any;
  gameId: string;
  seed: number;
  actualPlayerIds: string[];
  joinedFixtures: JoinedDeckFixture[];
};

let oracleIndexCache: Map<string, LoadedCard> | null = null;
let atomicIndexCache: Map<string, LoadedCard> | null = null;

export function deriveLivePreconSeed(gameId: string): number {
  let hash = 0;
  for (const ch of gameId) {
    hash = ((hash * 31) + ch.charCodeAt(0)) | 0;
  }
  return (LIVE_PRECON_BASE_SEED + Math.abs(hash)) >>> 0;
}

export function createNoopIo() {
  const emitted: Array<{ room?: string; event: string; payload: any }> = [];
  const sockets = new Map<string, { data?: any; emit: (event: string, payload: any) => void }>();
  return {
    emitted,
    sockets: {
      sockets,
    },
    to: (room: string) => ({
      emit: (event: string, payload: any) => {
        emitted.push({ room, event, payload });
      },
    }),
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
}

function normalizeCardName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ');
}

function slugify(value: string): string {
  return normalizeCardName(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'card';
}

function cardScore(card: LoadedCard, layout?: string): number {
  let score = 0;
  if (layout && !['art_series', 'token', 'double_faced_token', 'emblem'].includes(layout)) {
    score += 4;
  }
  if (card.oracle_text) score += 4;
  if (card.type_line && card.type_line !== 'Card' && !card.type_line.endsWith('// Card')) score += 3;
  if (card.mana_cost !== undefined) score += 1;
  if (card.power || card.toughness || card.loyalty) score += 1;
  return score;
}

function toOracleCardData(raw: any): LoadedCard | null {
  if (!raw || !raw.name) return null;
  const firstFace = Array.isArray(raw.card_faces) && raw.card_faces.length > 0 ? raw.card_faces[0] : undefined;
  return {
    id: raw.id,
    name: raw.name,
    type_line: raw.type_line ?? firstFace?.type_line,
    oracle_text: raw.oracle_text ?? firstFace?.oracle_text,
    image_uris: raw.image_uris,
    mana_cost: raw.mana_cost ?? firstFace?.mana_cost,
    power: raw.power ?? firstFace?.power,
    toughness: raw.toughness ?? firstFace?.toughness,
    loyalty: raw.loyalty ?? firstFace?.loyalty,
    card_faces: raw.card_faces,
    layout: raw.layout,
    color_identity: Array.isArray(raw.color_identity) ? raw.color_identity.slice() : undefined,
    colors: Array.isArray(raw.colors) ? raw.colors.slice() : undefined,
  };
}

function toAtomicCardData(name: string, raw: any): LoadedCard {
  return {
    id: typeof raw?.uuid === 'string' ? raw.uuid : undefined,
    name,
    type_line: typeof raw?.type === 'string' ? raw.type : undefined,
    oracle_text: typeof raw?.text === 'string' ? raw.text : undefined,
    mana_cost: typeof raw?.manaCost === 'string' ? raw.manaCost : undefined,
    power: typeof raw?.power === 'string' ? raw.power : undefined,
    toughness: typeof raw?.toughness === 'string' ? raw.toughness : undefined,
    loyalty: typeof raw?.loyalty === 'string' ? raw.loyalty : undefined,
    color_identity: Array.isArray(raw?.colorIdentity) ? raw.colorIdentity.slice() : undefined,
    colors: Array.isArray(raw?.colors) ? raw.colors.slice() : undefined,
  };
}

function ensureOracleIndex(): Map<string, LoadedCard> {
  if (oracleIndexCache) return oracleIndexCache;
  const oracleCards = readOracleCardsSync(repoRoot) as any[];
  const index = new Map<string, LoadedCard>();
  for (const rawCard of oracleCards) {
    const cardData = toOracleCardData(rawCard);
    if (!cardData) continue;
    const candidateNames = [
      rawCard?.name,
      ...(Array.isArray(rawCard?.card_faces) ? rawCard.card_faces.map((face: any) => face?.name) : []),
    ].filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
    for (const candidateName of candidateNames) {
      const normalizedName = normalizeCardName(candidateName);
      if (!normalizedName) continue;
      const existing = index.get(normalizedName);
      if (!existing || cardScore(cardData, rawCard?.layout) > cardScore(existing)) {
        index.set(normalizedName, cardData);
      }
    }
  }
  oracleIndexCache = index;
  return index;
}

function ensureAtomicIndex(): Map<string, LoadedCard> {
  if (atomicIndexCache) return atomicIndexCache;
  const atomicCardsPath = path.join(repoRoot, 'AtomicCards.json');
  const index = new Map<string, LoadedCard>();
  if (!fs.existsSync(atomicCardsPath)) {
    atomicIndexCache = index;
    return index;
  }
  const atomicCards = JSON.parse(fs.readFileSync(atomicCardsPath, 'utf8')) as {
    data?: Record<string, any[]>;
  };
  for (const [name, printings] of Object.entries(atomicCards.data || {})) {
    const bestPrinting = Array.isArray(printings)
      ? printings.find((printing) => printing?.text || printing?.type || printing?.manaCost) ?? printings[0]
      : undefined;
    if (!bestPrinting) continue;
    const normalizedName = normalizeCardName(name);
    const cardData = toAtomicCardData(name, bestPrinting);
    const existing = index.get(normalizedName);
    if (!existing || cardScore(cardData) > cardScore(existing)) {
      index.set(normalizedName, cardData);
    }
  }
  atomicIndexCache = index;
  return index;
}

export function resolveDeckCards(deckCards: string[]): { resolved: LoadedCard[]; unresolved: string[] } {
  const oracleIndex = ensureOracleIndex();
  const atomicIndex = ensureAtomicIndex();
  const resolved: LoadedCard[] = [];
  const unresolved = new Set<string>();
  for (const deckCard of deckCards) {
    const normalizedName = normalizeCardName(deckCard);
    const cardData = oracleIndex.get(normalizedName) ?? atomicIndex.get(normalizedName);
    if (!cardData) {
      unresolved.add(deckCard);
      continue;
    }
    resolved.push(cardData);
  }
  return {
    resolved,
    unresolved: [...unresolved].sort((left, right) => left.localeCompare(right)),
  };
}

function getOracleText(card: LoadedCard): string {
  return String(card.oracle_text || card.card_faces?.[0]?.oracle_text || '').toLowerCase();
}

function getTypeLine(card: LoadedCard): string {
  return String(card.type_line || card.card_faces?.[0]?.type_line || '').toLowerCase();
}

function hasPartner(card: LoadedCard): boolean {
  const oracleText = getOracleText(card);
  return oracleText.includes('partner') || oracleText.includes('friends forever');
}

function hasChooseBackground(card: LoadedCard): boolean {
  return getOracleText(card).includes('choose a background');
}

function isBackground(card: LoadedCard): boolean {
  return getTypeLine(card).includes('background');
}

export function instantiateDeckCards(cards: LoadedCard[], playerId: string): LoadedCard[] {
  return cards.map((card, index) => ({
    ...card,
    id: `${playerId}_${card.id || slugify(card.name)}_${index + 1}`,
    card_faces: Array.isArray(card.card_faces)
      ? card.card_faces.map((face: any) => ({ ...face }))
      : undefined,
    color_identity: Array.isArray(card.color_identity) ? card.color_identity.slice() : undefined,
    colors: Array.isArray(card.colors) ? card.colors.slice() : undefined,
  }));
}

export function selectCommanders(cards: LoadedCard[]): LoadedCard[] {
  const [firstCard, secondCard] = cards;
  if (!firstCard) return [];
  if (secondCard) {
    if (hasChooseBackground(firstCard) && isBackground(secondCard)) {
      return [firstCard, secondCard];
    }
    if (isBackground(firstCard) && hasChooseBackground(secondCard)) {
      return [firstCard, secondCard];
    }
    if (hasPartner(firstCard) && hasPartner(secondCard)) {
      return [firstCard, secondCard];
    }
  }
  return [firstCard];
}

export function stateSnapshot(game: any) {
  const state = (game?.state || {}) as any;
  const activePlayers = (state.players || [])
    .filter((player: any) => player && !(player.hasLost || player.eliminated || player.conceded || player.spectator || player.isSpectator))
    .map((player: any) => ({ id: player.id, life: player.life, hasLost: !!player.hasLost }));

  return {
    seq: Number(game?.seq || 0),
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    turnPlayer: state.turnPlayer,
    priority: state.priority,
    stackSize: Array.isArray(state.stack) ? state.stack.length : 0,
    gameOver: !!state.gameOver,
    winner: state.winner,
    activePlayers,
  };
}

export type PrepareLiveGameOptions = {
  gameId: string;
  seats: DeckSeatSpec[];
  /** Explicit seed; defaults to deriveLivePreconSeed(gameId). */
  seed?: number;
  /** Seed AI RNG from this seed (default true for self-play). */
  seedAI?: boolean;
};

/**
 * Build a multi-seat live game on the real engine.
 * Callers supply resolved card-name lists per seat (catalogue or text fixtures).
 */
export async function prepareLiveGame(options: PrepareLiveGameOptions): Promise<PreparedLiveGame> {
  const { gameId, seats } = options;
  if (!Array.isArray(seats) || seats.length < 2) {
    throw new Error('prepareLiveGame requires at least two seats');
  }

  const io = createNoopIo();
  const seed = Number.isFinite(options.seed) ? Number(options.seed) : deriveLivePreconSeed(gameId);
  if (options.seedAI !== false) {
    seedAIRandom(seed);
  }

  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  const existingPriorityTimer = priorityTimers.get(gameId as any);
  if (existingPriorityTimer) {
    clearTimeout(existingPriorityTimer);
    priorityTimers.delete(gameId as any);
  }
  await deleteGame(gameId);

  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  if (typeof game.seedRng === 'function') {
    game.seedRng(seed);
  } else {
    (game.state as any).rngSeed = seed;
    (game as any)._rngSeed = seed;
  }

  const actualPlayerIds: string[] = [];
  const joinedFixtures: JoinedDeckFixture[] = [];

  for (let index = 0; index < seats.length; index++) {
    const seat = seats[index];
    const settings: LiveSeatSettings = {
      aiStrategy: 'aggressive',
      difficulty: 0.5,
      brain: 'v0',
      playerName: seat.settings?.playerName || `AI ${index + 1}`,
      ...seat.settings,
    };
    const { resolved, unresolved } = resolveDeckCards(seat.cardNames);
    if (unresolved.length > 0) {
      throw new Error(`Unresolved cards in ${seat.deckId}: ${unresolved.slice(0, 8).join(', ')}`);
    }

    const joinResult = game.join(`socket_${gameId}_${index}`, settings.playerName!, false);
    const actualPlayerId = String(joinResult?.playerId || '');
    if (!actualPlayerId) throw new Error(`Join did not return a player id for ${settings.playerName}`);

    const player = (game.state.players || []).find((entry: any) => entry?.id === actualPlayerId) as any;
    if (!player) throw new Error(`Missing joined player ${actualPlayerId}`);
    player.isAI = true;
    player.aiStrategy = settings.aiStrategy || 'aggressive';
    player.difficulty = settings.difficulty ?? 0.5;
    if (settings.brain) player.aiBrain = settings.brain;

    const cards = instantiateDeckCards(resolved, actualPlayerId);
    const commanders = selectCommanders(cards);
    if (commanders.length === 0) {
      throw new Error(`No commander selected for ${seat.deckId}`);
    }

    game.importDeckResolved(actualPlayerId as any, cards as any);
    game.flagPendingOpeningDraw?.(actualPlayerId as any);
    game.setCommander(
      actualPlayerId as any,
      commanders.map((card) => card.name),
      commanders.map((card) => String(card.id)),
      commanders.flatMap((card) => card.color_identity || []),
    );

    registerAIPlayer(gameId, actualPlayerId as any, settings.playerName, settings.difficulty ?? 0.5);
    // Re-apply brain after registration (registerAIPlayer syncs strategy fields).
    const registered = (game.state.players || []).find((entry: any) => entry?.id === actualPlayerId) as any;
    if (registered && settings.brain) registered.aiBrain = settings.brain;

    actualPlayerIds.push(actualPlayerId);
    joinedFixtures.push({
      deckId: seat.deckId,
      playerId: `seat${index + 1}`,
      playerName: settings.playerName!,
      cards,
      commanders,
      actualPlayerId,
      settings,
    });
  }

  (game.state as any).phase = 'pre_game';
  (game.state as any).step = undefined;
  (game.state as any).turnPlayer = joinedFixtures[0].actualPlayerId;
  (game.state as any).priority = joinedFixtures[0].actualPlayerId;
  (game.state as any).activePlayer = joinedFixtures[0].actualPlayerId;
  (game.state as any).stack = [];

  broadcastGame(io as any, game as any, gameId);
  for (const fixture of joinedFixtures) {
    scheduleAIGameFlow(io as any, gameId, fixture.actualPlayerId as any, 0);
  }

  return { io, game, gameId, seed, actualPlayerIds, joinedFixtures };
}

export async function cleanupLiveGame(prepared: PreparedLiveGame): Promise<void> {
  for (const playerId of prepared.actualPlayerIds) {
    unregisterAIPlayer(prepared.gameId, playerId as any);
  }
  ResolutionQueueManager.removeQueue(prepared.gameId);
  const pendingPriorityTimer = priorityTimers.get(prepared.gameId as any);
  if (pendingPriorityTimer) {
    clearTimeout(pendingPriorityTimer);
    priorityTimers.delete(prepared.gameId as any);
  }
  games.delete(prepared.gameId as any);
  await deleteGame(prepared.gameId);
  seedAIRandom(null);
}

export async function advanceLiveGame(
  game: any,
  options: {
    maxTicks: number;
    tickMs: number;
    maxTurns: number;
    maxStagnantTicks: number;
    maxNoTurnAdvanceMs?: number;
    stopWhen?: (game: any) => boolean;
    label?: string;
    /** When true, turn-limit / stall become soft outcomes instead of throws. */
    softStop?: boolean;
  },
): Promise<{ endReason: 'win' | 'turn-limit' | 'stall' | 'loop-exhausted'; turns: number }> {
  let lastSeq = Number(game.seq || 0);
  let stagnantTicks = 0;
  let lastLoggedTurn = Number((game.state as any).turnNumber || 0);
  let lastTurnAdvanceElapsedMs = 0;
  const startedAt = process.hrtime.bigint();
  let endReason: 'win' | 'turn-limit' | 'stall' | 'loop-exhausted' = 'loop-exhausted';

  const maybeLogProgress = (reason: string) => {
    if (!LIVE_PRECON_PROGRESS_LOG) return;
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const snapshot = stateSnapshot(game);
    console.log(
      `[live-harness:${options.label || 'run'}] ${reason} | realMs=${Math.round(elapsedMs)} | turn=${snapshot.turnNumber} | seq=${snapshot.seq} | phase=${snapshot.phase} | step=${snapshot.step} | stack=${snapshot.stackSize} | active=${snapshot.activePlayers.map((player: any) => `${player.id}:${player.life}`).join(',')}`,
    );
  };

  maybeLogProgress('start');

  for (let tick = 0; tick < options.maxTicks; tick++) {
    if ((game.state as any).gameOver) {
      endReason = 'win';
      break;
    }

    await vi.advanceTimersByTimeAsync(options.tickMs);

    const simulatedElapsedMs = (tick + 1) * options.tickMs;
    const currentSeq = Number(game.seq || 0);
    const currentTurn = Number((game.state as any).turnNumber || 0);

    if (currentSeq === lastSeq) {
      stagnantTicks += 1;
    } else {
      stagnantTicks = 0;
      lastSeq = currentSeq;
    }

    if (currentTurn > lastLoggedTurn) {
      lastLoggedTurn = currentTurn;
      lastTurnAdvanceElapsedMs = simulatedElapsedMs;
      maybeLogProgress(`advanced-turn-${currentTurn}`);
    } else if (LIVE_PRECON_PROGRESS_LOG && tick > 0 && tick % 100 === 0) {
      maybeLogProgress(`heartbeat-${tick}`);
    }

    if (options.stopWhen?.(game)) {
      maybeLogProgress('stop-condition-met');
      endReason = (game.state as any).gameOver ? 'win' : endReason;
      break;
    }

    if (currentTurn > options.maxTurns) {
      maybeLogProgress('max-turns-exceeded');
      endReason = 'turn-limit';
      if (options.softStop) break;
      throw new Error(`Game exceeded ${options.maxTurns} turns without reaching the target: ${JSON.stringify(stateSnapshot(game))}`);
    }

    if (stagnantTicks >= options.maxStagnantTicks) {
      maybeLogProgress('stalled');
      endReason = 'stall';
      if (options.softStop) break;
      throw new Error(`Game stalled without state changes: ${JSON.stringify(stateSnapshot(game))}`);
    }

    if (
      options.maxNoTurnAdvanceMs
      && currentTurn > 0
      && simulatedElapsedMs - lastTurnAdvanceElapsedMs >= options.maxNoTurnAdvanceMs
    ) {
      maybeLogProgress('turn-stalled');
      endReason = 'stall';
      if (options.softStop) break;
      throw new Error(
        `Game stalled without advancing turns for ${options.maxNoTurnAdvanceMs}ms: ${JSON.stringify(stateSnapshot(game))}`,
      );
    }
  }

  if ((game.state as any).gameOver) endReason = 'win';
  maybeLogProgress((game.state as any).gameOver ? 'game-over' : 'finished-loop');
  return {
    endReason,
    turns: Number((game.state as any).turnNumber || 0),
  };
}

/** Expand "N Card Name" deck text lines for the legacy precon_json fixtures. */
export function expandDeckLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  const countMatch = trimmed.match(/^(\d+)\s+(.+)$/);
  if (!countMatch) return [trimmed];
  return Array.from({ length: Number(countMatch[1]) }, () => countMatch[2].trim());
}

export function readDeckFileNames(relativePath: string): string[] {
  const deckPath = path.join(repoRoot, relativePath);
  return fs
    .readFileSync(deckPath, 'utf8')
    .split(/\r?\n/)
    .flatMap(expandDeckLine)
    .filter(Boolean);
}

/** Kept for e2e assertions that relied on vitest expect inside prepare. */
export function assertCommandZone(game: any, playerId: string, commanderIds: string[]): void {
  const commandZone = (game.state.commandZone || {})[playerId] as any;
  expect(commandZone?.commanderIds || []).toEqual(commanderIds);
  expect(commandZone?.inCommandZone || []).toEqual(commanderIds);
}
