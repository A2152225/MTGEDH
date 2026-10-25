// server/src/state/modules/turn-handlers/turnStartLastTurnSnapshots.ts
// Origin parent: turnNextTurnStartOfTurn.ts (moved verbatim in Batch 24 to keep that file under 40KB).
// Cluster: "cards drawn / life lost / damage taken last turn" snapshots and the cards-drawn reset.
// Public entry symbols: snapshotLastTurnCountersAndResetDraws.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";

export function snapshotLastTurnCountersAndResetDraws(ctx: GameContext, players: string[], current: string): void {
    // Snapshot "cards drawn last turn" before clearing per-turn trackers.
    // Used by intervening-if clauses like "if you drew a card last turn".
    try {
      const last: any = {};
      for (const pid of players) last[String(pid)] = 0;
      const cur = (ctx as any).state.cardsDrawnThisTurn;
      if (cur && typeof cur === 'object') {
        for (const [pid, v] of Object.entries(cur)) {
          if (typeof v === 'number' && !Number.isNaN(v)) last[String(pid)] = v;
        }
      }
      (ctx as any).state.cardsDrawnLastTurnByPlayerCounts = last;

      // Legacy aliases used by intervening-if fallbacks.
      (ctx as any).state.cardsDrawnLastTurnByPlayer = last;
      (ctx as any).state.cardsDrawnLastTurn = last;

      // Convenience: how many cards did the previous turn's active player draw?
      // Note: `current` is the old turn player (before we assigned `next`).
      if (typeof current === 'string' && current) {
        (ctx as any).state.cardsDrawnLastTurnByActivePlayerCount = last[String(current)] || 0;
      }
    } catch {}

    // Reset cards drawn this turn for all players (for miracle tracking)
    (ctx as any).state.cardsDrawnThisTurn = {};
    for (const pid of players) {
      (ctx as any).state.cardsDrawnThisTurn[String(pid)] = 0;
    }

    // Snapshot "life lost last turn" before clearing per-turn trackers.
    // Used by intervening-if clauses like "if you lost life last turn".
    try {
      const last: any = {};
      for (const pid of players) last[String(pid)] = 0;
      const cur = (ctx as any).state.lifeLostThisTurn;
      if (cur && typeof cur === 'object') {
        for (const [pid, v] of Object.entries(cur)) {
          if (typeof v === 'number' && !Number.isNaN(v)) last[String(pid)] = v;
        }
      }
      (ctx as any).state.lifeLostLastTurnByPlayerCounts = last;

      // Legacy aliases used by intervening-if fallbacks.
      (ctx as any).state.lifeLostLastTurnByPlayer = last;
      (ctx as any).state.lifeLostLastTurn = last;
    } catch {}

    // Snapshot "damage taken last turn" before clearing per-turn trackers.
    // Used by intervening-if clauses like "if an opponent was dealt damage this turn".
    try {
      const last: any = {};
      for (const pid of players) last[String(pid)] = 0;
      const cur = (ctx as any).state.damageTakenThisTurnByPlayer;
      if (cur && typeof cur === 'object') {
        for (const [pid, v] of Object.entries(cur)) {
          if (typeof v === 'number' && !Number.isNaN(v)) last[String(pid)] = v;
        }
      }
      (ctx as any).state.damageTakenLastTurnByPlayerCounts = last;
    } catch {}
}
