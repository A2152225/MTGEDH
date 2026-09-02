/**
 * Origin parent: server/src/socket/join.ts
 *
 * Pre-game spectator <-> seated-player conversion for the same socket.
 * Play-while-spectating must flip the existing roster row instead of
 * no-op reattach or name-matching another seat (e.g. an AI named Player).
 *
 * Public entry symbols: isPreGamePhase, findExistingSeatForSocket,
 * applyPreGameSeatRole, tryConvertPreGameSeat, syncOwnPreGameSeatRole.
 */

import { randomBytes } from "crypto";

function makeSeatToken() {
  return randomBytes(6).toString("hex");
}

export function isPreGamePhase(game: any): boolean {
  const phase = String(game?.state?.phase || "").toLowerCase();
  return phase === "" || phase === "pre_game";
}

function playerFlaggedSpectator(player: any): boolean {
  return !!(player?.spectator || player?.isSpectator);
}

/** Same-socket identity already in this game. Does not use display name. */
export function findExistingSeatForSocket(game: any, socket: any, gameId: string): string | null {
  if (!game || !socket || !gameId) return null;
  try {
    const data = socket.data || {};
    if (data.gameId && String(data.gameId) === String(gameId) && data.playerId) {
      return String(data.playerId);
    }
  } catch {
    /* ignore */
  }
  try {
    const bound = game.joinedBySocket?.get?.(socket.id);
    if (bound?.playerId) return String(bound.playerId);
  } catch {
    /* ignore */
  }
  try {
    const participants = Array.isArray(game.participantsList) ? game.participantsList : [];
    const fromList = participants.find((p: any) => p && p.socketId === socket.id && p.playerId);
    if (fromList?.playerId) return String(fromList.playerId);
  } catch {
    /* ignore */
  }
  try {
    const players = Array.isArray(game.state?.players) ? game.state.players : [];
    const bySocket = players.find((p: any) => p && p.socketId === socket.id && p.id);
    if (bySocket?.id) return String(bySocket.id);
  } catch {
    /* ignore */
  }
  return null;
}

function nextSeat(players: any[]): number {
  const used = new Set(
    (players || [])
      .filter((p: any) => p && !playerFlaggedSpectator(p) && p.seat != null)
      .map((p: any) => Number(p.seat))
      .filter((n: number) => Number.isFinite(n))
  );
  let seat = 0;
  while (used.has(seat)) seat += 1;
  return seat;
}

export function applyPreGameSeatRole(
  game: any,
  playerId: string,
  spectator: boolean,
  opts: { socket: any; playerName?: string; seatToken?: string },
): { playerId: string; seatToken?: string; added: boolean; converted: boolean } {
  game.state = game.state || {};
  game.state.players = game.state.players || [];
  const players = game.state.players as any[];
  let player = players.find((p: any) => p && String(p.id) === String(playerId));
  let added = false;
  const token = opts.seatToken || player?.seatToken || makeSeatToken();
  const name = (opts.playerName && String(opts.playerName).trim()) || player?.name || (spectator ? "Spectator" : "Player");

  if (!player) {
    player = {
      id: playerId,
      name,
      spectator: Boolean(spectator),
      isSpectator: Boolean(spectator),
      seatToken: token,
      socketId: opts.socket?.id,
    };
    if (!spectator) player.seat = nextSeat(players);
    players.push(player);
    added = true;
  } else {
    player.socketId = opts.socket?.id || player.socketId;
    if (!player.seatToken) player.seatToken = token;
    if (name && !player.name) player.name = name;
  }

  const wasSpectator = playerFlaggedSpectator(player);
  player.spectator = Boolean(spectator);
  player.isSpectator = Boolean(spectator);
  if (!spectator) {
    player.inactive = false;
    if (player.seat == null) player.seat = nextSeat(players.filter((p: any) => p !== player));
    try { game.spectatorNames?.delete?.(playerId); } catch { /* ignore */ }
  } else {
    try { game.spectatorNames?.set?.(playerId, name); } catch { /* ignore */ }
  }

  try {
    if (game.joinedBySocket instanceof Map && opts.socket?.id) {
      game.joinedBySocket.set(opts.socket.id, {
        socketId: opts.socket.id,
        playerId,
        spectator: Boolean(spectator),
      });
    }
  } catch {
    /* ignore */
  }
  try {
    if (Array.isArray(game.participantsList)) {
      for (const entry of game.participantsList) {
        if (entry && (entry.socketId === opts.socket?.id || entry.playerId === playerId)) {
          entry.socketId = opts.socket?.id || entry.socketId;
          entry.playerId = playerId;
          entry.spectator = Boolean(spectator);
        }
      }
    }
  } catch {
    /* ignore */
  }

  return {
    playerId,
    seatToken: player.seatToken || token,
    added,
    converted: wasSpectator !== Boolean(spectator) || added,
  };
}

/**
 * If this socket is already in gameId during PRE_GAME, reuse that same
 * player id and apply the requested spectator/player role. Returns null
 * when there is no same-socket seat (caller should use normal join) or
 * the game has already started (no convert).
 */
export function tryConvertPreGameSeat(opts: {
  game: any;
  socket: any;
  gameId: string;
  spectator: boolean;
  playerName?: string;
  seatToken?: string;
}): { playerId: string; seatToken?: string; added: boolean; converted: boolean } | null {
  const { game, socket, gameId, spectator, playerName, seatToken } = opts;
  const existingId = findExistingSeatForSocket(game, socket, gameId);
  if (!existingId) return null;
  if (!isPreGamePhase(game)) return null;
  return applyPreGameSeatRole(game, existingId, Boolean(spectator), {
    socket,
    playerName,
    seatToken,
  });
}

/** After a join resolved to playerId, flip flags only if that id was already ours. */
export function syncOwnPreGameSeatRole(opts: {
  game: any;
  socket: any;
  gameId: string;
  playerId: string;
  spectator: boolean;
  playerName?: string;
  seatToken?: string;
  existingOwnId?: string | null;
}): boolean {
  const { game, socket, gameId, playerId, spectator, playerName, seatToken } = opts;
  if (!playerId || !isPreGamePhase(game)) return false;
  const ownId = opts.existingOwnId ?? findExistingSeatForSocket(game, socket, gameId);
  if (!ownId || String(ownId) !== String(playerId)) return false;
  applyPreGameSeatRole(game, playerId, Boolean(spectator), { socket, playerName, seatToken });
  return true;
}
