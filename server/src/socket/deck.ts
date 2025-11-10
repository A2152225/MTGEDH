import type { Server, Socket } from "socket.io";
import {
  parseDecklist,
  fetchCardsByExactNamesBatch,
  fetchCardByExactNameStrict,
  validateDeck,
  normalizeName
} from "../services/scryfall";
import { ensureGame, broadcastGame } from "./util";
import { appendEvent } from "../db";
import {
  saveDeck as saveDeckDB,
  listDecks,
  getDeck as getDeckDB,
  renameDeck as renameDeckDB,
  deleteDeck as deleteDeckDB
} from "../db/decks";
import type { KnownCardRef, PlayerID } from "../../shared/src";

// Suggest commander card objects, not just names
function suggestCommandersFromResolved(cards: Array<Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris">>) {
  const isLegendary = (tl?: string) => (tl || "").toLowerCase().includes("legendary");
  const isEligibleType = (tl?: string) => {
    const t = (tl || "").toLowerCase();
    return t.includes("creature") || t.includes("planeswalker") || t.includes("background");
  };
  const hasPartnerish = (oracle?: string, tl?: string) => {
    const o = (oracle || "").toLowerCase();
    const t = (tl || "").toLowerCase();
    return o.includes("partner") || o.includes("background") || t.includes("background");
  };
  const pool = cards.filter(c => isLegendary(c.type_line) && isEligibleType(c.type_line));
  const first = pool[0];
  const second = pool.slice(1).find(c => hasPartnerish(c.oracle_text, c.type_line));
  const result: any[] = [];
  if (first) result.push(first);
  if (second) result.push(second);
  return result.slice(0, 2);
}

