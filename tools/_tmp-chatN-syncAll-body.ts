export function syncAllOracleIRPlayerZonesAfterResolution(ctx: GameContext): void {
  const state = (ctx as any).state;
  if (!state) return;
  const graveyardBefore = snapshotGraveyardCardIds(state);
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim() as PlayerID;
    if (playerId) {
      syncOracleIRPlayerZonesToContext(ctx, state, playerId, graveyardBefore);
    }
  }
}

