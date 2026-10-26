/**
 * Origin parent: server/src/socket/ai-handlers/aiRegisterHandlers.ts
 *
 * Cluster moved: join + deck load + persist + register used when adding an
 * AI opponent to an already-created game during pre-game (addAIToGame).
 *
 * Public entry symbols: MAX_TOTAL_AI_TABLE_SEATS, addAIOpponentToExistingGame.
 * Leaf must not import ai.ts or ai-handlers/index.ts.
 */
import { randomBytes } from "crypto";
import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { getDeck } from "../../db/decks.js";
import { parseDecklist } from "../../services/scryfall.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { broadcastGame } from "../util.js";
import { AI_THINK_TIME_MS } from "./aiConstants.js";
import { handleAIGameFlow } from "./aiGameFlowHandlers.js";
import { persistAIPlayerDeckSource, resolveAIDeckEntries } from "./aiPregameHandlers.js";
import { registerAIPlayer } from "./aiPlayerRegistry.js";
import { joinAiPlayerSeat } from "../join-handlers/playerSeatIds.js";

/** Matches CreateGameModal: 9 AI seats + the host. */
export const MAX_TOTAL_AI_TABLE_SEATS = 10;

export type AddAIOpponentToGameConfig = {
  aiName?: unknown;
  aiDifficulty?: unknown;
  aiDeckId?: unknown;
  aiDeckText?: unknown;
  aiDeckName?: unknown;
};

