import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
// registerSocketHandlers comes from the socket index (folder)
import { registerSocketHandlers } from "./socket/index.js";
import {
  initDb,
  listGames as dbListGames,
  deleteGame as dbDeleteGame,
} from "./db/index.js";
import {
  listDecks,
  saveDeck,
  getDeck,
  updateDeckContent,
  renameDeck,
  deleteDeck,
} from "./db/decks.js";
import { resolveDeckList } from "./services/deckImport.js";
import { addSuggestion, loadSuggestions } from "./db/houseRuleSuggestions.js";
import { ensureLocalCardLookupIndex, lookupLocalCards } from "./services/localCardLookup.js";
import { parseDecklist, clearPlaneswalkerCache, shouldSkipDeckLine, normalizeName } from "./services/scryfall";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "../../shared/src/events";
import GameManager from "./GameManager.js"; // NEW: import GameManager
import { initCLI, setHttpServer } from "./cli"; // CLI support for server management
import { games as socketGames, priorityTimers } from "./socket/socket.js";
import { debug, debugWarn, debugError } from "./utils/debug.js";
import { BOOT_ID } from "./utils/bootId.js";
import { getOracleIrGapTelemetrySnapshot } from "./state/modules/oracleIrGapTelemetry.js";
import {
  renderOracleIrTelemetryHtml,
  wantsOracleIrTelemetryHtml,
} from "./oracleIrGapTelemetryPage.js";
import { registerOracleIrLiveSoakRoutes } from "./oracleIrLiveSoak.js";

// Get the equivalent of __dirname in ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type StartupOptions = {
  port: number;
  corsOrigin: string;
  clearPlaneswalkerCache: boolean;
  warmLocalCardLookup: boolean;
  wipeGamesOnStartup: boolean;
  showHelp: boolean;
};

