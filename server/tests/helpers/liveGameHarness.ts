/**
 * Headless live-game helpers for AI self-play and precon e2e.
 *
 * Origin: AI_Upgrade Phase 0-1 (P0-3), extracted from precon-live-e2e.integration.test.ts.
 * Public entry symbols: createNoopIo, deriveLivePreconSeed, resolveDeckCards,
 * instantiateDeckCards, selectCommanders, stateSnapshot, prepareLiveGame,
 * advanceLiveGame, cleanupLiveGame, logPosition, LiveSeatSettings, PreparedLiveGame,
 * LoadedCard, DeckSeatSpec.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as realSetTimeout, clearTimeout as realClearTimeout } from 'node:timers';
import { expect, vi } from 'vitest';
import { createGameIfNotExists, deleteGame } from '../../src/db/index.js';
import { formatTurnStallDiagnostics } from './selfplayStallTurnDiagnostics.js';
import { GameManager } from '../../src/GameManager.js';
import { ensureGame, broadcastGame } from '../../src/socket/util.js';
import { cleanupGameAI, registerAIPlayer, scheduleAIGameFlow, unregisterAIPlayer } from '../../src/socket/ai.js';
import { aiActionDebugStage, aiPlayers } from '../../src/socket/ai-handlers/aiScheduler.js';
import { formatAIStallDiagnostics, resetAIStallDiagnostics } from '../../src/socket/ai-handlers/aiStallDiagnostics.js';
import { startEventLoopLagMonitor, startStallCpuProfile, stopStallCpuProfile } from './stallTickCpuProfile.js';
import { games, priorityTimers } from '../../src/socket/socket.js';
import { ResolutionQueueManager } from '../../src/state/resolution/index.js';
import { readOracleCardsSync } from '../../src/services/oracleCardsIndex.js';
import { seedAIRandom } from '../../../rules-engine/src/aiRandom.js';
import { buildObservation } from '../../../rules-engine/src/ai/buildObservation.js';
import { seatFeatures } from '../../../rules-engine/src/ai/evaluatorFeatures.js';

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

function logTickTimeoutBoard(game: any, label?: string, reason = 'tick-timeout'): void {
  const state = (game?.state || {}) as any;
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const counts = new Map<string, number>();
  for (const perm of battlefield) {
    const name = String(perm?.card?.name || perm?.name || '?');
    const marker = perm?.isToken ? 'token' : 'card';
    const key = `${name} (${marker})`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const board = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 16)
    .map(([name, count]) => `${count}x ${name}`)
    .join(', ');
  const stack = (Array.isArray(state.stack) ? state.stack : [])
    .slice(-4)
    .map((item: any) => String(item?.sourceName || item?.card?.name || item?.description || item?.type || '?'))
    .join(' > ');
  let queue = '';
  if (label) {
    try {
      const steps = ResolutionQueueManager.getQueue(label)?.steps || [];
      queue = steps.slice(0, 4).map((step: any) => `${step?.type || '?'}:${String(step?.sourceName || step?.description || '').slice(0, 80)}@${step?.playerId || '?'}(${step?.status || 'pending'})`).join(' | ');
    } catch {
      queue = '';
    }
  }
  const stages: string[] = [];
  if (label) {
    for (const [key, stage] of aiActionDebugStage) {
      if (String(key).startsWith(`${label}:`)) stages.push(`${String(key).slice(label.length + 1)}=${stage}`);
    }
  }
  const hands = (state.players || []).map((player: any) => {
    const hand = state.zones?.[player.id]?.hand;
    return `${player.id}:${Array.isArray(hand) ? hand.length : '?'}`;
  }).join(',');
  const players = (state.players || [])
    .map((player: any) => `${player.id}:${player.life}${player.hasLost || player.eliminated ? ':out' : ''}`)
    .join(',');
  const pendingCasts = Object.values(state.pendingSpellCasts || {})
    .map((cast: any) => `${String(cast?.card?.name || cast?.cardName || '?')}@${cast?.playerId || '?'}`)
    .join(',');
  console.log(
    `[selfplay-stall] ${reason} turn=${state.turnNumber} phase=${state.phase} step=${state.step} priority=${state.priority} turnPlayer=${state.turnPlayer} seq=${Number(game?.seq || 0)} bf=${battlefield.length} stack=${Array.isArray(state.stack) ? state.stack.length : 0} [${stack}] queue=[${queue}] pendingCasts=[${pendingCasts}] players=${players} hands=${hands} board=[${board}] ai=[${stages.join('; ')}]`,
  );
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

  // Tear down any leftover process-global AI / GameManager state for this id before
  // recreate — prevents a timed-out prior shard from resurrecting via ensureGame.
  cleanupGameAI(gameId);
  ResolutionQueueManager.removeQueue(gameId);
  try {
    GameManager.deleteGame(gameId);
  } catch {
    // best-effort
  }
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
    // Self-play / harness: skip human-feel think delay so fake-timer runs are not padded
    // 500ms per makeDecision (activate/response scans in UPKEEP multiply that cost).
    const aiConfig = aiPlayers.get(gameId)?.get(actualPlayerId as any);
    if (aiConfig) aiConfig.thinkTime = 0;
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
  const gameId = prepared.gameId;
  // Cancel scheduled AI timers first so they cannot fire into the next test's fake clock.
  cleanupGameAI(gameId);
  for (const playerId of prepared.actualPlayerIds) {
    try {
      unregisterAIPlayer(gameId, playerId as any);
    } catch {
      // already cleared by cleanupGameAI
    }
  }
  ResolutionQueueManager.removeQueue(gameId);
  const pendingPriorityTimer = priorityTimers.get(gameId as any);
  if (pendingPriorityTimer) {
    clearTimeout(pendingPriorityTimer);
    priorityTimers.delete(gameId as any);
  }
  try {
    GameManager.deleteGame(gameId);
  } catch {
    // best-effort
  }
  games.delete(gameId as any);
  await deleteGame(gameId);
  seedAIRandom(null);
}

async function withWallClockTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof realSetTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = realSetTimeout(() => reject(new Error(`wall-clock timeout after ${ms}ms (${label})`)), ms);
      }),
    ]);
  } finally {
    if (timer) realClearTimeout(timer);
  }
}

const isPositionGone = (p: any): boolean =>
  Boolean(p?.hasLost || p?.eliminated || p?.conceded || p?.spectator || p?.isSpectator || p?.inactive);

/**
 * Append one feature row per turn start when AI_POSITIONS_FILE is set (P1-2).
 * Off by default; read-only on game state. AI_POSITIONS_VERIFY asserts every live
 * seat's Observation yields identical features (public-only check).
 */
