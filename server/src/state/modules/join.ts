// server/src/state/modules/join.ts
// Robust join/leave/disconnect helpers for GameContext.
// join(...) now reuses an existing player record when the same name is provided
// and that player is currently NOT connected. It still honors fixedPlayerId
// when supplied and only creates a new player entry when needed.

import type { GameContext } from "../context";
import type { PlayerID } from "../../../shared/src/types";
import { uid } from "../utils";

/**
 * Ensure internal participant containers exist.
 */
function ensureParticipantContainers(ctx: GameContext) {
  if (!ctx.joinedBySocket) (ctx as any).joinedBySocket = new Map<string, { socketId: string; playerId: PlayerID; spectator: boolean }>();
  if (!Array.isArray((ctx as any).participantsList)) (ctx as any).participantsList = [];
  if (!ctx.state) (ctx as any).state = { players: [], startingLife: 40 } as any;
  if (!Array.isArray((ctx.state as any).players)) (ctx.state as any).players = [];
}

/**
 * Find player index by id in state.players (safe).
 */
function findPlayerIndex(ctx: GameContext, playerId: PlayerID) {
  const players = (ctx.state as any).players || [];
  return players.findIndex((p: any) => p && p.id === playerId);
}

/**
 * Find a player in state.players by name (case-insensitive).
 * Returns the player object or undefined.
 */
function findPlayerByName(ctx: GameContext, playerName?: string) {
  if (!playerName) return undefined;
  const players = (ctx.state as any).players || [];
  const nameLower = String(playerName).trim().toLowerCase();
  return players.find((p: any) => String(p?.name || "").trim().toLowerCase() === nameLower);
}

/**
 * Check whether a playerId is currently connected (has an entry in participantsList or joinedBySocket)
 */
