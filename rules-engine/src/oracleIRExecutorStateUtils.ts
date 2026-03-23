import type { GameState } from '../../shared/src';

export function findPlayerById(state: GameState, playerIdRaw: string): any | null {
  const playerId = String(playerIdRaw || '').trim();
  if (!playerId) return null;
  return (state.players || []).find((player: any) => String((player as any)?.id || '').trim() === playerId) || null;
}
