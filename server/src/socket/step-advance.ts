import type { Server } from 'socket.io';
import type { InMemoryGame } from '../state/types';
import { emitPendingDamageTriggers } from './damage-triggers.js';

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