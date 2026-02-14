// server/src/socket/replay.ts
// Socket handlers for game replay functionality
// Allows watching game replays with playback controls and player focus

import type { Server, Socket } from "socket.io";
import { getEvents } from "../db";
import { createInitialGameState } from "../state/index.js";
import { ensureGame } from "./util";
import { transformDbEventsForReplay } from "./util";
import type { PlayerID } from "../../../shared/src/types.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";

/**
 * Replay session state
 */
interface ReplaySession {
  gameId: string;
  viewerId: string;
  events: any[];
  currentEventIndex: number;
  isPlaying: boolean;
  playbackSpeed: number; // ms per event (default 2000 = 2 seconds)
  focusedPlayerId: PlayerID | null;
  gameState: any; // Current reconstructed game state
  playbackIntervalId?: ReturnType<typeof setInterval>;
}

// Store replay sessions by viewerId (each viewer can have one replay session)
const replaySessions = new Map<string, ReplaySession>();

// Default playback speed (2 seconds per action)
const DEFAULT_PLAYBACK_SPEED = 2000;

/**
 * Clean up a replay session
 */
function cleanupSession(viewerId: string): void {
  const session = replaySessions.get(viewerId);
  if (session) {
    if (session.playbackIntervalId) {
      clearInterval(session.playbackIntervalId);
    }
    replaySessions.delete(viewerId);
  }
}

/**
 * Apply a single event and return the new state
 */
function applyEventToState(game: any, event: any): void {
  if (typeof game.applyEvent === 'function') {
    game.applyEvent(event);
  }
}

/**
 * Generate a view of the game state for replay, optionally focused on a specific player
 */
function generateReplayView(session: ReplaySession, forViewer: string): any {
  const { gameState, focusedPlayerId, events, currentEventIndex } = session;
  
  if (!gameState) {
    return {
      error: "No game state available",
      eventIndex: currentEventIndex,
      totalEvents: events.length,
    };
  }
  
  // Get the current state
  const state = gameState.state || {};
  
  // Build the view
  const view = {
    // Metadata
    gameId: session.gameId,
    isReplay: true,
    eventIndex: currentEventIndex,
    totalEvents: events.length,
    currentEvent: currentEventIndex > 0 && currentEventIndex <= events.length 
      ? events[currentEventIndex - 1] 
      : null,
    isPlaying: session.isPlaying,
    playbackSpeed: session.playbackSpeed,
    focusedPlayerId: focusedPlayerId,
    
    // Game state (full visibility in replay mode)
    phase: state.phase,
    step: state.step,
    turn: state.turn,
    turnPlayer: state.turnPlayer,
    priority: state.priority,
    stack: state.stack || [],
    battlefield: state.battlefield || [],
    players: (state.players || []).map((p: any) => ({
      ...p,
      life: state.life?.[p.id] ?? 40,
    })),
    life: state.life || {},
    zones: {},
    
    // For replays, show all hands and zones (no secrets in replays)
    commandZone: state.commandZone || {},
  };
  
  // Include all player zones with full visibility for replay
  for (const playerId of Object.keys(state.zones || {})) {
    const z = state.zones[playerId] || {};
    view.zones[playerId] = {
      hand: z.hand || [],
      handCount: z.handCount ?? (z.hand?.length ?? 0),
      libraryCount: z.libraryCount ?? 0,
      graveyard: z.graveyard || [],
      graveyardCount: z.graveyardCount ?? (z.graveyard?.length ?? 0),
      exile: z.exile || [],
      exileCount: (z as any).exileCount ?? (z.exile?.length ?? 0),
    };
  }
  
  return view;
}

/**
 * Advance the replay by one event
 */
function advanceReplay(session: ReplaySession, io: Server, viewerSocketId: string): boolean {
  if (session.currentEventIndex >= session.events.length) {
    // Reached end of replay
    session.isPlaying = false;
    if (session.playbackIntervalId) {
      clearInterval(session.playbackIntervalId);
      session.playbackIntervalId = undefined;
    }
    return false;
  }
  
  const event = session.events[session.currentEventIndex];
  
  // Apply the event to the game state
  applyEventToState(session.gameState, event);
  session.currentEventIndex++;
  
  // Emit the updated view
  const view = generateReplayView(session, session.viewerId);
  io.to(viewerSocketId).emit("replayStateUpdate", view);
  
  return true;
}