function readBooleanEnv(name: string): boolean {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function readBooleanEnvWithDefault(name: string, defaultValue: boolean): boolean {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return defaultValue;
  return readBooleanEnv(name);
}

function printStartupHelp(): void {
  console.log(`
@mtgedh/server startup flags:

  --port <number>                Override PORT for this process.
  --cors-origin <origin>         Override CORS_ORIGIN for this process.
  --sqlite-file <path>           Override SQLITE_FILE / SQLITE_PATH for this process.
  --debug-state <0|1|2>          Override DEBUG_STATE for this process.
  --clear-planeswalker-cache     Force the Scryfall planeswalker cache to be cleared at startup.
  --skip-card-lookup-warmup      Do not prebuild the local deck-import card lookup table at startup.
  --wipe-games                   Delete persisted + in-memory games at startup.
  --wipe-games-on-startup        Alias for --wipe-games.
  --help                         Show this help and exit.

Examples:
  npm --workspace @mtgedh/server run dev -- --wipe-games
  npm --workspace @mtgedh/server run dev -- --port 3002 --debug-state 1
  npm --workspace @mtgedh/server run dev -- --sqlite-file ./data/dev.sqlite

Environment variable equivalents:
  PORT, CORS_ORIGIN, SQLITE_FILE, SQLITE_PATH, DEBUG_STATE,
  CLEAR_PLANESWALKER_CACHE, LOCAL_CARD_LOOKUP_WARMUP, WIPE_GAMES_ON_STARTUP

Note: --wipe-games only clears games and their persisted events. Saved decks are left intact.
`);
}

function readFlagValue(args: string[], index: number, flag: string): string {
  const current = args[index] || '';
  const eqIndex = current.indexOf('=');
  if (eqIndex >= 0) {
    return current.slice(eqIndex + 1);
  }

  const next = args[index + 1];
  if (!next || next.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return next;
}

function resolveStartupOptions(args: string[]): StartupOptions {
  let port = Number(process.env.PORT || 3001);
  let corsOrigin = process.env.CORS_ORIGIN || '*';
  let clearPlaneswalkerCacheOnStartup = readBooleanEnv('CLEAR_PLANESWALKER_CACHE');
  let warmLocalCardLookup = readBooleanEnvWithDefault('LOCAL_CARD_LOOKUP_WARMUP', true);
  let wipeGamesOnStartup = readBooleanEnv('WIPE_GAMES_ON_STARTUP');
  let showHelp = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    if (arg === '--help') {
      showHelp = true;
      continue;
    }

    if (arg === '--clear-planeswalker-cache') {
      clearPlaneswalkerCacheOnStartup = true;
      process.env.CLEAR_PLANESWALKER_CACHE = 'true';
      continue;
    }

    if (arg === '--skip-card-lookup-warmup') {
      warmLocalCardLookup = false;
      process.env.LOCAL_CARD_LOOKUP_WARMUP = 'false';
      continue;
    }

    if (arg === '--wipe-games' || arg === '--wipe-games-on-startup') {
      wipeGamesOnStartup = true;
      process.env.WIPE_GAMES_ON_STARTUP = 'true';
      continue;
    }

    if (arg.startsWith('--port')) {
      const raw = readFlagValue(args, index, '--port');
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid value for --port: ${raw}`);
      }
      port = parsed;
      process.env.PORT = String(parsed);
      if (!arg.includes('=')) index++;
      continue;
    }

    if (arg.startsWith('--cors-origin')) {
      corsOrigin = readFlagValue(args, index, '--cors-origin');
      process.env.CORS_ORIGIN = corsOrigin;
      if (!arg.includes('=')) index++;
      continue;
    }

    if (arg.startsWith('--sqlite-file') || arg.startsWith('--sqlite-path')) {
      const sqliteFile = readFlagValue(args, index, arg.startsWith('--sqlite-path') ? '--sqlite-path' : '--sqlite-file');
      process.env.SQLITE_FILE = sqliteFile;
      process.env.SQLITE_PATH = sqliteFile;
      if (!arg.includes('=')) index++;
      continue;
    }

    if (arg.startsWith('--debug-state')) {
      const debugState = readFlagValue(args, index, '--debug-state');
      process.env.DEBUG_STATE = debugState;
      if (!arg.includes('=')) index++;
      continue;
    }

    throw new Error(`Unknown startup flag: ${arg}`);
  }

  return {
    port,
    corsOrigin,
    clearPlaneswalkerCache: clearPlaneswalkerCacheOnStartup,
    warmLocalCardLookup,
    wipeGamesOnStartup,
    showHelp,
  };
}

const startupOptions = resolveStartupOptions(process.argv.slice(2));
if (startupOptions.showHelp) {
  printStartupHelp();
  process.exit(0);
}

function wipeGamesAtStartup(): { requested: number; deleted: number; ids: string[] } {
  const persisted = dbListGames();
  const ids = persisted.map((row) => String(row.game_id)).filter(Boolean);

  GameManager.clearAllGames();
  socketGames.clear();
  for (const timer of priorityTimers.values()) {
    clearTimeout(timer);
  }
  priorityTimers.clear();

  let deleted = 0;
  for (const id of ids) {
    try {
      if (dbDeleteGame(id)) {
        deleted++;
      }
    } catch (err) {
      debugWarn(1, `[Server] Failed to wipe game on startup: ${id}`, err);
    }
  }

  return { requested: ids.length, deleted, ids };
}

// Key configurations
// Updated default port to 3001 to match repository config defaults (can be overridden with PORT env var)
const PORT = startupOptions.port;
const BUILD_PATH = path.resolve(__dirname, "../../client/dist");

// Initialize Express app
const app = express();

// Serve static files from `client/dist`
app.use(express.static(BUILD_PATH));

// Simple JSON middleware for admin endpoints
app.use(express.json());

// API: list games (merged view between persisted metadata and in-memory state)
app.get("/api/games", (req, res) => {
  // Prevent caching to ensure fresh data (especially through reverse proxies like IIS/ARR)
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  });
  try {
    const persisted = dbListGames();
    const enriched = persisted.map((row) => {
      const id = row.game_id;
      const inMem = GameManager.getGame(id);
      const playersCount = inMem
        ? inMem.state && Array.isArray(inMem.state.players)
          ? inMem.state.players.length
          : 0
        : 0;
      const turn = inMem
        ? inMem.state && typeof inMem.state.turn !== "undefined"
          ? inMem.state.turn
          : null
        : null;
      const phase = inMem
        ? inMem.state && typeof inMem.state.phase !== "undefined"
          ? inMem.state.phase
          : null
        : null;
      const status = inMem
        ? inMem.state && typeof inMem.state.status !== "undefined"
          ? inMem.state.status
          : null
        : null;
      // Get count of active socket connections for this game
      // This allows the client to show delete button when no players are connected
      const activeConnectionsCount = GameManager.getActiveConnectionsCount(id);
      const resume = GameManager.getResumeProgress(id);
      const isRestoring = GameManager.isRestoring(id);
      return {
        id,
        format: row.format,
        startingLife: row.starting_life,
        createdAt: row.created_at,
        createdByPlayerId: row.created_by_player_id || null,
        playersCount,
        activeConnectionsCount,
        turn,
        phase,
        status,
        isRestoring,
        resumeProgress: resume
          ? {
              current: resume.current,
              total: resume.total,
              percent: resume.percent,
            }
          : null,
      };
    });
    res.json({ games: enriched });
  } catch (err) {
    debugError(1, "GET /api/games failed:", err);
    res.status(500).json({ error: "Failed to list games" });
  }
});

function telemetryGameNameFor(gameId: string): string | undefined {
  const game = GameManager.getGame(gameId) || socketGames.get(gameId as any);
  const names = Array.isArray(game?.state?.players)
    ? game.state.players.map((player: any) => String(player?.name || "").trim()).filter(Boolean)
    : [];
  return names.length > 0 ? names.join(", ") : undefined;
}

function enrichTelemetrySnapshotGameNames<T extends { recentEvents: readonly any[] }>(snapshot: T): T {
  return {
    ...snapshot,
    recentEvents: snapshot.recentEvents.map((event) => {
      const gameId = String(event?.gameId || "").trim();
      const gameName = String(event?.gameName || "").trim() || (gameId ? telemetryGameNameFor(gameId) : undefined);
      return gameName ? { ...event, gameName } : event;
    }),
  };
}

// API: Oracle IR production gap telemetry (task D2).
// Browser navigation gets an HTML log (game, time, what broke). Scripts keep JSON
// via Accept: application/json or ?format=json.
app.get("/api/oracle-ir/telemetry", (req, res) => {
  res.set({ "Cache-Control": "no-store" });
  try {
    const snapshot = enrichTelemetrySnapshotGameNames(getOracleIrGapTelemetrySnapshot());
    if (wantsOracleIrTelemetryHtml(req)) {
      res.type("html").send(renderOracleIrTelemetryHtml(snapshot, { gameNameFor: telemetryGameNameFor }));
      return;
    }
    res.json(snapshot);
  } catch (err) {
    debugError(1, "GET /api/oracle-ir/telemetry failed:", err);
    res.status(500).json({ error: "Failed to read oracle IR telemetry" });
  }
});

// Localhost-only live table soak: create game + AI + decks, then free-cast listed cards.
registerOracleIrLiveSoakRoutes(app);

// API: list saved decks (for AI opponent deck selection)
function getRequestRemoteAddress(req: express.Request): string {
  return String(req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function isLocalhostRequest(req: express.Request): boolean {
  const remote = getRequestRemoteAddress(req);
  return remote === '127.0.0.1' || remote === '::1' || remote === 'localhost' || remote.startsWith('127.0.0.1:');
}

function canModifyDeckViaApi(
  req: express.Request,
  deck: { created_by_id: string },
  playerId?: string,
): boolean {
  if (isLocalhostRequest(req)) return true;
  return !!playerId && deck.created_by_id === playerId;
}

app.get("/api/decks", (req, res) => {
  try {
    const decks = listDecks();
    res.json({ decks });
  } catch (err) {
    debugError(1, "GET /api/decks failed:", err);
    res.status(500).json({ error: "Failed to list decks" });
  }
});

/** Local-first card preview for deck builder (oracle text + image URIs). No Scryfall. */
app.post("/api/cards/lookup", (req, res) => {
  try {
    const rawNames = Array.isArray(req.body?.names) ? req.body.names : [];
    const names = [...new Set(
      rawNames
        .map((n: unknown) => (typeof n === 'string' ? n.trim() : ''))
        .filter(Boolean),
    )].slice(0, 200) as string[];

    if (names.length === 0) {
      res.json({ cards: [] });
      return;
    }

    void (async () => {
      try {
        const found = await lookupLocalCards(names);
        const cards = names.map((query) => {
          const card = found.get(normalizeName(query).toLowerCase());
          if (!card) {
            return { query, found: false as const };
          }
          const faceOracle = Array.isArray(card.card_faces)
            ? card.card_faces.map((f) => String(f?.oracle_text || '').trim()).filter(Boolean).join('\n\n')
            : '';
          const oracleText = String(card.oracle_text || '').trim() || faceOracle || undefined;
          const imageUris = card.image_uris || card.card_faces?.[0]?.image_uris;
          return {
            query,
            found: true as const,
            name: card.name,
            type_line: card.type_line,
            oracle_text: oracleText,
            mana_cost: card.mana_cost,
            image_uris: imageUris
              ? {
                  small: imageUris.small,
                  normal: imageUris.normal,
                  art_crop: imageUris.art_crop,
                }
              : undefined,
          };
        });
        res.json({ cards });
      } catch (err) {
        debugError(1, "POST /api/cards/lookup failed:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to look up cards" });
        }
      }
    })();
  } catch (err) {
    debugError(1, "POST /api/cards/lookup failed:", err);
    res.status(500).json({ error: "Failed to look up cards" });
  }
});

// API: save a deck (for AI opponent deck import)
app.post("/api/decks", (req, res) => {
  try {
    const { name, text, playerId, playerName, cacheCards } = req.body;
    
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: "Deck name is required" });
      return;
    }
    
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: "Deck text is required" });
      return;
    }
    
    // Use the shared parseDecklist function for consistent parsing
    let cardCount = 0;
    let parsed: Array<{ name: string; count: number }> = [];
    try {
      parsed = parseDecklist(text);
      cardCount = parsed.reduce((sum, entry) => sum + (entry.count || 1), 0);
    } catch (e) {
      debugWarn(1, "[API] parseDecklist failed, using fallback count:", e);
      // Fallback: simple line count
      cardCount = text.split(/\r?\n/).filter((l: string) => l.trim().length > 0).length;
    }

    const createdById = typeof playerId === 'string' && playerId.trim() ? playerId.trim() : 'api';
    const createdByName = typeof playerName === 'string' && playerName.trim()
      ? playerName.trim()
      : (createdById === 'api' ? 'API Import' : createdById);
    
    const deckId = `deck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    (async () => {
      let resolvedCardsJson: string | null = null;
      if (cacheCards && parsed.length > 0) {
        try {
          const resolution = await resolveDeckList(parsed, { uniqueInstanceIds: false });
          if (resolution.resolvedCards.length > 0) {
            resolvedCardsJson = JSON.stringify(resolution.resolvedCards);
          }
        } catch (e) {
          debugWarn(1, "[API] save deck cacheCards failed:", e);
        }
      }

      saveDeck({
        id: deckId,
        name: name.trim(),
        text: text.trim(),
        created_by_id: createdById,
        created_by_name: createdByName,
        card_count: cardCount,
        resolved_cards: resolvedCardsJson,
      });
      
      debug(1, "[API] Deck saved:", { deckId, name: name.trim(), cardCount, createdById });
      
      res.json({ success: true, deckId, cardCount });
    })().catch((err) => {
      debugError(1, "POST /api/decks async failed:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to save deck" });
      }
    });
  } catch (err) {
    debugError(1, "POST /api/decks failed:", err);
    res.status(500).json({ error: "Failed to save deck" });
  }
});

