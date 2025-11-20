/**
 * server/src/socket/commander.ts
 *
 * Socket handlers for commander operations.
 *
 * Key points in this variant:
 * - Treat client-provided ids as input but always read back authoritative state from game.state after calling game.setCommander/applyEvent.
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
    image_uris: c?.image_uris || c?.imageUris || (c?.scryfall && c.scryfall.image_uris) || null,
  }));
  return out;
}

/**
 * Emit importedDeckCandidates to all currently-connected sockets that belong to `pid` (non-spectators).
 * This avoids races where an importer-only socket was used but the player's current connection differs.
 */
export function emitImportedDeckCandidatesToPlayer(io: Server, gameId: string, pid: PlayerID) {
  try {
    const game = ensureGame(gameId);
    if (!game) return;
    const buf = (game as any)._lastImportedDecks as Map<PlayerID, any[]> | undefined;
    let localArr: any[] = [];
    if (buf && typeof buf.get === "function") localArr = buf.get(pid) || [];
    else if ((game as any).libraries && Array.isArray((game as any).libraries[pid])) localArr = (game as any).libraries[pid] || [];

    const candidates = makeCandidateList(localArr);

    // Iterate sockets and emit to those matching the playerId
    try {
      for (const s of Array.from(io.sockets.sockets.values() as any)) {
        try {
          if (s?.data?.playerId === pid && !s?.data?.spectator) {
            s.emit("importedDeckCandidates", { gameId, candidates });
          }
        } catch (e) { /* ignore per-socket errors */ }
      }
    } catch (e) {
      console.warn("emitImportedDeckCandidatesToPlayer: iterating sockets failed", e);
    }
  } catch (err) {
    console.error("emitImportedDeckCandidatesToPlayer failed:", err);
  }
}

/**
 * Emit suggestCommanders to all currently-connected sockets that belong to `pid`.
 * names may be undefined/null (server can still emit; clients will request candidates).
 */
