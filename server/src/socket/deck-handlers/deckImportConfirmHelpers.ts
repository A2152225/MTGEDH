/**
 * Origin parent: server/src/socket/deck.ts
 *
 * Cluster moved: confirm broadcast/cancel, pending-initial-draw flags,
 * snapshot restore, transient-zone clear, active-player ids, and
 * commander-name suggestions used by confirmed imports.
 *
 * Public entry symbols: broadcastConfirmUpdate, addPendingInitialDrawFlag,
 * removePendingInitialDrawFlag, restoreSnapshotIfPresent, cancelConfirmation,
 * clearPlayerTransientZonesForImport, getActivePlayerIds, suggestCommanderNames.
 */
import type { Server } from "socket.io";
import type { GameState, KnownCardRef, PlayerID } from "../../../../shared/src";
import { debug, debugWarn } from "../../utils/debug.js";
import { broadcastGame, ensureGame } from "../util";
import {
  cancelImportWipeConfirmResolutionSteps,
  pendingImportConfirmations,
  type PendingConfirm,
} from "./deckImportConfirmState.js";

export function broadcastConfirmUpdate(
  io: Server,
  confirmId: string,
  p: PendingConfirm
) {
  try {
    io.to(p.gameId).emit("importWipeConfirmUpdate", {
      confirmId,
      responses: p.responses,
    });
  } catch (err) {
    debugWarn(1, "broadcastConfirmUpdate failed", err);
  }
}

/* --- pendingInitialDraw helpers --- */
export function addPendingInitialDrawFlag(game: any, pid: PlayerID) {
  try {
    if (!game) return;
    if (
      (game as any).pendingInitialDraw &&
      typeof (game as any).pendingInitialDraw.add === "function"
    ) {
      (game as any).pendingInitialDraw.add(pid);
    } else {
      (game as any).pendingInitialDraw =
        (game as any).pendingInitialDraw || new Set<PlayerID>();
      (game as any).pendingInitialDraw.add(pid);
    }
    debug(1, "[deck] addPendingInitialDrawFlag", {
      gameId: game?.id ?? game?.state?.id ?? null,
      playerId: pid,
      pendingInitialDrawSize: (game as any).pendingInitialDraw?.size ?? null,
    });
  } catch (e) {
    debugWarn(1, "addPendingInitialDrawFlag failed:", e);
  }
}
export function removePendingInitialDrawFlag(game: any, pid: PlayerID) {
  try {
    if (!game) return;
    if (
      (game as any).pendingInitialDraw &&
      typeof (game as any).pendingInitialDraw.delete === "function"
    ) {
      (game as any).pendingInitialDraw.delete(pid);
    } else if (
      (game as any).pendingInitialDraw &&
      Array.isArray((game as any).pendingInitialDraw)
    ) {
      (game as any).pendingInitialDraw = new Set(
        ((game as any).pendingInitialDraw as any[]).filter(
          (x: any) => x !== pid
        )
      );
    }
    debug(1, "[deck] removePendingInitialDrawFlag", {
      gameId: game?.id ?? game?.state?.id ?? null,
      playerId: pid,
      pendingInitialDrawSize: (game as any).pendingInitialDraw?.size ?? null,
    });
  } catch (e) {
    debugWarn(1, "removePendingInitialDrawFlag failed:", e);
  }
}

/* --- snapshot helpers for cancellation --- */
export function restoreSnapshotIfPresent(io: Server, confirmId: string) {
  const p = pendingImportConfirmations.get(confirmId);
  if (!p) return;
  try {
    const game = ensureGame(p.gameId);
    if (!game) return;

    if (p.snapshotZones) {
      game.state = (game.state || {}) as GameState;
      game.state.zones = game.state.zones || {};
      game.state.zones[p.initiator] = p.snapshotZones;
    }

    if (p.snapshotCommandZone) {
      game.state = (game.state || {}) as GameState;
      game.state.commandZone = game.state.commandZone || {};
      game.state.commandZone[p.initiator] = p.snapshotCommandZone;
    }

    if (typeof p.snapshotPhase !== "undefined") {
      try {
        game.state = (game.state || {}) as GameState;
        (game.state as any).phase = p.snapshotPhase;
      } catch (e) {
        debugWarn(1, "restoreSnapshotIfPresent: failed to restore phase", e);
      }
    }

    // Remove pendingInitialDraw flag we set at import initiation
    try {
      removePendingInitialDrawFlag(game, p.initiator);
    } catch (e) {
      debugWarn(1, 
        "restoreSnapshotIfPresent: failed to remove pendingInitialDraw flag",
        e
      );
    }

    try {
      broadcastGame(io, game, p.gameId);
    } catch {
      /* best-effort */
    }
  } catch (err) {
    debugWarn(1, "restoreSnapshotIfPresent failed", err);
  }
}

