import { ResolutionQueueManager } from '../resolution/index.js';
import { resolveTopOfStack } from './stackResolveTopOfStackUtils.js';

/**
 * When an IR-handled spell queues resolution choices, the stack item is re-pushed
 * with oracleIrDeferredFinalize until the queue empties. Live play resumes via
 * socket handlers; replay/applyEvent must call this after choice events apply.
 */
export function ensureDeferredOracleIrStackItem(ctx: any, sourceId?: string): void {
  const stack = Array.isArray(ctx?.state?.stack) ? ctx.state.stack : [];
  if (stack.length === 0) return;

  const sid = String(sourceId || '').trim();
  const match = sid
    ? stack.find((entry: any) => {
      const entryId = String(entry?.id || '').trim();
      const cardId = String(entry?.card?.id || '').trim();
      return entryId === sid || cardId === sid;
    })
    : stack[stack.length - 1];

  if (match) {
    (match as any).oracleIrDeferredFinalize = true;
  }
}

export function maybeResumeDeferredOracleIrStackSpell(ctx: any): void {
  const gameId = String(ctx?.gameId || '').trim();
  if (!gameId) return;

  const pendingSteps = ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0;
  if (pendingSteps > 0) return;

  const state = ctx?.state;
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  if (stack.length === 0) return;

  const top = stack[stack.length - 1] as any;
  if (!top || top.oracleIrDeferredFinalize !== true) return;

  resolveTopOfStack(ctx);
}

export function maybeResumeDeferredOracleIrStackSpellOnGame(game: any, gameId: string): void {
  const ctx = (game as any)?.ctx || game;
  ctx.gameId = gameId;
  ctx.state = game.state;
  maybeResumeDeferredOracleIrStackSpell(ctx);
}