export function emitSuggestCommandersToPlayer(io: Server, gameId: string, pid: PlayerID, names?: string[]) {
  try {
    const payload = { gameId, names: Array.isArray(names) ? names.slice(0, 2) : [] };
    for (const s of Array.from(io.sockets.sockets.values() as any)) {
      try {
        if (s?.data?.playerId === pid && !s?.data?.spectator) {
          s.emit("suggestCommanders", payload);
        }
      } catch (e) { /* ignore per-socket errors */ }
    }
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
        socket.emit("deckError", { gameId: payload?.gameId, message: "Spectators cannot set commander." });
        return;
      }
      if (!payload || !payload.gameId) {
        socket.emit("error", { message: "Missing gameId for setCommander" });
        return;
      }

      // Debug incoming payload
      try {
        console.info("[setCommander] incoming", {
          from: pid,
          gameId: payload.gameId,
          commanderNames: payload.commanderNames || payload.names,
          commanderIds: payload.commanderIds || payload.ids
        });
      } catch (e) { /* noop */ }

      const game = ensureGame(payload.gameId);
      if (!game) {
        socket.emit("error", { message: "Game not found" });
        return;
      }

      // Normalize incoming name/id payload
      const names: string[] = normalizeNamesArray(payload);

      // If client provided ids, prefer to use them as input (we'll still read authoritative state afterwards)
      let providedIds: string[] = Array.isArray(payload.commanderIds)
        ? payload.commanderIds.slice()
        : Array.isArray(payload.ids)
          ? payload.ids.slice()
          : [];

      // Attempt to resolve names -> ids using import buffer (local) then Scryfall
      const resolvedIds: string[] = [];
      if ((!providedIds || providedIds.length === 0) && names.length > 0) {
        try {
          const buf = (game as any)._lastImportedDecks as Map<PlayerID, any[]> | undefined;
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
        } catch (err) {
          console.warn("setCommander: local import buffer lookup error:", err);
        }

        // fallback via Scryfall for unresolved names
        if (names.length && (resolvedIds.filter(Boolean).length < names.length)) {
          for (let i = 0; i < names.length; i++) {
            if (resolvedIds[i]) continue;
            const nm = names[i];
            try {
              const card = await fetchCardByExactNameStrict(nm);
              resolvedIds[i] = (card && card.id) ? card.id : "";
            } catch (err) {
              console.warn(`setCommander: scryfall resolution failed for "${nm}"`, err);
              resolvedIds[i] = "";
            }
          }
        }
      }

      // idsToApply is explicit provided ids (preferred) else resolved ids. Trim falsy.
      const idsToApply = (providedIds && providedIds.length > 0) ? providedIds.filter(Boolean) : (resolvedIds || []).filter(Boolean);

      // Call game.setCommander or fallback applyEvent
      try {
        if (typeof game.setCommander === "function") {
          await game.setCommander(pid, names, idsToApply);
        } else if (typeof (game as any).applyEvent === "function") {
          (game as any).applyEvent({
            type: "setCommander",
            playerId: pid,
            commanderNames: names,
            commanderIds: idsToApply
          });
        } else {
          socket.emit("error", { message: "Server state does not support setCommander" });
          console.error("setCommander: no game.setCommander or applyEvent on game");
          return;
        }
      } catch (err) {
        console.error("setCommander: game.setCommander/applyEvent error:", err);
      }

      // Persist the attempted setCommander for replay
      try {
        appendEvent(payload.gameId, game.seq, "setCommander", {
          playerId: pid,
          commanderNames: names,
          commanderIds: idsToApply
        });
      } catch (err) {
        console.warn("appendEvent(setCommander) failed:", err);
      }

      // Now: ensure authoritative commandZone reflects exactly what we want (replace, not merge).
      try {
        game.state = game.state || {};
        game.state.commandZone = game.state.commandZone || {};
        const prevCz = (game.state.commandZone as any)[pid] || { commanderIds: [], commanderCards: [], tax: 0, taxById: {} };

        // Read what the state currently has (authoritative) but if client provided ids we treat those as the intended replacement set.
        const czAuth = (game.state.commandZone as any)[pid] || prevCz;
        const authoritativeIds: string[] = Array.isArray(czAuth.commanderIds) ? czAuth.commanderIds.slice() : [];

        // finalIds: prefer idsToApply (client intent), otherwise use authoritative state
        let finalIds: string[] = [];
        if (idsToApply && idsToApply.length > 0) finalIds = idsToApply.slice();
        else if (authoritativeIds && authoritativeIds.length > 0) finalIds = authoritativeIds.slice();
        else finalIds = [];

        // Replace the commandZone entry for this player with the exact set we determined.
        (game.state.commandZone as any)[pid] = {
          commanderIds: finalIds,
          commanderNames: names && names.length ? names.slice(0, finalIds.length) : (prevCz.commanderNames || []),
          tax: prevCz.tax || 0,
          taxById: prevCz.taxById || {}
        };

        // Rebuild commanderCards array to include metadata where available (import buffer, libraries, battlefield)
        const findCardObj = (cid: string) => {
          try {
            const buf = (game as any)._lastImportedDecks as Map<PlayerID, any[]> | undefined;
            if (buf) {
              const local = buf.get(pid) || [];
              const found = local.find((c: any) => c && (c.id === cid || String(c.name || "").trim().toLowerCase() === String(cid).trim().toLowerCase()));
              if (found) return found;
            }
          } catch (e) { /* ignore */ }

          try {
            const z = game.state.zones && (game.state.zones as any)[pid];
            if (z && Array.isArray(z.library)) {
              const libFound = z.library.find((c: any) => c && (c.id === cid || c.cardId === cid));
              if (libFound) return libFound;
            }
          } catch (e) { /* ignore */ }

          try {
            const L = (game as any).libraries;
            if (L && typeof L.get === "function") {
              const arr = L.get(pid) || [];
              const libFound = (arr || []).find((c: any) => c && (c.id === cid || c.cardId === cid));
              if (libFound) return libFound;
            }
          } catch (e) { /* ignore */ }

          try {
            const bfFound = (game.state.battlefield || []).find((b: any) => (b.card && (b.card.id === cid || b.card.cardId === cid)));
            if (bfFound) return bfFound.card;
          } catch (e) { /* ignore */ }

          return null;
        };

        const builtCards: any[] = [];
        for (const cid of finalIds || []) {
          const prev = prevCz.commanderCards?.find((c: any) => c && c.id === cid);
          if (prev) { builtCards.push(prev); continue; }
          const cardObj = findCardObj(cid);
          if (cardObj) {
            builtCards.push({
              id: cardObj.id || cardObj.cardId || null,
              name: cardObj.name || cardObj.cardName || null,
              type_line: cardObj.type_line || cardObj.typeLine || null,
              oracle_text: cardObj.oracle_text || cardObj.oracleText || null,
              image_uris: cardObj.image_uris || cardObj.imageUris || (cardObj.scryfall && cardObj.scryfall.image_uris) || null,
              power: cardObj.power ?? cardObj.p,
              toughness: cardObj.toughness ?? cardObj.t
            });
          } else {
            const idx = finalIds.indexOf(cid);
            const nm = (prevCz.commanderNames && prevCz.commanderNames[idx]) || null;
            builtCards.push({ id: cid, name: nm });
          }
        }
        (game.state.commandZone as any)[pid].commanderCards = builtCards;

        // --- INSERTED: Best-effort removal of chosen commander(s) from player's library
        try {
          // Remove from state.zones[pid].library if present (clients read this)
          try {
            const zoneLib = game && game.state && game.state.zones && game.state.zones[pid] && Array.isArray(game.state.zones[pid].library)
              ? (game.state.zones as any)[pid].library
              : null;
            if (zoneLib) {
              for (const bc of builtCards) {
                if (!bc || !bc.id) continue;
                const idx = zoneLib.findIndex((c: any) =>
                  c && (c.id === bc.id || c.cardId === bc.id || String(c.name || "").trim().toLowerCase() === String(bc.name || "").trim().toLowerCase())
                );
                if (idx >= 0) {
                  zoneLib.splice(idx, 1);
                  try {
                    const z = (game.state.zones as any)[pid] || {};
                    const curCount = typeof z.libraryCount === "number" ? z.libraryCount : zoneLib.length + 1;
                    z.libraryCount = Math.max(0, curCount - 1);
                    (game.state.zones as any)[pid] = z;
                  } catch (e) {
                    // best-effort only
                  }
                }
              }
            }
          } catch (e) {
            console.warn("setCommander: removing from state.zones library failed", e);
          }

          // Also update internal libraries map (if the game has one) so shuffle/draw operates on the same authoritative list
          try {
            const libMap = (game as any).libraries;
            if (libMap && typeof libMap.get === "function" && typeof libMap.set === "function") {
              const cur = libMap.get(pid) || [];
              let changed = false;
              for (const bc of builtCards) {
                if (!bc || !bc.id) continue;
                const i = cur.findIndex((c: any) => c && (c.id === bc.id || c.cardId === bc.id));
                if (i >= 0) {
                  cur.splice(i, 1);
                  changed = true;
                }
              }
              if (changed) {
                try { libMap.set(pid, cur); } catch (e) { /* ignore */ }
              }
            }
          } catch (e) {
            console.warn("setCommander: updating internal libraries map failed", e);
          }
        } catch (e) {
          console.warn("setCommander: library removal best-effort block failed", e);
        }
        // --- END INSERT

      } catch (e) {
        console.warn("setCommander: building authoritative commanderCards failed:", e);
      }

      // Sync zones libraryCount from authoritative libraries map if present
      try {
        const L = (game as any).libraries;
        let libLen = -1;
        if (L && typeof L.get === "function") {
          const arr = L.get(pid) || [];
          libLen = Array.isArray(arr) ? arr.length : -1;
        } else if (L && Array.isArray(L[pid])) {
          libLen = L[pid].length;
        } else if (game.state && game.state.zones && typeof game.state.zones[pid]?.libraryCount === "number") {
          libLen = game.state.zones[pid].libraryCount;
        }
        if (libLen >= 0) {
          (game.state.zones = game.state.zones || {})[pid] = (game.state.zones && (game.state.zones as any)[pid]) || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          (game.state.zones as any)[pid].libraryCount = libLen;
        }
      } catch (e) {
        console.warn("setCommander: libraryCount sync failed", e);
      }

      // Handle pendingInitialDraw: only shuffle/draw when player's hand empty; consume the flag.
      try {
        const pendingSet = (game as any).pendingInitialDraw as Set<PlayerID> | undefined;
        if (pendingSet && pendingSet.has(pid)) {
          const z = (game.state && (game.state as any).zones && (game.state as any).zones[pid]) || null;
          const handCount = z ? (typeof z.handCount === "number" ? z.handCount : (Array.isArray(z.hand) ? z.hand.length : 0)) : 0;

          if (handCount === 0) {
            if (typeof (game as any).shuffleLibrary === "function") {
              try {
                (game as any).shuffleLibrary(pid);
                appendEvent(payload.gameId, game.seq, "shuffleLibrary", { playerId: pid });
              } catch (e) {
                console.warn("setCommander: shuffleLibrary failed", e);
              }
            } else {
              console.warn("setCommander: game.shuffleLibrary not available");
            }

            if (typeof (game as any).drawCards === "function") {
              try {
                (game as any).drawCards(pid, 7);
                appendEvent(payload.gameId, game.seq, "drawCards", { playerId: pid, count: 7 });
              } catch (e) {
                console.warn("setCommander: drawCards failed", e);
              }
            } else {
              console.warn("setCommander: game.drawCards not available");
            }
          }

          try { pendingSet.delete(pid); } catch (e) { /* ignore */ }
        }
      } catch (err) {
        console.error("setCommander: error while handling pending opening draw:", err);
      }

      // Broadcast authoritative updated view
      try {
        broadcastGame(io, game, payload.gameId);
      } catch (err) {
        console.error("setCommander: broadcastGame failed:", err);
      }
    } catch (err) {
      console.error("Unhandled error in setCommander handler:", err);
      socket.emit("error", { message: "Failed to set commander" });
    }
  });

  // Debug handler to emit the player's library snapshot (for the requesting player only)
  socket.on("dumpLibrary", ({ gameId }: { gameId: string }) => {
    try {
      const pid: PlayerID | undefined = socket.data.playerId;
      const spectator = socket.data.spectator;

      if (!gameId || typeof gameId !== "string") {
        socket.emit("debugLibraryDump", { gameId: gameId ?? null, playerId: pid, library: null, error: "Missing or invalid gameId" });
        return;
      }

      if (!pid || spectator) {
        socket.emit("debugLibraryDump", { gameId, playerId: pid, library: null, error: "Spectators cannot dump library" });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("debugLibraryDump", { gameId, playerId: pid, library: null, error: "game_not_found" });
        return;
      }
      const zoneForPid = (game.state?.zones && (game.state.zones as any)[pid]) as any | undefined;
      let libArr: any[] | undefined;
      if (zoneForPid && Array.isArray(zoneForPid.library)) libArr = zoneForPid.library;
      else {
        const L = (game as any).libraries;
        if (L && typeof L.get === "function") libArr = L.get(pid);
        else if (L && Array.isArray(L[pid])) libArr = L[pid];
      }
      const librarySnapshot = (libArr || []).map(c => ({ id: c?.id || c?.cardId || null, name: c?.name || null }));
      socket.emit("debugLibraryDump", { gameId, playerId: pid, library: librarySnapshot });
    } catch (err) {
      console.error("dumpLibrary failed:", err);
      socket.emit("debugLibraryDump", { gameId: (typeof gameId !== "undefined" ? gameId : null), playerId: socket.data.playerId, library: null, error: String(err) });
    }
  });

  socket.on("dumpImportedDeckBuffer", ({ gameId }: { gameId: string }) => {
    try {
      const pid: PlayerID | undefined = socket.data.playerId;
      const spectator = socket.data.spectator;

      if (!gameId || typeof gameId !== "string") {
        socket.emit("debugImportedDeckBuffer", { gameId: gameId ?? null, playerId: pid, buffer: null, error: "Missing or invalid gameId" });
        return;
      }

      if (!pid || spectator) {
        socket.emit("debugImportedDeckBuffer", { gameId, playerId: pid, buffer: null, error: "Spectators cannot access buffer" });
        return;
      }
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("debugImportedDeckBuffer", { gameId, playerId: pid, buffer: null, error: "game_not_found" });
        return;
      }
      const buf = (game as any)._lastImportedDecks as Map<PlayerID, any[]> | undefined;
      const local = buf ? (buf.get(pid) || []) : [];
      socket.emit("debugImportedDeckBuffer", { gameId, playerId: pid, buffer: local });
    } catch (err) {
      console.error("dumpImportedDeckBuffer failed:", err);
      socket.emit("debugImportedDeckBuffer", { gameId: (typeof gameId !== "undefined" ? gameId : null), playerId: socket.data.playerId, buffer: null, error: String(err) });
    }
  });

  // Allow client to request resolved imported deck candidates for the requesting player
  socket.on("getImportedDeckCandidates", ({ gameId }: { gameId: string }) => {
    try {
      const pid: PlayerID | undefined = socket.data.playerId;
      const spectator = socket.data.spectator;

      if (!gameId || typeof gameId !== "string") {
        socket.emit("importedDeckCandidates", { gameId: gameId ?? null, candidates: [] });
        return;
      }
      if (!pid || spectator) {
        socket.emit("importedDeckCandidates", { gameId, candidates: [] });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("importedDeckCandidates", { gameId, candidates: [] });
        return;
      }

      try {
        const buf = (game as any)._lastImportedDecks as Map<PlayerID, any[]> | undefined;
        let localArr: any[] = [];
        if (buf && typeof buf.get === "function") localArr = buf.get(pid) || [];
        else if ((game as any).libraries && Array.isArray((game as any).libraries[pid])) localArr = (game as any).libraries[pid] || [];
        // Map to minimal KnownCardRef-like objects (id, name, image_uris)
        const candidates = makeCandidateList(localArr);
        socket.emit("importedDeckCandidates", { gameId, candidates });
      } catch (e) {
        console.warn("getImportedDeckCandidates failed:", e);
        socket.emit("importedDeckCandidates", { gameId, candidates: [] });
      }
    } catch (err) {
      console.error("getImportedDeckCandidates handler failed:", err);
      socket.emit("importedDeckCandidates", { gameId: (typeof gameId !== "undefined" ? gameId : null), candidates: [] });
    }
  });

  // Debug handler to inspect pendingInitialDraw and commandZone for player
  socket.on("dumpCommanderState", ({ gameId }: { gameId: string }) => {
    try {
      const pid: PlayerID | undefined = socket.data.playerId;
      const spectator = socket.data.spectator;

      if (!gameId || typeof gameId !== "string") {
        socket.emit("debugCommanderState", { gameId: gameId ?? null, playerId: pid, state: null, error: "Missing or invalid gameId" });
        return;
      }

      if (!pid || spectator) {
        socket.emit("debugCommanderState", { gameId, playerId: pid, state: null, error: "Spectators cannot access commander state" });
        return;
      }
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("debugCommanderState", { gameId, playerId: pid, state: null, error: "game_not_found" });
        return;
      }
      const pendingSet: Set<PlayerID> = (game as any).pendingInitialDraw || new Set<PlayerID>();
      const pending = pendingSet ? Array.from(pendingSet) : [];
      const cz = (game.state && game.state.commandZone && (game.state.commandZone as any)[pid]) || null;
      socket.emit("debugCommanderState", { gameId, playerId: pid, pendingInitialDraw: pending, commandZone: cz });
    } catch (err) {
      console.error("dumpCommanderState failed:", err);
      socket.emit("debugCommanderState", { gameId: (typeof gameId !== "undefined" ? gameId : null), playerId: socket.data.playerId, state: null, error: String(err) });
    }
  });
}