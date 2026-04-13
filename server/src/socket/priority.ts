import type { Server, Socket } from "socket.io";
import { canAct, canRespond } from "../state/modules/can-respond.js";
import { debug, debugError } from "../utils/debug.js";
import { broadcastGame, clearPriorityTimer, ensureGame, schedulePriorityTimeout } from "./util";

export function registerPriorityHandlers(io: Server, socket: Socket) {
  function ensureInRoomAndSeated(gameId: string) {
    if (!gameId || typeof gameId !== 'string') return null;

    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return null;
    }

    const pid = socket.data.playerId as string | undefined;
    if (!pid) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return null;
    }

    if ((socket.data as any)?.spectator || (socket.data as any)?.isSpectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return null;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit?.('error', { code: 'GAME_NOT_FOUND', message: 'Game not found.' });
      return null;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
    const seatIsSpectator = !!(seated && ((seated as any).spectator || (seated as any).isSpectator));
    if (!seated || seatIsSpectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return null;
    }

    return { game, pid };
  }

  function rerunAutoPassEvaluation(gameId: string, game: any) {
    broadcastGame(io as any, game, gameId);
  }

  function emitIgnoredCardsUpdated(gameId: string, playerId: string, ignoredCards: Record<string, any> | undefined) {
    const entries = ignoredCards && typeof ignoredCards === 'object'
      ? Object.entries(ignoredCards)
      : [];
    const ignoredList = entries.map(([id, data]: [string, any]) => ({
      permanentId: data?.permanentId || id,
      cardId: data?.cardId || id,
      cardName: data?.cardName,
      imageUrl: data?.imageUrl,
      zone: data?.zone || 'battlefield',
    }));

    socket.emit("ignoredCardsUpdated" as any, {
      gameId,
      playerId,
      ignoredCards: ignoredList,
    });
  }

  socket.on("clearPriorityTimer", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') return;
      const ctx = ensureInRoomAndSeated(gameId);
      if (!ctx) return;

      clearPriorityTimer(gameId);
      socket.emit("priorityTimerCleared", { gameId });
    } catch {
      socket.emit("priorityTimerError", { gameId, message: "Failed to clear priority timer." });
    }
  });

  socket.on("schedulePriorityTimeout", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') return;
      const ctx = ensureInRoomAndSeated(gameId);
      if (!ctx) return;
      const game = ctx.game;
      schedulePriorityTimeout(io, game, gameId);
      socket.emit("priorityTimerScheduled", { gameId });
    } catch (err) {
      socket.emit("error", { code: "SCHEDULE_PRIORITY_ERROR", message: err.message });
    }
  });

  socket.on("setAutoPass", (payload?: { gameId?: unknown; enabled?: unknown; syncOnly?: unknown }) => {
    const gameId = payload?.gameId;
    const gameIdValue = typeof gameId === 'string' ? gameId : undefined;
    const enabled = !!payload?.enabled;
    const syncOnly = payload?.syncOnly === true;
    const ctx = gameIdValue ? ensureInRoomAndSeated(gameIdValue) : null;
    if (!ctx) return;

    const { game, pid } = ctx;
    const stateAny = game.state as any;
    const autoPassPlayers = stateAny.autoPassPlayers instanceof Set ? stateAny.autoPassPlayers : new Set<string>();
    const wasEnabled = autoPassPlayers.has(pid);

    if (enabled) {
      autoPassPlayers.add(pid);

      if (!wasEnabled && !syncOnly) {
        const justSkipped = stateAny.justSkippedToPhase;
        if (justSkipped && justSkipped.playerId === pid) {
          delete stateAny.justSkippedToPhase;
          debug(2, `[Priority] Cleared justSkippedToPhase for ${pid} (re-enabled auto-pass)`);
        }
      }
    } else {
      autoPassPlayers.delete(pid);
    }

    stateAny.autoPassPlayers = autoPassPlayers;

    socket.emit("autoPassToggled", {
      gameId: gameIdValue,
      playerId: pid,
      enabled,
      success: true,
    });

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }

    if (enabled && !syncOnly && stateAny.priority === pid) {
      rerunAutoPassEvaluation(gameIdValue, game);
    }
  });

  socket.on("setAutoPassForTurn", (payload?: { gameId?: unknown; enabled?: unknown }) => {
    const gameId = payload?.gameId;
    const gameIdValue = typeof gameId === 'string' ? gameId : undefined;
    const enabled = !!payload?.enabled;
    const ctx = gameIdValue ? ensureInRoomAndSeated(gameIdValue) : null;
    if (!ctx) return;

    const { game, pid } = ctx;
    const stateAny = game.state as any;
    if (!stateAny.autoPassForTurn || typeof stateAny.autoPassForTurn !== 'object') {
      stateAny.autoPassForTurn = {};
    }

    if (enabled) {
      stateAny.autoPassForTurn[pid] = true;

      const justSkipped = stateAny.justSkippedToPhase;
      if (justSkipped && justSkipped.playerId === pid) {
        delete stateAny.justSkippedToPhase;
        debug(2, `[Priority] Cleared justSkippedToPhase for ${pid} (enabled auto-pass for turn)`);
      }
    } else {
      delete stateAny.autoPassForTurn[pid];
    }

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }

    if (enabled && stateAny.priority === pid) {
      rerunAutoPassEvaluation(gameIdValue, game);
    }
  });

  socket.on("claimPriority", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    const gameIdValue = typeof gameId === 'string' ? gameId : undefined;
    const ctx = gameIdValue ? ensureInRoomAndSeated(gameIdValue) : null;
    if (!ctx) return;

    const { game, pid } = ctx;
    const stateAny = game.state as any;
    if (stateAny.priority !== pid) {
      return;
    }

    if (!(stateAny.priorityClaimed instanceof Set)) {
      stateAny.priorityClaimed = new Set<string>();
    }
    stateAny.priorityClaimed.add(pid);
    debug(2, `[Priority] ${pid} claimed priority in game ${gameIdValue}`);
  });

  socket.on("checkCanRespond", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    const gameIdValue = typeof gameId === 'string' ? gameId : undefined;
    const ctx = gameIdValue ? ensureInRoomAndSeated(gameIdValue) : null;
    if (!ctx) {
      socket.emit("canRespondResponse", { canRespond: false, canAct: false, reason: "Not in game" });
      return;
    }

    const { game, pid } = ctx;
    try {
      const stateAny = game.state as any;
      const gameContext: any = {
        state: game.state,
        inactive: new Set(),
        passesInRow: { value: 0 },
        bumpSeq: () => {},
        gameId: gameIdValue,
        libraries: (game as any).libraries || new Map(),
        life: stateAny.life || {},
        poison: {},
        experience: {},
        commandZone: stateAny.commandZone || {},
        joinedBySocket: new Map(),
        participantsList: [],
        tokenToPlayer: new Map(),
        playerToToken: new Map(),
        grants: new Map(),
        spectatorNames: new Map(),
        pendingInitialDraw: new Set(),
        handVisibilityGrants: new Map(),
        rngSeed: null,
        rng: () => 0,
        seq: { value: 0 },
        landsPlayedThisTurn: stateAny.landsPlayedThisTurn || {},
        maxLandsPerTurn: {},
        additionalDrawsPerTurn: {},
        manaPool: stateAny.manaPool || {},
      };

      socket.emit("canRespondResponse", {
        canRespond: canRespond(gameContext, pid),
        canAct: canAct(gameContext, pid),
      });
    } catch (err) {
      debugError(1, "[Priority] Error in checkCanRespond:", err);
      socket.emit("canRespondResponse", {
        canRespond: true,
        canAct: true,
        reason: "Failed to check response capability",
      });
    }
  });

  socket.on("setStop", (payload?: { gameId?: unknown; phase?: unknown; enabled?: unknown }) => {
    const gameId = payload?.gameId;
    const gameIdValue = typeof gameId === 'string' ? gameId : undefined;
    const phase = payload?.phase;
    const enabled = !!payload?.enabled;
    const ctx = gameIdValue ? ensureInRoomAndSeated(gameIdValue) : null;
    if (!ctx) return;

    if (!phase || typeof phase !== 'string') {
      socket.emit("error", { code: "INVALID_PAYLOAD", message: "Invalid phase" });
      return;
    }

    const { game, pid } = ctx;
    const stateAny = game.state as any;
    const playerStops = stateAny.playerStops || {};
    if (!playerStops[pid]) {
      playerStops[pid] = {};
    }
    playerStops[pid][phase] = enabled;
    stateAny.playerStops = playerStops;
  });

  socket.on("yieldToTriggerSource", (payload?: { gameId?: unknown; sourceId?: unknown; sourceName?: unknown }) => {
    const gameId = payload?.gameId;
    const gameIdValue = typeof gameId === 'string' ? gameId : undefined;
    const sourceId = payload?.sourceId;
    const sourceName = payload?.sourceName;
    const ctx = gameIdValue ? ensureInRoomAndSeated(gameIdValue) : null;
    if (!ctx) return;

    if (!sourceId || typeof sourceId !== 'string') {
      socket.emit("error", { code: "INVALID_PAYLOAD", message: "Missing sourceId" });
      return;
    }

    const { game, pid } = ctx;
    const stateAny = game.state as any;
    if (!stateAny.yieldToTriggerSourcesForAutoPass) {
      stateAny.yieldToTriggerSourcesForAutoPass = {};
    }
    if (!stateAny.yieldToTriggerSourcesForAutoPass[pid]) {
      stateAny.yieldToTriggerSourcesForAutoPass[pid] = {};
    }

    const normalizedSourceName = typeof sourceName === 'string' ? sourceName : sourceId;
    stateAny.yieldToTriggerSourcesForAutoPass[pid][sourceId] = {
      sourceId,
      sourceName: normalizedSourceName,
      enabled: true,
      setAt: Date.now(),
    };

    if (stateAny.priority === pid) {
      rerunAutoPassEvaluation(gameIdValue, game);
    }
  });

  socket.on("unyieldToTriggerSource", (payload?: { gameId?: unknown; sourceId?: unknown }) => {
    const gameId = payload?.gameId;
    const gameIdValue = typeof gameId === 'string' ? gameId : undefined;
    const sourceId = payload?.sourceId;
    const ctx = gameIdValue ? ensureInRoomAndSeated(gameIdValue) : null;
    if (!ctx) return;

    if (!sourceId || typeof sourceId !== 'string') {
      return;
    }

    const { game, pid } = ctx;
    const triggerMap = (game.state as any).yieldToTriggerSourcesForAutoPass?.[pid];
    if (triggerMap && triggerMap[sourceId]) {
      delete triggerMap[sourceId];
    }
  });

  socket.on("ignoreCardForAutoPass", (payload?: {
    gameId?: unknown;
    permanentId?: unknown;
    cardId?: unknown;
    cardName?: unknown;
    zone?: unknown;
    imageUrl?: unknown;
  }) => {
    const gameId = payload?.gameId;
    const gameIdValue = typeof gameId === 'string' ? gameId : undefined;
    const permanentId = payload?.permanentId;
    const cardId = payload?.cardId;
    const cardName = payload?.cardName;
    const zone = payload?.zone;
    const providedImageUrl = payload?.imageUrl;
    const ctx = gameIdValue ? ensureInRoomAndSeated(gameIdValue) : null;
    if (!ctx) return;

    const effectiveId = cardId || permanentId;
    if (!effectiveId || typeof effectiveId !== 'string') {
      socket.emit("error", { code: "INVALID_PAYLOAD", message: "Missing card identifier" });
      return;
    }

    const { game, pid } = ctx;
    const effectiveZone = typeof zone === 'string' && zone ? zone : 'battlefield';
    const normalizedCardName = typeof cardName === 'string' ? cardName : String(effectiveId);
    let imageUrl = typeof providedImageUrl === 'string' ? providedImageUrl : undefined;
    const stateAny = game.state as any;

    if (!stateAny.ignoredCardsForAutoPass) {
      stateAny.ignoredCardsForAutoPass = {};
    }
    if (!stateAny.ignoredCardsForAutoPass[pid]) {
      stateAny.ignoredCardsForAutoPass[pid] = {};
    }

    if (!imageUrl) {
      if (effectiveZone === 'battlefield') {
        const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
        const permanent = battlefield.find((entry: any) => entry && entry.id === effectiveId);
        imageUrl = permanent?.card?.image_uris?.small || permanent?.card?.image_uris?.normal;
      } else {
        const zoneCards = (game.state as any)?.zones?.[pid]?.[effectiveZone] || [];
        const card = Array.isArray(zoneCards) ? zoneCards.find((entry: any) => entry?.id === effectiveId) : undefined;
        imageUrl = card?.image_uris?.small || card?.image_uris?.normal;
      }
    }

    stateAny.ignoredCardsForAutoPass[pid][effectiveId] = {
      cardName: normalizedCardName,
      cardId: effectiveId,
      permanentId: effectiveId,
      imageUrl,
      zone: effectiveZone,
      ignoredAt: Date.now(),
    };

    emitIgnoredCardsUpdated(gameIdValue, pid, stateAny.ignoredCardsForAutoPass[pid]);
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
  });

  socket.on("unignoreCardForAutoPass", (payload?: { gameId?: unknown; permanentId?: unknown; cardId?: unknown }) => {
    const gameId = payload?.gameId;
    const gameIdValue = typeof gameId === 'string' ? gameId : undefined;
    const effectiveId = payload?.cardId || payload?.permanentId;
    const ctx = gameIdValue ? ensureInRoomAndSeated(gameIdValue) : null;
    if (!ctx) return;

    if (!effectiveId || typeof effectiveId !== 'string') {
      socket.emit("error", { code: "INVALID_PAYLOAD", message: "Missing card identifier" });
      return;
    }

    const { game, pid } = ctx;
    const ignoredCards = (game.state as any).ignoredCardsForAutoPass?.[pid];
    if (ignoredCards && ignoredCards[effectiveId]) {
      delete ignoredCards[effectiveId];
      emitIgnoredCardsUpdated(gameIdValue, pid, ignoredCards);
      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }
    }
  });

  socket.on("clearIgnoredCards", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    const gameIdValue = typeof gameId === 'string' ? gameId : undefined;
    const ctx = gameIdValue ? ensureInRoomAndSeated(gameIdValue) : null;
    if (!ctx) return;

    const { game, pid } = ctx;
    const stateAny = game.state as any;
    if (stateAny.ignoredCardsForAutoPass?.[pid]) {
      stateAny.ignoredCardsForAutoPass[pid] = {};
      emitIgnoredCardsUpdated(gameIdValue, pid, stateAny.ignoredCardsForAutoPass[pid]);
      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }
    }
  });
}