// API: get a single saved deck (standalone deck builder)
app.get("/api/decks/:id", (req, res) => {
  try {
    const deck = getDeck(String(req.params.id || ''));
    if (!deck) {
      res.status(404).json({ error: "Deck not found" });
      return;
    }
    res.json({ deck });
  } catch (err) {
    debugError(1, "GET /api/decks/:id failed:", err);
    res.status(500).json({ error: "Failed to get deck" });
  }
});

// API: update a saved deck (owner or localhost admin)
app.put("/api/decks/:id", (req, res) => {
  const deckId = String(req.params.id || '');
  const { name, text, playerId, cacheCards } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: "Deck name is required" });
    return;
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: "Deck text is required" });
    return;
  }

  const existing = getDeck(deckId);
  if (!existing) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }

  const safePlayerId = typeof playerId === 'string' ? playerId : undefined;
  if (!canModifyDeckViaApi(req, existing, safePlayerId)) {
    res.status(403).json({ error: "You can only edit decks you created." });
    return;
  }

  (async () => {
    let cardCount = 0;
    let parsed: Array<{ name: string; count: number }> = [];
    try {
      parsed = parseDecklist(text);
      cardCount = parsed.reduce((sum, entry) => sum + (entry.count || 1), 0);
    } catch (e) {
      debugWarn(1, "[API] update deck parseDecklist failed, using line count estimate", e);
      const lines = text.split(/\r?\n/).filter((l: string) => !shouldSkipDeckLine(l));
      cardCount = lines.length;
    }

    let resolvedCardsJson: string | null | undefined = undefined;
    if (cacheCards && parsed.length > 0) {
      try {
        const resolution = await resolveDeckList(parsed, { uniqueInstanceIds: false });
        resolvedCardsJson = resolution.resolvedCards.length > 0
          ? JSON.stringify(resolution.resolvedCards)
          : null;
      } catch (e) {
        debugWarn(1, "[API] update deck cacheCards failed:", e);
        resolvedCardsJson = null;
      }
    }

    const updated = updateDeckContent(deckId, {
      name: name.trim(),
      text,
      card_count: cardCount,
      ...(resolvedCardsJson !== undefined ? { resolved_cards: resolvedCardsJson } : {}),
    });
    if (!updated) {
      res.status(500).json({ error: "Failed to update deck" });
      return;
    }
    res.json({ success: true, deck: updated });
  })().catch((err) => {
    debugError(1, "PUT /api/decks/:id failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to update deck" });
    }
  });
});

