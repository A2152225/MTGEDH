// server/src/socket/util-handlers/stateDeltaEmit.ts
// Per-socket delta broadcasts. Each delta-capable socket keeps the last versioned
// view it was sent (socket.data, so it dies with the socket). Later broadcasts
// send only a structural diff (shared/src/stateDelta.ts) with baseVersion and
// newVersion; the client asks for a full resync (requestState) on any gap.
// Full state still goes out on join / reconnect / resync / forceStateReplace, and
// whenever the patch would exceed STATE_DELTA_MAX_RATIO of the full view.
// Views stay per viewer: a socket is only ever diffed against its own last view.
//
// Kill switch: MTGEDH_STATE_DELTA=0 (or false/off/no) sends full state always.

import type { Server, Socket } from "socket.io";
import { diffStateViews } from "../../../../shared/src/stateDelta.js";

export const STATE_DELTA_MAX_RATIO = 0.5;
const CACHE_KEY = "__stateDeltaCache";

type DeltaCache = { gameId: string; version: number; snap: unknown };

let enabledOverride: boolean | null = null;

/** Tests only: force the flag (null = read env again). */
export function setStateDeltaEnabledOverride(value: boolean | null): void {
  enabledOverride = value;
}

export function isStateDeltaEnabled(): boolean {
  if (enabledOverride !== null) return enabledOverride;
  const raw = String(process.env.MTGEDH_STATE_DELTA ?? "").trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

function clientSupportsDelta(sock: Socket | undefined): boolean {
  const flag = (sock as any)?.handshake?.auth?.stateDelta;
  return flag === 1 || flag === true || flag === "1";
}

export function resetStateDeltaForSocket(sock: Socket | undefined | null): void {
  try {
    if (sock && (sock as any).data) delete (sock as any).data[CACHE_KEY];
  } catch {
    // ignore
  }
}

/** A room-wide unversioned "state" makes every cached base unknown. */
export function resetStateDeltaForRoom(io: Server, gameId: string): void {
  try {
    const room = io.sockets?.adapter?.rooms?.get(String(gameId));
    if (!room) return;
    for (const socketId of room) resetStateDeltaForSocket(io.sockets?.sockets?.get(socketId));
  } catch {
    // ignore
  }
}

export type VersionedStatePayload = {
  gameId: string;
  view: unknown;
  seq?: number;
  forceStateReplace?: boolean;
  [extra: string]: unknown;
};

export type StateEmitResult = { kind: "plain" | "full" | "delta"; bytes: number; fullBytes: number };

/** Emit one viewer's state to one socket, as a delta when safe. */
export function emitVersionedState(io: Server, socketId: string, payload: VersionedStatePayload): StateEmitResult {
  const sock = io.sockets?.sockets?.get(socketId) as Socket | undefined;
  if (!isStateDeltaEnabled() || !sock || !clientSupportsDelta(sock)) {
    io.to(socketId).emit("state", payload);
    return { kind: "plain", bytes: -1, fullBytes: -1 };
  }
  const gameId = String(payload.gameId);
  const json = JSON.stringify(payload.view ?? null);
  // Snapshot exactly what the client will deserialize; the live view shares objects with game state.
  const snap = JSON.parse(json);
  const data = (sock as any).data || ((sock as any).data = {});
  const prev = data[CACHE_KEY] as DeltaCache | undefined;
  const version = (prev?.version || 0) + 1;

  if (prev && prev.gameId === gameId && !payload.forceStateReplace) {
    try {
      const ops = diffStateViews(prev.snap, snap);
      const opsBytes = JSON.stringify(ops).length;
      if (opsBytes <= json.length * STATE_DELTA_MAX_RATIO) {
        data[CACHE_KEY] = { gameId, version, snap } as DeltaCache;
        sock.emit("stateDelta" as any, {
          gameId,
          baseVersion: prev.version,
          newVersion: version,
          seq: payload.seq,
          ops,
        });
        return { kind: "delta", bytes: opsBytes, fullBytes: json.length };
      }
    } catch {
      // fall through to full
    }
  }

  data[CACHE_KEY] = { gameId, version, snap } as DeltaCache;
  sock.emit("state", { ...payload, viewVersion: version });
  return { kind: "full", bytes: json.length, fullBytes: json.length };
}

/** Joins and explicit refreshes send unversioned full state; drop the cached base. */
export function registerStateDeltaHandlers(_io: Server, socket: Socket): void {
  socket.on("joinGame", () => resetStateDeltaForSocket(socket));
  socket.on("requestState", () => resetStateDeltaForSocket(socket));
  socket.on("leaveGame", () => resetStateDeltaForSocket(socket));
}