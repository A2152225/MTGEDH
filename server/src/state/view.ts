// server/src/state/view.ts
// Create a client-scoped view from the authoritative GameContext.
// Fixed import path to shared types.

import type { GameContext } from "./context";
import type { ClientGameView, PlayerID, PlayerRef, PlayerZones, KnownCardRef } from "../../../shared/src/types";

/**
 * Produce a ClientGameView for a specific viewer (playerId) or for a spectator.
 */
export function viewFor(ctx: GameContext, viewer?: PlayerID, spectator = false): ClientGameView {
  const state = ctx.state as any;

  const out: any = {
    id: state.id,
    format: state.format,
    players: Array.isArray(state.players) ? (state.players as PlayerRef[]).map(p => ({ ...p })) : [],
    startingLife: state.startingLife,
    life: { ...(state.life || {}) },
    turnPlayer: state.turnPlayer,
    priority: state.priority,
    turnDirection: state.turnDirection,
    stack: Array.isArray(state.stack) ? state.stack.map((s: any) => ({ ...s })) : [],
    battlefield: Array.isArray(state.battlefield) ? state.battlefield.map((b: any) => ({ ...b })) : [],
    commandZone: { ...(state.commandZone || {}) },
    phase: state.phase,
    step: state.step,
    active: Boolean(state.active),
    zones: {},
    status: state.status,
    turnOrder: Array.isArray(state.turnOrder) ? [...state.turnOrder] : undefined,
    startedAt: state.startedAt,
    turn: state.turn,
    activePlayerIndex: state.activePlayerIndex,
    landsPlayedThisTurn: state.landsPlayedThisTurn ? { ...state.landsPlayedThisTurn } : undefined,
    manaPool: state.manaPool ? { ...state.manaPool } : undefined,
  };

  const zones = (ctx as any).zones || {};
  const libraries: Map<string, any[]> = (ctx as any).libraries || new Map();

  for (const pid of Object.keys(zones)) {
    const z = zones[pid] as PlayerZones | undefined;
    if (!z) {
      out.zones[pid] = {
        hand: [],
        handCount: 0,
        libraryCount: libraries.get(pid)?.length ?? 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
      };
      continue;
    }

    const libLen = libraries.get(pid)?.length ?? (z.libraryCount ?? 0);

    const fullHand = Array.isArray(z.hand) ? (z.hand as any[]) : [];
    const fullGraveyard = Array.isArray(z.graveyard) ? (z.graveyard as any[]) : [];
    const fullExile = Array.isArray(z.exile) ? (z.exile as any[]) : [];

    const isViewer = !spectator && viewer && viewer === pid;

    if (isViewer) {
      // For the viewer's own zones, clone full detail (existing behavior).
      out.zones[pid] = {
        hand: fullHand.map(h => ({ ...h })),
        handCount: z.handCount ?? fullHand.length,
        libraryCount: libLen,
        graveyard: fullGraveyard.map(g => ({ ...g })),
        graveyardCount: z.graveyardCount ?? fullGraveyard.length,
        exile: fullExile.map(e => ({ ...e })),
      };
    } else {
      // For opponents / spectators: send a stub array matching handCount so the
      // client can render card backs, without leaking identities.
      const handCount = z.handCount ?? fullHand.length;

      const opponentHandStubs =
        handCount > 0
          ? Array.from({ length: handCount }, (_v, idx) => ({
              id: `hidden-${pid}-${idx}`,
              faceDown: true,
              known: false,
            }))
          : [];

      out.zones[pid] = {
        hand: opponentHandStubs,
        handCount,
        libraryCount: libLen,
        graveyard: [],
        graveyardCount: z.graveyardCount ?? fullGraveyard.length ?? 0,
        exile: [],
      };
    }
  }

  if ((ctx as any).poison) {
    out.poisonCounters = { ...(ctx as any).poison };
  }
  if ((ctx as any).experience) {
    out.experienceCounters = { ...(ctx as any).experience };
  }

  if (!Array.isArray(out.players) || out.players.length === 0) {
    const participants = (ctx as any).participantsList || [];
    out.players = participants.map((p: any, idx: number) => ({
      id: p.playerId,
      name: p.name || `Player ${idx + 1}`,
      seat: idx,
    }));
  }

  return out as ClientGameView;
}

export default viewFor;