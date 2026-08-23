import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { addExtraTurn } from './turn.js';
import { debug } from '../../utils/debug.js';

const CONTROL_NEXT_TURN_PATTERN =
  /gain\s+control\s+of\s+target\s+opponent\s+during\s+that\s+(?:player|opponent)['\u2019]?s\s+next\s+turn/i;

const AFTER_THAT_TURN_EXTRA_TURN_PATTERN =
  /after\s+that\s+turn,?\s+that\s+(?:player|opponent)\s+takes?\s+an?\s+extra\s+turn/i;

/** True for oracle text that grants control of a player during their next turn. */
export function isControlOfTargetOpponentNextTurnEffect(description: string): boolean {
  return CONTROL_NEXT_TURN_PATTERN.test(String(description || ''));
}

/**
 * Generic on-cast / trigger effect:
 * "you gain control of target opponent during that player's next turn.
 *  After that turn, that player takes an extra turn."
 *
 * Registers controlledPlayerNextTurn and optionally queues the drawback extra turn.
 */
export function applyControlOfTargetOpponentNextTurnFromTrigger(params: {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly description: string;
  readonly triggerItem: any;
  readonly state: any;
}): boolean {
  if (!isControlOfTargetOpponentNextTurnEffect(params.description)) {
    return false;
  }

  const targets = params.triggerItem?.targets || [];
  if (targets.length === 0) {
    // Legal no-op when no legal target (e.g. cancelled / empty).
    return true;
  }

  const targetOpponentId = String(targets[0]?.id || targets[0] || '').trim();
  if (!targetOpponentId) {
    return true;
  }

  const stateAny = params.state as any;
  stateAny.controlledPlayerNextTurn = stateAny.controlledPlayerNextTurn || {};
  stateAny.controlledPlayerNextTurn[targetOpponentId] = params.controller;

  if (AFTER_THAT_TURN_EXTRA_TURN_PATTERN.test(String(params.description || ''))) {
    addExtraTurn(
      params.ctx,
      targetOpponentId as PlayerID,
      params.sourceName || 'control next turn drawback',
    );
  }

  debug(
    2,
    `[executeTriggerEffect] control-next-turn: player ${params.controller} will control ${targetOpponentId} next turn`,
  );
  return true;
}

/** @deprecated Prefer applyControlOfTargetOpponentNextTurnFromTrigger (generic oracle pattern). */
export const applyEmrakulGainControlOfTargetOpponentFromTrigger =
  applyControlOfTargetOpponentNextTurnFromTrigger;