export function cancelConfirmation(
  io: Server,
  confirmId: string,
  reason = "cancelled"
) {
  const p = pendingImportConfirmations.get(confirmId);
  if (!p) return;

  // Prevent stale RQ prompts from appearing after cancel/timeout.
  cancelImportWipeConfirmResolutionSteps(p.gameId, confirmId);

  if (p.timeout) {
    try {
      clearTimeout(p.timeout);
    } catch {
      /* ignore */
    }
  }

  try {
    // restore snapshots if present
    try {
      restoreSnapshotIfPresent(io, confirmId);
    } catch (e) {
      debugWarn(1, "cancelConfirmation: restoreSnapshotIfPresent failed", e);
    }

    io.to(p.gameId).emit("importWipeCancelled", {
      confirmId,
      gameId: p.gameId,
      by: p.initiator,
      reason,
    });
  } catch (e) {
    debugWarn(1, "cancelConfirmation emit failed", e);
  }
  pendingImportConfirmations.delete(confirmId);
}

/* Helper: clear transient importer zones (hand + command zone) */
export function clearPlayerTransientZonesForImport(game: any, pid: PlayerID) {
  try {
    game.state = game.state || {};
    game.state.zones = game.state.zones || {};
    game.state.zones[pid] = game.state.zones[pid] || {};

    // clear hand
    game.state.zones[pid].hand = [];
    game.state.zones[pid].handCount = 0;

    // clear command zone snapshot
    game.state.commandZone = game.state.commandZone || {};
    game.state.commandZone[pid] = {
      commanderIds: [],
      commanderCards: [],
      tax: 0,
      taxById: {},
    };

    // mark pre-game (best-effort; not required)
    try {
      (game.state as any).phase = "pre_game";
    } catch {
      /* ignore */
    }

    debug(1, "[deck] clearPlayerTransientZonesForImport", {
      gameId: game?.id ?? game?.state?.id ?? null,
      playerId: pid,
    });
  } catch (e) {
    debugWarn(1, "clearPlayerTransientZonesForImport failed:", e);
  }
}

/* Helper: best-effort active player ids */
export function getActivePlayerIds(
  game: any,
  io: Server,
  gameId: string
): string[] {
  try {
    const sPlayers =
      game && game.state && Array.isArray(game.state.players)
        ? game.state.players
        : null;
    if (sPlayers) {
      const active = sPlayers
        .filter((p: any) => !p?.inactive)
        .map((p: any) => p?.id)
        .filter(Boolean);
      if (active.length > 0) return Array.from(new Set(active));
      const ids = sPlayers.map((p: any) => p?.id).filter(Boolean);
      if (ids.length > 0) return Array.from(new Set(ids));
    }

    if (typeof (game as any).participants === "function") {
      try {
        const parts = (game as any).participants();
        const ids = Array.isArray(parts)
          ? parts.map((pp: any) => pp.playerId).filter(Boolean)
          : [];
        if (ids.length > 0) return Array.from(new Set(ids));
      } catch {
        /* ignore */
      }
    }

    try {
      const adapter = (io as any).sockets?.adapter;
      if (adapter && typeof adapter.rooms?.has === "function") {
        const room = adapter.rooms.get(gameId);
        if (room && typeof room[Symbol.iterator] === "function") {
          const sockets = Array.from(room as Iterable<any>);
          const parts =
            (game &&
              ((game as any).participants
                ? (game as any).participants()
                : (game as any).participantsList)) ||
            [];
          const mapping: Record<string, string> = {};
          for (const pp of parts || [])
            if (pp?.socketId && pp?.playerId)
              mapping[pp.socketId] = pp.playerId;
          const ids = sockets.map((sid: any) => mapping[sid]).filter(Boolean);
          if (ids.length > 0) return Array.from(new Set(ids));
        }
      }
    } catch {
      /* ignore */
    }
  } catch (e) {
    debugWarn(1, "getActivePlayerIds failed:", e);
  }
  return [];
}

/* suggest commander heuristics (unchanged) */
export function suggestCommanderNames(
  cards: Array<Pick<KnownCardRef, "name" | "type_line" | "oracle_text">>
) {
  const isLegendary = (tl?: string) => (tl || "").toLowerCase().includes(
    "legendary"
  );
  const isEligibleType = (tl?: string) => {
    const t = (tl || "").toLowerCase();
    return (
      t.includes("creature") ||
      t.includes("planeswalker") ||
      t.includes("background")
    );
  };
  const hasPartnerish = (oracle?: string, tl?: string) => {
    const o = (oracle || "").toLowerCase();
    const t = (tl || "").toLowerCase();
    return o.includes("partner") || o.includes("background") || t.includes(
      "background"
    );
  };
  const pool = cards.filter(
    (c: any) => isLegendary(c.type_line) && isEligibleType(c.type_line)
  );
  const first = pool[0];
  const second = pool.slice(1).find((c: any) => hasPartnerish(
    c.oracle_text,
    c.type_line
  ));
  const names: string[] = [];
  if (first?.name) names.push(first.name);
  if (second?.name && second.name !== first.name) names.push(second.name);
  return names.slice(0, 2);
}
