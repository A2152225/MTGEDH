/**
 * server/src/socket/commander.ts
 *
 * Socket handlers for commander operations.
 *
 * Key points in this variant:
 * - Treat client-provided ids as input but always read back authoritative state from game.state.
 * - Resolve names -> ids only for names the client supplied (local import buffer -> scryfall fallback).
 * - Update zones[pid].libraryCount from authoritative libraries map if present so clients see correct counts.
 * - Perform pendingInitialDraw idempotently: only shuffle/draw when the player's hand is empty; clear pending flag.
 * - Provide debug endpoints to inspect library, import buffer, and commander state.
 *
 * Additional:
 * - Enforce replace semantics when the client provides ids (do not implicitly merge into partner slots).
 * - Export helpers to push candidate/suggestion events to all sockets belonging to a player (fixes importer-socket races).
 */

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame } from "./util";
import { appendEvent } from "../db";
import { fetchCardByExactNameStrict } from "../services/scryfall";
import type { PlayerID } from "../../shared/src";

function normalizeNamesArray(payload: any): string[] {
  if (!payload) return [];
  if (Array.isArray(payload.commanderNames)) return payload.commanderNames.slice();
  if (Array.isArray(payload.names)) return payload.names.slice();
  if (typeof payload.commanderNames === "string") return [payload.commanderNames];
  if (typeof payload.names === "string") return [payload.names];
  if (typeof payload.name === "string") return [payload.name];
  return [];
}

/**
 * Helper: build minimal KnownCardRef-like objects from an array of card objects
 */
function makeCandidateList(arr: any[] | undefined) {
  const out = (arr || []).map((c: any) => ({
    id: c?.id || c?.cardId || null,
    name: c?.name || c?.cardName || null,
    image_uris:
      c?.image_uris ||
      c?.imageUris ||
      (c?.scryfall && c.scryfall.image_uris) ||
      null,
  }));
  return out;
}

/**
 * Emit importedDeckCandidates to all currently-connected sockets that belong to `pid` (non-spectators).
 */
export function emitImportedDeckCandidatesToPlayer(
  io: Server,
  gameId: string,
  pid: PlayerID
) {
  try {
    const game = ensureGame(gameId);
    if (!game) return;
    const buf = (game as any)._lastImportedDecks as
      | Map<PlayerID, any[]>
      | undefined;
    let localArr: any[] = [];
    if (buf && typeof buf.get === "function") localArr = buf.get(pid) || [];
    else if ((game as any).libraries && Array.isArray((game as any).libraries[pid]))
      localArr = (game as any).libraries[pid] || [];

    const candidates = makeCandidateList(localArr);

    try {
      for (const s of Array.from(io.sockets.sockets.values() as any)) {
        try {
          if (s?.data?.playerId === pid && !s?.data?.spectator) {
            s.emit("importedDeckCandidates", { gameId, candidates });
          }
        } catch {
          /* ignore per-socket errors */
        }
      }
      console.info("[commander] emitImportedDeckCandidatesToPlayer", {
        gameId,
        playerId: pid,
        candidatesCount: candidates.length,
      });
    } catch (e) {
      console.warn(
        "emitImportedDeckCandidatesToPlayer: iterating sockets failed",
        e
      );
    }
  } catch (err) {
    console.error("emitImportedDeckCandidatesToPlayer failed:", err);
  }
}

/**
 * Emit suggestCommanders to all currently-connected sockets that belong to `pid`.
 */
export function emitSuggestCommandersToPlayer(
  io: Server,
  gameId: string,
  pid: PlayerID,
  names?: string[]
) {
  try {
    const payload = {
      gameId,
      names: Array.isArray(names) ? names.slice(0, 2) : [],
    };
    for (const s of Array.from(io.sockets.sockets.values() as any)) {
      try {
        if (s?.data?.playerId === pid && !s?.data?.spectator) {
          s.emit("suggestCommanders", payload);
        }
      } catch {
        /* ignore per-socket errors */
      }
    }
    console.info("[commander] emitSuggestCommandersToPlayer", {
      gameId,
      playerId: pid,
      names: payload.names,
    });
  } catch (err) {
    console.error("emitSuggestCommandersToPlayer failed:", err);
  }
}

