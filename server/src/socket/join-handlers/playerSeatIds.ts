// Seat ids used in logs and zone maps.
// Logged-in accounts: U_<username> (stable across games).
// Guests: caller keeps a random p_ id.
// AI: AI_<Name>_<rand>, new for each seat.
// Public entry symbols: accountPlayerSeatId, aiPlayerSeatId, isAiSeatId, decideLoggedInSeat, joinAiPlayerSeat.

import { safeParticipants } from "./joinRosterLookup.js";

const ACCOUNT_USERNAME_RE = /^[a-z0-9_]{2,24}$/;

/** Stable in-game seat id for a logged-in account. Null when the login name is not a safe key. */
export function accountPlayerSeatId(username: unknown): string | null {
  const name = String(username || "").trim().toLowerCase();
  if (!ACCOUNT_USERNAME_RE.test(name)) return null;
  return `U_${name}`;
}

/** AI seat id: AI_<letters and digits from the display name>_<rand>. */
export function aiPlayerSeatId(displayName: unknown, takenIds?: Iterable<unknown>): string {
  const slug = String(displayName || "").replace(/[^A-Za-z0-9]+/g, "").slice(0, 24) || "Opponent";
  const taken = new Set(Array.from(takenIds || [], (id) => String(id || "")));
  for (let attempt = 0; attempt < 6; attempt++) {
    const id = `AI_${slug}_${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.has(id)) return id;
  }
  return `AI_${slug}_${Math.random().toString(36).slice(2, 12)}`;
}

export function isAiSeatId(playerId: unknown): boolean {
  return /^ai_/i.test(String(playerId || ""));
}

export type LoggedInSeatDecision =
  | { action: "none" }
  | { action: "assign"; playerId: string }
  | { action: "reuse"; playerId: string; seatToken?: string }
  | {
      action: "nameInUse";
      payload: {
        gameId: string;
        playerName: string;
        options: Array<{ action: "reconnect" | "newName" | "cancel"; fixedPlayerId?: string }>;
        meta: { isConnected: true };
      };
    };

/**
 * Pick the logged-in account's seat when this join is not already a reconnect.
 * An occupied seat prompts reconnect. An empty seat is reused. A new table gets U_<username>.
 */
export function decideLoggedInSeat(args: {
  game: any;
  gameId: string;
  spectator: boolean;
  username: unknown;
  currentSocketId?: string;
  alreadyForcedId?: string;
  joiningName?: string;
}): LoggedInSeatDecision {
  if (args.spectator || args.alreadyForcedId) return { action: "none" };
  const playerId = accountPlayerSeatId(args.username);
  if (!playerId) return { action: "none" };

  const players = Array.isArray(args.game?.state?.players) ? args.game.state.players : [];
  const existing = players.find((player: any) => String(player?.id || "") === playerId);
  if (!existing) return { action: "assign", playerId };

  const takenByOther = safeParticipants(args.game).some((participant: any) =>
    String(participant?.playerId || "") === playerId
    && Boolean(participant?.socketId)
    && String(participant.socketId) !== String(args.currentSocketId || "")
  );
  if (takenByOther) {
    return {
      action: "nameInUse",
      payload: {
        gameId: args.gameId,
        playerName: String(existing.name || args.joiningName || playerId),
        options: [
          { action: "reconnect", fixedPlayerId: playerId },
          { action: "newName" },
          { action: "cancel" },
        ],
        meta: { isConnected: true },
      },
    };
  }

  return {
    action: "reuse",
    playerId,
    seatToken: typeof existing.seatToken === "string" ? existing.seatToken : undefined,
  };
}

/** Join an AI seat with an AI_<Name>_<rand> id. Returns that id even if game.join throws. */
export function joinAiPlayerSeat(
  game: any,
  displayName: string,
  socketSuffix = "",
): { playerId: string; seatToken?: string } {
  const players = Array.isArray(game?.state?.players) ? game.state.players : [];
  const planned = aiPlayerSeatId(displayName, players.map((player: any) => player?.id));
  if (typeof game?.join !== "function") return { playerId: planned };
  try {
    const result = game.join(
      `ai_socket_${Date.now().toString(36)}${socketSuffix}`,
      displayName,
      false,
      planned,
    );
    const joinedId = String(result?.playerId || "").trim();
    const seatToken = typeof result?.seatToken === "string" ? result.seatToken : undefined;
    return { playerId: joinedId || planned, seatToken };
  } catch {
    return { playerId: planned };
  }
}
