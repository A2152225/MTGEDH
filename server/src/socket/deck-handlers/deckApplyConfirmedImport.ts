/**
 * Origin parent: server/src/socket/deck.ts
 *
 * Cluster moved: applyConfirmedImport — idempotent / reentrancy-safe
 * application of a confirmed deck import (reset/wipe or importer-only,
 * commander suggest, opening shuffle/draw, optional auto-save).
 *
 * Public entry symbols: applyConfirmedImport.
 */
import type { Server, Socket } from "socket.io";
import type { GameState, PlayerID } from "../../../../shared/src";
import { appendEvent } from "../../db";
import { listDecks, saveDeck as saveDeckDB } from "../../db/decks";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import {
  emitImportedDeckCandidatesToPlayer,
  emitSuggestCommandersToPlayer,
} from "../commander";
import { broadcastGame, ensureGame } from "../util";
import {
  addPendingInitialDrawFlag,
  suggestCommanderNames,
} from "./deckImportConfirmHelpers.js";
import {
  cancelImportWipeConfirmResolutionSteps,
  pendingImportConfirmations,
  toImportBufferCard,
} from "./deckImportConfirmState.js";

/**
 * applyConfirmedImport - idempotent / reentrancy-safe application of confirmed import.
 *
 * Optional importerSocket parameter is used for immediate importer-only flows so we can
 * directly emit suggestCommanders/importedDeckCandidates/importApplied to the initiating client.
 */
