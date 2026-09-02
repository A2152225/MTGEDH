/**
 * 20s reconnect grace after a raw socket disconnect (refresh/drop).
 *
 * While grace is active AND the seated player has no participant socket,
 * idle / Smart-Pass / timeout auto-pass must not skip the game forward.
 * Expiry only drops the grace — it does not force a pass.
 *
 * leaveGame must not start this grace (that path is concede-and-pass-now).
 */

export const DISCONNECT_AUTOPASS_GRACE_MS = 20_000;

type GraceEntry = {
  timeout: ReturnType<typeof setTimeout>;
};

const graceBySeat = new Map<string, GraceEntry>();

function graceKey(gameId: string, playerId: string): string {
  return `${String(gameId)}\u0000${String(playerId)}`;
}

function isSpectatorParticipant(participant: any): boolean {
  return Boolean(participant?.spectator || participant?.isSpectator);
}

export function playerHasSeatedParticipant(game: any, playerId: string): boolean {
  const pid = String(playerId || "").trim();
  if (!pid || !game) return false;

  const matches = (participant: any): boolean => {
    if (!participant) return false;
    const participantId = String(participant.playerId || participant.id || "").trim();
    if (participantId !== pid) return false;
    if (!participant.socketId) return false;
    if (isSpectatorParticipant(participant)) return false;
    return true;
  };

  try {
    if (game.joinedBySocket instanceof Map) {
      for (const participant of game.joinedBySocket.values()) {
        if (matches(participant)) return true;
      }
    }
  } catch {
    // non-fatal
  }

  try {
    if (typeof game.participants === "function") {
      const list = game.participants();
      if (Array.isArray(list) && list.some(matches)) return true;
    }
  } catch {
    // non-fatal
  }

  try {
    if (Array.isArray(game.participantsList) && game.participantsList.some(matches)) {
      return true;
    }
  } catch {
    // non-fatal
  }

  return false;
}

export function hasDisconnectAutoPassGrace(gameId: string, playerId: string): boolean {
  return graceBySeat.has(graceKey(gameId, playerId));
}

/**
 * True when this seated player is in reconnect grace AND has no participant socket.
 * Auto-pass callers must treat them as not idle / not eligible.
 */
export function isDisconnectAutoPassGraceBlocking(
  gameId: string,
  playerId: string,
  game: any,
): boolean {
  const gid = String(gameId || "").trim();
  const pid = String(playerId || "").trim();
  if (!gid || !pid) return false;
  if (!hasDisconnectAutoPassGrace(gid, pid)) return false;
  return !playerHasSeatedParticipant(game, pid);
}

export function clearDisconnectAutoPassGrace(gameId: string, playerId: string): void {
  const key = graceKey(gameId, playerId);
  const entry = graceBySeat.get(key);
  if (!entry) return;
  clearTimeout(entry.timeout);
  graceBySeat.delete(key);
}

/**
 * Start (or restart) the 20s grace. Does not force a pass when it expires.
 * Do not call this while the player is connected / after a successful rejoin.
 */
export function startDisconnectAutoPassGrace(gameId: string, playerId: string): void {
  const gid = String(gameId || "").trim();
  const pid = String(playerId || "").trim();
  if (!gid || !pid) return;
  clearDisconnectAutoPassGrace(gid, pid);
  const timeout = setTimeout(() => {
    graceBySeat.delete(graceKey(gid, pid));
  }, DISCONNECT_AUTOPASS_GRACE_MS);
  graceBySeat.set(graceKey(gid, pid), { timeout });
}

export function clearAllDisconnectAutoPassGraceForTests(): void {
  for (const entry of graceBySeat.values()) {
    clearTimeout(entry.timeout);
  }
  graceBySeat.clear();
}
