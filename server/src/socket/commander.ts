/**
 * server/src/socket/commander.ts
 *
 * Socket handlers for commander operations.
 *
 * This variant:
 * - Treats client-provided commanderIds as authoritative (replace, do not union).
 * - Resolves names -> ids only for names actually supplied by the client.
 * - Preserves pendingInitialDraw handling: if player is flagged, shuffle + draw (idempotent guard).
 * - Adds concise debug logging for incoming setCommander payloads.
 * - Fixes dumpCommanderState pendingInitialDraw snapshot extraction.
 *
 * Server remains authoritative: state changes are done via game.setCommander / applyEvent and we
 * populate commandZone commanderCards as a best-effort UI snapshot.
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

      // Lightweight debug so we can see what clients actually send (helpful for repro)
      try {
        console.info("[setCommander] payload received:", {
          from: pid,
          gameId: payload.gameId,
          commanderNames: payload.commanderNames || payload.names,
          commanderIds: payload.commanderIds || payload.ids
        });
      } catch (e) { /* ignore */ }

      const game = ensureGame(payload.gameId);
      if (!game) {
        socket.emit("error", { message: "Game not found" });
        return;
      }

      // Normalize incoming name/id payload
      const names: string[] = normalizeNamesArray(payload);

      // If client provided ids, treat them as authoritative.
      let providedIds: string[] = Array.isArray(payload.commanderIds)
        ? payload.commanderIds.slice()
        : Array.isArray(payload.ids)
          ? payload.ids.slice()
          : [];

      // finalIds: the ids we'll pass to the state layer (may be empty array)
      let finalIds: string[] = [];

      if (providedIds && providedIds.length > 0) {
        finalIds = providedIds.filter(Boolean);
      } else {
        // No explicit ids supplied: resolve names->ids only for names client included.
        // 1) Try to resolve via local import buffer on the game (fast)
        try {
          const buf = (game as any)._lastImportedDecks as Map<PlayerID, any[]> | undefined;
          if (buf && buf.get(pid) && names.length > 0) {
            const localCards = buf.get(pid) || [];
            const map = new Map<string, string>();
            for (const c of localCards) {
              if (c && c.name && c.id) {
                const key = String(c.name).trim().toLowerCase();
                if (!map.has(key)) map.set(key, c.id);
              }
            }
            const resolvedIds: string[] = [];
            for (let i = 0; i < names.length; i++) {
              const nm = names[i];
              const key = String(nm).trim().toLowerCase();
              resolvedIds[i] = map.get(key) || "";
            }
            finalIds = resolvedIds.map(x => x || "").filter(Boolean);
          }
        } catch (err) {
          console.warn("setCommander: local import buffer lookup error:", err);
        }

        // 2) Fallback: resolve remaining names via Scryfall (best-effort)
        if (names.length && finalIds.length < names.length) {
          const fallbackIds: string[] = [];
          for (let i = 0; i < names.length; i++) {
            // if we already have an id for this index (from local), skip
            if (finalIds[i]) {
              fallbackIds[i] = finalIds[i];
              continue;
            }
            const nm = names[i];
            try {
              const card = await fetchCardByExactNameStrict(nm);
              if (card && card.id) fallbackIds[i] = card.id;
              else fallbackIds[i] = "";
            } catch (err) {
              console.warn(`setCommander: scryfall resolution failed for "${nm}"`, err);
              fallbackIds[i] = "";
            }
          }
          finalIds = names.map((_, idx) => finalIds[idx] || fallbackIds[idx] || "").filter(Boolean);
        }
      }

      // Call authoritative state API to set commander(s)
      try {
        if (typeof game.setCommander === "function") {
          await game.setCommander(pid, names, finalIds);
        } else if (typeof (game as any).applyEvent === "function") {
          (game as any).applyEvent({
            type: "setCommander",
            playerId: pid,
            commanderNames: names,
            commanderIds: finalIds
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
          commanderIds: finalIds
        });
      } catch (err) {
        console.warn("appendEvent(setCommander) failed:", err);
      }

      // Ensure commandZone[pid].commanderCards contains full card objects for UI (best-effort)
      try {
        (game.state.commandZone = game.state.commandZone || {});
        (game.state.commandZone[pid] = game.state.commandZone[pid] || { commanderIds: [], commanderCards: [], tax: 0, taxById: {} });

        const czInfo = game.state.commandZone[pid] as any;

        // If client provided/resolved ids -> replace the commandZone list with finalIds.
        // If no ids resolved/provided, leave state layer's commanderIds as authoritative.
        if (finalIds && finalIds.length > 0) {
          czInfo.commanderIds = finalIds.slice();
        } else {
          czInfo.commanderIds = czInfo.commanderIds || [];
        }

        // helper to find a card object from various sources
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
              image_uris: cardObj.image_uris || cardObj.imageUris || (cardObj.scryfall && cardObj.scryfall.image_uris) || null,
              power: cardObj.power ?? cardObj.p,
              toughness: cardObj.toughness ?? cardObj.t
            };
            builtCards.push(normalized);
          } else {
            const idx = (finalIds || []).indexOf(cid);
            const nm = names[idx] || null;
            builtCards.push({ id: cid, name: nm });
          }
        }
        czInfo.commanderCards = builtCards;
      } catch (err) {
        console.warn("setCommander: populating commandZone commanderCards failed:", err);
      }

      // If pending opening draw exists for player, shuffle and draw now, and append events.
      // Idempotency: game state should guard against double-draws, but we also try to be careful here.
      try {
        const pendingSet = (game as any).pendingInitialDraw as Set<PlayerID> | undefined;
        if (pendingSet && pendingSet.has(pid)) {
          // Check handCount; prefer authoritative zones if present
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
            // Hand not empty => likely already drawn; just clear pending flag
            try { /* no-op */ } catch {}
          }

          try { pendingSet.delete(pid); } catch (e) { /* ignore */ }
        }
      } catch (err) {
        console.error("setCommander: error while handling pending opening draw:", err);
      }

      // Broadcast updated authoritative view
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
      else if ((game as any).libraries && (typeof (game as any).libraries.get === "function" ? Array.isArray((game as any).libraries.get(pid)) : Array.isArray((game as any).libraries[pid]))) {
        libArr = (game as any).libraries.get ? (game as any).libraries.get(pid) : (game as any).libraries[pid];
      }
      const librarySnapshot = (libArr || []).map(c => ({ id: c?.id || c?.cardId || null, name: c?.name || null }));
      socket.emit("debugLibraryDump", { gameId, playerId: pid, library: librarySnapshot });
    } catch (err) {
      console.error("dumpLibrary failed:", err);
      socket.emit("debugLibraryDump", { gameId: payload?.gameId, playerId: socket.data.playerId, library: null, error: String(err) });
    }
  });

  // Debug handler to show the per-game import buffer we store
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
      const pending = Array.from(pendingSet.values ? pendingSet.values() : pendingSet) as any[];
      const cz = (game.state && game.state.commandZone && (game.state.commandZone as any)[pid]) || null;
      socket.emit("debugCommanderState", { gameId, playerId: pid, pendingInitialDraw: pending, commandZone: cz });
    } catch (err) {
      console.error("dumpCommanderState failed:", err);
      socket.emit("debugCommanderState", { gameId: payload?.gameId, playerId: socket.data.playerId, state: null, error: String(err) });
    }
  });
}