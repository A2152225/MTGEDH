import type { Server } from 'socket.io';
import type { InMemoryGame } from '../state/types.js';
import {
  buildCombatDamageChatMessages,
  drainPendingCombatDamageChat,
} from '../state/modules/combatDamageChat.js';

export function emitPendingCombatDamageChat(
  io: Server,
  game: InMemoryGame,
  gameId: string,
): void {
  const state = game?.state as any;
  if (!state) return;

  const pending = drainPendingCombatDamageChat(state);
  if (pending.length === 0) return;

  for (const entry of pending) {
    const messages = buildCombatDamageChatMessages(game, entry);
    for (const message of messages) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        gameId,
        from: 'system',
        message,
        ts: Date.now(),
      });
    }
  }
}
