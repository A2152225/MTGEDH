/**
 * Turn number of a player's next turn.
 *
 * Origin: server/src/socket/player-selection.ts (getNextTurnNumberForPlayer).
 * Shared so Oracle IR goad, replay mutations, and server GoadPermanent effects
 * expire at the goader's next turn (CR 701.15, "until your next turn"), not on
 * the next turn number.
 *
 * Public entry: nextTurnNumberForPlayer.
 */

function activeTurnOrder(state: any): string[] {
  const players = Array.isArray(state?.players) ? state.players : [];
  const activePlayerIds = players
    .filter((player: any) => player?.id && !player?.hasLost)
    .map((player: any) => String(player.id));

  const ordered = Array.isArray(state?.turnOrder)
    ? state.turnOrder.map((playerId: any) => String(playerId)).filter((playerId: string) => activePlayerIds.includes(playerId))
    : [];

  for (const playerId of activePlayerIds) {
    if (!ordered.includes(playerId)) {
      ordered.push(playerId);
    }
  }

  return ordered;
}

export function nextTurnNumberForPlayer(state: any, playerId: string): number {
  const currentTurn = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
  const targetPlayerId = String(playerId || '');
  if (!targetPlayerId) {
    return currentTurn + 1;
  }

  const extraTurns = Array.isArray(state?.extraTurns) ? state.extraTurns : [];
  const extraTurnIndex = extraTurns.findIndex((entry: any) => String(entry?.playerId || '') === targetPlayerId);
  if (extraTurnIndex >= 0) {
    return currentTurn + extraTurnIndex + 1;
  }

  const turnOrder = activeTurnOrder(state);
  if (turnOrder.length === 0) {
    return currentTurn + 1;
  }

  const currentPlayerId = String(state?.turnPlayer || turnOrder[0] || '');
  const currentIndex = turnOrder.indexOf(currentPlayerId);
  const targetIndex = turnOrder.indexOf(targetPlayerId);
  if (currentIndex < 0 || targetIndex < 0) {
    return currentTurn + 1;
  }

  const turnDirection = Number(state?.turnDirection) === -1 ? -1 : 1;
  let stepsUntilTurn = turnDirection === -1
    ? (currentIndex - targetIndex + turnOrder.length) % turnOrder.length
    : (targetIndex - currentIndex + turnOrder.length) % turnOrder.length;

  if (stepsUntilTurn === 0) {
    stepsUntilTurn = turnOrder.length;
  }

  return currentTurn + extraTurns.length + stepsUntilTurn;
}