// API: rename a saved deck (owner or localhost admin)
app.patch("/api/decks/:id", (req, res) => {
  try {
    const deckId = String(req.params.id || '');
    const { name, playerId } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: "Deck name is required" });
      return;
    }

    const existing = getDeck(deckId);
    if (!existing) {
      res.status(404).json({ error: "Deck not found" });
      return;
    }

    const safePlayerId = typeof playerId === 'string' ? playerId : undefined;
    if (!canModifyDeckViaApi(req, existing, safePlayerId)) {
      res.status(403).json({ error: "You can only rename decks you created." });
      return;
    }

    const deck = renameDeck(deckId, name.trim());
    if (!deck) {
      res.status(404).json({ error: "Deck not found" });
      return;
    }
    res.json({ success: true, deck });
  } catch (err) {
    debugError(1, "PATCH /api/decks/:id failed:", err);
    res.status(500).json({ error: "Failed to rename deck" });
  }
});

// API: delete a saved deck (owner or localhost admin)
app.delete("/api/decks/:id", (req, res) => {
  try {
    const deckId = String(req.params.id || '');
    const playerId = typeof req.body?.playerId === 'string' ? req.body.playerId : undefined;

    const existing = getDeck(deckId);
    if (!existing) {
      res.status(404).json({ error: "Deck not found" });
      return;
    }

    if (!canModifyDeckViaApi(req, existing, playerId)) {
      res.status(403).json({ error: "You can only delete decks you created." });
      return;
    }

    const ok = deleteDeck(deckId);
    if (!ok) {
      res.status(500).json({ error: "Failed to delete deck" });
      return;
    }
    res.json({ success: true, deckId });
  } catch (err) {
    debugError(1, "DELETE /api/decks/:id failed:", err);
    res.status(500).json({ error: "Failed to delete deck" });
  }
});

