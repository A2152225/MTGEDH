// server/src/state/modules/batch96CauseGuard.ts
// B96: hook helpers for Tamiyo, Compleated Sage — opponent-caused discard
// and sacrifice. Does not block a player's own costs or self-controlled
// abilities. Public: inferCausingController, shouldBlockOpponentForcedDiscardOrSacrifice.

import { playerHasOpponentCantForceDiscardOrSacrifice } from './staticEffectSpec-handlers/batch95LongTailStatics.js';

function stackTop(state: any): any | undefined {
  const stack = Array.isArray(state?.stack) ? state.stack : (Array.isArray(state?.stackItems) ? state.stackItems : []);
  if (stack.length) return stack[stack.length - 1];
  return state?.resolvingStackItem || state?.currentResolution?.source || state?.resolvingAbility || undefined;
}

export function inferCausingController(ctxOrState: any, explicit?: string): string | undefined {
  if (explicit) return String(explicit);
  const state = ctxOrState?.state && typeof ctxOrState.state === 'object' && ctxOrState.battlefield == null
    ? ctxOrState.state
    : ctxOrState;
  const ctx = ctxOrState;
  const fromCtx = String(ctx?.causingController || ctx?.sourceController || state?.causingController || '').trim();
  if (fromCtx) return fromCtx;
  const top = stackTop(state);
  const fromStack = String(top?.controller || top?.owner || top?.sourceController || top?.card?.controller || '').trim();
  return fromStack || undefined;
}

/**
 * True when an opponent-controlled spell or ability is trying to make
 * `affectedPlayerId` discard or sacrifice, and that player has Tamiyo's shield.
 * Own costs (no causing controller, or the cause is the affected player) pass through.
 */
export function shouldBlockOpponentForcedDiscardOrSacrifice(
  state: any,
  affectedPlayerId: string,
  causingController?: string,
): boolean {
  const affected = String(affectedPlayerId || '').trim();
  if (!affected) return false;
  if (!playerHasOpponentCantForceDiscardOrSacrifice(state, affected)) return false;
  const cause = String(causingController || '').trim();
  if (!cause) return false;
  return cause !== affected;
}

export function shouldBlockOpponentForcedActionFromContext(
  ctx: any,
  affectedPlayerId: string,
  explicitCause?: string,
): boolean {
  const state = ctx?.state ?? ctx;
  return shouldBlockOpponentForcedDiscardOrSacrifice(state, affectedPlayerId, inferCausingController(ctx, explicitCause));
}
