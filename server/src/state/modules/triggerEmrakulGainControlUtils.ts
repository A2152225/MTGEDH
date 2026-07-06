import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { addExtraTurn } from './turn.js';
import { debug } from '../../utils/debug.js';

export function applyEmrakulGainControlOfTargetOpponentFromTrigger(
  params: {
    readonly ctx: GameContext;
    readonly controller: PlayerID;
    readonly sourceName: string;
    readonly description: string;
    readonly triggerItem: any;
    readonly state: any;
  },
): boolean {
  if (!String(params.description || '').toLowerCase().includes('gain control of target opponent')) {
    return false;
  }

  const targets = params.triggerItem?.targets || [];
  if (targets.length === 0) {
    return true;
  }

  const targetOpponentId = targets[0];
  const stateAny = params.state as any;
  stateAny.controlledPlayerNextTurn = stateAny.controlledPlayerNextTurn || {};
  stateAny.controlledPlayerNextTurn[targetOpponentId] = params.controller;

  addExtraTurn(params.ctx, targetOpponentId, params.sourceName || 'Emrakul, the Promised End (drawback)');
  debug(2, `[executeTriggerEffect] Emrakul, the Promised End cast trigger: player ${params.controller} will control ${targetOpponentId} next turn`);
  return true;
}