export function registerCommanderHandlers(io: Server, socket: Socket) {
  socket.on("setCommander", async (payload: any) => {
    try {
      const pid: PlayerID | undefined = socket.data.playerId;
      const spectator = socket.data.spectator;
      if (!pid || spectator) {
        socket.emit("deckError", {
          gameId: payload?.gameId,
          message: "Spectators cannot set commander.",
        });
        return;
      }
      if (!payload || !payload.gameId) {
        socket.emit("error", { message: "Missing gameId for setCommander" });
        return;
      }

      const gameId = payload.gameId;
      console.info("[commander] setCommander incoming", {
        gameId,
        from: pid,
        commanderNames: payload.commanderNames || payload.names,
        commanderIds: payload.commanderIds || payload.ids,
      });

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", { message: "Game not found" });
        return;
      }

      const names: string[] = normalizeNamesArray(payload);

      let providedIds: string[] = Array.isArray(payload.commanderIds)
        ? payload.commanderIds.slice()
        : Array.isArray(payload.ids)
        ? payload.ids.slice()
        : [];

      const resolvedIds: string[] = [];
      if ((!providedIds || providedIds.length === 0) && names.length > 0) {
        try {
          const buf = (game as any)._lastImportedDecks as
            | Map<PlayerID, any[]>
            | undefined;
          if (buf && buf.get(pid)) {
            const local = buf.get(pid) || [];
            const map = new Map<string, string>();
            for (const c of local) {
              if (c && c.name && c.id) {
                const key = String(c.name).trim().toLowerCase();
                if (!map.has(key)) map.set(key, c.id);
              }
            }
            for (let i = 0; i < names.length; i++) {
              const key = String(names[i]).trim().toLowerCase();
              resolvedIds[i] = map.get(key) || "";
            }
          }
          console.info("[commander] setCommander local buffer resolution", {
            gameId,
            playerId: pid,
            names,
            resolvedIds,
          });
        } catch (err) {
          console.warn("setCommander: local import buffer lookup error:", err);
        }

        if (names.length && resolvedIds.filter(Boolean).length < names.length) {
          for (let i = 0; i < names.length; i++) {
            if (resolvedIds[i]) continue;
            const nm = names[i];
            try {
              const card = await fetchCardByExactNameStrict(nm);
              resolvedIds[i] = card && card.id ? card.id : "";
              console.info("[commander] setCommander scryfall resolution", {
                gameId,
                playerId: pid,
                name: nm,
                resolvedId: resolvedIds[i],
              });
            } catch (err) {
              console.warn(
                `setCommander: scryfall resolution failed for "${nm}"`,
                err
              );
              resolvedIds[i] = "";
            }
          }
        }
      }

      const idsToApply =
        providedIds && providedIds.length > 0
          ? providedIds.filter(Boolean)
          : (resolvedIds || []).filter(Boolean);

      console.info("[commander] setCommander idsToApply", {
        gameId,
        playerId: pid,
        names,
        idsToApply,
      });

      // We no longer rely on game.setCommander/applyEvent; we manage state here.
      try {
        appendEvent(gameId, game.seq, "setCommander", {
          playerId: pid,
          commanderNames: names,
          commanderIds: idsToApply,
        });
      } catch (err) {
        console.warn("appendEvent(setCommander) failed:", err);
      }

      try {
        game.state = game.state || {};
        game.state.commandZone = game.state.commandZone || {};
        const prevCz =
          (game.state.commandZone as any)[pid] || {
            commanderIds: [],
            commanderCards: [],
            tax: 0,
            taxById: {},
          };

        const czAuth = (game.state.commandZone as any)[pid] || prevCz;
        const authoritativeIds: string[] = Array.isArray(czAuth.commanderIds)
          ? czAuth.commanderIds.slice()
          : [];

        let finalIds: string[] = [];
        if (idsToApply && idsToApply.length > 0) finalIds = idsToApply.slice();
        else if (authoritativeIds && authoritativeIds.length > 0)
          finalIds = authoritativeIds.slice();
        else finalIds = [];

        (game.state.commandZone as any)[pid] = {
          commanderIds: finalIds,
          commanderNames:
            names && names.length
              ? names.slice(0, finalIds.length)
              : prevCz.commanderNames || [],
          tax: prevCz.tax || 0,
          taxById: prevCz.taxById || {},
        };

        const findCardObj = (cid: string) => {
          try {
            const buf = (game as any)._lastImportedDecks as
              | Map<PlayerID, any[]>
              | undefined;
            if (buf) {
              const local = buf.get(pid) || [];
              const found = local.find(
                (c: any) =>
                  c &&
                  (c.id === cid ||
                    String(c.name || "")
                      .trim()
                      .toLowerCase() ===
                      String(cid).trim().toLowerCase())
              );
              if (found) return found;
            }
          } catch {
            /* ignore */
          }

          try {
            const z =
              game.state.zones && (game.state.zones as any)[pid];
            if (z && Array.isArray(z.library)) {
              const libFound = z.library.find(
                (c: any) => c && (c.id === cid || c.cardId === cid)
              );
              if (libFound) return libFound;
            }
          } catch {
            /* ignore */
          }

          try {
            const L = (game as any).libraries;
            if (L && typeof L.get === "function") {
              const arr = L.get(pid) || [];
              const libFound = (arr || []).find(
                (c: any) => c && (c.id === cid || c.cardId === cid)
              );
              if (libFound) return libFound;
            }
          } catch {
            /* ignore */
          }

          try {
            const bfFound = (game.state.battlefield || []).find(
              (b: any) =>
                b.card &&
                (b.card.id === cid || b.card.cardId === cid)
            );
            if (bfFound) return bfFound.card;
          } catch {
            /* ignore */
          }

          return null;
        };

        const builtCards: any[] = [];
        for (const cid of finalIds || []) {
          const prev = prevCz.commanderCards?.find(
            (c: any) => c && c.id === cid
          );
          if (prev) {
            builtCards.push(prev);
            continue;
          }
          const cardObj = findCardObj(cid);
          if (cardObj) {
            builtCards.push({
              id: cardObj.id || cardObj.cardId || null,
              name: cardObj.name || cardObj.cardName || null,
              type_line: cardObj.type_line || cardObj.typeLine || null,
              oracle_text:
                cardObj.oracle_text || cardObj.oracleText || null,
              image_uris:
                cardObj.image_uris ||
                cardObj.imageUris ||
                (cardObj.scryfall && cardObj.scryfall.image_uris) ||
                null,
              power: cardObj.power ?? cardObj.p,
              toughness: cardObj.toughness ?? cardObj.t,
            });
          } else {
            const idx = finalIds.indexOf(cid);
            const nm =
              (prevCz.commanderNames &&
                prevCz.commanderNames[idx]) ||
              null;
            builtCards.push({ id: cid, name: nm });
          }
        }
        (game.state.commandZone as any)[pid].commanderCards = builtCards;

        console.info("[commander] setCommander updated commandZone", {
          gameId,
          playerId: pid,
          commanderIds: finalIds,
          commanderCardCount: builtCards.length,
        });

        // Robust removal of chosen commanders from library, both zones and internal map.
        try {
          const pidLocal = pid;

          // 1) Remove from zones[pid].library if present
          try {
            const z =
              game &&
              game.state &&
              game.state.zones &&
              (game.state.zones as any)[pidLocal];
            if (z && Array.isArray(z.library)) {
              const lib = z.library as any[];
              for (const bc of builtCards) {
                if (!bc || !bc.id) continue;
                const idx = lib.findIndex(
                  (c: any) =>
                    c &&
                    (c.id === bc.id ||
                      c.cardId === bc.id ||
                      String(c.name || "")
                        .trim()
                        .toLowerCase() ===
                        String(bc.name || "").trim().toLowerCase())
                );
                if (idx >= 0) {
                  lib.splice(idx, 1);
                }
              }
              z.libraryCount = Array.isArray(lib)
                ? lib.length
                : z.libraryCount || 0;
              (game.state.zones as any)[pidLocal] = z;
              console.info("[commander] zones library updated", {
                gameId,
                playerId: pidLocal,
                newLibraryCount: z.libraryCount,
              });
            }
          } catch (e) {
            console.warn(
              "setCommander: removing from zones library failed",
              e
            );
          }

          // 2) Remove from internal libraries map and resync zones from it
          try {
            const libMap = (game as any).libraries;
            if (
              libMap &&
              typeof libMap.get === "function" &&
              typeof libMap.set === "function"
            ) {
              const cur = libMap.get(pidLocal) || [];
              let changed = false;
              for (const bc of builtCards) {
                if (!bc || !bc.id) continue;
                const i = cur.findIndex(
                  (c: any) =>
                    c && (c.id === bc.id || c.cardId === bc.id)
                );
                if (i >= 0) {
                  cur.splice(i, 1);
                  changed = true;
                }
              }
              if (changed) {
                try {
                  libMap.set(pidLocal, cur);
                  console.info(
                    "[commander] libraries map updated after commander removal",
                    {
                      gameId,
                      playerId: pidLocal,
                      newLibraryLength: cur.length,
                    }
                  );
                } catch {
                  /* ignore */
                }
                // resync zones[pid].library from internal map
                try {
                  game.state = game.state || {};
                  game.state.zones = game.state.zones || {};
                  const z =
                    (game.state.zones as any)[pidLocal] || {
                      hand: [],
                      handCount: 0,
                      library: [],
                      libraryCount: 0,
                      graveyard: [],
                      graveyardCount: 0,
                    };
                  z.library = cur.map((c: any) => ({
                    ...c,
                    zone: "library",
                  }));
                  z.libraryCount = cur.length;
                  (game.state.zones as any)[pidLocal] = z;
                } catch (e) {
                  console.warn(
                    "setCommander: resync zones from libraries failed",
                    e
                  );
                }
              }
            }
          } catch (e) {
            console.warn(
              "setCommander: updating internal libraries map failed",
              e
            );
          }
        } catch (e) {
          console.warn(
            "setCommander: commander library removal block failed",
            e
          );
        }
      } catch (e) {
        console.warn(
          "setCommander: building authoritative commanderCards failed:",
          e
        );
      }

      // Sync libraryCount defensively
      try {
        const L = (game as any).libraries;
        let libLen = -1;
        if (L && typeof L.get === "function") {
          const arr = L.get(pid) || [];
          libLen = Array.isArray(arr) ? arr.length : -1;
        } else if (L && Array.isArray(L[pid])) {
          libLen = L[pid].length;
        } else if (
          game.state &&
          game.state.zones &&
          typeof game.state.zones[pid]?.libraryCount === "number"
        ) {
          libLen = game.state.zones[pid].libraryCount;
        }
        if (libLen >= 0) {
          (game.state.zones = game.state.zones || {})[pid] =
            (game.state.zones && (game.state.zones as any)[pid]) || {
              hand: [],
              handCount: 0,
              libraryCount: 0,
              graveyard: [],
              graveyardCount: 0,
            };
          (game.state.zones as any)[pid].libraryCount = libLen;
        }
        console.info("[commander] setCommander libraryCount sync", {
          gameId,
          playerId: pid,
          libraryCount: libLen,
        });
      } catch (e) {
        console.warn("setCommander: libraryCount sync failed", e);
      }

      // Pending opening draw: shuffle + draw 7 if needed
      try {
        const pendingSet = (game as any).pendingInitialDraw as
          | Set<PlayerID>
          | undefined;
        if (pendingSet && pendingSet.has(pid)) {
          const z =
            (game.state &&
              (game.state as any).zones &&
              (game.state as any).zones[pid]) ||
            null;
          const handCount =
            z
              ? typeof z.handCount === "number"
                ? z.handCount
                : Array.isArray(z.hand)
                ? z.hand.length
                : 0
              : 0;

          console.info(
            "[commander] pendingInitialDraw check on setCommander",
            {
              gameId,
              playerId: pid,
              handCount,
            }
          );

          if (handCount === 0) {
            if (typeof (game as any).shuffleLibrary === "function") {
              try {
                (game as any).shuffleLibrary(pid);
                appendEvent(gameId, game.seq, "shuffleLibrary", {
                  playerId: pid,
                });
                console.info("[commander] shuffleLibrary for opening draw", {
                  gameId,
                  playerId: pid,
                });
              } catch (e) {
                console.warn("setCommander: shuffleLibrary failed", e);
              }
            } else {
              console.warn(
                "setCommander: game.shuffleLibrary not available"
              );
            }

            if (typeof (game as any).drawCards === "function") {
              try {
                (game as any).drawCards(pid, 7);
                appendEvent(gameId, game.seq, "drawCards", {
                  playerId: pid,
                  count: 7,
                });
                console.info("[commander] drawCards(7) for opening draw", {
                  gameId,
                  playerId: pid,
                });
              } catch (e) {
                console.warn("setCommander: drawCards failed", e);
              }
            } else {
              console.warn(
                "setCommander: game.drawCards not available"
              );
            }
          } else {
            console.info(
              "[commander] pendingInitialDraw present but hand not empty, skipping draw",
              {
                gameId,
                playerId: pid,
                handCount,
              }
            );
          }

          try {
            pendingSet.delete(pid);
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        console.error(
          "setCommander: error while handling pending opening draw:",
          err
        );
      }

      // Compact debug log of commander + top-of-library state after all changes
      try {
        const cz =
          (game.state &&
            (game.state as any).commandZone &&
            (game.state as any).commandZone[pid]) ||
          null;
        const z =
          (game.state &&
            (game.state as any).zones &&
            (game.state as any).zones[pid]) ||
          null;
        const libArr = z && Array.isArray(z.library) ? z.library : [];
        const top = libArr[0];
        console.info("[DEBUG_CMD] after setCommander", {
          gameId,
          playerId: pid,
          commanderIds: cz?.commanderIds,
          commanderNames: cz?.commanderNames,
          libraryCount: z?.libraryCount,
          libraryTop: top
            ? {
                id: top.id,
                name: top.name,
                type_line: top.type_line,
              }
            : null,
        });
      } catch (e) {
        console.warn("[DEBUG_CMD] logging failed", e);
      }

      try {
        broadcastGame(io, game, gameId);
      } catch (err) {
        console.error("setCommander: broadcastGame failed:", err);
      }
    } catch (err) {
      console.error("Unhandled error in setCommander handler:", err);
      socket.emit("error", { message: "Failed to set commander" });
    }
  });

  // dumpLibrary, dumpImportedDeckBuffer, getImportedDeckCandidates, dumpCommanderState
  // remain as in your current file (not shown here for brevity).
}