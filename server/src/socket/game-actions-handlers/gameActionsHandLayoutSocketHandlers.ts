/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: the registerGameActions socket handlers for shuffleHand,
 * reorderHand, updatePermanentPos, and setTurnDirection.
 *
 * These were arrow bodies inside registerGameActions. They take io/socket and
 * the room guard explicitly; registerGameActions now just registers them.
 *
 * Public entry symbols: handleShuffleHandRequest, handleReorderHandRequest,
 * handleUpdatePermanentPosRequest, handleSetTurnDirectionRequest.
 */
import type { Server, Socket } from "socket.io";
import { isGameCreator } from "../../db";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { appendGameEvent, broadcastGame, ensureGame } from "../util";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";


// Shuffle player's hand (server-authoritative) G�� randomize order of cards in hand.
export async function handleShuffleHandRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  try {
    if (!gameId || typeof gameId !== 'string') return;
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    const spectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!game || !playerId || spectator) return;

    if (!ensureInGameRoom(gameId)) return;

    // Must be seated and non-spectator in this game.
    try {
      const seated = Array.isArray((game.state as any)?.players)
        ? (game.state as any).players.some(
            (p: any) => p?.id === playerId && !p?.spectator && !p?.isSpectator
          )
        : false;
      if (!seated) return;
    } catch {
      return;
    }

    try {
      // Use the engine's shuffleHand method
      if (typeof (game as any).shuffleHand === "function") {
        (game as any).shuffleHand(playerId);
        debug(2, 
          `[shuffleHand] Shuffled hand for player ${playerId} in game ${gameId}`
        );
      } else {
        // Fallback to direct manipulation if engine method not available
        debugWarn(1, 
          `[shuffleHand] game.shuffleHand not available, using fallback for game ${gameId}`
        );
        game.state = (game.state || {}) as any;
        game.state.zones = game.state.zones || {};
        const zones = game.state.zones[playerId] || null;
        if (!zones || !Array.isArray(zones.hand)) {
          socket.emit("error", {
            code: "SHUFFLE_HAND_NO_HAND",
            message: "No hand to shuffle.",
          });
          return;
        }

        // Fisher-Yates shuffle of the hand array
        const arr = zones.hand;
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = arr[i];
          arr[i] = arr[j];
          arr[j] = tmp;
        }
        // Ensure handCount remains accurate
        zones.handCount = Array.isArray(zones.hand)
          ? zones.hand.length
          : zones.handCount || 0;
      }

      appendGameEvent(game, gameId, "shuffleHand", { playerId });

      // Ensure sequence is bumped before broadcasting to trigger client re-renders
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
    } catch (e) {
      debugError(1, "shuffleHand failed:", e);
      socket.emit("error", {
        code: "SHUFFLE_HAND_ERROR",
        message: String(e),
      });
    }
  } catch (err) {
    debugError(1, "shuffleHand handler error:", err);
  }
}

// Reorder player's hand based on drag-and-drop
export async function handleReorderHandRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown; order?: unknown },
): Promise<void> {
    try {
      const gameId = payload?.gameId;
      const order = payload?.order;
      if (!gameId || typeof gameId !== "string") return;
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      const spectator = !!(
        (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
      );
      if (!game || !playerId || spectator) return;

      if (!ensureInGameRoom(gameId)) return;

      // Must be seated and non-spectator in this game.
      try {
        const seated = Array.isArray((game.state as any)?.players)
          ? (game.state as any).players.some(
              (p: any) => p?.id === playerId && !p?.spectator && !p?.isSpectator
            )
          : false;
        if (!seated) return;
      } catch {
        return;
      }

      debug(1, 
        "[reorderHand] Received request for game",
        gameId,
        ", order length:",
        Array.isArray(order) ? order.length : 0
      );
      debug(1, 
        "[reorderHand] playerId:",
        playerId,
        ", spectator:",
        spectator,
        ", game exists:",
        !!game
      );

      if (!Array.isArray(order) || order.length === 0) {
        socket.emit("error", {
          code: "REORDER_HAND_BAD_ORDER",
          message: "Invalid hand order payload.",
        });
        return;
      }

      // Prefer engine viewFor, fall back to raw state zones
      let view: any;
      try {
        view =
          typeof (game as any).viewFor === "function"
            ? (game as any).viewFor(playerId, false)
            : (game as any).state;
      } catch {
        view = (game as any).state;
      }

      const zonesFromView = view?.zones || {};
      const zView = zonesFromView[playerId];
      let hand: any[] = Array.isArray(zView?.hand) ? zView.hand : [];

      // Fallback: if view hand is empty but state.zones has a hand, use that
      if (!hand.length) {
        try {
          (game as any).state = (game as any).state || {};
          (game as any).state.zones = (game as any).state.zones || {};
          const zState = (game as any).state.zones[playerId];
          if (zState && Array.isArray(zState.hand) && zState.hand.length) {
            hand = zState.hand;
            debug(1, 
              "[reorderHand] Fallback to state.zones hand, length:",
              hand.length
            );
          }
        } catch {
          // ignore fallback errors
        }
      }

      debug(1, 
        "[reorderHand] Current hand length:",
        hand.length,
        ", order length:",
        order.length
      );

      if (!hand.length) {
        debugWarn(2, "[reorderHand] No hand found for player", playerId);
        socket.emit("error", {
          code: "REORDER_HAND_NO_HAND",
          message: "No hand to reorder.",
        });
        return;
      }

      // Map IDs to indices in current hand
      const idToIndex = new Map<string, number>();
      hand.forEach((c, idx) => {
        if (c && c.id) idToIndex.set(c.id, idx);
      });

      const indexOrder: number[] = [];
      for (const id of order) {
        const idx = idToIndex.get(id);
        if (idx === undefined) {
          debugWarn(1, 
            "[reorderHand] ID from client not found in hand:",
            id
          );
          socket.emit("error", {
            code: "REORDER_HAND_BAD_ORDER",
            message:
              "Supplied hand order does not match current hand contents.",
          });
          return;
        }
        indexOrder.push(idx);
      }

      if (typeof (game as any).reorderHand === "function") {
        (game as any).reorderHand(playerId, indexOrder);
      } else {
        // Fallback: reorder a shadow hand in game.state.zones if needed
        try {
          (game as any).state = (game as any).state || {};
          (game as any).state.zones = (game as any).state.zones || {};
          const zState = (game as any).state.zones[playerId];
          if (zState && Array.isArray(zState.hand)) {
            const oldHand = zState.hand.slice();
            const newHand: any[] = [];
            indexOrder.forEach((oldIdx) => {
              if (oldIdx >= 0 && oldIdx < oldHand.length) {
                newHand.push(oldHand[oldIdx]);
              }
            });
            if (newHand.length === oldHand.length) {
              zState.hand = newHand;
              zState.handCount = newHand.length;
            }
          }
        } catch (e) {
          debugWarn(1, 
            "[reorderHand] fallback reorder in state.zones failed",
            e
          );
        }
      }

      appendGameEvent(game, gameId, "reorderHand", {
        playerId,
        orderIndices: indexOrder,
      });
      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, "reorderHand handler error:", err);
      socket.emit("error", {
        code: "REORDER_HAND_ERROR",
        message: err?.message ?? String(err),
      });
    }
  
}

export async function handleUpdatePermanentPosRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: {
      gameId?: unknown;
      permanentId?: unknown;
      x?: unknown;
      y?: unknown;
      z?: unknown;
  },
): Promise<void> {
    try {
      const gameId = payload?.gameId;
      const permanentId = payload?.permanentId;
      const x = payload?.x;
      const y = payload?.y;
      const z = payload?.z;

      if (!gameId || typeof gameId !== "string") return;
      if (!permanentId || typeof permanentId !== "string") return;
      if (typeof x !== "number" || !Number.isFinite(x)) return;
      if (typeof y !== "number" || !Number.isFinite(y)) return;
      if (!(z === undefined || (typeof z === "number" && Number.isFinite(z)))) return;

      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as string | undefined;
      const spectator = !!(
        (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
      );
      if (!game || !playerId || spectator) return;

      if (!ensureInGameRoom(gameId)) return;

      const battlefield = Array.isArray((game.state as any)?.battlefield)
        ? (game.state as any).battlefield
        : [];
      const permanent = battlefield.find(
        (entry: any) => String(entry?.id || "") === permanentId
      );
      if (!permanent) return;

      if (String(permanent.controller || "") !== playerId) {
        socket.emit("error", {
          code: "POS",
          message: "You can only move your own permanents",
        });
        return;
      }

      appendGameEvent(game, gameId, "updatePermanentPos", {
        permanentId,
        x: Math.round(x),
        y: Math.round(y),
        ...(typeof z === "number" ? { z: Math.round(z) } : {}),
      });
      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, "updatePermanentPos handler error:", err);
      socket.emit("error", {
        code: "UPDATE_PERMANENT_POS_ERROR",
        message: err?.message ?? String(err),
      });
    }
  
}

// Set turn direction (+1 or -1)
export async function handleSetTurnDirectionRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown; direction?: unknown },
): Promise<void> {
    try {
      const gameId = payload?.gameId;
      const direction = payload?.direction;
      const playerId = socket.data?.playerId;
      const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
      if (!playerId || typeof playerId !== "string" || socketIsSpectator) {
        socket.emit("error", {
          code: "NOT_AUTHORIZED",
          message: "Not authorized.",
        });
        return;
      }

      if (!gameId || typeof gameId !== "string") return;
      if (direction !== 1 && direction !== -1) {
        socket.emit("error", {
          code: "TURN_DIRECTION_ERROR",
          message: "Invalid turn direction.",
        });
        return;
      }

      if ((socket.data as any)?.gameId && (socket.data as any).gameId !== gameId) {
        socket.emit("error", {
          code: "NOT_IN_GAME",
          message: "Not in game.",
        });
        return;
      }

      if (!(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit("error", {
          code: "NOT_IN_GAME",
          message: "Not in game.",
        });
        return;
      }

      if (!isGameCreator(gameId, playerId)) {
        socket.emit("error", {
          code: "NOT_AUTHORIZED",
          message: "Not authorized.",
        });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", {
          code: "GAME_NOT_FOUND",
          message: "Game not found.",
        });
        return;
      }

      const statePlayers = ((game.state as any)?.players || []) as any[];
      const me = statePlayers.find((p: any) => p?.id === playerId);
      if (!me || me?.spectator || me?.isSpectator) {
        socket.emit("error", {
          code: "NOT_AUTHORIZED",
          message: "Not authorized.",
        });
        return;
      }

      game.setTurnDirection(direction);
      appendGameEvent(game, gameId, "setTurnDirection", { direction });
      broadcastGame(io, game, gameId);
    } catch (err: any) {
      socket.emit("error", {
        code: "TURN_DIRECTION_ERROR",
        message: err?.message ?? String(err),
      });
    }
  
}

