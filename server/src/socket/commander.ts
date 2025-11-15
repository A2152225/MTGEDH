import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame } from "./util";
import { appendEvent } from "../db";
import { fetchCardByExactNameStrict } from "../services/scryfall";
import type { PlayerID } from "../../shared/src";

/**
 * Robust commander socket handlers (drop-in replacement).
 *
 * Goals:
 * - Accept multiple client payload shapes (commanderNames, names, commanderIds).
 * - Prefer local import buffer (game._lastImportedDecks) to map names -> ids (fast).
 * - Fallback to Scryfall to resolve names -> ids if necessary.
 * - Call game.setCommander(pid, names, ids) if available, otherwise fallback to game.applyEvent.
 * - Ensure game.state.commandZone[pid].commanderCards contains full card objects for UI preview.
 * - If player had pending opening draw flagged, shuffle and draw 7, append events, clear pending.
 * - Provide debug routes:
 *    - dumpLibrary  -> emits 'debugLibraryDump' to requester
 *    - dumpImportedDeckBuffer -> emits 'debugImportedDeckBuffer'
 *    - dumpCommanderState -> emits 'debugCommanderState'
 *
 * Note: This version intentionally does NOT mutate libraries from the socket handler.
 *       Authoritative library mutation should occur inside game.setCommander (state module).
 */

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

      const game = ensureGame(payload.gameId);
      if (!game) {
        socket.emit("error", { message: "Game not found" });
        return;
      }

      // Normalize incoming name/id payload
      const names = normalizeNamesArray(payload);
      let ids: string[] = Array.isArray(payload.commanderIds) ? payload.commanderIds.slice() :
                         Array.isArray(payload.ids) ? payload.ids.slice() : [];

      // 1) Try to resolve ids from the per-game import buffer (fast)
      try {
        const buf = (game as any)._lastImportedDecks as Map<PlayerID, any[]> | undefined;
        if (buf && names.length) {
          const local = buf.get(pid) || [];
          const map = new Map<string, string>();
          for (const c of local) {
            if (c && c.name && c.id) {
              const key = String(c.name).trim().toLowerCase();
              if (!map.has(key)) map.set(key, c.id);
            }
          }
          const resolvedIds: string[] = [];
          for (let i = 0; i < names.length; i++) {
            const n = names[i];
            const key = String(n).trim().toLowerCase();
            if (ids[i]) resolvedIds[i] = ids[i];
            else if (map.has(key)) resolvedIds[i] = map.get(key)!;
            else resolvedIds[i] = "";
          }
          ids = resolvedIds.filter(Boolean);
        }
      } catch (err) {
        console.warn("setCommander: local import buffer lookup error:", err);
      }

      // 2) If still missing ids, fallback to Scryfall name resolution
      if (names.length && ids.length < names.length) {
        const fallback: string[] = [];
        for (let i = 0; i < names.length; i++) {
          if (ids[i]) {
            fallback[i] = ids[i];
            continue;
          }
          const nm = names[i];
          try {
            const card = await fetchCardByExactNameStrict(nm);
            if (card && card.id) fallback[i] = card.id;
            else fallback[i] = "";
          } catch (err) {
            console.warn(`setCommander: scryfall resolution failed for "${nm}"`, err);
            fallback[i] = "";
          }
        }
        ids = names.map((_, idx) => ids[idx] || fallback[idx] || "").filter(Boolean);
      }

      // 3) Call authoritative state API to set commander(s)
      try {
        if (typeof game.setCommander === "function") {
          await game.setCommander(pid, names, ids);
        } else if (typeof (game as any).applyEvent === "function") {
          (game as any).applyEvent({
            type: "setCommander",
            playerId: pid,
            commanderNames: names,
            commanderIds: ids
          });
        } else {
          socket.emit("error", { message: "Server state does not support setCommander" });
          console.error("setCommander: no game.setCommander or applyEvent on game");
          return;
        }
      } catch (err) {
        console.error("setCommander: game.setCommander/applyEvent error:", err);
        // continue to attempt best-effort notification
      }

      // Persist setCommander event
      try {
        appendEvent(payload.gameId, game.seq, "setCommander", {
          playerId: pid,
          commanderNames: names,
          commanderIds: ids
        });
      } catch (err) {
        console.warn("appendEvent(setCommander) failed:", err);
      }

      // 4) Ensure commandZone[pid].commanderCards contains full card objects for UI (best-effort)
      try {
        (game.state.commandZone = game.state.commandZone || {});
        (game.state.commandZone[pid] = game.state.commandZone[pid] || { commanderIds: [], commanderCards: [], tax: 0, taxById: {} });

        const czInfo = game.state.commandZone[pid] as any;
        czInfo.commanderIds = Array.from(new Set([...(czInfo.commanderIds || []), ...ids]));

        // helper to find a card object from various sources
        const findCardObj = (cid: string) => {
          try {
            const buf = (game as any)._lastImportedDecks as Map<PlayerID, any[]> | undefined;
            if (buf) {
              const local = buf.get(pid) || [];
              const found = local.find((c: any) => c && (c.id === cid || (String(c.name || "").trim().toLowerCase() === String(cid).trim().toLowerCase())));
              if (found) return found;
            }
          } catch (e) { /* ignore */ }

          try {
            const z = game.state.zones && game.state.zones[pid];
            if (z && Array.isArray(z.library)) {
              const libFound = z.library.find((c: any) => c && (c.id === cid || c.cardId === cid));
              if (libFound) return libFound;
            }
          } catch (e) { /* ignore */ }

          try {
            const L = (game as any).libraries;
            if (L && (typeof L.get === "function" ? Array.isArray(L.get(pid)) : Array.isArray(L[pid]))) {
              const arr = typeof L.get === "function" ? L.get(pid) : L[pid];
              const libFound = arr.find((c: any) => c && (c.id === cid || c.cardId === cid));
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
        for (const cid of czInfo.commanderIds || []) {
          const existingCard = czInfo.commanderCards?.find((c: any) => c && (c.id === cid));
          if (existingCard) {
            builtCards.push(existingCard);
            continue;
          }
          const cardObj = findCardObj(cid);
          if (cardObj) {
            const normalized = {
              id: cardObj.id || cardObj.cardId || null,
              name: cardObj.name || cardObj.cardName || null,
              type_line: cardObj.type_line || cardObj.typeLine || null,
              oracle_text: cardObj.oracle_text || cardObj.oracleText || null,
              image_uris: cardObj.image_uris || cardObj.imageUris || (cardObj.scryfall && cardObj.scryfall.image_uris) || null
            };
            builtCards.push(normalized);
          } else {
            const idx = ids.indexOf(cid);
            const nm = names[idx] || null;
            builtCards.push({ id: cid, name: nm });
          }
        }
        czInfo.commanderCards = builtCards;
      } catch (err) {
        console.warn("setCommander: populating commandZone commanderCards failed:", err);
      }

      // 5) If pending opening draw exists for player, shuffle and draw now, and append events
      try {
        const pendingSet = (game as any).pendingInitialDraw as Set<PlayerID> | undefined;
        if (pendingSet && pendingSet.has(pid)) {
          if (typeof game.shuffleLibrary === "function") {
            game.shuffleLibrary(pid);
            appendEvent(payload.gameId, game.seq, "shuffleLibrary", { playerId: pid });
          } else {
            console.warn("setCommander: game.shuffleLibrary not available");
          }

          if (typeof game.drawCards === "function") {
            game.drawCards(pid, 7);
            appendEvent(payload.gameId, game.seq, "drawCards", { playerId: pid, count: 7 });
          } else {
            console.warn("setCommander: game.drawCards not available");
          }

          try { pendingSet.delete(pid); } catch (e) { /* ignore */ }
        }
      } catch (err) {
        console.error("setCommander: error while handling pending opening draw:", err);
      }

      // 6) Broadcast authoritative updated view to all participants
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
    const pid: PlayerID | undefined = socket.data.playerId;
    const spectator = socket.data.spectator;
    if (!pid || spectator) {
      socket.emit("debugLibraryDump", { gameId, playerId: pid, library: null, error: "Spectators cannot dump library" });
      return;
    }
    try {
      const game = ensureGame(gameId);
      const zoneForPid = (game.state?.zones && (game.state.zones as any)[pid]) as any | undefined;
      let libArr: any[] | undefined;
      if (zoneForPid && Array.isArray(zoneForPid.library)) libArr = zoneForPid.library;
      else if ((game as any).libraries && (typeof (game as any).libraries.get === "function" ? Array.isArray((game as any).libraries.get(pid)) : Array.isArray((game as any).libraries[pid]))) {
        libArr = (game as any).libraries.get ? (game as any).libraries.get(pid) : (game as any).libraries[pid];
      }
      const librarySnapshot = (libArr || []).map(c => ({ id: c?.id || c?.cardId || null, name: c?.name || null }));
      socket.emit("debugLibraryDump", { gameId, playerId: pid, library: librarySnapshot });
    } catch (err) {
      console.error("dumpLibrary failed:", err);
      socket.emit("debugLibraryDump", { gameId, playerId: pid, library: null, error: String(err) });
    }
  });

  // Debug handler to show the per-game import buffer we store
  socket.on("dumpImportedDeckBuffer", ({ gameId }: { gameId: string }) => {
    const pid: PlayerID | undefined = socket.data.playerId;
    const spectator = socket.data.spectator;
    if (!pid || spectator) {
      socket.emit("debugImportedDeckBuffer", { gameId, playerId: pid, buffer: null, error: "Spectators cannot access buffer" });
      return;
    }
    try {
      const game = ensureGame(gameId);
      const buf = (game as any)._lastImportedDecks as Map<PlayerID, any[]> | undefined;
      const local = buf ? (buf.get(pid) || []) : [];
      socket.emit("debugImportedDeckBuffer", { gameId, playerId: pid, buffer: local });
    } catch (err) {
      console.error("dumpImportedDeckBuffer failed:", err);
      socket.emit("debugImportedDeckBuffer", { gameId, playerId: pid, buffer: null, error: String(err) });
    }
  });

  // Debug handler to inspect pendingInitialDraw and commandZone for player
  socket.on("dumpCommanderState", ({ gameId }: { gameId: string }) => {
    const pid: PlayerID | undefined = socket.data.playerId;
    const spectator = socket.data.spectator;
    if (!pid || spectator) {
      socket.emit("debugCommanderState", { gameId, playerId: pid, state: null, error: "Spectators cannot access commander state" });
      return;
    }
    try {
      const game = ensureGame(gameId);
      const pending = Array.from(((game as any).pendingInitialDraw as Set<PlayerID> || new Set()).values || []);
      const cz = (game.state && game.state.commandZone && game.state.commandZone[pid]) || null;
      socket.emit("debugCommanderState", { gameId, playerId: pid, pendingInitialDraw: pending, commandZone: cz });
    } catch (err) {
      console.error("dumpCommanderState failed:", err);
      socket.emit("debugCommanderState", { gameId, playerId: pid, state: null, error: String(err) });
    }
  });
}