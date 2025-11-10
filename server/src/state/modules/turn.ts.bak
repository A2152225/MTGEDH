import { GamePhase, GameStep } from "../types";
import type { GameContext } from "../context";
import type { PlayerID, PlayerRef } from "../types";

const stepOrder: ReadonlyArray<{ phase: GamePhase; step: GameStep }> = [
  { phase: GamePhase.BEGINNING, step: GameStep.UNTAP },
  { phase: GamePhase.BEGINNING, step: GameStep.UPKEEP },
  { phase: GamePhase.BEGINNING, step: GameStep.DRAW },
  { phase: GamePhase.PRECOMBAT_MAIN, step: GameStep.MAIN1 },
  { phase: GamePhase.COMBAT, step: GameStep.BEGIN_COMBAT },
  { phase: GamePhase.COMBAT, step: GameStep.DECLARE_ATTACKERS },
  { phase: GamePhase.COMBAT, step: GameStep.DECLARE_BLOCKERS },
  { phase: GamePhase.COMBAT, step: GameStep.DAMAGE },
  { phase: GamePhase.COMBAT, step: GameStep.END_COMBAT },
  { phase: GamePhase.POSTCOMBAT_MAIN, step: GameStep.MAIN2 },
  { phase: GamePhase.END, step: GameStep.END },
  { phase: GamePhase.END, step: GameStep.CLEANUP }
];

function indexOfCurrentStep(ctx: GameContext): number {
  const { state } = ctx;
  const idx = stepOrder.findIndex(s => s.phase === state.phase && s.step === state.step);
  return idx >= 0 ? idx : 0;
}

function applyStartOfStepActions(ctx: GameContext) {
  const { state, bumpSeq, libraries } = ctx;
  if (state.step === GameStep.UNTAP) {
    for (const perm of state.battlefield) {
      if (perm.controller === state.turnPlayer) perm.tapped = false;
    }
    bumpSeq();
  } else if (state.step === GameStep.DRAW) {
    // draw is delegated to zones module's drawCards via composite object later
    // actual invocation handled in applyEvent or nextStep path
  }
}

function beginTurnFor(ctx: GameContext, player: PlayerID) {
  const { state, passesInRow, bumpSeq } = ctx;
  state.turnPlayer = player;
  state.priority = player;
  state.phase = GamePhase.BEGINNING;
  state.step = GameStep.UNTAP;
  state.landsPlayedThisTurn = {};
  for (const p of (state.players as any as PlayerRef[])) state.landsPlayedThisTurn[p.id] = 0;
  passesInRow.value = 0;
  bumpSeq();
  applyStartOfStepActions(ctx);
}

function activePlayersClockwise(ctx: GameContext): PlayerRef[] {
  const { state, inactive } = ctx;
  return (state.players as any as PlayerRef[])
    .filter(p => !inactive.has(p.id))
    .sort((a, b) => a.seat - b.seat);
}

export function nextTurn(ctx: GameContext) {
  const { state } = ctx;
  const current = state.turnPlayer;
  const active = activePlayersClockwise(ctx);
  const currentIdx = active.findIndex(p => p.id === current);
  const step = state.turnDirection === -1 ? -1 : 1;
  const nextIdx = active.length
    ? ((currentIdx >= 0 ? currentIdx : 0) + step + active.length) % active.length
    : 0;
  const next = active[nextIdx]?.id as PlayerID || ((state.players as any as PlayerRef[])[0]?.id as PlayerID);
  beginTurnFor(ctx, next);
}

export function nextStep(ctx: GameContext) {
  const { state, passesInRow, bumpSeq } = ctx;
  if (!state.step) {
    state.phase = GamePhase.BEGINNING;
    state.step = GameStep.UNTAP;
    applyStartOfStepActions(ctx);
    return;
  }
  const idx = indexOfCurrentStep(ctx);
  if (idx < stepOrder.length - 1) {
    const next = stepOrder[idx + 1];
    state.phase = next.phase;
    state.step = next.step;
    state.priority = state.turnPlayer;
    passesInRow.value = 0;
    bumpSeq();
    applyStartOfStepActions(ctx);
  } else {
    nextTurn(ctx);
  }
}

export function exposeStepOrder() {
  return stepOrder;
}