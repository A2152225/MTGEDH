import type { Server } from 'socket.io';
import { appendEvent } from '../db/index.js';
import type { InMemoryGame } from '../state/types';
import { emitPendingDamageTriggers } from './damage-triggers.js';
import { debugWarn } from '../utils/debug.js';

/**
 * Flush queued damage-received trigger prompts immediately after a socket-driven
 * step advance so combat damage choices are offered in the same combat window.
 */
export function flushPendingDamageTriggersAfterStepAdvance(
  io: Server,
  game: InMemoryGame,
  gameId: string,
): number {
  return emitPendingDamageTriggers(io, game, gameId);
}

/**
 * Persist nextStep *before* applying it, then run nextStep() + damage-trigger flush.
 *
 * Live sockets historically called nextStep() first (which appends pushTriggeredAbility
 * during turn-step entry) and only then appendEvent(nextStep). That inverted order
 * causes replay to apply the persisted push and live-push again, leaking stack items
 * across turns. Recording nextStep first keeps pushTriggeredAbility after nextStep.
 */
export function advanceStepPersistingEvent(
  io: Server,
  game: InMemoryGame,
  gameId: string,
  payload: Record<string, unknown> = {},
): boolean {
  if (typeof (game as any).nextStep !== 'function') {
    return false;
  }
  try {
    appendEvent(gameId, (game as any).seq || 0, 'nextStep', payload);
  } catch (err) {
    debugWarn(1, 'advanceStepPersistingEvent: appendEvent(nextStep) failed:', err);
  }
  (game as any).nextStep();
  flushPendingDamageTriggersAfterStepAdvance(io, game as any, gameId);
  return true;
}