// API: submit a house rule suggestion
app.post("/api/house-rule-suggestions", (req, res) => {
  try {
    const { suggestion } = req.body;
    
    if (!suggestion || typeof suggestion !== 'string' || !suggestion.trim()) {
      res.status(400).json({ error: "Suggestion text is required" });
      return;
    }
    
    // Limit suggestion length to prevent abuse
    if (suggestion.length > 2000) {
      res.status(400).json({ error: "Suggestion too long (max 2000 characters)" });
      return;
    }
    
    const saved = addSuggestion(suggestion.trim());
    
    debug(1, "[API] House rule suggestion submitted:", saved.id);
    
    res.json({ success: true, suggestionId: saved.id });
  } catch (err) {
    debugError(1, "POST /api/house-rule-suggestions failed:", err);
    res.status(500).json({ error: "Failed to save suggestion" });
  }
});

// API: list house rule suggestions (admin only - localhost)
app.get("/api/house-rule-suggestions", (req, res) => {
  try {
    // Determine requester IP (works for direct connections)
    const remote = (req.ip || req.socket.remoteAddress || "").toString();
    const allowed =
      remote === "127.0.0.1" ||
      remote === "::1" ||
      remote === "localhost" ||
      remote === "127.0.0.1:3001";
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    
    const suggestions = loadSuggestions();
    res.json({ suggestions });
  } catch (err) {
    debugError(1, "GET /api/house-rule-suggestions failed:", err);
    res.status(500).json({ error: "Failed to list suggestions" });
  }
});

