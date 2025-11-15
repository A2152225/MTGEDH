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

      // Resolve names -> ids only for the names client supplied (local import buffer -> scryfall)
      let resolvedIds: string[] = [];
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
            resolvedIds = resolvedIds.map(x => x || "").filter(Boolean);
          }
        } catch (err) {
          console.warn("setCommander: local import buffer lookup error:", err);
        }

        // fallback via Scryfall when still unresolved
        if (names.length && resolvedIds.length < names.length) {
          const fallback: string[] = [];
          for (let i = 0; i < names.length; i++) {
            if (resolvedIds[i]) { fallback[i] = resolvedIds[i]; continue; }
            const nm = names[i];
            try {
              const card = await fetchCardByExactNameStrict(nm);
              fallback[i] = (card && card.id) ? card.id : "";
            } catch (err) {
              console.warn(`setCommander: scryfall resolution failed for "${nm}"`, err);
              fallback[i] = "";
            }
          }
          resolvedIds = names.map((_, idx) => resolvedIds[idx] || fallback[idx] || "").filter(Boolean);
        }
      }

      // Determine ids to pass to state: prefer providedIds if present else resolvedIds
      const idsToPass = (providedIds && providedIds.length > 0) ? providedIds.filter(Boolean) : resolvedIds;

      // Call authoritative state API
      try {
        if (typeof game.setCommander === "function") {
          await game.setCommander(pid, names, idsToPass);
        } else if (typeof (game as any).applyEvent === "function") {
          (game as any).applyEvent({
            type: "setCommander",
            playerId: pid,
            commanderNames: names,
            commanderIds: idsToPass
          });
        } else {
          socket.emit("error", { message: "Server state does not support setCommander" });
          console.error("setCommander: no game.setCommander or applyEvent on game");
          return;
        }
      } catch (err) {
        console.error("setCommander: game.setCommander/applyEvent error:", err);
      }

      // Persist the attempted setCommander (names + ids attempted)
      try {
        appendEvent(payload.gameId, game.seq, "setCommander", {
          playerId: pid,
          commanderNames: names,
          commanderIds: idsToPass
        });
      } catch (err) {
        console.warn("appendEvent(setCommander) failed:", err);
      }

      // Now read authoritative state back and build UI snapshot from it (do NOT rely on our provisional ids)
      try {
        (game.state.commandZone = game.state.commandZone || {});
        const czAuth = (game.state.commandZone[pid] = game.state.commandZone[pid] || { commanderIds: [], commanderCards: [], tax: 0, taxById: {} }) as any;

        // Build commanderCards array from authoritative czAuth.commanderIds
        const authoritativeIds: string[] = Array.isArray(czAuth.commanderIds) ? czAuth.commanderIds.slice() : [];
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
            if (L && (typeof L.get === "function" ? Array.isArray(L.get(pid)) : Array.isArray(L[pid]))) {
              const arr = typeof L.get === "function" ? L.get(pid) : L[pid];
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
        for (const cid of authoritativeIds || []) {
          const prev = czAuth.commanderCards?.find((c: any) => c && c.id === cid);
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
            // fallback: if we have a name mapping in state, use it; else keep id-only
            const idx = authoritativeIds.indexOf(cid);
            const nm = (czAuth.commanderNames && czAuth.commanderNames[idx]) || null;
            builtCards.push({ id: cid, name: nm });
          }
        }
        czAuth.commanderCards = builtCards;

        // Ensure zones[pid].libraryCount reflects authoritative libraries if present
        try {
          const L = (game as any).libraries;
          let libLen = -1;
          if (L && typeof L.get === "function") {
            const arr = L.get(pid) || [];
            libLen = Array.isArray(arr) ? arr.length : -1;
          } else if (L && Array.isArray(L[pid])) {
            libLen = L[pid].length;
          } else if (game.state && game.state.zones && game.state.zones[pid] && typeof game.state.zones[pid].libraryCount === "number") {
            libLen = game.state.zones[pid].libraryCount;
          }
          if (libLen >= 0) {
            (game.state.zones = game.state.zones || {})[pid] = (game.state.zones && (game.state.zones as any)[pid]) || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
            (game.state.zones as any)[pid].libraryCount = libLen;
          }
        } catch (e) {
          console.warn("setCommander: libraryCount sync failed", e);
        }
      } catch (err) {
        console.warn("setCommander: building authoritative commanderCards failed:", err);
      }

      // Handle pendingInitialDraw: only shuffle/draw if hand empty (idempotent)
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
          } else {
            // already has cards; do not draw again
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
      socket.emit("debugLibraryDump", { gameId: payload?.gameId, playerId: socket.data.playerId, library: null, error: String(err) });
    }
  });

  // Debug handler to show the per-game import buffer
  socket.on("dumpImportedDeckBuffer", ({ gameId }: { gameId: string }) => {
    try {
      const pid: PlayerID | undefined = socket.data.playerId;
      const spectator = socket.data.spectator;
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
      socket.emit("debugImportedDeckBuffer", { gameId: payload?.gameId, playerId: socket.data.playerId, buffer: null, error: String(err) });
    }
  });

  // Debug handler to inspect pendingInitialDraw and commandZone for player
  socket.on("dumpCommanderState", ({ gameId }: { gameId: string }) => {
    try {
      const pid: PlayerID | undefined = socket.data.playerId;
      const spectator = socket.data.spectator;
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
      const pending = Array.from(typeof pendingSet.values === "function" ? pendingSet.values() : pendingSet) as any[];
      const cz = (game.state && game.state.commandZone && (game.state.commandZone as any)[pid]) || null;
      socket.emit("debugCommanderState", { gameId, playerId: pid, pendingInitialDraw: pending, commandZone: cz });
    } catch (err) {
      console.error("dumpCommanderState failed:", err);
      socket.emit("debugCommanderState", { gameId: payload?.gameId, playerId: socket.data.playerId, state: null, error: String(err) });
    }
  });
}