import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { runSBA } from './counters_tokens.js';

export function finalizeResolveTopOfStackAfterEffects(ctx: GameContext): void {
  const state = (ctx as any).state;
  const bumpSeq = typeof (ctx as any).bumpSeq === 'function'
    ? (ctx as any).bumpSeq.bind(ctx)
    : () => {};

  try {
    runSBA(ctx);
  } catch (err) {
    debugWarn(1, '[resolveTopOfStack] Error running SBA:', err);
  }

  try {
    (state as any).priorityPassedBy = new Set<string>();
    debug(2, `[resolveTopOfStack] Reset priorityPassedBy after spell resolution`);
  } catch (err) {
    debugWarn(1, '[resolveTopOfStack] Error resetting priorityPassedBy:', err);
  }

  bumpSeq();
}