/**
 * Start/resume automatic playback
 */
function startPlayback(session: ReplaySession, io: Server, viewerSocketId: string): void {
  if (session.isPlaying) return; // Already playing
  
  session.isPlaying = true;
  
  // Clear any existing interval
  if (session.playbackIntervalId) {
    clearInterval(session.playbackIntervalId);
  }
  
  // Set up playback interval
  session.playbackIntervalId = setInterval(() => {
    if (!advanceReplay(session, io, viewerSocketId)) {
      // Replay complete
      io.to(viewerSocketId).emit("replayComplete", {
        gameId: session.gameId,
        totalEvents: session.events.length,
      });
    }
  }, session.playbackSpeed);
}

/**
 * Pause playback
 */
function pausePlayback(session: ReplaySession): void {
  session.isPlaying = false;
  if (session.playbackIntervalId) {
    clearInterval(session.playbackIntervalId);
    session.playbackIntervalId = undefined;
  }
}

export function registerReplayHandlers(io: Server, socket: Socket) {
  const getPlayerIds = (game: any): string[] => {
    const players = game.state?.players || [];
    return players
      .filter((p: any) => p && !p.spectator)
      .map((p: any) => p.id);
  };

  const getReplayRequesterContext = (gameId: string) => {
    const playerId = socket.data.playerId;

    if (!socket.rooms.has(gameId)) {
      socket.emit("error", {
        code: "NOT_IN_GAME",
        message: "You are not in this game",
      });
      return null;
    }

    if (!playerId) return null;

    if (socket.data.spectator) {
      socket.emit("error", {
        code: "SPECTATOR_CANNOT_REPLAY",
        message: "Spectators cannot start replays",
      });
      return null;
    }

    const game = ensureGame(gameId);
    if (!game) return null;

    const playerIds = getPlayerIds(game);
    if (!playerIds.includes(playerId)) {
      socket.emit("error", {
        code: "NOT_IN_GAME",
        message: "You are not in this game",
      });
      return null;
    }

    if (!(game.state as any)?.gameOver) {
      socket.emit("error", {
        code: "REPLAY_NOT_AVAILABLE",
        message: "Replay is only available after the game is over",
      });
      return null;
    }

    return { game, playerId };
  };

  /**
   * Start a replay session for a game
   */
  socket.on("startReplay", ({ gameId }: { gameId: string }) => {
    try {
      const ctx = getReplayRequesterContext(gameId);
      if (!ctx) return;

      const viewerId = socket.id;
      
      // Clean up any existing session for this viewer
      cleanupSession(viewerId);
      
      // Get the game events from the database
      let dbEvents: any[];
      try {
        dbEvents = getEvents(gameId);
      } catch (e) {
        debugWarn(1, `[replay] Failed to get events for game ${gameId}:`, e);
        socket.emit("error", {
          code: "REPLAY_NO_EVENTS",
          message: "Could not load game events for replay",
        });
        return;
      }
      
      if (!dbEvents || dbEvents.length === 0) {
        socket.emit("error", {
          code: "REPLAY_EMPTY",
          message: "No events found for this game",
        });
        return;
      }
      
      // Transform events to replay format
      const events = transformDbEventsForReplay(dbEvents);
      
      // Create a fresh game context for replay
      const gameState = createInitialGameState(gameId);
      
      // Create the replay session
      const session: ReplaySession = {
        gameId,
        viewerId,
        events,
        currentEventIndex: 0,
        isPlaying: false,
        playbackSpeed: DEFAULT_PLAYBACK_SPEED,
        focusedPlayerId: null,
        gameState,
      };
      
      replaySessions.set(viewerId, session);
      
      // Send initial state
      socket.emit("replayStarted", {
        gameId,
        totalEvents: events.length,
        playbackSpeed: session.playbackSpeed,
        state: generateReplayView(session, viewerId),
      });
      
      debug(2, `[replay] Started replay session for game ${gameId}, viewer ${viewerId}, ${events.length} events`);
    } catch (err: any) {
      debugError(1, `startReplay error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "REPLAY_START_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });
  
  /**
   * Play/resume the replay
   */
  socket.on("replayPlay", () => {
    const viewerId = socket.id;
    const session = replaySessions.get(viewerId);
    
    if (!session) {
      socket.emit("error", {
        code: "NO_REPLAY_SESSION",
        message: "No active replay session",
      });
      return;
    }
    
    startPlayback(session, io, socket.id);
    socket.emit("replayPlaying", { isPlaying: true });
  });
  
  /**
   * Pause the replay
   */
  socket.on("replayPause", () => {
    const viewerId = socket.id;
    const session = replaySessions.get(viewerId);
    
    if (!session) return;
    
    pausePlayback(session);
    socket.emit("replayPaused", { isPlaying: false });
  });
  
  /**
   * Step forward one event
   */
  socket.on("replayStepForward", () => {
    const viewerId = socket.id;
    const session = replaySessions.get(viewerId);
    
    if (!session) {
      socket.emit("error", {
        code: "NO_REPLAY_SESSION",
        message: "No active replay session",
      });
      return;
    }
    
    // Pause automatic playback if playing
    pausePlayback(session);
    
    // Advance one event
    if (advanceReplay(session, io, socket.id)) {
      // Successfully advanced
    } else {
      // End of replay
      socket.emit("replayComplete", {
        gameId: session.gameId,
        totalEvents: session.events.length,
      });
    }
  });
  
  /**
   * Step backward one event (replay from beginning to target index)
   */
  socket.on("replayStepBackward", () => {
    const viewerId = socket.id;
    const session = replaySessions.get(viewerId);
    
    if (!session) {
      socket.emit("error", {
        code: "NO_REPLAY_SESSION",
        message: "No active replay session",
      });
      return;
    }
    
    // Pause automatic playback
    pausePlayback(session);
    
    if (session.currentEventIndex <= 0) {
      // Already at beginning
      socket.emit("replayStateUpdate", generateReplayView(session, viewerId));
      return;
    }
    
    const targetIndex = session.currentEventIndex - 1;
    
    // Reset game state and replay up to targetIndex
    session.gameState = createInitialGameState(session.gameId);
    session.currentEventIndex = 0;
    
    for (let i = 0; i < targetIndex; i++) {
      applyEventToState(session.gameState, session.events[i]);
      session.currentEventIndex++;
    }
    
    socket.emit("replayStateUpdate", generateReplayView(session, viewerId));
  });
  
  /**
   * Jump to a specific event index
   */
  socket.on("replayJumpTo", ({ eventIndex }: { eventIndex: number }) => {
    const viewerId = socket.id;
    const session = replaySessions.get(viewerId);
    
    if (!session) {
      socket.emit("error", {
        code: "NO_REPLAY_SESSION",
        message: "No active replay session",
      });
      return;
    }
    
    // Pause automatic playback
    pausePlayback(session);
    
    // Clamp index to valid range
    const targetIndex = Math.max(0, Math.min(eventIndex, session.events.length));
    
    // Reset game state and replay up to targetIndex
    session.gameState = createInitialGameState(session.gameId);
    session.currentEventIndex = 0;
    
    for (let i = 0; i < targetIndex; i++) {
      applyEventToState(session.gameState, session.events[i]);
      session.currentEventIndex++;
    }
    
    socket.emit("replayStateUpdate", generateReplayView(session, viewerId));
  });
  
  /**
   * Set playback speed
   */
  socket.on("replaySetSpeed", ({ speed }: { speed: number }) => {
    const viewerId = socket.id;
    const session = replaySessions.get(viewerId);
    
    if (!session) return;
    
    // Clamp speed between 100ms (fast) and 10000ms (slow)
    session.playbackSpeed = Math.max(100, Math.min(10000, speed));
    
    // If playing, restart the interval with new speed
    if (session.isPlaying) {
      if (session.playbackIntervalId) {
        clearInterval(session.playbackIntervalId);
      }
      startPlayback(session, io, socket.id);
    }
    
    socket.emit("replaySpeedChanged", { speed: session.playbackSpeed });
  });
  
  /**
   * Set focused player for the replay view
   */
  socket.on("replaySetFocusPlayer", ({ playerId }: { playerId: PlayerID | null }) => {
    const viewerId = socket.id;
    const session = replaySessions.get(viewerId);
    
    if (!session) return;
    
    session.focusedPlayerId = playerId;
    
    // Emit updated view with new focus
    socket.emit("replayStateUpdate", generateReplayView(session, viewerId));
  });
  
  /**
   * Get list of players in the replay (for focus selection UI)
   */
  socket.on("replayGetPlayers", () => {
    const viewerId = socket.id;
    const session = replaySessions.get(viewerId);
    
    if (!session) {
      socket.emit("error", {
        code: "NO_REPLAY_SESSION",
        message: "No active replay session",
      });
      return;
    }
    
    const players = (session.gameState?.state?.players || []).map((p: any) => ({
      id: p.id,
      name: p.name || p.id,
      isAI: p.isAI || false,
    }));
    
    socket.emit("replayPlayers", {
      gameId: session.gameId,
      players,
      focusedPlayerId: session.focusedPlayerId,
    });
  });
  
  /**
   * Get event list for scrubber/timeline UI
   */
  socket.on("replayGetEvents", () => {
    const viewerId = socket.id;
    const session = replaySessions.get(viewerId);
    
    if (!session) {
      socket.emit("error", {
        code: "NO_REPLAY_SESSION",
        message: "No active replay session",
      });
      return;
    }
    
    // Return simplified event list for UI display
    const eventSummaries = session.events.map((e: any, index: number) => ({
      index,
      type: e.type,
      playerId: e.playerId,
      // Add summary based on event type
      summary: getEventSummary(e),
    }));
    
    socket.emit("replayEventList", {
      gameId: session.gameId,
      events: eventSummaries,
      currentEventIndex: session.currentEventIndex,
    });
  });
  
  /**
   * Stop/close the replay session
   */
  socket.on("replayStop", () => {
    const viewerId = socket.id;
    cleanupSession(viewerId);
    socket.emit("replayStopped", {});
    debug(2, `[replay] Stopped replay session for viewer ${viewerId}`);
  });
  
  /**
   * Clean up on disconnect
   */
  socket.on("disconnect", () => {
    cleanupSession(socket.id);
  });
}

/**
 * Generate a human-readable summary of an event
 */
function getEventSummary(event: any): string {
  if (!event || !event.type) return "Unknown event";
  
  switch (event.type) {
    case "rngSeed":
      return "Game started (RNG initialized)";
    case "join":
      return `${event.name || event.playerId || 'Player'} joined`;
    case "deckImportResolved":
      return `${event.playerId || 'Player'} imported deck`;
    case "setCommander":
      return `${event.playerId || 'Player'} set commander: ${event.commanderNames?.join(', ') || 'Unknown'}`;
    case "shuffleLibrary":
      return `${event.playerId || 'Player'} shuffled library`;
    case "drawCards":
      return `${event.playerId || 'Player'} drew ${event.count || 1} card(s)`;
    case "mulligan":
      return `${event.playerId || 'Player'} mulliganed`;
    case "keepHand":
      return `${event.playerId || 'Player'} kept hand`;
    case "playLand":
      return `${event.playerId || 'Player'} played ${event.card?.name || 'a land'}`;
    case "castSpell":
      return `${event.playerId || 'Player'} cast ${event.card?.name || 'a spell'}`;
    case "passPriority":
      return `${event.by || event.playerId || 'Player'} passed priority`;
    case "nextStep":
      return "Advanced to next step";
    case "nextTurn":
      return "Turn ended";
    case "declareAttackers":
      return "Declared attackers";
    case "declareBlockers":
      return "Declared blockers";
    case "adjustLife":
    case "setLife":
      return `Life change for ${event.playerId || 'player'}`;
    case "concede":
      return `${event.playerName || event.playerId || 'Player'} conceded`;
    case "foretellCard":
      return `${event.playerId || 'Player'} foretold a card`;
    case "phaseOutPermanents":
      return `Permanents phased out`;
    case "equipPermanent":
      return `Equipped ${event.equipmentName || 'equipment'} to ${event.targetCreatureName || 'creature'}`;
    case "tapPermanent":
      return `Tapped permanent`;
    case "untapPermanent":
      return `Untapped permanent`;
    case "resolveTopOfStack":
      return "Resolved stack item";
    case "createToken":
      return `Created ${event.count || 1} ${event.name || 'token'}(s)`;
    case "updateCounters":
      return "Counter(s) updated";
    case "sacrificePermanent":
      return "Sacrificed permanent";
    case "crewVehicle":
      return `${event.playerId || 'Player'} crewed a Vehicle`;
    case "enlist":
      return `${event.playerId || 'Player'} enlisted a creature`;
    case "reorderHand":
      return `${event.playerId || 'Player'} reordered hand`;
    case "shuffleHand":
      return `${event.playerId || 'Player'} shuffled hand`;
    default:
      return event.type;
  }
}