export function registerDeckHandlers(io: Server, socket: Socket) {
  // Import text deck (Commander automation and chat summary included)
  socket.on("importDeck", async ({ gameId, list, deckName }: { gameId: string; list: string; deckName?: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) {
      socket.emit("deckError", { gameId, message: "Spectators cannot import decks." });
      return;
    }
    const game = ensureGame(gameId);

    const parsed = parseDecklist(list);
    const requestedNames = parsed.map(p => p.name);

    let byName: Map<string, any>;
    try {
      byName = await fetchCardsByExactNamesBatch(requestedNames);
    } catch (e: any) {
      socket.emit("deckError", { gameId, message: e?.message || "Deck import failed (batch fetch)." });
      return;
    }

    const resolvedCards: Array<Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris">> = [];
    const validationCards: any[] = [];
    const missing: string[] = [];

    for (const { name, count } of parsed) {
      const key = normalizeName(name).toLowerCase();
      const c = byName.get(key);
      if (!c) {
        missing.push(name);
        continue;
      }
      for (let i = 0; i < count; i++) {
        validationCards.push(c);
        resolvedCards.push({
          id: c.id,
          name: c.name,
          type_line: c.type_line,
          oracle_text: c.oracle_text,
          image_uris: c.image_uris
        });
      }
    }
    if (missing.length) {
      for (const miss of missing) {
        try {
          const c = await fetchCardByExactNameStrict(miss);
          const count = parsed.find(p => p.name === miss)?.count ?? 1;
          for (let i = 0; i < count; i++) {
            validationCards.push(c);
            resolvedCards.push({
              id: c.id,
              name: c.name,
              type_line: c.type_line,
              oracle_text: c.oracle_text,
              image_uris: c.image_uris
            });
          }
        } catch {
          // still missing, ignore
        }
      }
    }

    game.importDeckResolved(pid, resolvedCards);
    appendEvent(gameId, game.seq, "deckImportResolved", { playerId: pid, cards: resolvedCards });

    const handCountBefore = game.state.zones?.[pid]?.handCount ?? 0;
    if (handCountBefore === 0) {
      const isCommanderFmt = String(game.state.format).toLowerCase() === "commander";
      if (isCommanderFmt) {
        if (!game.pendingInitialDraw) (game as any).pendingInitialDraw = new Set();
        game.flagPendingOpeningDraw(pid);
        const sockId = game.participants().find(p => p.playerId === pid)?.socketId;
        const commanders = suggestCommandersFromResolved(resolvedCards);
        if (sockId) io.to(sockId).emit("suggestCommanders", { gameId, commanders });
      } else {
        game.shuffleLibrary(pid);
        appendEvent(gameId, game.seq, "shuffleLibrary", { playerId: pid });
        game.drawCards(pid, 7);
        appendEvent(gameId, game.seq, "drawCards", { playerId: pid, count: 7 });
      }
      broadcastGame(io, game, gameId);
    }

    // Validation & summary chat
    const fmt = String(game.state.format);
    const report = validateDeck(fmt, validationCards);
    const expected = parsed.reduce((sum, p) => sum + p.count, 0);
    const summaryLines: string[] = [];
    summaryLines.push(`Player ${pid} imported ${resolvedCards.length}/${expected} cards.`);
    const stillMissing = parsed
      .filter(p => !resolvedCards.some(rc => rc.name.toLowerCase() === p.name.toLowerCase()))
      .map(p => p.name);
    if (stillMissing.length) summaryLines.push(`Missing: ${stillMissing.slice(0, 10).join(", ")}${stillMissing.length > 10 ? ", …" : ""}`);
    if (report.illegal.length) {
      summaryLines.push(
        `Illegal (${report.illegal.length}): ${report.illegal
          .slice(0, 10)
          .map(i => `${i.name} (${i.reason})`)
          .join(", ")}${report.illegal.length > 10 ? ", …" : ""}`
      );
    }
    if (report.warnings.length) {
      summaryLines.push(...report.warnings.map(w => `Warning: ${w}`));
    }
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: summaryLines.join(" "),
      ts: Date.now()
    });

    // Optional auto-save if deckName provided
    if (deckName && deckName.trim()) {
      try {
        const deckId = `deck_${Date.now()}`;
        const created_by_name =
          (game.state.players as any[])?.find(p => p.id === pid)?.name || String(pid);
        const card_count = parsed.reduce((a, p) => a + (p.count || 0), 0);
        saveDeckDB({
          id: deckId,
          name: deckName.trim(),
          text: list,
          created_by_id: pid,
          created_by_name,
          card_count
        });
        const d = getDeckDB(deckId);
        if (d) {
          const { text: _omit, entries: _omit2, ...summary } = d as any;
          socket.emit("deckSaved", { gameId, deck: summary });
          io.to(gameId).emit("savedDecksList", { gameId, decks: listDecks() });
        }
      } catch {
        socket.emit("deckError", { gameId, message: "Auto-save failed." });
      }
    }
  });

  // Use saved deck (runs same commander post-processing as importDeck)
  socket.on("useSavedDeck", async ({ gameId, deckId }: { gameId: string; deckId: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) {
      socket.emit("deckError", { gameId, message: "Spectators cannot use saved decks." });
      return;
    }

    const game = ensureGame(gameId);
    const deck = getDeckDB(deckId);
    if (!deck) {
      socket.emit("deckError", { gameId, message: "Deck not found." });
      return;
    }
    try {
      const parsed = parseDecklist(deck.text);
      const requested = parsed.map(p => p.name);
      let byName: Map<string, any> | null = null;
      try { byName = await fetchCardsByExactNamesBatch(requested); } catch { byName = null; }

      const resolved: Array<Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris">> = [];
      const missing: string[] = [];

      if (byName) {
        for (const { name, count } of parsed) {
          const key = normalizeName(name).toLowerCase();
          const c = byName.get(key);
          if (!c) {
            missing.push(name);
            continue;
          }
          for (let i = 0; i < count; i++) {
            resolved.push({
              id: c.id,
              name: c.name,
              type_line: c.type_line,
              oracle_text: c.oracle_text,
              image_uris: c.image_uris
            });
          }
        }
      } else {
        for (const { name, count } of parsed) {
          try {
            const c = await fetchCardByExactNameStrict(name);
            for (let i = 0; i < count; i++) {
              resolved.push({
                id: c.id,
                name: c.name,
                type_line: c.type_line,
                oracle_text: c.oracle_text,
                image_uris: c.image_uris
              });
            }
          } catch {
            missing.push(name);
          }
        }
      }

      game.importDeckResolved(pid, resolved);
      appendEvent(gameId, game.seq, "deckImportResolved", { playerId: pid, cards: resolved });

      const handEmpty = (game.state.zones?.[pid]?.handCount ?? 0) === 0;
      if (handEmpty) {
        const isCommanderFmt = String(game.state.format).toLowerCase() === "commander";
        if (isCommanderFmt) {
          if (!game.pendingInitialDraw) (game as any).pendingInitialDraw = new Set();
          game.flagPendingOpeningDraw(pid);
          const sockId = game.participants().find(p => p.playerId === pid)?.socketId;
          const commanders = suggestCommandersFromResolved(resolved);
          if (sockId) io.to(sockId).emit("suggestCommanders", { gameId, commanders });
        } else {
          game.shuffleLibrary(pid);
          appendEvent(gameId, game.seq, "shuffleLibrary", { playerId: pid });
          game.drawCards(pid, 7);
          appendEvent(gameId, game.seq, "drawCards", { playerId: pid, count: 7 });
        }
        broadcastGame(io, game, gameId);
      }
      socket.emit("deckApplied", { gameId, deck });
      if (missing.length) {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `Missing (strict fetch): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}`,
          ts: Date.now()
        });
      }
    } catch (e) {
      socket.emit("deckError", { gameId, message: "Use deck failed." });
    }
  });

  // Save a deck explicitly
  socket.on("saveDeck", ({ gameId, name, list }: { gameId: string; name: string; list: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) {
      socket.emit("deckError", { gameId, message: "Spectators cannot save decks." });
      return;
    }
    if (!name || !name.trim()) {
      socket.emit("deckError", { gameId, message: "Deck name required." });
      return;
    }
    if (!list || !list.trim()) {
      socket.emit("deckError", { gameId, message: "Deck list empty." });
      return;
    }
    if (list.length > 400_000) {
      socket.emit("deckError", { gameId, message: "Deck text too large." });
      return;
    }

    try {
      const deckId = `deck_${Date.now()}`;
      const game = ensureGame(gameId);
      const created_by_name = (game.state.players as any[])?.find(p => p.id === pid)?.name || String(pid);
      const parsed = parseDecklist(list);
      const card_count = parsed.reduce((a, p) => a + (p.count || 0), 0);

      saveDeckDB({
        id: deckId,
        name: name.trim(),
        text: list,
        created_by_id: pid,
        created_by_name,
        card_count
      });
      const d = getDeckDB(deckId);
      if (d) {
        const { text: _omit, entries: _omit2, ...summary } = d as any;
        socket.emit("deckSaved", { gameId, deck: summary });
        io.to(gameId).emit("savedDecksList", { gameId, decks: listDecks() });
      }
    } catch {
      socket.emit("deckError", { gameId, message: "Save failed." });
    }
  });

  socket.on("listSavedDecks", ({ gameId }: { gameId: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) return;
    try {
      const decks = listDecks();
      socket.emit("savedDecksList", { gameId, decks });
    } catch {
      socket.emit("deckError", { gameId, message: "Could not retrieve decks." });
    }
  });

  socket.on("getSavedDeck", ({ gameId, deckId }: { gameId: string; deckId: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) return;
    try {
      const deck = getDeckDB(deckId);
      if (!deck) {
        socket.emit("deckError", { gameId, message: "Deck not found." });
        return;
      }
      socket.emit("savedDeckDetail", { gameId, deck });
    } catch {
      socket.emit("deckError", { gameId, message: "Could not fetch deck details." });
    }
  });

  socket.on("renameSavedDeck", ({ gameId, deckId, name }: { gameId: string; deckId: string; name: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) return;
    if (!name || !name.trim()) {
      socket.emit("deckError", { gameId, message: "Name required." });
      return;
    }
    const updated = renameDeckDB(deckId, name.trim());
    if (!updated) {
      socket.emit("deckError", { gameId, message: "Rename failed or deck not found." });
      return;
    }
    socket.emit("deckRenamed", { gameId, deck: updated });
    io.to(gameId).emit("savedDecksList", { gameId, decks: listDecks() });
  });

  socket.on("deleteSavedDeck", ({ gameId, deckId }: { gameId: string; deckId: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) return;
    const deck = getDeckDB(deckId);
    if (!deck) {
      socket.emit("deckError", { gameId, message: "Deck not found." });
      return;
    }
    const game = ensureGame(gameId);
    const currentName = (game.state.players as any[])?.find(p => p.id === pid)?.name || "";
    const allowed =
      deck.created_by_id === pid ||
      (deck.created_by_name || "").trim().toLowerCase() === currentName.trim().toLowerCase();
    if (!allowed) {
      socket.emit("deckError", { gameId, message: "Not authorized to delete deck." });
      return;
    }
    const deleted = deleteDeckDB(deckId);
    if (!deleted) {
      socket.emit("deckError", { gameId, message: "Deck deletion failed." });
      return;
    }
    socket.emit("deckDeleted", { gameId, deckId });
    io.to(gameId).emit("savedDecksList", { gameId, decks: listDecks() });
  });
}