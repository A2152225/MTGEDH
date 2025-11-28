import type { PlayerID, PlayerRef } from "../../../../shared/src";
import type { GameContext } from "../context";

function activePlayersClockwise(ctx: GameContext): PlayerRef[] {
  const { state, inactive } = ctx;
  return (state.players as any as PlayerRef[])
    .filter(p => !inactive.has(p.id))
    .sort((a, b) => a.seat - b.seat);
}

function advancePriorityClockwise(ctx: GameContext, from: PlayerID): PlayerID {
  const active = activePlayersClockwise(ctx);
  const n = active.length;
  if (n === 0) return from;
  const idx = active.findIndex(p => p.id === from);
  const step = ctx.state.turnDirection === -1 ? -1 : 1;
  const nextIdx = ((idx >= 0 ? idx : 0) + step + n) % n;
  return active[nextIdx].id as PlayerID;
}

export function passPriority(ctx: GameContext, playerId: PlayerID): { changed: boolean; resolvedNow: boolean; advanceStep: boolean } {
  const { state, passesInRow, bumpSeq } = ctx;
  if (state.priority !== playerId) return { changed: false, resolvedNow: false, advanceStep: false };
  const active = activePlayersClockwise(ctx);
  const n = active.length;
  if (n === 0) return { changed: false, resolvedNow: false, advanceStep: false };
  
  // Track that this player passed priority
  const stateAny = state as any;
  if (!stateAny.priorityPassedBy || !(stateAny.priorityPassedBy instanceof Set)) {
    stateAny.priorityPassedBy = new Set<string>();
  }
  stateAny.priorityPassedBy.add(playerId);
  
  state.priority = advancePriorityClockwise(ctx, playerId);
  bumpSeq();
  
  let resolvedNow = false;
  let advanceStep = false;
  
  // Check if all active players have passed priority
  const allPassed = active.every(p => stateAny.priorityPassedBy.has(p.id));
  
  if (state.stack.length > 0) {
    passesInRow.value++;
    if (passesInRow.value >= n || allPassed) {
      resolvedNow = true;
      passesInRow.value = 0;
      stateAny.priorityPassedBy = new Set<string>(); // Reset tracking
    }
  } else {
    passesInRow.value = 0;
    // If all players passed with empty stack, advance step
    if (allPassed) {
      advanceStep = true;
      stateAny.priorityPassedBy = new Set<string>(); // Reset tracking
    }
  }
  
  return { changed: true, resolvedNow, advanceStep };
}

export function setTurnDirection(ctx: GameContext, dir: 1 | -1) {
  ctx.state.turnDirection = dir;
  ctx.bumpSeq();
}