export function logPosition(game: any, gameId: string): void {
  const file = process.env.AI_POSITIONS_FILE;
  if (!file || !gameId) return;
  const state = game.state as any;
  const active = String(state.turnPlayer || state.activePlayer || '');
  if (!active) return;
  const features = seatFeatures(buildObservation(state, active));
  if (process.env.AI_POSITIONS_VERIFY) {
    for (const p of state.players || []) {
      if (isPositionGone(p)) continue;
      assert.deepStrictEqual(
        seatFeatures(buildObservation(state, String(p.id))),
        features,
        `seatFeatures mismatch for observer ${p.id} vs active ${active}`,
      );
    }
  }
  const eliminated = (state.players || []).filter(isPositionGone).map((p: any) => String(p.id));
  fs.appendFileSync(
    file,
    `${JSON.stringify({
      v: 1,
      gameId,
      turn: Number(state.turnNumber || 0),
      activeSeat: active,
      features,
      eliminated,
    })}\n`,
  );
}

export async function advanceLiveGame(
  game: any,
  options: {
    maxTicks: number;
    tickMs: number;
    maxTurns: number;
    maxStagnantTicks: number;
    maxNoTurnAdvanceMs?: number;
    /** Real wall-clock budget for the whole advance loop (not faked). */
    maxWallClockMs?: number;
    /** Real wall-clock budget for a single timer tick (catches hung AI promises). */
    maxTickWallClockMs?: number;
    /** Minimum real elapsed ms before stagnantTicks can end the game (fake-timer safe). */
    minStagnantWallMs?: number;
    stopWhen?: (game: any) => boolean;
    label?: string;
    /** When true, turn-limit / stall become soft outcomes instead of throws. */
    softStop?: boolean;
    /**
     * Abort to stop the loop immediately (vitest timeout / harness finally).
     * Prevents a timed-out shard from keeping fake timers / AI schedules alive
     * into the next test in the same worker.
     */
    signal?: AbortSignal;
  },
): Promise<{
  endReason: 'win' | 'turn-limit' | 'stall' | 'loop-exhausted' | 'aborted';
  turns: number;
  /** Set when endReason is stall: wall-clock | tick-timeout | stagnant | turn-stalled. */
  stallReason?: 'wall-clock' | 'tick-timeout' | 'stagnant' | 'turn-stalled';
}> {
  let lastSeq = Number(game.seq || 0);
  let stagnantTicks = 0;
  let lastLoggedTurn = Number((game.state as any).turnNumber || 0);
  let lastTurnAdvanceElapsedMs = 0;
  let lastTurnAdvanceWallMs = 0;
  let lastProgressStamp = '';
  let stallReason: 'wall-clock' | 'tick-timeout' | 'stagnant' | 'turn-stalled' | undefined;
  /** Wall ms spent with stack/resolution busy since last turn advance (paused, not reset). */
  let turnStallPausedAccumMs = 0;
  let turnStallBusyStartedWallMs: number | null = null;
  // Prefer real wall clock. Callers under vitest must not fake hrtime (see ai-selfplay harness
  // useFakeTimers toFake list). process.hrtime.bigint is used directly so maxNoTurnAdvanceMs /
  // minStagnantWallMs / maxWallClockMs measure real elapsed time, not simulated tick time.
  const startedAt = process.hrtime.bigint();
  let endReason: 'win' | 'turn-limit' | 'stall' | 'loop-exhausted' | 'aborted' = 'loop-exhausted';

  const wallMs = () => Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const isAborted = () => Boolean(options.signal?.aborted);
  const progressStampOf = () => {
    const st = (game.state || {}) as any;
    // Step only. A MAIN1 cast loop changes the board and seq without leaving the
    // step; counting that as progress reopened the 10–20min false-progress stalls.
    return `${st.turnNumber}|${st.phase}|${st.step}`;
  };
  const resetTurnStallClock = () => {
    lastTurnAdvanceWallMs = wallMs();
    turnStallPausedAccumMs = 0;
    turnStallBusyStartedWallMs = null;
  };

  const maybeLogProgress = (reason: string) => {
    if (!LIVE_PRECON_PROGRESS_LOG) return;
    const snapshot = stateSnapshot(game);
    console.log(
      `[live-harness:${options.label || 'run'}] ${reason} | realMs=${Math.round(wallMs())} | turn=${snapshot.turnNumber} | seq=${snapshot.seq} | phase=${snapshot.phase} | step=${snapshot.step} | stack=${snapshot.stackSize} | active=${snapshot.activePlayers.map((player: any) => `${player.id}:${player.life}`).join(',')}`,
    );
  };

  maybeLogProgress('start');
  // Position log for the starting turn (P1-2); subsequent turns log on advance.
  if (options.label) logPosition(game, options.label);

  // Stall diagnosis: per-tick scheduler counters and event-loop lag are always on (cheap);
  // the CPU profile only runs with AI_SELFPLAY_STALL_PROFILE=1.
  const lagMonitor = startEventLoopLagMonitor();
  await startStallCpuProfile();

  for (let tick = 0; tick < options.maxTicks; tick++) {
    if (isAborted()) {
      maybeLogProgress('aborted');
      endReason = 'aborted';
      break;
    }

    if ((game.state as any).gameOver) {
      endReason = 'win';
      break;
    }

    if (options.maxWallClockMs && wallMs() >= options.maxWallClockMs) {
      logTickTimeoutBoard(game, options.label, 'wall-clock');
      console.log(`[selfplay-stall] wall-clock diag gameRealMs=${Math.round(wallMs())} lastTick: ${formatAIStallDiagnostics()}`);
      maybeLogProgress('wall-clock-exceeded');
      stallReason = 'wall-clock';
      endReason = 'stall';
      if (options.softStop) break;
      throw new Error(`Game exceeded wall-clock budget ${options.maxWallClockMs}ms`);
    }

    const tickStartedWallMs = wallMs();
    const seqAtTickStart = Number(game.seq || 0);
    resetAIStallDiagnostics();
    lagMonitor.reset();
    try {
      const tickAdvance = vi.advanceTimersByTimeAsync(options.tickMs);
      if (options.maxTickWallClockMs && options.maxTickWallClockMs > 0) {
        await withWallClockTimeout(tickAdvance, options.maxTickWallClockMs, `tick=${tick}`);
      } else {
        await tickAdvance;
      }
    } catch (err) {
      const tickRealMs = wallMs() - tickStartedWallMs;
      const lag = lagMonitor.read();
      const diagnostics = formatAIStallDiagnostics();
      const seqDelta = Number(game.seq || 0) - seqAtTickStart;
      const profileHeadline = await stopStallCpuProfile({ label: options.label || 'run', windowMs: tickRealMs });
      lagMonitor.stop();
      logTickTimeoutBoard(game, options.label);
      console.log(
        `[selfplay-stall] tick-timeout diag tick=${tick} tickRealMs=${Math.round(tickRealMs)} gameRealMs=${Math.round(wallMs())} seqDelta=${seqDelta} maxLoopLagMs=${Math.round(lag.maxLagMs)} loopBeats=${lag.beats} ${diagnostics}`,
      );
      if (profileHeadline) console.log(`[selfplay-stall] tick-timeout profile ${profileHeadline}`);
      maybeLogProgress(`tick-timeout:${String(err).slice(0, 80)}`);
      stallReason = 'tick-timeout';
      endReason = 'stall';
      if (options.softStop) break;
      throw err;
    }

    if (isAborted()) {
      maybeLogProgress('aborted');
      endReason = 'aborted';
      break;
    }

    const simulatedElapsedMs = (tick + 1) * options.tickMs;
    const currentSeq = Number(game.seq || 0);
    const currentTurn = Number((game.state as any).turnNumber || 0);

    if (currentSeq === lastSeq) {
      stagnantTicks += 1;
    } else {
      stagnantTicks = 0;
      lastSeq = currentSeq;
    }

    const progressStamp = progressStampOf();
    if (progressStamp !== lastProgressStamp) {
      lastProgressStamp = progressStamp;
      // Step changed inside this turn. Seq-only priority ping-pong and a MAIN1
      // cast loop stay on the same step and still turn-stall. Resetting per step
      // keeps a slow turn's earlier steps from eating the 180s budget.
      resetTurnStallClock();
    }

    if (currentTurn > lastLoggedTurn) {
      lastLoggedTurn = currentTurn;
      lastTurnAdvanceElapsedMs = simulatedElapsedMs;
      resetTurnStallClock();
      if (options.label) logPosition(game, options.label);
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

    // With fake timers, ticks can race in <1ms of wall time. Require some real
    // elapsed time before treating "no seq change" as a stall, or pregame/mulligan
    // false-stalls at turn 0–1 in a few hundred ms.
    const minStagnantWallMs = options.minStagnantWallMs ?? 5_000;
    if (stagnantTicks >= options.maxStagnantTicks && wallMs() >= minStagnantWallMs) {
      logTickTimeoutBoard(game, options.label, 'stagnant');
      console.log(`[selfplay-stall] stagnant diag stagnantTicks=${stagnantTicks} gameRealMs=${Math.round(wallMs())} lastTick: ${formatAIStallDiagnostics()}`);
      maybeLogProgress('stalled');
      stallReason = 'stagnant';
      endReason = 'stall';
      if (options.softStop) break;
      throw new Error(`Game stalled without state changes: ${JSON.stringify(stateSnapshot(game))}`);
    }

    // Use wall clock, not simulated ms: under fake timers simulated time races ahead
    // while wall time stays small, which false-stalled many games at turn 1.
    // Pause (don't reset) the turn-stall clock while stack/resolution is busy so a storm
    // can drain without false-stall — but intermittent MAIN1 cast→stack flickers must not
    // refresh the watermark forever (that produced 10–20min wall-clock "stalls").
    // Self-play passes gameId as options.label.
    const stackBusy = Array.isArray((game.state as any)?.stack) && (game.state as any).stack.length > 0;
    let resolutionBusy = false;
    if (options.label) {
      try {
        const q = ResolutionQueueManager.getQueue(options.label);
        resolutionBusy = Boolean(q && Array.isArray(q.steps) && q.steps.length > 0);
      } catch {
        resolutionBusy = false;
      }
    }
    const engineBusy = stackBusy || resolutionBusy;
    const nowWall = wallMs();
    if (engineBusy) {
      if (turnStallBusyStartedWallMs == null) turnStallBusyStartedWallMs = nowWall;
    } else if (turnStallBusyStartedWallMs != null) {
      turnStallPausedAccumMs += nowWall - turnStallBusyStartedWallMs;
      turnStallBusyStartedWallMs = null;
    }
    const busyPauseNow =
      turnStallBusyStartedWallMs != null ? nowWall - turnStallBusyStartedWallMs : 0;
    const idleSinceTurnMs =
      nowWall - lastTurnAdvanceWallMs - turnStallPausedAccumMs - busyPauseNow;
    if (
      options.maxNoTurnAdvanceMs
      && currentTurn > 0
      && !engineBusy
      && idleSinceTurnMs >= options.maxNoTurnAdvanceMs
    ) {
      logTickTimeoutBoard(game, options.label, 'turn-stalled');
      console.log(`[selfplay-stall] turn-stalled diag gameRealMs=${Math.round(wallMs())} lastTick: ${formatAIStallDiagnostics()}`);
      console.log(`[selfplay-stall] turn-stalled combat ${formatTurnStallDiagnostics(game, options.label)}`);
      maybeLogProgress('turn-stalled');
      stallReason = 'turn-stalled';
      endReason = 'stall';
      if (options.softStop) break;
      throw new Error(
        `Game stalled without advancing turns for ${options.maxNoTurnAdvanceMs}ms wall-clock: ${JSON.stringify(stateSnapshot(game))}`,
      );
    }
  }

  lagMonitor.stop();
  await stopStallCpuProfile();
  if ((game.state as any).gameOver) endReason = 'win';
  maybeLogProgress((game.state as any).gameOver ? 'game-over' : 'finished-loop');
  return {
    endReason,
    turns: Number((game.state as any).turnNumber || 0),
    stallReason,
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
