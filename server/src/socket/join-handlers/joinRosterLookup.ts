// Origin parent: server/src/socket/join.ts
// Cluster moved: roster lookup used while seating a player.
// Public entry symbols: safeParticipants, findPlayerByName, findPlayerBySeatToken, makeSeatToken, upsertParticipantBinding.

import { randomBytes } from "crypto";

export function safeParticipants(game: any) {
  try {
    if (!game) return [];
    if (typeof game.participants === "function") return game.participants();
    if (Array.isArray((game as any).participantsList))
      return (game as any).participantsList;
    return game.state && Array.isArray(game.state.players)
      ? game.state.players.map((p: any) => ({
          playerId: p.id,
          socketId: (p as any).socketId ?? undefined,
          spectator: !!(p.spectator || p.isSpectator),
        }))
      : [];
  } catch {
    return [];
  }
}

function isReconnectablePlayer(player: any) {
  return !player?.leftGame && !player?.conceded && !player?.hasLost && !player?.eliminated;
}

/** Find a roster entry by display name (case-insensitive, trimmed) */
export function findPlayerByName(game: any, name?: string) {
  if (!name) return undefined;
  try {
    const nm = String(name).trim().toLowerCase();
    if (!game || !game.state || !Array.isArray(game.state.players))
      return undefined;
    return (game.state.players as any[]).find(
      (p) => isReconnectablePlayer(p) && String(p?.name || "").trim().toLowerCase() === nm
    );
  } catch {
    return undefined;
  }
}

/** Find a roster entry by seatToken */
export function findPlayerBySeatToken(game: any, token?: string) {
  if (!token) return undefined;
  try {
    if (!game || !game.state || !Array.isArray(game.state.players))
      return undefined;
    return (game.state.players as any[]).find(
      (p) => isReconnectablePlayer(p) && p?.seatToken && String(p.seatToken) === String(token)
    );
  } catch {
    return undefined;
  }
}

/** Generate a short seat token */
export function makeSeatToken() {
  return randomBytes(6).toString("hex");
}

export function upsertParticipantBinding(
  game: any,
  socketId: string,
  playerId: string,
  spectator: boolean
) {
  const participant = {
    socketId,
    playerId,
    spectator: Boolean(spectator),
  };

  try {
    if ((game as any)?.joinedBySocket instanceof Map) {
      for (const [existingSocketId, existingParticipant] of (game as any)
        .joinedBySocket as Map<string, { socketId: string; playerId: string; spectator: boolean }>) {
        if (
          existingSocketId === socketId ||
          existingParticipant?.playerId === playerId
        ) {
          (game as any).joinedBySocket.delete(existingSocketId);
        }
      }
      (game as any).joinedBySocket.set(socketId, participant);
    }
  } catch {
    // non-fatal
  }

  try {
    if (Array.isArray((game as any)?.participantsList)) {
      for (
        let index = (game as any).participantsList.length - 1;
        index >= 0;
        index--
      ) {
        const existing = (game as any).participantsList[index];
        if (
          existing?.socketId === socketId ||
          existing?.playerId === playerId
        ) {
          (game as any).participantsList.splice(index, 1);
        }
      }
      (game as any).participantsList.push(participant);
    }
  } catch {
    // non-fatal
  }
}
