import type { GameContext } from '../context.js';

type SkipUntapState = {
  skipNextUntapStepByPlayer?: Record<string, boolean>;
};

function stateAny(ctx: GameContext): SkipUntapState & Record<string, unknown> {
  return ((ctx as any).state || {}) as SkipUntapState & Record<string, unknown>;
}

/** Stasis-style: all players skip their untap steps while this permanent is on the battlefield. */
export function hasGlobalPlayersSkipUntapSteps(ctx: GameContext): boolean {
  const battlefield = (ctx as any).state?.battlefield || [];
  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    const oracleText = String(permanent.card.oracle_text || '').toLowerCase();
    if (/players\s+skip\s+their\s+untap\s+steps?/.test(oracleText)) {
      return true;
    }
  }
  return false;
}

export function playerHasSkipNextUntapStep(ctx: GameContext, playerId: string): boolean {
  const pid = String(playerId || '').trim();
  if (!pid) return false;
  const flags = stateAny(ctx).skipNextUntapStepByPlayer;
  return flags?.[pid] === true;
}

export function markPlayerSkipsNextUntapStep(ctx: GameContext, playerId: string): void {
  const pid = String(playerId || '').trim();
  if (!pid) return;
  const state = stateAny(ctx);
  state.skipNextUntapStepByPlayer = state.skipNextUntapStepByPlayer || {};
  state.skipNextUntapStepByPlayer[pid] = true;
}

export function consumePlayerSkipNextUntapStep(ctx: GameContext, playerId: string): boolean {
  const pid = String(playerId || '').trim();
  if (!pid) return false;
  const state = stateAny(ctx);
  const flags = state.skipNextUntapStepByPlayer;
  if (!flags?.[pid]) return false;
  delete flags[pid];
  if (Object.keys(flags).length === 0) {
    delete state.skipNextUntapStepByPlayer;
  }
  return true;
}

/** Rule 502.1: true when the active player's untap step turn action should be skipped. */
export function shouldSkipUntapStepForPlayer(ctx: GameContext, turnPlayer: string): boolean {
  if (hasGlobalPlayersSkipUntapSteps(ctx)) return true;
  return playerHasSkipNextUntapStep(ctx, turnPlayer);
}
