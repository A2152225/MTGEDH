import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { ensureGame, broadcastGame } from '../src/socket/util.js';
import { initializeAIResolutionHandler } from '../src/socket/resolution.js';
import { registerAIPlayer, scheduleAIGameFlow, unregisterAIPlayer } from '../src/socket/ai.js';
import { games, priorityTimers } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const DECK_FILES = [
  'precon_json/StopHittingYourself.txt',
  'precon_json/Myrel, Shield of Argive token deck.txt',
  'precon_json/Iroas-Boros.txt',
] as const;

type LoadedCard = {
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

type DeckFixture = {
  relativePath: string;
  playerId: string;
  playerName: string;
  cards: LoadedCard[];
  commanders: LoadedCard[];
};

type JoinedDeckFixture = DeckFixture & {
  actualPlayerId: string;
};

let oracleIndexCache: Map<string, LoadedCard> | null = null;
let atomicIndexCache: Map<string, LoadedCard> | null = null;

const RUN_SLOW_LIVE_PRECON_FINISH = process.env.RUN_SLOW_LIVE_PRECON_FINISH === '1';
const LIVE_PRECON_PROGRESS_LOG = process.env.LIVE_PRECON_PROGRESS_LOG === '1';
const LIVE_PRECON_ENV_SEED = Number(process.env.LIVE_PRECON_SEED);
const LIVE_PRECON_BASE_SEED = Number.isFinite(LIVE_PRECON_ENV_SEED) ? LIVE_PRECON_ENV_SEED : Date.now();
const LIVE_PRECON_REQUIRED_TURNS = Number(process.env.LIVE_PRECON_REQUIRED_TURNS || 10);
const LIVE_PRECON_FAST_TICK_MS = Number(process.env.LIVE_PRECON_FAST_TICK_MS || 5_000);
const LIVE_PRECON_FAST_MAX_TICKS = Number(process.env.LIVE_PRECON_FAST_MAX_TICKS || 300);
const LIVE_PRECON_FAST_MAX_TURNS = Number(process.env.LIVE_PRECON_FAST_MAX_TURNS || 25);
const LIVE_PRECON_FAST_TIMEOUT_MS = RUN_SLOW_LIVE_PRECON_FINISH ? 300_000 : 180_000;

function deriveLivePreconSeed(gameId: string): number {
  let hash = 0;
  for (const ch of gameId) {
    hash = ((hash * 31) + ch.charCodeAt(0)) | 0;
  }
  return (LIVE_PRECON_BASE_SEED + Math.abs(hash)) >>> 0;
}

function createNoopIo() {
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

function expandDeckLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const countMatch = trimmed.match(/^(\d+)\s+(.+)$/);
  if (!countMatch) return [trimmed];

  return Array.from({ length: Number(countMatch[1]) }, () => countMatch[2].trim());
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

  const oracleCardsPath = path.join(repoRoot, 'oracle-cards.json');
  const oracleCards = JSON.parse(fs.readFileSync(oracleCardsPath, 'utf8')) as any[];
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
  const atomicCards = JSON.parse(fs.readFileSync(atomicCardsPath, 'utf8')) as {
    data?: Record<string, any[]>;
  };
  const index = new Map<string, LoadedCard>();

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

function readDeckFile(relativePath: string): string[] {
  const deckPath = path.join(repoRoot, relativePath);
  return fs
    .readFileSync(deckPath, 'utf8')
    .split(/\r?\n/)
    .flatMap(expandDeckLine)
    .filter(Boolean);
}

function resolveDeckCards(deckCards: string[]): { resolved: LoadedCard[]; unresolved: string[] } {
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

function instantiateDeckCards(cards: LoadedCard[], playerId: string): LoadedCard[] {
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

function selectCommanders(cards: LoadedCard[]): LoadedCard[] {
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

function loadDeckFixtures(): DeckFixture[] {
  return DECK_FILES.map((relativePath, index) => {
    const rawCards = readDeckFile(relativePath);
    const { resolved, unresolved } = resolveDeckCards(rawCards);
    expect(unresolved, `${relativePath} contains unresolved cards`).toEqual([]);
    expect(resolved.length, `${relativePath} should resolve into a commander deck`).toBeGreaterThan(95);

    const playerId = `ai${index + 1}`;
    const cards = instantiateDeckCards(resolved, playerId);
    const commanders = selectCommanders(cards);

    expect(commanders.length, `${relativePath} should have at least one commander`).toBeGreaterThan(0);

    return {
      relativePath,
      playerId,
      playerName: path.basename(relativePath, '.txt'),
      cards,
      commanders,
    };
  });
}

function stateSnapshot(game: any) {
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

type PreparedLiveGame = {
  io: any;
  game: any;
  gameId: string;
  actualPlayerIds: string[];
  joinedFixtures: JoinedDeckFixture[];
};

function prepareLiveGame(gameId: string): PreparedLiveGame {
  const io = createNoopIo();
  const fixtures = loadDeckFixtures();
  const actualPlayerIds: string[] = [];
  const livePreconSeed = deriveLivePreconSeed(gameId);

  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  const existingPriorityTimer = priorityTimers.get(gameId as any);
  if (existingPriorityTimer) {
    clearTimeout(existingPriorityTimer);
    priorityTimers.delete(gameId as any);
  }

  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  console.log(
    `[precon-live] game=${gameId} rngSeed=${livePreconSeed}${Number.isFinite(LIVE_PRECON_ENV_SEED) ? ' (env override)' : ' (auto-generated)'}`,
  );

  if (typeof game.seedRng === 'function') {
    game.seedRng(livePreconSeed);
  } else {
    (game.state as any).rngSeed = livePreconSeed;
    (game as any)._rngSeed = livePreconSeed;
  }

  const joinedFixtures: JoinedDeckFixture[] = fixtures.map((fixture) => {
    const joinResult = game.join(`socket_${fixture.playerId}`, fixture.playerName, false);
    const actualPlayerId = String(joinResult?.playerId || '');
    if (!actualPlayerId) throw new Error(`Join did not return a player id for ${fixture.playerName}`);
    const player = (game.state.players || []).find((entry: any) => entry?.id === actualPlayerId) as any;
    if (!player) throw new Error(`Missing joined player ${actualPlayerId}`);
    player.isAI = true;
    player.aiStrategy = 'aggressive';
    player.difficulty = 0.5;

    game.importDeckResolved(actualPlayerId as any, fixture.cards as any);
    game.flagPendingOpeningDraw?.(actualPlayerId as any);
    game.setCommander(
      actualPlayerId as any,
      fixture.commanders.map((card) => card.name),
      fixture.commanders.map((card) => String(card.id)),
      fixture.commanders.flatMap((card) => card.color_identity || []),
    );

    registerAIPlayer(gameId, actualPlayerId as any, fixture.playerName);

    const commandZone = (game.state.commandZone || {})[actualPlayerId] as any;
    expect(commandZone?.commanderIds || []).toEqual(fixture.commanders.map((card) => card.id));
    expect(commandZone?.inCommandZone || []).toEqual(fixture.commanders.map((card) => card.id));
    actualPlayerIds.push(actualPlayerId);

    return {
      ...fixture,
      actualPlayerId,
    };
  });

  const stopDeckCommanders = (game.state.commandZone || {})[joinedFixtures[0].actualPlayerId] as any;
  expect(stopDeckCommanders?.commanderIds?.length).toBe(2);
  expect(stopDeckCommanders?.commanderNames).toEqual(joinedFixtures[0].commanders.map((card) => card.name));

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

  return { io, game, gameId, actualPlayerIds, joinedFixtures };
}

function cleanupLiveGame(prepared: PreparedLiveGame): void {
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
}

async function advanceLiveGame(
  game: any,
  options: {
    maxTicks: number;
    tickMs: number;
    maxTurns: number;
    maxStagnantTicks: number;
    maxNoTurnAdvanceMs?: number;
    stopWhen?: (game: any) => boolean;
    label?: string;
  },
): Promise<void> {
  let lastSeq = Number(game.seq || 0);
  let stagnantTicks = 0;
  let lastLoggedTurn = Number((game.state as any).turnNumber || 0);
  let lastTurnAdvanceElapsedMs = 0;
  const startedAt = process.hrtime.bigint();

  const maybeLogProgress = (reason: string) => {
    if (!LIVE_PRECON_PROGRESS_LOG) return;
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const snapshot = stateSnapshot(game);
    console.log(
      `[precon-live:${options.label || 'run'}] ${reason} | realMs=${Math.round(elapsedMs)} | turn=${snapshot.turnNumber} | seq=${snapshot.seq} | phase=${snapshot.phase} | step=${snapshot.step} | stack=${snapshot.stackSize} | active=${snapshot.activePlayers.map((player: any) => `${player.id}:${player.life}`).join(',')}`,
    );
  };

  maybeLogProgress('start');

  for (let tick = 0; tick < options.maxTicks; tick++) {
    if ((game.state as any).gameOver) break;

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
      break;
    }

    if (currentTurn > options.maxTurns) {
      maybeLogProgress('max-turns-exceeded');
      throw new Error(`Game exceeded ${options.maxTurns} turns without reaching the target: ${JSON.stringify(stateSnapshot(game))}`);
    }

    if (stagnantTicks >= options.maxStagnantTicks) {
      maybeLogProgress('stalled');
      throw new Error(`Game stalled without state changes: ${JSON.stringify(stateSnapshot(game))}`);
    }

    if (
      options.maxNoTurnAdvanceMs &&
      currentTurn > 0 &&
      simulatedElapsedMs - lastTurnAdvanceElapsedMs >= options.maxNoTurnAdvanceMs
    ) {
      maybeLogProgress('turn-stalled');
      throw new Error(
        `Game stalled without advancing turns for ${options.maxNoTurnAdvanceMs}ms: ${JSON.stringify(stateSnapshot(game))}`,
      );
    }
  }

  maybeLogProgress((game.state as any).gameOver ? 'game-over' : 'finished-loop');
}

describe('live server precon end-to-end', () => {
  beforeAll(async () => {
    await initDb();
    initializeAIResolutionHandler(createNoopIo() as any);
  });

  it('loads the three txt decks into the real server engine and advances multiple live turns without stalling', async () => {
    vi.useFakeTimers();
    const prepared = prepareLiveGame('precon_live_e2e_server_integration');

    try {
      const requiredTurns = LIVE_PRECON_REQUIRED_TURNS;

      await advanceLiveGame(prepared.game, {
        maxTicks: LIVE_PRECON_FAST_MAX_TICKS,
        tickMs: LIVE_PRECON_FAST_TICK_MS,
        maxTurns: LIVE_PRECON_FAST_MAX_TURNS,
        maxStagnantTicks: 6,
        stopWhen: (game) => Number((game.state as any).turnNumber || 0) >= requiredTurns,
        label: 'fast',
      });

      const turnNumber = Number((prepared.game.state as any).turnNumber || 0);
      const gameOver = Boolean((prepared.game.state as any).gameOver);

      expect(gameOver || turnNumber >= requiredTurns).toBe(true);
      expect(String((prepared.game.state as any).phase || '').toLowerCase()).not.toBe('pre_game');

      const zones = (prepared.game.state as any).zones || {};
      const battlefieldCount = Array.isArray((prepared.game.state as any).battlefield) ? (prepared.game.state as any).battlefield.length : 0;
      const anyLifeChange = ((prepared.game.state as any).players || []).some((player: any) => typeof player?.life === 'number' && player.life !== 40);
      const anyCardsLeftHand = Object.values(zones).some((zone: any) => {
        const handCount = typeof zone?.handCount === 'number' ? zone.handCount : Array.isArray(zone?.hand) ? zone.hand.length : 0;
        return handCount !== 7;
      });

      expect(battlefieldCount > 0 || anyLifeChange || anyCardsLeftHand).toBe(true);
    } finally {
      cleanupLiveGame(prepared);
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  }, LIVE_PRECON_FAST_TIMEOUT_MS);

  const slowIt = RUN_SLOW_LIVE_PRECON_FINISH ? it : it.skip;
  slowIt('finishes the three txt decks through the real server engine', async () => {
    vi.useFakeTimers();
    const prepared = prepareLiveGame('precon_live_e2e_server_full_finish');

    try {
      await advanceLiveGame(prepared.game, {
        maxTicks: 5000,
        tickMs: 30_000,
        maxTurns: 250,
        maxStagnantTicks: 12,
        maxNoTurnAdvanceMs: 300_000,
        label: 'slow-finish',
      });

      if (!(prepared.game.state as any).gameOver) {
        throw new Error(`Live game did not finish before the slow-test bound: ${JSON.stringify(stateSnapshot(prepared.game))}`);
      }

      expect(String((prepared.game.state as any).winner || '')).not.toBe('');
      const gameOverEvent = prepared.io.emitted.find((entry: any) => entry.event === 'gameOver');
      expect(
        gameOverEvent ||
          (prepared.game.state as any).winCondition ||
          (prepared.game.state as any).winReason ||
          (prepared.game.state as any).gameOver,
      ).toBeTruthy();
    } finally {
      cleanupLiveGame(prepared);
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  }, 900000);
});