function isPlayerConnected(ctx: GameContext, playerId: PlayerID) {
  try {
    if (ctx.joinedBySocket instanceof Map) {
      for (const [, info] of ctx.joinedBySocket.entries()) {
        if (info && info.playerId === playerId) return true;
      }
    }
    if (Array.isArray((ctx as any).participantsList)) {
      if ((ctx as any).participantsList.some((p: any) => p.playerId === playerId)) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Add a PlayerRef into ctx.state.players if missing.
 * Returns true if newly added.
 */
function addPlayerIfMissing(ctx: GameContext, playerId: PlayerID, playerName: string | undefined) {
  ensureParticipantContainers(ctx);
  const idx = findPlayerIndex(ctx, playerId);
  if (idx >= 0) return false;
  const players = (ctx.state as any).players as any[];
  const newPlayer = {
    id: playerId,
    name: playerName || `Player ${players.length + 1}`,
    seat: players.length,
    isSpectator: false,
  };
  players.push(newPlayer);
  // ensure life default
  if (!ctx.life) (ctx as any).life = {};
  if (typeof ctx.life[playerId] === "undefined") ctx.life[playerId] = ctx.state.startingLife ?? 40;
  return true;
}

/**
 * Public join: register a socket and player in the context.
 *
 * Signature preserved for compatibility:
 * join(ctx, socketId, playerName, spectator, fixedPlayerId, seatTokenFromClient)
 *
 * Returns: { playerId, added: boolean, seatToken?: string }
 *
 * Behavior enhancements:
 * - If fixedPlayerId is provided, prefer it.
 * - Else if a player with the same name exists AND is NOT connected, reuse that playerId.
 * - Otherwise create a new playerId and append to state.players.
 */
export function join(
  ctx: GameContext,
  socketId: string,
  playerName: string,
  spectator = false,
  fixedPlayerId?: string,
  seatTokenFromClient?: string
) {
  ensureParticipantContainers(ctx);

  // Determine playerId to use
  let chosenPlayerId: PlayerID;
  let createdNew = false;

  if (fixedPlayerId) {
    chosenPlayerId = String(fixedPlayerId) as PlayerID;
    // ensure player exists in authoritative list (create if absent)
    const added = addPlayerIfMissing(ctx, chosenPlayerId, playerName);
    createdNew = added;
  } else {
    // Try to find an existing player by name to reuse (if not currently connected)
    const existing = findPlayerByName(ctx, playerName);
    if (existing && existing.id) {
      if (!isPlayerConnected(ctx, existing.id)) {
        // reuse the existing player record
        chosenPlayerId = existing.id;
        createdNew = false;
      } else {
        // already connected: allocate a new player id (allow duplicate names in this case)
        chosenPlayerId = uid("p") as PlayerID;
        const added = addPlayerIfMissing(ctx, chosenPlayerId, playerName);
        createdNew = added;
      }
    } else {
      // no existing player with this name -> create a new one
      chosenPlayerId = uid("p") as PlayerID;
      const added = addPlayerIfMissing(ctx, chosenPlayerId, playerName);
      createdNew = added;
    }
  }

  // participantsList: ensure only one entry per socket, update or add entry for this player
  if (!Array.isArray((ctx as any).participantsList)) (ctx as any).participantsList = [];
  const existingParticipant = (ctx as any).participantsList.find((p: any) => p.playerId === chosenPlayerId);
  if (existingParticipant) {
    existingParticipant.socketId = socketId;
    existingParticipant.spectator = spectator;
  } else {
    (ctx as any).participantsList.push({ socketId, playerId: chosenPlayerId, spectator });
  }

  // joinedBySocket map
  if (!ctx.joinedBySocket) (ctx as any).joinedBySocket = new Map();
  ctx.joinedBySocket.set(String(socketId), { socketId: String(socketId), playerId: chosenPlayerId, spectator });

  // bump seq to indicate presence change if needed
  try { if (typeof ctx.bumpSeq === "function") ctx.bumpSeq(); } catch {}

  return { playerId: chosenPlayerId, added: createdNew, seatToken: seatTokenFromClient || null };
}

/**
 * Leave: remove a player from participants but keep persisted state.
 */
export function leave(ctx: GameContext, playerId?: PlayerID) {
  if (!playerId) return false;
  if (!Array.isArray((ctx as any).participantsList)) return false;
  const idx = (ctx as any).participantsList.findIndex((p: any) => p.playerId === playerId);
  if (idx >= 0) {
    (ctx as any).participantsList.splice(idx, 1);
    // also remove joinedBySocket entries referencing this player
    if (ctx.joinedBySocket instanceof Map) {
      for (const [sock, info] of Array.from(ctx.joinedBySocket.entries())) {
        if (info && info.playerId === playerId) ctx.joinedBySocket.delete(sock);
      }
    }
    try { if (typeof ctx.bumpSeq === "function") ctx.bumpSeq(); } catch {}
    return true;
  }
  return false;
}

/**
 * Disconnect: remove socket registration (preserves player record).
 */
export function disconnect(ctx: GameContext, socketId: string) {
  if (!socketId) return false;
  if (ctx.joinedBySocket instanceof Map) {
    const info = ctx.joinedBySocket.get(String(socketId));
    if (info) {
      ctx.joinedBySocket.delete(String(socketId));
      // remove from participantsList by socketId
      if (Array.isArray((ctx as any).participantsList)) {
        const idx = (ctx as any).participantsList.findIndex((p: any) => p.socketId === String(socketId));
        if (idx >= 0) (ctx as any).participantsList.splice(idx, 1);
      }
      try { if (typeof ctx.bumpSeq === "function") ctx.bumpSeq(); } catch {}
      return true;
    }
  }
  return false;
}

/**
 * participants helper: return shallow copy of participants list
 */
export function participants(ctx: GameContext) {
  ensureParticipantContainers(ctx);
  return ((ctx as any).participantsList || []).map((p: any) => ({ socketId: p.socketId, playerId: p.playerId, spectator: p.spectator }));
}

export default {
  join,
  leave,
  disconnect,
  participants,
};