// Admin: delete a game (only from localhost)
app.delete("/admin/games/:id", (req, res) => {
  try {
    // Determine requester IP (works for direct connections). If behind proxy, adjust trust proxy as needed.
    const remote = (req.ip || req.socket.remoteAddress || "").toString();
    const allowed =
      remote === "127.0.0.1" ||
      remote === "::1" ||
      remote === "localhost" ||
      remote === "127.0.0.1:3001";
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const id = String(req.params.id || "");
    if (!id) {
      res.status(400).json({ error: "Missing game id" });
      return;
    }

    // Remove in-memory game from GameManager (authoritative)
    try {
      const removed = GameManager.deleteGame(id);
      if (!removed) {
        debug(1, 
          `DELETE /admin/games/${id}: GameManager.deleteGame returned false (no in-memory game)`
        );
      } else {
        debug(1, 
          `DELETE /admin/games/${id}: GameManager.deleteGame removed in-memory game`
        );
      }
    } catch (e) {
      debugWarn(1, 
        `DELETE /admin/games/${id}: GameManager.deleteGame threw`,
        e
      );
    }

    // Remove persisted rows (events + games metadata)
    const ok = dbDeleteGame(id);
    if (!ok) {
      debugWarn(2, `DELETE /admin/games/${id}: deleteGame returned false`);
    }

    res.json({ ok: true });
  } catch (err) {
    debugError(1, "DELETE /admin/games/:id failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// Admin: delete ALL games (only from localhost)
app.delete("/admin/games", (req, res) => {
  try {
    const remote = (req.ip || req.socket.remoteAddress || "").toString();
    const allowed =
      remote === "127.0.0.1" ||
      remote === "::1" ||
      remote === "localhost" ||
      remote === "127.0.0.1:3001";
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const persisted = dbListGames();
    const ids = persisted.map((r) => String(r.game_id)).filter(Boolean);

    let deleted = 0;
    for (const id of ids) {
      try {
        GameManager.deleteGame(id);
      } catch {
        // best-effort
      }
      try {
        const ok = dbDeleteGame(id);
        if (ok) deleted++;
      } catch (e) {
        debugWarn(1, `DELETE /admin/games: dbDeleteGame threw for ${id}`, e);
      }
    }

    res.json({ ok: true, requested: ids.length, deleted, ids });
  } catch (err) {
    debugError(1, "DELETE /admin/games failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// Handle undefined routes by serving `index.html` (useful for React Router handling)
app.get("*", (req, res) => {
  res.sendFile(path.join(BUILD_PATH, "index.html"), (err) => {
    if (err) {
      debugError(1, `Error serving index.html: ${err.message}`);
      res
        .status(500)
        .send(
          "Static files missing. Ensure `npm run build` was run in the client directory."
        );
    }
  });
});

// Main bootstrap: initialize DB first, then create HTTP + Socket.IO servers and register handlers.
async function main() {
  try {
    debug(1, "[Server] Boot", { bootId: BOOT_ID, pid: process.pid, node: process.version, port: PORT });
    debug(2, "[Server] Initializing database...");
    await initDb();
    debug(2, "[Server] Database initialized successfully.");

    if (startupOptions.wipeGamesOnStartup) {
      const wipeResult = wipeGamesAtStartup();
      debug(1, "[Server] Wiped games at startup", wipeResult);
    }
    
    // Optionally clear planeswalker cache to force re-fetch with loyalty field
    // Set environment variable CLEAR_PLANESWALKER_CACHE=true to enable on startup
    // This is useful after adding new fields like loyalty to the ScryfallCard type
    if (startupOptions.clearPlaneswalkerCache) {
      clearPlaneswalkerCache();
    }

    if (startupOptions.warmLocalCardLookup) {
      const startedAt = Date.now();
      let lastLookupStatusMessage = '';
      debug(1, '[Server] Warming local card lookup table for deck imports...');
      try {
        await ensureLocalCardLookupIndex({
          onStatus: (status) => {
            if (status.message && status.message !== lastLookupStatusMessage) {
              debug(1, '[Server] Local card lookup warmup', { phase: status.phase, message: status.message });
              lastLookupStatusMessage = status.message;
            }
          },
        });
        debug(1, '[Server] Local card lookup table ready', { durationMs: Date.now() - startedAt });
      } catch (lookupError) {
        debugWarn(1, '[Server] Local card lookup warmup failed; deck imports will build or fall back lazily', lookupError);
      }
    }
  } catch (err) {
    debugError(1, "[Server] Failed to initialize database:", err);
    process.exit(1); // Stop the server if the database cannot be initialized
  }

  // Create HTTP and WebSocket server after DB initialization to avoid races when handlers persist/read DB.
  const httpServer = createServer(app);

  // Allow configuring CORS origin via env var in production; default is '*' for dev
  const corsOrigin = startupOptions.corsOrigin;

  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
    },
  });

  // Register Socket.IO handlers
  registerSocketHandlers(io);

  // Start the server bound to localhost only for security (IIS/ARR will reverse-proxy to this)
  httpServer.listen(PORT, "127.0.0.1", () => {
    debug(2, `[Server] Running at http://127.0.0.1:${PORT}`);
    
    // Initialize CLI interface for server management
    setHttpServer(httpServer);
    initCLI();
  });
}

main().catch((err) => {
  debugError(1, "[Server] Unhandled error during startup:", err);
  process.exit(1);
});

