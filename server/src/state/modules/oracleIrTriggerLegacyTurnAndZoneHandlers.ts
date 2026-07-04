import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { addExtraTurn } from './turn.js';
import { debug } from '../../utils/debug.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacyTurnAndZoneParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly description: string;
  readonly desc?: string;
  readonly triggerItem: any;
  readonly state: any;
}

export function applyRetiredTriggerLegacyGainControlOfTargetOpponent(
  params: Pick<TriggerLegacyTurnAndZoneParams, 'ctx' | 'controller' | 'sourceName' | 'description' | 'triggerItem' | 'state'>,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.description, params.sourceName)) {
    return false;
  }

  if (!String(params.description || '').toLowerCase().includes('gain control of target opponent')) {
    return false;
  }

  const targets = params.triggerItem.targets || [];
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
