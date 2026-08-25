/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Shared leaf: the shape of registerGameActions' `ensureInGameRoom` closure.
 * Extracted socket handlers take it as a parameter instead of closing over it,
 * so their bodies move out of registerGameActions unchanged.
 *
 * Public entry symbols: EnsureInGameRoom.
 */
export type EnsureInGameRoom = (
  gameId: string,
  options?: { code?: string; message?: string },
) => boolean;