export type AddAIOpponentToGameResult =
  | {
      ok: true;
      aiPlayerId: string;
      aiName: string;
      strategy: string;
      difficulty: number;
      deckLoaded: boolean;
      deckName?: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

function isPreGamePhase(game: any): boolean {
  const phaseStr = String(game?.state?.phase || "").toUpperCase().trim().replace(/[-\s]/g, "_");
  return phaseStr === "" || phaseStr === "PRE_GAME" || phaseStr === "PREGAME";
}

function getActivePlayers(game: any): any[] {
  return (game?.state?.players || []).filter(
    (p: any) => p && !p.spectator && !p.isSpectator,
  );
}

function allPlayersKeptHands(game: any): boolean {
  const mulliganState = (game?.state as any)?.mulliganState || {};
  const active = getActivePlayers(game);
  if (active.length === 0) return false;
  for (const player of active) {
    const playerMulliganState = mulliganState[player.id];
    if (!playerMulliganState?.hasKeptHand) return false;
    if (Number(playerMulliganState.pendingBottomCount || 0) > 0) return false;
  }
  return true;
}

function uniquifyPlayerName(game: any, requested: string): string {
  const taken = new Set(
    getActivePlayers(game)
      .map((p: any) => String(p?.name || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const base = requested.trim() || "AI Opponent";
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

function rejectAddAI(game: any): AddAIOpponentToGameResult | null {
  if (!isPreGamePhase(game) || (game.state as any)?._pregameAutoStartInProgress) {
    return {
      ok: false,
      code: "AI_NOT_PREGAME",
      message: "AI opponents can only be added during pre-game, before the game starts.",
    };
  }
  if (allPlayersKeptHands(game)) {
    return {
      ok: false,
      code: "AI_HANDS_LOCKED",
      message: "Cannot add AI after every player has kept their hand. Unlock a hand first, or add AI before the table is ready.",
    };
  }
  if (getActivePlayers(game).length >= MAX_TOTAL_AI_TABLE_SEATS) {
    return {
      ok: false,
      code: "AI_TABLE_FULL",
      message: `Table is full (${MAX_TOTAL_AI_TABLE_SEATS} seats).`,
    };
  }
  return null;
}

async function loadAndImportAIDeck(options: {
  game: any;
  gameId: string;
  aiPlayerId: string;
  aiName: string;
  playerInState: any;
  aiDeckId?: unknown;
  aiDeckText?: unknown;
  aiDeckName?: unknown;
}): Promise<{ deckLoaded: boolean; deckName?: string }> {
  const {
    game,
    gameId,
    aiPlayerId,
    aiName,
    playerInState,
    aiDeckId,
    aiDeckText,
    aiDeckName,
  } = options;

  let deckEntries: Array<{ name: string; count: number }> = [];
  let finalDeckName: string | undefined;
  const importedDeckId = typeof aiDeckText === "string" && aiDeckText.trim()
    ? `imported_${Date.now().toString(36)}`
    : null;

  if (typeof aiDeckText === "string" && aiDeckText.trim()) {
    try {
      deckEntries = parseDecklist(aiDeckText);
      finalDeckName = (typeof aiDeckName === "string" && aiDeckName.trim())
        ? aiDeckName
        : "Imported Deck";
      debug(1, "[AI] Using imported deck text:", { deckName: finalDeckName, entryCount: deckEntries.length });
    } catch (e) {
      debugWarn(1, "[AI] Failed to parse deck text:", e);
    }
  } else if (typeof aiDeckId === "string" && aiDeckId.trim()) {
    try {
      const deck = getDeck(aiDeckId);
      if (deck && deck.entries && deck.entries.length > 0) {
        deckEntries = deck.entries;
        finalDeckName = deck.name;
        debug(1, "[AI] Loading deck for AI:", { deckId: aiDeckId, deckName: deck.name });
      } else {
        debugWarn(1, "[AI] Deck not found:", { deckId: aiDeckId });
      }
    } catch (e) {
      debugError(1, "[AI] Error loading deck for AI:", { deckId: aiDeckId, error: e });
    }
  }

  persistAIPlayerDeckSource(playerInState, {
    deckName: finalDeckName,
    deckId: (typeof aiDeckId === "string" && aiDeckId.trim()) ? aiDeckId.trim() : importedDeckId,
    deckText: typeof aiDeckText === "string" ? aiDeckText : undefined,
  });

  if (deckEntries.length === 0) {
    return { deckLoaded: false, deckName: finalDeckName };
  }

  let resolution: Awaited<ReturnType<typeof resolveAIDeckEntries>>;
  try {
    resolution = await resolveAIDeckEntries(deckEntries, {
      gameId,
      playerId: aiPlayerId as any,
      deckName: finalDeckName,
      logPrefix: `[AI] Loading AI deck for ${aiName}`,
    });
  } catch (e) {
    debugWarn(1, "[AI] Failed to resolve AI deck:", e);
    return { deckLoaded: false, deckName: finalDeckName };
  }

  const resolvedCards = resolution.resolvedCards;
  if (resolvedCards.length === 0) {
    debugWarn(1, "[AI] No cards resolved for AI deck:", { aiName, deckName: finalDeckName });
    return { deckLoaded: false, deckName: finalDeckName };
  }

  if (typeof (game as any).importDeckResolved === "function") {
    (game as any).importDeckResolved(aiPlayerId, resolvedCards);
    try {
      await appendEvent(gameId, (game as any).seq || 0, "deckImportResolved", {
        playerId: aiPlayerId,
        cards: resolvedCards,
      });
    } catch (e) {
      debugWarn(1, "[AI] Failed to persist deckImportResolved event:", e);
    }
  } else {
    debugWarn(2, "[AI] importDeckResolved not available, using fallback zone initialization");
    game.state.zones = game.state.zones || {};
    (game.state.zones as any)[aiPlayerId] = {
      hand: [],
      handCount: 0,
      libraryCount: resolvedCards.length,
      graveyard: [],
      graveyardCount: 0,
    };
  }

  return { deckLoaded: true, deckName: finalDeckName };
}

/**
 * Join an AI opponent into an existing pre-game table, optionally load a deck,
 * persist the join for replay, and kick off commander/hand flow.
 */
export async function addAIOpponentToExistingGame(
  io: Server,
  game: any,
  gameId: string,
  config: AddAIOpponentToGameConfig,
): Promise<AddAIOpponentToGameResult> {
  const blocked = rejectAddAI(game);
  if (blocked) return blocked;

  const difficulty = typeof config.aiDifficulty === "number" && Number.isFinite(config.aiDifficulty)
    ? Math.min(1, Math.max(0, config.aiDifficulty))
    : 0.5;
  const requestedName = typeof config.aiName === "string" && config.aiName.trim()
    ? config.aiName.trim()
    : "AI Opponent";
  const aiDisplayName = uniquifyPlayerName(game, requestedName);

  game.state = (game.state || {}) as any;
  game.state.players = game.state.players || [];

  const joinedAi = joinAiPlayerSeat(game, aiDisplayName);
  const aiPlayerId = joinedAi.playerId;
  debug(1, "[AI] AI player joined game via game.join():", { aiPlayerId, aiName: aiDisplayName });

  let playerInState = game.state.players.find((p: any) => p.id === aiPlayerId);
  if (!playerInState) {
    const startingLife = (game.state as any).startingLife || 40;
    playerInState = {
      id: aiPlayerId,
      name: aiDisplayName,
      life: startingLife,
      isAI: true,
      difficulty,
    };
    game.state.players.push(playerInState);
    game.state.zones = game.state.zones || {};
    if (!(game.state.zones as any)[aiPlayerId]) {
      (game.state.zones as any)[aiPlayerId] = {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
      };
    }
    try {
      const life = (game as any).life || (game.state as any).life;
      if (life && typeof life === "object") life[aiPlayerId] = startingLife;
    } catch {
      /* best-effort */
    }
  }

  playerInState.isAI = true;
  playerInState.difficulty = difficulty;
  playerInState.name = aiDisplayName;

  const { deckLoaded, deckName } = await loadAndImportAIDeck({
    game,
    gameId,
    aiPlayerId,
    aiName: aiDisplayName,
    playerInState,
    aiDeckId: config.aiDeckId,
    aiDeckText: config.aiDeckText,
    aiDeckName: config.aiDeckName,
  });

  const strategy = registerAIPlayer(gameId, aiPlayerId, aiDisplayName, difficulty);

  try {
    const seatToken = joinedAi.seatToken || `ai_token_${randomBytes(6).toString("hex")}`;
    await appendEvent(gameId, (game as any).seq || 0, "join", {
      playerId: aiPlayerId,
      name: aiDisplayName,
      seatToken,
      spectator: false,
      isAI: true,
      strategy,
      deckId: playerInState?.deckId || config.aiDeckId,
      deckName: playerInState?.deckName,
      deckText: playerInState?.deckText,
      deckLoaded,
    });
  } catch (e) {
    debugWarn(1, "[AI] Failed to persist AI join event:", e);
  }

  try {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${aiDisplayName} joined as an AI opponent.`,
      ts: Date.now(),
    });
  } catch {
    /* best-effort */
  }

  broadcastGame(io, game, gameId);

  if (deckLoaded) {
    setTimeout(async () => {
      try {
        await handleAIGameFlow(io, gameId, aiPlayerId);
      } catch (e) {
        debugError(1, "[AI] Error in AI game flow after adding opponent:", e);
      }
    }, AI_THINK_TIME_MS);
  }

  return {
    ok: true,
    aiPlayerId,
    aiName: aiDisplayName,
    strategy,
    difficulty,
    deckLoaded,
    deckName: deckLoaded ? (playerInState?.deckName || deckName) : undefined,
  };
}
