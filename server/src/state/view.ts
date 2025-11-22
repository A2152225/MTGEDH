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
  };

  const zones = (ctx as any).zones || {};
  const libraries: Map<string, any[]> = (ctx as any).libraries || new Map();

  for (const pid of Object.keys(zones)) {
    const z = zones[pid] as PlayerZones | undefined;
    if (!z) {
      out.zones[pid] = { hand: [], handCount: 0, libraryCount: libraries.get(pid)?.length ?? 0, graveyard: [], graveyardCount: 0 };
      continue;
    }

    const libLen = libraries.get(pid)?.length ?? (z.libraryCount ?? 0);

    if (!spectator && viewer && viewer === pid) {
      // For the viewing player, show all their own cards as known
      out.zones[pid] = {
        hand: Array.isArray(z.hand) ? (z.hand as any[]).map(h => ({ ...h, known: true })) : [],
        handCount: z.handCount ?? (Array.isArray(z.hand) ? (z.hand as any[]).length : 0),
        libraryCount: libLen,
        graveyard: Array.isArray(z.graveyard) ? (z.graveyard as any[]).map(g => ({ ...g })) : [],
        graveyardCount: z.graveyardCount ?? (Array.isArray(z.graveyard) ? (z.graveyard as any[]).length : 0),
        exile: Array.isArray(z.exile) ? (z.exile as any[]).map(e => ({ ...e })) : [],
      };
    } else {
      // For other players, include cards but mark them as unknown (unless already marked as known via knownTo)
      const handCards = Array.isArray(z.hand) ? (z.hand as any[]) : [];
      out.zones[pid] = {
        hand: handCards.map(h => {
          // Check if this card is known to the viewer (e.g., via effects like Telepathy)
          const isKnownToViewer = viewer && Array.isArray(h.knownTo) && h.knownTo.includes(viewer);
          return {
            id: h.id,
            name: isKnownToViewer ? h.name : undefined,
            type_line: isKnownToViewer ? h.type_line : undefined,
            oracle_text: isKnownToViewer ? h.oracle_text : undefined,
            image_uris: isKnownToViewer ? h.image_uris : undefined,
            mana_cost: isKnownToViewer ? h.mana_cost : undefined,
            power: isKnownToViewer ? h.power : undefined,
            toughness: isKnownToViewer ? h.toughness : undefined,
            faceDown: !isKnownToViewer,
            known: isKnownToViewer,
          };
        }),
        handCount: z.handCount ?? handCards.length,
        libraryCount: libLen,
        graveyard: [],
        graveyardCount: z.graveyardCount ?? 0,
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
    out.players = participants.map((p: any, idx: number) => ({ id: p.playerId, name: p.name || `Player ${idx + 1}`, seat: idx }));
  }

  return out as ClientGameView;
}

export default viewFor;