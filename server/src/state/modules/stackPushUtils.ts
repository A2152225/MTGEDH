import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { recordCommittedCrimeThisTurn } from './turn-tracking.js';

export function pushStack(
  ctx: GameContext,
  item: {
    id: string;
    controller: PlayerID;
    card: any;
    targets?: string[];
  },
) {
  const { state } = ctx;

  try {
    const controllerId = String((item as any)?.controller ?? '');
    const targets = Array.isArray((item as any)?.targets) ? ((item as any).targets as any[]) : [];
    if (controllerId && targets.length > 0) {
      recordCommittedCrimeThisTurn(state, controllerId, targets);
    }
  } catch {
    // best-effort only
  }

  state.stack = state.stack || [];
  state.stack.push(item as any);
  ctx.bumpSeq();
}

export function popStackItem(ctx: GameContext) {
  const stackState = ctx.state;
  if (!stackState.stack || stackState.stack.length === 0) return null;
  return stackState.stack.pop()!;
}
