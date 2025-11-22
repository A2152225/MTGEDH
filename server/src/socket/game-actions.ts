import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, appendGameEvent } from "./util";
import { appendEvent } from "../db";

export function registerGameActions(io: Server, socket: Socket) {
  // Pass priority
  socket.on("passPriority", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const { changed, resolvedNow } = game.passPriority(playerId);
      if (!changed) return;

      appendGameEvent(game, gameId, "passPriority", { by: playerId });

      if (resolvedNow) {
        appendGameEvent(game, gameId, "resolveTopOfStack");
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: "Top of stack resolved.",
          ts: Date.now(),
        });
      }
      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`passPriority error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "PASS_PRIORITY_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Claim turn (pre-game only) - set yourself as active player when pre-game and turnPlayer is unset.
  socket.on("claimMyTurn", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      const pregame =
        phaseStr === "" ||
        phaseStr === "PRE_GAME" ||
        phaseStr.includes("BEGIN");

      if (!pregame) {
        socket.emit("error", {
          code: "CLAIM_TURN_NOT_PREGAME",
          message: "Claiming turn only allowed in pre-game.",
        });
        return;
      }

      if (game.state.turnPlayer) {
        socket.emit("error", {
          code: "CLAIM_TURN_EXISTS",
          message: "Active player already set.",
        });
        return;
      }

      // Set as active player
      try {
        game.state.turnPlayer = playerId;
        appendGameEvent(game, gameId, "claimTurn", { by: playerId });
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `Player ${playerId} claimed first turn.`,
          ts: Date.now(),
        });
        broadcastGame(io, game, gameId);
      } catch (e) {
        console.error("claimMyTurn: failed to set turnPlayer", e);
        socket.emit("error", {
          code: "CLAIM_TURN_FAILED",
          message: String(e),
        });
      }
    } catch (err) {
      console.error("claimMyTurn handler failed:", err);
    }
  });

  // Next turn
  socket.on("nextTurn", async ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Debug logging
      try {
        console.info(
          `[nextTurn] request from player=${playerId} game=${gameId} turnPlayer=${
            game.state?.turnPlayer
          } stack=${(game.state?.stack || []).length} phase=${String(
            game.state?.phase
          )}`
        );
      } catch {
        /* ignore */
      }

      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      const pregame =
        phaseStr === "" ||
        phaseStr === "PRE_GAME" ||
        phaseStr.includes("BEGIN");

      const playersArr: any[] =
        game.state && Array.isArray(game.state.players)
          ? game.state.players
          : [];

      // Only active player may advance if set
      if (game.state.turnPlayer) {
        if (game.state.turnPlayer !== playerId) {
          socket.emit("error", {
            code: "NEXT_TURN",
            message: "Only the active player can advance the turn.",
          });
          console.info(
            `[nextTurn] rejected - not active player (player=${playerId} turnPlayer=${game.state.turnPlayer})`
          );
          return;
        }
      } else {
        // No turnPlayer set
        if (playersArr.length <= 1) {
          try {
            game.state.turnPlayer = playerId;
            appendGameEvent(game, gameId, "autoAssignTurn", { playerId });
            console.info(
              `[nextTurn] auto-assigned turnPlayer to single player ${playerId}`
            );
          } catch (e) {
            console.warn("nextTurn: auto-assign failed", e);
          }
        } else {
          if (!pregame) {
            socket.emit("error", {
              code: "NEXT_TURN",
              message: "No active player set; cannot advance turn.",
            });
            console.info(
              `[nextTurn] rejected - no turnPlayer and not pregame (phase=${phaseStr})`
            );
            return;
          } else {
            if (!game.state.turnPlayer) {
              socket.emit("error", {
                code: "NEXT_TURN_NO_CLAIM",
                message:
                  "No active player set. Use 'Claim Turn' to set first player.",
              });
              console.info(
                `[nextTurn] rejected - no turnPlayer; ask user to claim (player=${playerId})`
              );
              return;
            }
          }
        }
      }

      if (game.state.stack && game.state.stack.length > 0) {
        socket.emit("error", {
          code: "NEXT_TURN",
          message: "Cannot advance turn while the stack is not empty.",
        });
        console.info(
          `[nextTurn] rejected - stack not empty (len=${game.state.stack.length})`
        );
        return;
      }

      // Invoke underlying implementation
      try {
        if (typeof (game as any).nextTurn === "function") {
          await (game as any).nextTurn();
          console.log(`[nextTurn] Successfully advanced turn for game ${gameId}`);
        } else {
          console.error(
            `[nextTurn] CRITICAL: game.nextTurn not available on game ${gameId} - this should not happen with full engine`
          );
          socket.emit("error", {
            code: "NEXT_TURN_IMPL_MISSING",
            message:
              "Server error: game engine not properly initialized. Please contact support.",
          });
          return;
        }
      } catch (e) {
        console.error(
          "nextTurn: game.nextTurn invocation failed:",
          e
        );
        socket.emit("error", {
          code: "NEXT_TURN_IMPL_ERROR",
          message: String(e),
        });
        return;
      }

      try {
        appendGameEvent(game, gameId, "nextTurn");
      } catch (e) {
        console.warn("appendEvent(nextTurn) failed", e);
      }

      // Ensure sequence is bumped before broadcasting to trigger client re-renders
      if (typeof (game as any).safeBumpSeq === "function") {
        (game as any).bumpSeq();
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `Turn advanced. Active player: ${game.state.turnPlayer}`,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`nextTurn error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "NEXT_TURN_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Next step handler
  socket.on("nextStep", async ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Debug logging
      try {
        console.info(
          `[nextStep] request from player=${playerId} game=${gameId} turnPlayer=${
            game.state?.turnPlayer
          } step=${String(game.state?.step)} stack=${
            (game.state?.stack || []).length
          } phase=${String(game.state?.phase)}`
        );
      } catch {
        /* ignore */
      }

      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      const pregame =
        phaseStr === "" ||
        phaseStr === "PRE_GAME" ||
        phaseStr.includes("BEGIN");

      const playersArr: any[] =
        game.state && Array.isArray(game.state.players)
          ? game.state.players
          : [];

      if (game.state.turnPlayer) {
        if (game.state.turnPlayer !== playerId) {
          socket.emit("error", {
            code: "NEXT_STEP",
            message: "Only the active player can advance the step.",
          });
          console.info(
            `[nextStep] rejected - not active player (player=${playerId} turnPlayer=${game.state.turnPlayer})`
          );
          return;
        }
      } else {
        if (playersArr.length <= 1) {
          try {
            game.state.turnPlayer = playerId;
            appendGameEvent(game, gameId, "autoAssignTurn", { playerId });
            console.info(
              `[nextStep] auto-assigned turnPlayer to single player ${playerId}`
            );
          } catch (e) {
            console.warn("nextStep: auto-assign failed", e);
          }
        } else {
          if (!pregame) {
            socket.emit("error", {
              code: "NEXT_STEP",
              message: "No active player set; cannot advance step.",
            });
            console.info(
              `[nextStep] rejected - no turnPlayer and not pregame (phase=${phaseStr})`
            );
            return;
          } else {
            if (!game.state.turnPlayer) {
              socket.emit("error", {
                code: "NEXT_STEP_NO_CLAIM",
                message:
                  "No active player set. Use 'Claim Turn' to set first player.",
              });
              console.info(
                `[nextStep] rejected - no turnPlayer; ask user to claim (player=${playerId})`
              );
              return;
            }
          }
        }
      }

      if (game.state.stack && game.state.stack.length > 0) {
        socket.emit("error", {
          code: "NEXT_STEP",
          message: "Cannot advance step while the stack is not empty.",
        });
        console.info(
          `[nextStep] rejected - stack not empty (len=${game.state.stack.length})`
        );
        return;
      }

      // Invoke underlying implementation
      try {
        if (typeof (game as any).nextStep === "function") {
          await (game as any).nextStep();
          console.log(`[nextStep] Successfully advanced step for game ${gameId}`);
        } else {
          console.error(
            `[nextStep] CRITICAL: game.nextStep not available on game ${gameId} - this should not happen with full engine`
          );
          socket.emit("error", {
            code: "NEXT_STEP_IMPL_MISSING",
            message:
              "Server error: game engine not properly initialized. Please contact support.",
          });
          return;
        }
      } catch (e) {
        console.error(
          "nextStep: game.nextStep invocation failed:",
          e
        );
        socket.emit("error", {
          code: "NEXT_STEP_IMPL_ERROR",
          message: String(e),
        });
        return;
      }

      try {
        appendGameEvent(game, gameId, "nextStep");
      } catch (e) {
        console.warn("appendEvent(nextStep) failed", e);
      }

      // Ensure sequence is bumped before broadcasting to trigger client re-renders
      if (typeof (game as any).safeBumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`nextStep error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "NEXT_STEP_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Shuffle player's hand (server-authoritative) — randomize order of cards in hand.
  socket.on("shuffleHand", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      const spectator = socket.data.spectator;
      if (!game || !playerId || spectator) return;

      try {
        // Use the engine's shuffleHand method
        if (typeof (game as any).shuffleHand === "function") {
          (game as any).shuffleHand(playerId);
          console.log(`[shuffleHand] Shuffled hand for player ${playerId} in game ${gameId}`);
        } else {
          // Fallback to direct manipulation if engine method not available
          console.warn(`[shuffleHand] game.shuffleHand not available, using fallback for game ${gameId}`);
          game.state = game.state || {};
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
        if (typeof (game as any).safeBumpSeq === "function") {
          (game as any).bumpSeq();
        }

        broadcastGame(io, game, gameId);
      } catch (e) {
        console.error("shuffleHand failed:", e);
        socket.emit("error", {
          code: "SHUFFLE_HAND_ERROR",
          message: String(e),
        });
      }
    } catch (err) {
      console.error("shuffleHand handler error:", err);
    }
  });

  // Reorder player's hand based on drag-and-drop
socket.on("reorderHand", ({ gameId, order }: { gameId: string; order: string[] }) => {
  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    const spectator = socket.data.spectator;
    if (!game || !playerId || spectator) return;

    console.info("[reorderHand] Received request for game", gameId, ", order length:", order.length);
    console.info("[reorderHand] playerId:", playerId, ", spectator:", spectator, ", game exists:", !!game);

    if (!Array.isArray(order) || order.length === 0) {
      socket.emit("error", {
        code: "REORDER_HAND_BAD_ORDER",
        message: "Invalid hand order payload.",
      });
      return;
    }

    // Use engine viewFor, not raw state, to infer current hand
    let view: any;
    try {
      view = typeof (game as any).viewFor === "function"
        ? (game as any).viewFor(playerId, false)
        : (game as any).state;
    } catch {
      view = (game as any).state;
    }

    const zones = view?.zones || {};
    const playerZone = zones[playerId];
    const hand: any[] = Array.isArray(playerZone?.hand) ? playerZone.hand : [];

    console.info("[reorderHand] Current hand length:", hand.length, ", order length:", order.length);

    if (!hand.length) {
      console.warn("[reorderHand] No hand found for player", playerId);
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
        console.warn("[reorderHand] ID from client not found in hand:", id);
        // we can bail out conservatively
        socket.emit("error", {
          code: "REORDER_HAND_BAD_ORDER",
          message: "Supplied hand order does not match current hand contents.",
        });
        return;
      }
      indexOrder.push(idx);
    }

    if (typeof (game as any).reorderHand === "function") {
      (game as any).reorderHand(playerId, indexOrder);
    } else {
      // fallback: reorder a shadow hand in game.state.zones if needed
      // (optional, depending on how your engine works)
    }

    appendGameEvent(game, gameId, "reorderHand", { playerId, orderIndices: indexOrder });
    broadcastGame(io, game, gameId);
  } catch (err: any) {
    console.error("reorderHand handler error:", err);
    socket.emit("error", {
      code: "REORDER_HAND_ERROR",
      message: err?.message ?? String(err),
    });
  }
});
  // Set turn direction (+1 or -1)
  socket.on(
    "setTurnDirection",
    ({ gameId, direction }: { gameId: string; direction: 1 | -1 }) => {
      try {
        const game = ensureGame(gameId);
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
  );

  // Restart (keep roster/players)
  socket.on("restartGame", ({ gameId }) => {
    try {
      const game = ensureGame(gameId);
      game.reset(true);
      // Make restarted games start in PRE_GAME to be consistent
      try {
        game.state = game.state || {};
        (game.state as any).phase = "PRE_GAME";
      } catch {
        /* best effort */
      }
      appendEvent(gameId, game.seq, "restart", { preservePlayers: true });
      broadcastGame(io, game, gameId);
    } catch (err: any) {
      socket.emit("error", {
        code: "RESTART_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Restart (clear roster/players)
  socket.on("restartGameClear", ({ gameId }) => {
    try {
      const game = ensureGame(gameId);
      game.reset(false);
      // Ensure cleared restart is PRE_GAME as well
      try {
        game.state = game.state || {};
        (game.state as any).phase = "PRE_GAME";
      } catch {
        /* best effort */
      }
      appendEvent(gameId, game.seq, "restart", { preservePlayers: false });
      broadcastGame(io, game, gameId);
    } catch (err: any) {
      socket.emit("error", {
        code: "RESTART_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });
}