export async function applyConfirmedImport(
  io: Server,
  confirmId: string,
  importerSocket?: Socket
) {
  const p = pendingImportConfirmations.get(confirmId);
  if (!p) {
    debugWarn(1, "[import] applyConfirmedImport called with missing confirmId", {
      confirmId,
    });
    return;
  }

  // Prevent stale RQ prompts from appearing after confirmation.
  cancelImportWipeConfirmResolutionSteps(p.gameId, confirmId);

  if (p.timeout) {
    try {
      clearTimeout(p.timeout);
    } catch {
      /* ignore */
    }
  }

  const REPEAT_WINDOW_MS = 5_000;

  try {
    const game = ensureGame(p.gameId);
    if (!game) {
      debugWarn(1, "[import] applyConfirmedImport: game not found", {
        gameId: p.gameId,
        confirmId,
      });
      try {
        io.to(p.gameId).emit("importWipeCancelled", {
          confirmId,
          gameId: p.gameId,
          by: p.initiator,
          reason: "game_not_found",
        });
      } catch {
        /* ignore */
      }
      pendingImportConfirmations.delete(confirmId);
      return;
    }

    const importerOnly = !!p.applyImporterOnly;

    try {
      if ((game as any)._importApplying) {
        debug(1, 
          "[import] applyConfirmedImport skipped - another apply in progress",
          {
            gameId: p.gameId,
            initiator: p.initiator,
            confirmId,
          }
        );
        pendingImportConfirmations.delete(confirmId);
        return;
      }
      const lastBy = (game as any)._lastImportAppliedBy;
      const lastAt = (game as any)._lastImportAppliedAt || 0;
      if (lastBy === p.initiator && Date.now() - lastAt < REPEAT_WINDOW_MS) {
        debug(1, "[import] applyConfirmedImport dedupe skip recent apply", {
          gameId: p.gameId,
          initiator: p.initiator,
          confirmId,
          lastBy,
          lastAt,
        });
        pendingImportConfirmations.delete(confirmId);
        return;
      }
      (game as any)._importApplying = true;
    } catch (e) {
      debugWarn(2, "applyConfirmedImport: could not set _importApplying guard", e);
    }

    debug(1, "[import] applyConfirmedImport start", {
      gameId: p.gameId,
      initiator: p.initiator,
      cards: p.resolvedCards.length,
      importerOnly,
      confirmId,
    });

    if (!importerOnly) {
      try {
        if (typeof (game as any).reset === "function") {
          (game as any).reset(true);
          try {
            appendEvent(p.gameId, game.seq, "resetGame", {
              preservePlayers: true,
            });
          } catch {
            /* ignore */
          }
          debug(1, "[import] reset(true) applied", { gameId: p.gameId });
        } else {
          debugWarn(2, "applyConfirmedImport: game.reset not available");
        }
      } catch (e) {
        debugWarn(1, "applyConfirmedImport: reset failed", e);
      }
    } else {
      debug(1, "[import] importer-only apply: skipping full reset", {
        gameId: p.gameId,
      });
    }

    try {
      if (typeof (game as any).importDeckResolved === "function") {
        try {
          (game as any).importDeckResolved(p.initiator, p.resolvedCards);
        } catch {
          (game as any).importDeckResolved(p.initiator, p.resolvedCards);
        }
      }
      debug(1, "[import] importDeckResolved attempted", {
        gameId: p.gameId,
        playerId: p.initiator,
      });
    } catch (err) {
      debugError(1, "applyConfirmedImport: game.importDeckResolved failed", err);
    }

    try {
      const mapped = (p.resolvedCards || []).map((c: any) => ({
        ...c,
        zone: "library",
      }));
      const L = (game as any).libraries;
      if (L && typeof L.set === "function") {
        try {
          L.set(p.initiator, mapped);
          debug(1, "[import] libraries.set overwrite", {
            gameId: p.gameId,
            playerId: p.initiator,
            count: mapped.length,
          });
        } catch (e) {
          debugWarn(1, "applyConfirmedImport: libraries.set overwrite failed", e);
        }
      } else {
        try {
          // Fallback: only update libraryCount in zones, not the full library array
          // The authoritative source for library data should be ctx.libraries or _fallbackLibraries
          game.state = (game.state || {}) as GameState;
          game.state.zones = game.state.zones || {};
          game.state.zones[p.initiator] =
            game.state.zones[p.initiator] || {
              hand: [],
              handCount: 0,
              libraryCount: 0,
              graveyard: [],
              graveyardCount: 0,
            };
          // Note: We don't store library in zones - only the count
          game.state.zones[p.initiator].libraryCount =
            typeof p.parsedCount === "number"
              ? p.parsedCount
              : mapped.length;
          debug(1, "[import] state.zones libraryCount update (no library array duplication)", {
            gameId: p.gameId,
            playerId: p.initiator,
            libraryCount: game.state.zones[p.initiator].libraryCount,
          });
        } catch (e) {
          debugWarn(1, "applyConfirmedImport: state.zones update failed", e);
        }
      }
    } catch (e) {
      debugWarn(1, "applyConfirmedImport: forced library overwrite failed", e);
    }

    try {
      const starting = (game.state && (game.state as any).startingLife) || 40;
      if ((game as any).life) (game as any).life[p.initiator] = starting;
      if ((game.state as any).life)
        (game.state as any).life[p.initiator] = starting;
      (game.state as any).zones = (game.state as any).zones || {};
      (game.state as any).zones[p.initiator] =
        (game.state as any).zones[p.initiator] || {
          hand: [],
          handCount: 0,
          libraryCount:
            (game as any).libraries &&
            typeof (game as any).libraries.get === "function"
              ? ((game as any).libraries.get(p.initiator) || []).length
              : 0,
          graveyard: [],
          graveyardCount: 0,
        };
    } catch (e) {
      debugWarn(1, "applyConfirmedImport: defensive life/zones init failed", e);
    }

    try {
      appendEvent(p.gameId, game.seq, "deckImportResolved", {
        playerId: p.initiator,
        cards: p.resolvedCards,
        importerOnly,
      });
    } catch (err) {
      debugWarn(1, "applyConfirmedImport: appendEvent failed", err);
    }

    // Flag pendingInitialDraw and emit suggestions/candidates
    try {
      addPendingInitialDrawFlag(game, p.initiator);
      try {
        broadcastGame(io, game, p.gameId);
      } catch (e) {
        debugWarn(1, 
          "applyConfirmedImport: broadcastGame failed (pre-suggest)",
          e
        );
      }

      const names = suggestCommanderNames(p.resolvedCards);

      try {
        (game as any)._lastImportedDecks =
          (game as any)._lastImportedDecks || new Map<PlayerID, any[]>();
        (game as any)._lastImportedDecks.set(
          p.initiator,
          (p.resolvedCards || []).map(toImportBufferCard)
        );
        (game as any)._lastImportedDecksNames =
          (game as any)._lastImportedDecksNames ||
          new Map<PlayerID, string[]>();
        (game as any)._lastImportedDecksNames.set(p.initiator, names);
      } catch (e) {
        debugWarn(1, 
          "applyConfirmedImport: could not persist _lastImportedDecks metadata",
          e
        );
      }

      if (importerSocket) {
        try {
          try {
            emitImportedDeckCandidatesToPlayer(io, p.gameId, p.initiator);
          } catch (e) {
            debugWarn(1, 
              "applyConfirmedImport: emitImportedDeckCandidatesToPlayer failed (importerSocket)",
              e
            );
          }
          try {
            emitSuggestCommandersToPlayer(
              io,
              p.gameId,
              p.initiator,
              names
            );
            debug(1, "[import] suggestCommanders emitted (importerSocket)", {
              gameId: p.gameId,
              playerId: p.initiator,
              names,
            });
          } catch (e) {
            debugWarn(1, 
              "applyConfirmedImport: emitSuggestCommandersToPlayer failed (importerSocket)",
              e
            );
          }

          try {
            for (const s of Array.from(io.sockets.sockets.values())) {
              try {
                const sock = s as { data?: { playerId?: string; spectator?: boolean; isSpectator?: boolean }; emit?: any };
                if (
                  sock?.data?.playerId === p.initiator &&
                  !sock?.data?.spectator &&
                  !sock?.data?.isSpectator
                ) {
                  sock.emit?.("importApplied", {
                    confirmId,
                    gameId: p.gameId,
                    by: p.initiator,
                    deckName: p.deckName,
                    importerOnly,
                  });
                }
              } catch {
                /* ignore per-socket errors */
              }
            }
            debug(1, "[import] importApplied sent to player sockets", {
              gameId: p.gameId,
              playerId: p.initiator,
            });
          } catch (e) {
            debugWarn(1, 
              "applyConfirmedImport: importApplied emit to player sockets failed",
              e
            );
            try {
              importerSocket.emit("importApplied", {
                confirmId,
                gameId: p.gameId,
                by: p.initiator,
                deckName: p.deckName,
                importerOnly,
              });
            } catch {
              /* ignore */
            }
          }
        } catch (e) {
          debugWarn(1, "applyConfirmedImport: importerSocket branch failed", e);
        }
      } else {
        try {
          try {
            emitImportedDeckCandidatesToPlayer(io, p.gameId, p.initiator);
          } catch (e) {
            debugWarn(1, 
              "applyConfirmedImport: emitImportedDeckCandidatesToPlayer failed",
              e
            );
          }

          try {
            emitSuggestCommandersToPlayer(
              io,
              p.gameId,
              p.initiator,
              names
            );
            debug(1, "[import] suggestCommanders emitted (player sockets)", {
              gameId: p.gameId,
              playerId: p.initiator,
              names,
            });
          } catch (e) {
            debugWarn(1, 
              "applyConfirmedImport: emitSuggestCommandersToPlayer failed",
              e
            );
            try {
              io.to(p.gameId).emit("suggestCommanders", {
                gameId: p.gameId,
                names,
              });
              debug(1, 
                "[import] suggestCommanders broadcast to room",
                {
                  gameId: p.gameId,
                  names,
                }
              );
            } catch (e2) {
              debugWarn(1, 
                "applyConfirmedImport: fallback suggestCommanders broadcast failed",
                e2
              );
            }
          }
        } catch (e) {
          debugWarn(1, "applyConfirmedImport: suggestCommanders block failed", e);
        }
      }

      // If commander already present or non-commander format, immediate shuffle+draw
      try {
        const cz =
          (game.state &&
            game.state.commandZone &&
            (game.state as any).commandZone[p.initiator]) ||
          null;
        const isCommanderFmt =
          String(game.state.format || "").toLowerCase() === "commander";
        const hasCommanderAlready =
          cz &&
          Array.isArray(cz.commanderIds) &&
          cz.commanderIds.length > 0;
        if (hasCommanderAlready || !isCommanderFmt) {
          debug(1, 
            "[import] applyConfirmedImport -> immediate shuffle/draw path",
            {
              gameId: p.gameId,
              playerId: p.initiator,
              hasCommanderAlready,
              isCommanderFmt,
            }
          );
          const pendingSet = (game as any)
            .pendingInitialDraw as Set<PlayerID> | undefined;
          if (pendingSet && pendingSet.has(p.initiator)) {
            const z =
              (game.state &&
                (game.state as any).zones &&
                (game.state as any).zones[p.initiator]) ||
              null;
            const handCount =
              z
                ? typeof z.handCount === "number"
                  ? z.handCount
                  : Array.isArray(z.hand)
                  ? z.hand.length
                  : 0
                : 0;
            if (handCount === 0) {
              if (typeof (game as any).shuffleLibrary === "function") {
                try {
                  (game as any).shuffleLibrary(p.initiator);
                  appendEvent(p.gameId, game.seq, "shuffleLibrary", {
                    playerId: p.initiator,
                  });
                  debug(1, "[import] immediate shuffleLibrary", {
                    gameId: p.gameId,
                    playerId: p.initiator,
                  });
                } catch (e) {
                  debugWarn(1, 
                    "applyConfirmedImport: shuffleLibrary failed",
                    e
                  );
                }
              }
              if (typeof (game as any).drawCards === "function") {
                try {
                  (game as any).drawCards(p.initiator, 7);
                  debug(1, "[import] immediate drawCards(7)", {
                    gameId: p.gameId,
                    playerId: p.initiator,
                  });
                } catch (e) {
                  debugWarn(1, 
                    "applyConfirmedImport: drawCards failed",
                    e
                  );
                }
              }
            }
            try {
              pendingSet.delete(p.initiator);
            } catch {
              /* ignore */
            }
          }
        }
      } catch (e) {
        debugWarn(1, 
          "applyConfirmedImport: attempted immediate shuffle/draw failed",
          e
        );
      }

      try {
        broadcastGame(io, game, p.gameId);
      } catch (e) {
        debugWarn(1, 
          "applyConfirmedImport: broadcastGame failed (post-suggest)",
          e
        );
      }
    } catch (err) {
      debugWarn(1, "applyConfirmedImport: opening draw flow failed", err);
    }

    if (p.save === true && p.deckName && p.deckName.trim()) {
      try {
        const deckId = `deck_${Date.now()}`;
        const created_by_name =
          (game.state.players as any[])?.find((pl) => pl.id === p.initiator)
            ?.name || String(p.initiator);
        const card_count = p.parsedCount;
        saveDeckDB({
          id: deckId,
          name: p.deckName.trim(),
          text: "",
          created_by_id: p.initiator,
          created_by_name,
          card_count,
        });
        io.to(p.gameId).emit("savedDecksList", {
          gameId: p.gameId,
          decks: listDecks(),
        });
      } catch (e) {
        debugWarn(1, "applyConfirmedImport: auto-save failed", e);
      }
    }

    try {
      if (!importerOnly) {
        try {
          io.to(p.gameId).emit("importWipeConfirmed", {
            confirmId,
            gameId: p.gameId,
            by: p.initiator,
          });
        } catch (e) {
          debugWarn(1, 
            "applyConfirmedImport: importWipeConfirmed emit failed",
            e
          );
        }
      }
      try {
        broadcastGame(io, game, p.gameId);
      } catch {
        /* ignore */
      }
    } catch (err) {
      debugWarn(1, "applyConfirmedImport: final broadcast/notify failed", err);
    }

    try {
      (game as any)._lastImportAppliedBy = p.initiator;
      (game as any)._lastImportAppliedAt = Date.now();
    } catch {
      /* ignore */
    }
  } finally {
    try {
      const game = ensureGame(p.gameId);
      if (game) (game as any)._importApplying = false;
    } catch {
      /* ignore */
    }
    pendingImportConfirmations.delete(confirmId);
    debug(1, "[import] applyConfirmedImport complete", {
      gameId: p.gameId,
      initiator: p.initiator,
      confirmId,
    });
  }
}
